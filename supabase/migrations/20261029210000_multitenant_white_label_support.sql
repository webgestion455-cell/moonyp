-- MOONYP white-label, multi-tenant support foundation.
-- Additive migration: existing MOONYP conversations remain in the platform workspace
-- because organization_id is nullable. Tenant conversations must always be scoped by
-- organization membership in the server-side support API.
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$'),
  logo_url text,
  brand_color text not null default '#166534' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#0f172a' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  welcome_message jsonb not null default '{}'::jsonb,
  default_locale text not null default 'en',
  enabled_locales text[] not null default array['en','fr','de','es','it','pt','nl','pl','ru','ar','zh','ja','ko','tr','sw']::text[],
  support_email text,
  public_chat_enabled boolean not null default true,
  status text not null default 'active' check (status in ('active','suspended','pending')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent' check (role in ('owner','admin','supervisor','agent','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.chat_conversations
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

create index if not exists idx_org_members_user_active
  on public.organization_members(user_id, active);
create index if not exists idx_chat_conversations_org_status
  on public.chat_conversations(organization_id, status, last_message_at desc);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

grant select, insert, update on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant all on public.organizations, public.organization_members to service_role;

drop policy if exists organizations_read_members on public.organizations;
create policy organizations_read_members on public.organizations
  for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = organizations.id
      and m.user_id = auth.uid() and m.active
  ) or public.is_super_admin(auth.uid()));

drop policy if exists organizations_update_admins on public.organizations;
create policy organizations_update_admins on public.organizations
  for update to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = organizations.id
      and m.user_id = auth.uid() and m.active and m.role in ('owner','admin')
  ) or public.is_super_admin(auth.uid()))
  with check (exists (
    select 1 from public.organization_members m
    where m.organization_id = organizations.id
      and m.user_id = auth.uid() and m.active and m.role in ('owner','admin')
  ) or public.is_super_admin(auth.uid()));

drop policy if exists organization_members_read_same_org on public.organization_members;
create policy organization_members_read_same_org on public.organization_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_members.organization_id
        and m.user_id = auth.uid() and m.active and m.role in ('owner','admin','supervisor')
    )
    or public.is_super_admin(auth.uid())
  );

-- Tenant-safe policies for direct authenticated access to chat tables.
-- Existing platform-only conversations (organization_id IS NULL) retain their
-- existing permission model; tenant conversations require active membership.
drop policy if exists chat_conv_read on public.chat_conversations;
create policy chat_conv_read on public.chat_conversations
  for select to authenticated
  using (
    (organization_id is null and (auth.uid() = user_id or public.has_permission(auth.uid(), 'chat.view')))
    or (organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.organization_id = chat_conversations.organization_id
        and m.user_id = auth.uid() and m.active
    ))
  );

drop policy if exists chat_conv_update on public.chat_conversations;
create policy chat_conv_update on public.chat_conversations
  for update to authenticated
  using (
    (organization_id is null and (auth.uid() = user_id or public.has_permission(auth.uid(), 'chat.reply')))
    or (organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.organization_id = chat_conversations.organization_id
        and m.user_id = auth.uid() and m.active and m.role in ('owner','admin','supervisor','agent')
    ))
  )
  with check (
    (organization_id is null and (auth.uid() = user_id or public.has_permission(auth.uid(), 'chat.reply')))
    or (organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.organization_id = chat_conversations.organization_id
        and m.user_id = auth.uid() and m.active and m.role in ('owner','admin','supervisor','agent')
    ))
  );

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id
        and (
          (c.organization_id is null and (
            public.has_permission(auth.uid(), 'chat.view')
            or c.user_id = auth.uid()
          ))
          or (c.organization_id is not null and exists (
            select 1 from public.organization_members m
            where m.organization_id = c.organization_id
              and m.user_id = auth.uid() and m.active
          ))
        )
    )
  );

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id
        and (
          (c.organization_id is null and (
            public.has_permission(auth.uid(), 'chat.reply')
            or c.user_id = auth.uid()
          ))
          or (c.organization_id is not null and exists (
            select 1 from public.organization_members m
            where m.organization_id = c.organization_id
              and m.user_id = auth.uid() and m.active
              and (
                (chat_messages.sender = 'user' and c.user_id = auth.uid())
                or (chat_messages.sender in ('agent','system') and m.role in ('owner','admin','supervisor','agent'))
              )
          ))
        )
    )
  );

-- Create an organization and make the caller its owner in one transaction.
-- Slug collisions are rejected by the unique constraint; no public/anon execution.
create or replace function public.create_support_organization(
  p_name text,
  p_slug text,
  p_default_locale text default 'en'
)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_org public.organizations;
  v_slug text := lower(trim(p_slug));
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(p_name)) > 120 then
    raise exception 'Organization name must contain 2 to 120 characters';
  end if;
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$' then
    raise exception 'Invalid public slug';
  end if;
  if p_default_locale not in ('en','fr','de','es','it','pt','nl','pl','ru','ar','zh','ja','ko','tr','sw') then
    raise exception 'Unsupported locale';
  end if;
  insert into public.organizations(name, slug, default_locale, created_by)
    values (trim(p_name), v_slug, p_default_locale, v_user)
    returning * into v_org;
  insert into public.organization_members(organization_id, user_id, role)
    values (v_org.id, v_user, 'owner');
  return v_org;
end;
$$;

revoke all on function public.create_support_organization(text,text,text) from public;
grant execute on function public.create_support_organization(text,text,text) to authenticated;

create or replace function public.is_organization_member(p_organization_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid() and m.active
      and (p_roles is null or m.role = any(p_roles))
  );
$$;
revoke all on function public.is_organization_member(uuid,text[]) from public;
grant execute on function public.is_organization_member(uuid,text[]) to authenticated;

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
before update on public.organizations
for each row execute function public.update_updated_at_column();
