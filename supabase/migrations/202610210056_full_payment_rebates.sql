-- Referral rebates (owner, 21 Oct 2026): Qapla Maritime, Costa Maritime and Tara Barko
-- deduct the rebate on any payment; every other partner's rebate comes off only once
-- the trainee has paid the fee less the rebate ("Deducted on full payment").
begin;

alter table public.marketing_agencies drop constraint if exists marketing_agencies_rebate_mode_check;
alter table public.marketing_agencies add constraint marketing_agencies_rebate_mode_check
  check (rebate_mode in ('Deducted', 'Deducted on full payment', 'No deduction'));
alter table public.marketing_agencies alter column rebate_mode set default 'Deducted on full payment';

update public.marketing_agencies set rebate_mode = 'Deducted on full payment'
where rebate_mode = 'Deducted'
  and name !~* '(qapla|costa|tara[[:space:]]*barko)';

notify pgrst, 'reload schema';
commit;
