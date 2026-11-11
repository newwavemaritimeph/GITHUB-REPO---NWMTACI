-- Bank Deposits (owner, 11 Nov 2026): Accounting asks the Cashier to deposit drawer cash in a company bank account.
-- A transfer between New Wave's own accounts, never an expense: it lowers Cash on Hand and raises that bank account.
-- Rows are never deleted; every step is written to audit_logs.
create table if not exists public.bank_deposits (
  id uuid primary key default gen_random_uuid(),
  deposit_no text not null unique,
  amount_centavos bigint not null check (amount_centavos > 0),
  account text not null,
  due_on date,
  note text,
  status text not null default 'Requested' check (status in ('Requested', 'Deposited', 'Received', 'Returned', 'Cancelled')),
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  deposited_by uuid references public.profiles(id),
  deposited_at timestamptz,
  deposited_on date,
  reference text,
  slip_link text,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  reason text
);
create index if not exists bank_deposits_status_idx on public.bank_deposits (status, requested_at desc);
create index if not exists bank_deposits_day_idx on public.bank_deposits (deposited_on);
alter table public.bank_deposits enable row level security;
drop policy if exists bank_deposits_staff_read on public.bank_deposits;
create policy bank_deposits_staff_read on public.bank_deposits for select to authenticated using (public.has_any_role(array['admin','accounting','cashier']));
-- Deposits are never deleted.
create or replace function public.bank_deposits_no_delete() returns trigger language plpgsql as $$ begin raise exception 'Bank deposits cannot be deleted; cancel it instead'; end $$;
drop trigger if exists bank_deposits_no_delete on public.bank_deposits;
create trigger bank_deposits_no_delete before delete on public.bank_deposits for each row execute function public.bank_deposits_no_delete();
