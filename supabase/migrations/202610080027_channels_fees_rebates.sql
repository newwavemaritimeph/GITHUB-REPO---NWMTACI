-- Owner ruling, 8 Oct 2026:
-- * Payment and expense channels: Cash, GCash, PSBank, UnionBank and Cheque only.
--   (Expense screens use the same active channels when no expense-only channel is set.)
-- * Schedule of fees: Reprinting ₱500.00, Uniform ₱150.00, LBC ₱500.00 only.
-- * Rebates: 50% of the training fee on New Wave in-house courses for every partner.
-- Older rows are deactivated, never deleted (history keeps them). Safe to re-run.

begin;

insert into public.payment_methods(code, name, requires_reference, allows_proof, active, sort_order)
values ('cash', 'Cash', false, true, true, 10), ('gcash', 'GCash', true, true, true, 20),
       ('psbank', 'PSBank', true, true, true, 30), ('unionbank', 'UnionBank', true, true, true, 40),
       ('cheque', 'Cheque', true, true, true, 50)
on conflict (code) do update set name = excluded.name, requires_reference = excluded.requires_reference, active = true, sort_order = excluded.sort_order;
update public.payment_methods set kind = 'receivable' where code in ('cash', 'gcash', 'psbank', 'unionbank', 'cheque');
update public.payment_methods set active = false where code not in ('cash', 'gcash', 'psbank', 'unionbank', 'cheque');

insert into public.charge_catalog(name, default_amount_centavos, active, kind)
values ('Reprinting', 50000, true, 'fee'), ('Uniform', 15000, true, 'item'), ('LBC', 50000, true, 'item')
on conflict (name) do update set default_amount_centavos = excluded.default_amount_centavos, active = true, kind = excluded.kind;
update public.charge_catalog set active = false where name not in ('Reprinting', 'Uniform', 'LBC');

update public.marketing_agencies set rebate_percent = 50 where rebate_percent is null;
alter table public.marketing_agencies alter column rebate_percent set default 50;

commit;
