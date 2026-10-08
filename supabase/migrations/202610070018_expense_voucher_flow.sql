-- Expense voucher flow (owner, 7 Oct 2026).
--   Cashier records an expense      -> request number ER-YYYY-000001, Pending
--   Accounting Manager approves     -> voucher number CV-YYYY-000001 issued (next in sequence)
--   Accounting Manager rejects      -> no voucher number is used
--   Cashier releases the money      -> Paid, with channel, reference and time
-- Vouchers are filed in Google Drive (NWMTACI Expense Vouchers / Category /
-- YYYY-MM Month / date CV-no - payee.pdf). Additive and idempotent.

begin;

alter table public.expenses add column if not exists request_number text;
alter table public.expenses add column if not exists voucher_number text;
alter table public.expenses add column if not exists approved_at timestamptz;
alter table public.expenses add column if not exists decision_remarks text;
alter table public.expenses add column if not exists released_by uuid references public.profiles(id);
alter table public.expenses add column if not exists released_at timestamptz;
alter table public.expenses add column if not exists drive_file_id text;
alter table public.expenses add column if not exists drive_link text;

create unique index if not exists expenses_request_number_key on public.expenses(request_number) where request_number is not null;
create unique index if not exists expenses_voucher_number_key on public.expenses(voucher_number) where voucher_number is not null;

-- Existing rows keep their number as both the request and (when approved) the voucher number.
update public.expenses set request_number = expense_number where request_number is null;
update public.expenses set voucher_number = expense_number where voucher_number is null and status in ('Approved', 'Paid');

-- Approve: issue the next voucher number atomically.
create or replace function public.approve_expense(target uuid, actor uuid, remarks text default null)
returns text language plpgsql security definer set search_path = public as $$
declare row_status text; issued text;
begin
  select status into row_status from public.expenses where id = target for update;
  if row_status is null then raise exception 'Expense not found'; end if;
  if row_status <> 'Pending' then raise exception 'Only an expense waiting for approval can be approved'; end if;
  issued := public.next_reference('CV', extract(year from now() at time zone 'Asia/Manila')::integer);
  update public.expenses
     set status = 'Approved', voucher_number = issued, expense_number = issued,
         approved_by = actor, approved_at = now(), decision_remarks = remarks
   where id = target;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'accounting', 'expense.approved', 'expense', target::text, jsonb_build_object('voucher_number', issued, 'remarks', remarks));
  return issued;
end $$;

create or replace function public.reject_expense(target uuid, actor uuid, remarks text default null)
returns void language plpgsql security definer set search_path = public as $$
declare row_status text;
begin
  select status into row_status from public.expenses where id = target for update;
  if row_status is null then raise exception 'Expense not found'; end if;
  if row_status <> 'Pending' then raise exception 'Only an expense waiting for approval can be rejected'; end if;
  update public.expenses set status = 'Rejected', approved_by = actor, approved_at = now(), decision_remarks = remarks where id = target;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'accounting', 'expense.rejected', 'expense', target::text, jsonb_build_object('remarks', remarks));
end $$;

revoke all on function public.approve_expense(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reject_expense(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_expense(uuid, uuid, text) to service_role;
grant execute on function public.reject_expense(uuid, uuid, text) to service_role;

commit;
