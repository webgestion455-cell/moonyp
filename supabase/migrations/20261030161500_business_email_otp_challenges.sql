create table if not exists public.business_email_otp (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('signup','login')),
  code_hash text not null,
  company_name text,
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  resend_after timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists business_email_otp_email_created_idx
  on public.business_email_otp (email, created_at desc);
alter table public.business_email_otp enable row level security;
revoke all on public.business_email_otp from anon, authenticated;
