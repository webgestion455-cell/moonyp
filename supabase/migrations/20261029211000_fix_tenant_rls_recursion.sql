-- Correct tenant policies to avoid recursive RLS evaluation on organization_members.
-- SECURITY DEFINER helper is restricted to authenticated callers and returns only
-- membership booleans, never tenant data.
create or replace function public.is_organization_member(p_organization_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid() and m.active
      and (p_roles is null or m.role = any(p_roles))
  );
$$;
revoke all on function public.is_organization_member(uuid,text[]) from public, anon;
grant execute on function public.is_organization_member(uuid,text[]) to authenticated;

drop policy if exists organizations_read_members on public.organizations;
create policy organizations_read_members on public.organizations
  for select to authenticated
  using (public.is_organization_member(id) or public.is_super_admin(auth.uid()));

drop policy if exists organizations_update_admins on public.organizations;
create policy organizations_update_admins on public.organizations
  for update to authenticated
  using (public.is_organization_member(id, array['owner','admin']) or public.is_super_admin(auth.uid()))
  with check (public.is_organization_member(id, array['owner','admin']) or public.is_super_admin(auth.uid()));

drop policy if exists organization_members_read_same_org on public.organization_members;
create policy organization_members_read_same_org on public.organization_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_organization_member(organization_id, array['owner','admin','supervisor'])
    or public.is_super_admin(auth.uid())
  );

drop policy if exists chat_conv_read on public.chat_conversations;
create policy chat_conv_read on public.chat_conversations
  for select to authenticated
  using (
    (organization_id is null and (auth.uid() = user_id or public.has_permission(auth.uid(), 'chat.view')))
    or (organization_id is not null and public.is_organization_member(organization_id))
  );

drop policy if exists chat_conv_insert_own on public.chat_conversations;
create policy chat_conv_insert_own on public.chat_conversations
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      organization_id is null
      or public.is_organization_member(organization_id, array['owner','admin','supervisor','agent'])
    )
  );

drop policy if exists chat_conv_update on public.chat_conversations;
create policy chat_conv_update on public.chat_conversations
  for update to authenticated
  using (
    (organization_id is null and (auth.uid() = user_id or public.has_permission(auth.uid(), 'chat.reply')))
    or (organization_id is not null and public.is_organization_member(organization_id, array['owner','admin','supervisor','agent']))
  )
  with check (
    (organization_id is null and (auth.uid() = user_id or public.has_permission(auth.uid(), 'chat.reply')))
    or (organization_id is not null and public.is_organization_member(organization_id, array['owner','admin','supervisor','agent']))
  );

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id
        and (
          (c.organization_id is null and (public.has_permission(auth.uid(), 'chat.view') or c.user_id = auth.uid()))
          or (c.organization_id is not null and public.is_organization_member(c.organization_id))
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
          (c.organization_id is null and (public.has_permission(auth.uid(), 'chat.reply') or c.user_id = auth.uid()))
          or (
            c.organization_id is not null
            and (
              (chat_messages.sender = 'user' and c.user_id = auth.uid())
              or (chat_messages.sender in ('agent','system') and public.is_organization_member(c.organization_id, array['owner','admin','supervisor','agent']))
            )
          )
        )
    )
  );
