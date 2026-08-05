-- =====================================================================
-- HR module completion: employment contracts + government-benefit records.
-- - employment_contracts: per-employee contract details (type, position, rate,
--   dates, status, notes). Details only — no file upload.
-- - benefit_records already exists (SSS/PhilHealth/Pag-IBIG/TIN reference +
--   optional contribution amount); this adds created_at + staff-read RLS.
-- Self clock-in writes to the existing employee_attendance table (no change).
-- All writes go through the service-role API; staff read via RLS. Idempotent.
-- =====================================================================

begin;

create table if not exists public.employment_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  contract_type text not null,
  position text,
  rate_centavos bigint,
  starts_on date not null,
  ends_on date,
  status text not null default 'Active',
  notes text,
  created_at timestamptz not null default now()
);

alter table public.employment_contracts enable row level security;
drop policy if exists employment_contracts_staff_read on public.employment_contracts;
create policy employment_contracts_staff_read on public.employment_contracts
  for select using (public.has_staff_role());

-- benefit_records exists from the base schema; make it readable by staff and
-- give it a stable ordering column.
alter table public.benefit_records add column if not exists created_at timestamptz not null default now();
alter table public.benefit_records enable row level security;
drop policy if exists benefit_records_staff_read on public.benefit_records;
create policy benefit_records_staff_read on public.benefit_records
  for select using (public.has_staff_role());

commit;
