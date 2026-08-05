-- =====================================================================
-- Employee salary charges: an employee self-reports a charge against
-- themselves in MyHR (category + note, no amount). The Accounting Manager
-- then enters the peso amount — that entry activates the charge — and it
-- auto-deducts from the employee's next payroll, grouped as an "Others"
-- deduction line. The Accounting Manager can also input a charge directly.
--
-- Reuses the existing (previously unused) public.employee_charges table.
-- All writes happen through the service-role API; browsers only read.
-- Additive and idempotent.
-- =====================================================================

begin;

-- New per-charge fields. category = Rescheduling/Cancellation/Wrong Enrollment/Reprinting/Others.
alter table public.employee_charges add column if not exists category text;
alter table public.employee_charges add column if not exists note text;
alter table public.employee_charges add column if not exists filed_by uuid;
alter table public.employee_charges add column if not exists amount_set_by uuid;
alter table public.employee_charges add column if not exists activated_at timestamptz;
alter table public.employee_charges add column if not exists balance_centavos bigint;

-- A Pending charge exists before the Accounting Manager sets its amount, so the
-- amount is no longer required and defaults to 0.
alter table public.employee_charges alter column amount_centavos drop not null;
alter table public.employee_charges alter column amount_centavos set default 0;

-- Lifecycle: Pending (filed, awaiting amount) -> Active (amount set, deducting)
-- -> Settled (fully deducted) / Cancelled. New rows start Pending.
alter table public.employee_charges alter column status set default 'Pending';

alter table public.employee_charges enable row level security;

-- Staff may read charges; writes happen only through the service-role API.
drop policy if exists employee_charges_staff_read on public.employee_charges;
create policy employee_charges_staff_read on public.employee_charges
  for select using (public.has_staff_role());

commit;
