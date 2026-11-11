-- Bank Ledger (owner, 11 Nov 2026): running balances for each company bank account. Payments, Bank Deposits and
-- expenses paid from a bank post by themselves (read live); Accounting encodes the rest here: cheques issued and
-- encashed, encashments, withdrawals, transfers, bank charges, interest, other credits and debits, adjustments.
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank text not null,
  account_name text not null,
  last4 text,
  channel text not null unique,
  opening_balance_centavos bigint not null default 0,
  opening_on date not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.bank_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no text not null,
  account_id uuid not null references public.bank_accounts(id),
  entry_type text not null check (entry_type in ('Cheque Issued','Encashment','Withdrawal','Transfer Out','Transfer In','Bank Charge','Interest Earned','Other Credit','Other Debit','Adjustment','Reversal')),
  entry_on date not null,
  amount_centavos bigint not null check (amount_centavos <> 0),
  payee text,
  description text,
  cheque_no text,
  cheque_status text check (cheque_status in ('Issued','Encashed','Void')),
  cleared_on date,
  transfer_pair_id uuid,
  expense_id uuid references public.expenses(id),
  reversal_of uuid references public.bank_entries(id),
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (entry_no, account_id)
);
create index if not exists bank_entries_account_idx on public.bank_entries (account_id, entry_on);
create unique index if not exists bank_entries_cheque_idx on public.bank_entries (account_id, cheque_no) where cheque_no is not null;

alter table public.bank_accounts enable row level security;
alter table public.bank_entries enable row level security;
drop policy if exists bank_accounts_read on public.bank_accounts;
create policy bank_accounts_read on public.bank_accounts for select to authenticated using (public.has_any_role(array['admin','accounting']));
drop policy if exists bank_entries_read on public.bank_entries;
create policy bank_entries_read on public.bank_entries for select to authenticated using (public.has_any_role(array['admin','accounting']));

-- Entries are never deleted, and only a cheque's status and clearing date may change after it is saved.
create or replace function public.bank_entries_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Bank entries cannot be deleted; add a reversal instead'; end if;
  if new.amount_centavos <> old.amount_centavos or new.account_id <> old.account_id or new.entry_type <> old.entry_type
     or new.entry_on <> old.entry_on or coalesce(new.cheque_no, '') <> coalesce(old.cheque_no, '') then
    raise exception 'A saved bank entry cannot be changed; void or reverse it instead';
  end if;
  return new;
end $$;
drop trigger if exists bank_entries_guard on public.bank_entries;
create trigger bank_entries_guard before update or delete on public.bank_entries for each row execute function public.bank_entries_guard();
