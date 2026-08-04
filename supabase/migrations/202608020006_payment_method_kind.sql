-- Distinguish receivable collection channels from payable disbursement channels on
-- the shared payment_methods catalog. Additive, defaulted; existing rows become
-- 'receivable'. Safe on a live database.

begin;

alter table public.payment_methods
  add column if not exists kind text not null default 'receivable'
  check (kind in ('receivable', 'payable'));

comment on column public.payment_methods.kind is
  'receivable = channel for collections (cashier); payable = channel for disbursements/payables.';

commit;
