-- =====================================================================
-- Expenses: payment channel (Cash / GCash / Unionbank / Cheque / PSBank /
-- Other) + a reference number, for the expenses report and daily summary.
-- Additive and idempotent. Existing expenses RLS/policies are unchanged.
-- =====================================================================

begin;

alter table public.expenses add column if not exists payment_channel text;
alter table public.expenses add column if not exists reference_number text;

commit;
