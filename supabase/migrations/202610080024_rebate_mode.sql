-- Rebate handling per agency or consultancy (owner, 8 Oct 2026):
-- "Deducted": the rebate comes off the trainee's fee (₱1,300 − ₱300 = ₱1,000 settles it).
-- "No deduction": the full fee is collected and the rebate is owed to the agency (Payables).
-- Additive; safe to re-run.

alter table public.marketing_agencies
  add column if not exists rebate_mode text not null default 'Deducted';

alter table public.marketing_agencies drop constraint if exists marketing_agencies_rebate_mode_check;
alter table public.marketing_agencies add constraint marketing_agencies_rebate_mode_check check (rebate_mode in ('Deducted', 'No deduction'));
