-- =====================================================================
-- Admin Assistant (owner, 9 Oct 2026): a seventh portal role.
--   * Requisitions of supplies (items listed by Accounting/Admin). Approved by
--     the Admin or the Accounting Manager, an approval becomes an expense
--     voucher (CV) that the Cashier releases.
--   * Resource planning: classroom and instructor per batch.
--   * Instructor shortlist with course accreditations and contact numbers.
-- Additive and idempotent. Run after 202610090032_six_roles.sql.
-- =====================================================================

begin;

insert into public.roles(code, name, is_staff) values ('admin_assistant', 'Admin Assistant', true)
on conflict (code) do update set active = true, name = excluded.name;

create table if not exists public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'pc',
  default_cost_centavos integer not null default 0 check (default_cost_centavos >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists requisition_items_name_unique on public.requisition_items(lower(name));

create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  requisition_number text not null unique,
  requested_by uuid references public.profiles(id),
  purpose text not null,
  needed_by date,
  lines jsonb not null default '[]'::jsonb,
  total_centavos integer not null check (total_centavos > 0),
  status text not null default 'For Approval' check (status in ('For Approval', 'Approved', 'Rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_remarks text,
  expense_id uuid references public.expenses(id),
  created_at timestamptz not null default now()
);
create index if not exists requisitions_created_idx on public.requisitions(created_at desc);

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  complete_name text not null,
  mobile text,
  email text,
  notes text,
  active boolean not null default true,
  employee_id uuid references public.employees(id),
  created_at timestamptz not null default now()
);

create table if not exists public.instructor_accreditations (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  accreditation_number text,
  valid_until date,
  created_at timestamptz not null default now(),
  unique (instructor_id, course_id)
);

create table if not exists public.batch_resources (
  batch_id uuid primary key references public.batches(id) on delete cascade,
  classroom_id uuid references public.classrooms(id),
  instructor_id uuid references public.instructors(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.requisition_items enable row level security;
alter table public.requisitions enable row level security;
alter table public.instructors enable row level security;
alter table public.instructor_accreditations enable row level security;
alter table public.batch_resources enable row level security;

commit;
