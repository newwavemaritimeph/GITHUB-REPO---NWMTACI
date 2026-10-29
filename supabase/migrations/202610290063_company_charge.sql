-- Company Charge partners (owner, 29 Oct 2026, e.g. Marine Force): their trainees are enrolled
-- without paying at the Cashier, billed at the full fee (no rebate) on the Billing Statement,
-- and the company pays the whole statement at once.
begin;

-- 1) A partner's "How It Is Given" gains Company Charge.
alter table public.marketing_agencies drop constraint if exists marketing_agencies_rebate_mode_check;
alter table public.marketing_agencies add constraint marketing_agencies_rebate_mode_check
  check (rebate_mode in ('Deducted', 'Deducted on full payment', 'No deduction', 'Company Charge'));

-- 2) Enrollments enrolled on Company Charge remember the partner billed.
alter table public.enrollments add column if not exists company_charge_agency_id uuid references public.marketing_agencies(id);

-- 3) One company payment per Billing Statement payment, linked to the trainee payments it made.
create table if not exists public.company_payments (
  id uuid primary key default gen_random_uuid(),
  billing_statement_id uuid not null references public.billing_statements(id),
  agency_id uuid not null references public.marketing_agencies(id),
  amount_centavos bigint not null check (amount_centavos > 0),
  method text not null,
  reference_number text,
  received_at timestamptz not null,
  payment_ids uuid[] not null default '{}',
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.company_payments enable row level security;
drop trigger if exists company_payments_immutable on public.company_payments;
create trigger company_payments_immutable before update or delete on public.company_payments
  for each row execute function public.prevent_immutable_change();

notify pgrst, 'reload schema';
commit;
