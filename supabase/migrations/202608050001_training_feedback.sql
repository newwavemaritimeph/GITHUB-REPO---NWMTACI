-- =====================================================================
-- Training feedback = online-attendance for in-house courses.
-- Each enrollment gets a shareable feedback token. When the trainee submits
-- the feedback form, that counts as their online-training attendance and, for
-- In-House courses, marks the certificate "Ready to Print". Additive, idempotent.
-- =====================================================================

begin;

-- Per-enrollment share token for the public feedback link (backfilled for existing rows).
alter table public.enrollments add column if not exists feedback_token uuid not null default gen_random_uuid();

create table if not exists public.training_feedback (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id) on delete cascade,
  overall_rating int check (overall_rating between 1 and 5),
  instructor_rating int check (instructor_rating between 1 and 5),
  comments text,
  submitted_at timestamptz not null default now()
);

alter table public.training_feedback enable row level security;

-- Staff may read feedback; writes happen only through the service-role public API.
drop policy if exists training_feedback_staff_read on public.training_feedback;
create policy training_feedback_staff_read on public.training_feedback
  for select using (public.has_staff_role());

commit;
