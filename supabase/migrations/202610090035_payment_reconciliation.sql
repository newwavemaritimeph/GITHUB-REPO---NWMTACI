-- =====================================================================
-- GCash reconciliation (owner, 9 Oct 2026). The Admin Assistant checks each
-- day's GCash payments against the printed GCash transaction history and tags
-- them Reconciled, or Not in History (with remarks) for Accounting.
-- Payments stay immutable; the check is its own record, and every change is
-- also written to audit_logs. Additive and idempotent.
-- =====================================================================

begin;

create table if not exists public.payment_reconciliations (
  payment_id uuid primary key references public.payments(id),
  status text not null check (status in ('Reconciled', 'Not in History')),
  remarks text,
  checked_by uuid references public.profiles(id),
  checked_at timestamptz not null default now()
);
create index if not exists payment_reconciliations_status_idx on public.payment_reconciliations(status);
alter table public.payment_reconciliations enable row level security;

commit;
