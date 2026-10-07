-- =====================================================================
-- Google Classroom connection (7 Oct 2026, owner instruction).
-- New Wave signs in once with the Gmail that owns its classes ("Connect Google
-- Classroom"); the portal keeps an encrypted, revocable refresh token and uses
-- it to invite each trainee to the course's class when instructions are
-- generated. Server-only: RLS on, no policies (service role only).
-- Additive; safe to re-run.
-- =====================================================================

begin;

create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'classroom' check (provider in ('classroom')),
  account_email text not null,
  refresh_token_encrypted text not null,
  scopes text not null,
  connected_by uuid references public.profiles(id),
  connected_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists google_connections_active_idx on public.google_connections(provider, connected_at desc) where revoked_at is null;
alter table public.google_connections enable row level security;

-- The Classroom class each New Wave course uses (picked from the connected account).
alter table public.courses add column if not exists google_classroom_course_id text;

create table if not exists public.classroom_invitations (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  classroom_course_id text not null,
  email text not null,
  state text not null check (state in ('Invited', 'Already invited', 'Failed')),
  invitation_id text,
  error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists classroom_invitations_enrollment_idx on public.classroom_invitations(enrollment_id, created_at desc);
alter table public.classroom_invitations enable row level security;

commit;
