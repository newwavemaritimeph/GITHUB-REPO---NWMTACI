-- Budget Request then Liquidation (owner, 10 Nov 2026): the Cashier asks Accounting for a budget (no receipts yet);
-- once approved and released the cash is an advance (status Advanced, not yet an expense); the Cashier then files the
-- Liquidation Form with the receipts, the amount spent and the change returned, and it becomes an expense (Paid).
-- Additive and idempotent.

begin;

alter table public.expenses add column if not exists is_budget boolean not null default false;
alter table public.expenses add column if not exists advance_centavos bigint check (advance_centavos is null or advance_centavos >= 0);
alter table public.expenses add column if not exists returned_centavos bigint;
alter table public.expenses add column if not exists liquidated_at timestamptz;
alter table public.expenses add column if not exists liquidated_by uuid references public.profiles(id);

alter table public.expenses drop constraint if exists expenses_status_check;
alter table public.expenses add constraint expenses_status_check check (status in ('Pending','Approved','Rejected','Advanced','Paid','Void'));

-- An advance can be voided too (the same rules as a released voucher otherwise).
create or replace function public.void_expense(target_expense uuid, actor uuid, reason text)
returns text language plpgsql security definer set search_path = public as $$
declare e public.expenses%rowtype;
begin
  if coalesce(length(trim(reason)), 0) < 5 then raise exception 'Enter the reason for the void.'; end if;
  select * into e from public.expenses where id = target_expense for update;
  if not found then raise exception 'Expense not found.'; end if;
  if e.status = 'Void' then raise exception 'This voucher is already void.'; end if;
  if e.status not in ('Approved','Advanced','Paid') then raise exception 'Only an approved or released voucher can be voided; reject a pending expense instead.'; end if;
  update public.expenses set status = 'Void', void_reason = trim(reason), voided_by = actor, voided_at = now() where id = e.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values, reason)
    values (actor, public.void_actor_role(actor), 'expense.voided', 'expense', e.id::text,
      jsonb_build_object('status', e.status, 'expense_number', e.expense_number, 'amount_centavos', e.amount_centavos, 'paid_at', e.paid_at),
      jsonb_build_object('status', 'Void'), trim(reason));
  return e.status;
end $$;
revoke all on function public.void_expense(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_expense(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
