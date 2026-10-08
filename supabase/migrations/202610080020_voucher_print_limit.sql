-- Expense voucher print limit (owner, 8 Oct 2026): a voucher prints once.
-- Each further print needs a reprint request approved by the Accounting Manager;
-- one approval allows one more print. Additive; safe to re-run.

begin;

alter table public.expenses
  add column if not exists print_count integer not null default 0,
  add column if not exists reprints_approved integer not null default 0;

create table if not exists public.expense_reprint_requests (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id),
  reason text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_remarks text
);
-- One open request per voucher.
create unique index if not exists expense_reprint_one_pending on public.expense_reprint_requests(expense_id) where status = 'Pending';
alter table public.expense_reprint_requests enable row level security;

-- Counts one print, under a row lock so two clicks cannot both print. Returns the print number.
create or replace function public.record_voucher_print(target uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select status, print_count, reprints_approved into r from public.expenses where id = target for update;
  if not found then raise exception 'Voucher not found.'; end if;
  if r.status not in ('Approved', 'Paid') then raise exception 'The voucher is issued once the Accounting Manager approves the expense.'; end if;
  if r.print_count >= 1 + r.reprints_approved then raise exception 'This voucher was already printed. Request a reprint from the Accounting Manager.'; end if;
  update public.expenses set print_count = print_count + 1 where id = target;
  return r.print_count + 1;
end $$;
revoke all on function public.record_voucher_print(uuid) from public, anon, authenticated;
grant execute on function public.record_voucher_print(uuid) to service_role;

commit;
