-- Training Completion and Record of Assessment Report (owner, 9 Oct 2026).
-- The MISMO Compliance Officer prepares one record per STCW batch. Trainee
-- details come from the portal; the class number, places of assessment, written
-- results, practical checklist, MTI training certificate numbers, assessor,
-- training director and dates are encoded by hand.

-- Assessment tasks per course (title + assessment criteria), reused on every record of that course.
create table if not exists public.course_assessment_tasks (
  course_id uuid primary key references public.courses(id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- One record per batch. `results` maps enrollment id -> { pct, ticks, cert }.
-- `tasks` is the snapshot printed on the record (kept when the course's tasks change later).
create table if not exists public.training_completion_records (
  batch_id uuid primary key references public.batches(id) on delete cascade,
  class_no text,
  resit_class_no text,
  resit_duration text,
  written_place text,
  practical_place text,
  assessor text,
  coa_validity text,
  assessed_on date,
  director text,
  director_on date,
  tasks jsonb not null default '[]'::jsonb,
  results jsonb not null default '{}'::jsonb,
  status text not null default 'Draft' check (status in ('Draft','Ready','Printed')),
  print_count integer not null default 0,
  printed_at timestamptz,
  printed_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.course_assessment_tasks enable row level security;
alter table public.training_completion_records enable row level security;
