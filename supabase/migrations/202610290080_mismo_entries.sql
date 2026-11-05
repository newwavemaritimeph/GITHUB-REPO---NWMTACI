-- MISMO Compliance Officer (owner, 5 Nov 2026, Design 3): who has been input in the MARINA MISMO System, one tick per
-- trainee on a course. Each tick and undo is also in the audit log. Additive; the old batch submissions stay as history.

create table if not exists public.mismo_entries (
  enrollment_id uuid primary key references public.enrollments(id) on delete cascade,
  done_by uuid references public.profiles(id),
  done_at timestamptz not null default now()
);
alter table public.mismo_entries enable row level security;

notify pgrst, 'reload schema';
