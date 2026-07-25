-- Email-OTP second-factor challenges for privileged staff (Admin / Accounting).
-- Service-role only: RLS enabled with no policies, so anon/authenticated cannot read
-- or write. All access goes through server routes using the service-role key.
create table if not exists public.staff_mfa_email_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_mfa_email_challenges_user_idx
  on public.staff_mfa_email_challenges (user_id, created_at desc);

alter table public.staff_mfa_email_challenges enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) may touch this.

comment on table public.staff_mfa_email_challenges is
  'One-time email codes for Admin/Accounting step-up MFA. Service-role access only.';
