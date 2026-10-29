-- Payment void requests (owner, 29 Oct 2026): the Cashier asks to void a payment with a reason; Accounting
-- approves (the existing void_payment: a reversal is recorded, the payment is marked void and its receipt
-- prints VOID) or rejects with a reason. One open request per payment.

create table if not exists public.payment_void_requests (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_remarks text
);
create unique index if not exists payment_void_one_pending on public.payment_void_requests(payment_id) where status = 'Pending';
create index if not exists payment_void_requests_requested_at on public.payment_void_requests(requested_at desc);
alter table public.payment_void_requests enable row level security;

select count(*) as payment_void_requests from public.payment_void_requests;
