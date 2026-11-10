-- Void by Accounting (owner, 10 Nov 2026): Accounting now voids payments and vouchers as well as the Admin.
-- The audit row records the actor's own role instead of always 'admin'. Nothing else in the two functions changes.

create or replace function public.void_actor_role(actor uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.code from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.user_id = actor and r.code in ('admin', 'accounting')
      order by case r.code when 'admin' then 0 else 1 end limit 1),
    'admin');
$$;
revoke all on function public.void_actor_role(uuid) from public, anon, authenticated;
grant execute on function public.void_actor_role(uuid) to service_role;

create or replace function public.void_payment(target_payment uuid, actor uuid, reason text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.payments%rowtype;
begin
  if coalesce(length(trim(reason)), 0) < 5 then raise exception 'Enter the reason for the void.'; end if;
  select * into p from public.payments where id = target_payment for update;
  if not found then raise exception 'Payment not found.'; end if;
  if not p.valid then raise exception 'This payment is already void.'; end if;
  insert into public.refunds_and_reversals(payment_id, enrollment_id, event_type, amount_centavos, reason, created_by)
    values (p.id, (select enrollment_id from public.payment_allocations where payment_id = p.id order by amount_centavos desc limit 1), 'reversal', p.amount_centavos, trim(reason), actor);
  update public.payments set valid = false, void_reason = trim(reason), voided_by = actor, voided_at = now() where id = p.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values, reason)
    values (actor, public.void_actor_role(actor), 'payment.voided', 'payment', p.id::text,
      jsonb_build_object('valid', true, 'payment_number', p.payment_number, 'amount_centavos', p.amount_centavos, 'method', p.method, 'reference_number', p.reference_number),
      jsonb_build_object('valid', false), trim(reason));
end $$;
revoke all on function public.void_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_payment(uuid, uuid, text) to service_role;

create or replace function public.void_expense(target_expense uuid, actor uuid, reason text)
returns text language plpgsql security definer set search_path = public as $$
declare e public.expenses%rowtype;
begin
  if coalesce(length(trim(reason)), 0) < 5 then raise exception 'Enter the reason for the void.'; end if;
  select * into e from public.expenses where id = target_expense for update;
  if not found then raise exception 'Expense not found.'; end if;
  if e.status = 'Void' then raise exception 'This voucher is already void.'; end if;
  if e.status not in ('Approved','Paid') then raise exception 'Only an approved or released voucher can be voided; reject a pending expense instead.'; end if;
  update public.expenses set status = 'Void', void_reason = trim(reason), voided_by = actor, voided_at = now() where id = e.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values, reason)
    values (actor, public.void_actor_role(actor), 'expense.voided', 'expense', e.id::text,
      jsonb_build_object('status', e.status, 'expense_number', e.expense_number, 'amount_centavos', e.amount_centavos, 'paid_at', e.paid_at),
      jsonb_build_object('status', 'Void'), trim(reason));
  return e.status;
end $$;
revoke all on function public.void_expense(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_expense(uuid, uuid, text) to service_role;
