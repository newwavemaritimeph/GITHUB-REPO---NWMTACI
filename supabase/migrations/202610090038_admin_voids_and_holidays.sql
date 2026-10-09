-- Admin voids and holiday reminders (owner, 9 Oct 2026).
--
-- 1. Void a payment / receipt (Admin only). A payment stays in the ledger: its
--    `valid` flag turns false once, a full 'reversal' row is added to
--    refunds_and_reversals, and the audit log records who and why. Every other
--    change to a payment is still refused.
-- 2. Void an approved or released expense voucher (Admin only). The CV number is
--    kept and never reused; reports count only Approved and Paid expenses.
-- 3. Cancel an enrollment directly (Admin only), releasing the seat.
-- 4. Holidays: the Admin keeps the list; the dashboard warns when one falls on a
--    training day so New Wave can ask MARINA's permission to hold classes.

-- 1. Payments -----------------------------------------------------------------
alter table public.payments add column if not exists void_reason text;
alter table public.payments add column if not exists voided_by uuid references public.profiles(id);
alter table public.payments add column if not exists voided_at timestamptz;

-- Payments are append-only except for this one change: valid true -> false with
-- the void fields filled in. Deletes and every other update are still refused.
create or replace function public.payments_void_only() returns trigger language plpgsql as $$
declare skip text[] := array['valid','void_reason','voided_by','voided_at'];
begin
  if tg_op = 'UPDATE'
     and old.valid and not new.valid
     and old.voided_at is null and new.voided_at is not null
     and coalesce(length(trim(new.void_reason)), 0) > 0
     and (to_jsonb(new) - skip) = (to_jsonb(old) - skip) then
    return new;
  end if;
  raise exception 'Immutable records cannot be changed or deleted';
end $$;
drop trigger if exists payments_immutable on public.payments;
create trigger payments_immutable before update or delete on public.payments
  for each row execute function public.payments_void_only();

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
    values (actor, 'admin', 'payment.voided', 'payment', p.id::text,
      jsonb_build_object('valid', true, 'payment_number', p.payment_number, 'amount_centavos', p.amount_centavos, 'method', p.method, 'reference_number', p.reference_number),
      jsonb_build_object('valid', false), trim(reason));
end $$;
revoke all on function public.void_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_payment(uuid, uuid, text) to service_role;

-- 2. Expenses -------------------------------------------------------------------
alter table public.expenses add column if not exists void_reason text;
alter table public.expenses add column if not exists voided_by uuid references public.profiles(id);
alter table public.expenses add column if not exists voided_at timestamptz;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.expenses'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.expenses drop constraint %I', c);
  end loop;
end $$;
alter table public.expenses add constraint expenses_status_check check (status in ('Pending','Approved','Rejected','Paid','Void'));

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
    values (actor, 'admin', 'expense.voided', 'expense', e.id::text,
      jsonb_build_object('status', e.status, 'expense_number', e.expense_number, 'amount_centavos', e.amount_centavos, 'paid_at', e.paid_at),
      jsonb_build_object('status', 'Void'), trim(reason));
  return e.status;
end $$;
revoke all on function public.void_expense(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_expense(uuid, uuid, text) to service_role;

-- 3. Enrollments -----------------------------------------------------------------
alter table public.enrollments add column if not exists cancel_reason text;

create or replace function public.admin_cancel_enrollment(target_enrollment uuid, actor uuid, reason text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.enrollments%rowtype; b public.batches%rowtype; next_count integer;
begin
  if coalesce(length(trim(reason)), 0) < 5 then raise exception 'Enter the reason for the cancellation.'; end if;
  select * into e from public.enrollments where id = target_enrollment for update;
  if not found then raise exception 'Enrollment not found.'; end if;
  if e.enrollment_status = 'Cancelled' then raise exception 'This enrollment is already cancelled.'; end if;
  update public.enrollments set enrollment_status = 'Cancelled', cancelled_at = now(), cancel_reason = trim(reason) where id = e.id;
  if e.batch_id is not null then
    select * into b from public.batches where id = e.batch_id for update;
    if found then
      next_count := greatest(0, b.confirmed_count - 1);
      update public.batches set confirmed_count = next_count,
        status = case when b.status = 'Full' and next_count < b.capacity then 'Open' else b.status end
        where id = b.id;
    end if;
  end if;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values, reason)
    values (actor, 'admin', 'enrollment.cancelled_by_admin', 'enrollment', e.id::text,
      jsonb_build_object('enrollment_status', e.enrollment_status, 'batch_id', e.batch_id),
      jsonb_build_object('enrollment_status', 'Cancelled'), trim(reason));
end $$;
revoke all on function public.admin_cancel_enrollment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_cancel_enrollment(uuid, uuid, text) to service_role;

-- 4. Holidays ----------------------------------------------------------------------
create table if not exists public.holidays (
  holiday_date date primary key,
  name text not null,
  kind text not null default 'Regular' check (kind in ('Regular','Special Non-Working','Special Working','Local')),
  marina_status text not null default 'Not Sent' check (marina_status in ('Not Sent','Sent','Approved','Classes Moved')),
  marina_note text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.holidays enable row level security;

-- Starting list (national holidays from October 2026 through 2027). The Admin
-- checks it against each year's Proclamation and adds special days declared later.
insert into public.holidays(holiday_date, name, kind) values
  ('2026-11-01','All Saints'' Day','Special Non-Working'),
  ('2026-11-30','Bonifacio Day','Regular'),
  ('2026-12-08','Feast of the Immaculate Conception','Special Non-Working'),
  ('2026-12-24','Christmas Eve','Special Non-Working'),
  ('2026-12-25','Christmas Day','Regular'),
  ('2026-12-30','Rizal Day','Regular'),
  ('2026-12-31','Last Day of the Year','Special Non-Working'),
  ('2027-01-01','New Year''s Day','Regular'),
  ('2027-02-06','Chinese New Year','Special Non-Working'),
  ('2027-03-25','Maundy Thursday','Regular'),
  ('2027-03-26','Good Friday','Regular'),
  ('2027-03-27','Black Saturday','Special Non-Working'),
  ('2027-04-09','Araw ng Kagitingan','Regular'),
  ('2027-05-01','Labor Day','Regular'),
  ('2027-06-12','Independence Day','Regular'),
  ('2027-08-21','Ninoy Aquino Day','Special Non-Working'),
  ('2027-08-30','National Heroes Day','Regular'),
  ('2027-11-01','All Saints'' Day','Special Non-Working'),
  ('2027-11-30','Bonifacio Day','Regular'),
  ('2027-12-08','Feast of the Immaculate Conception','Special Non-Working'),
  ('2027-12-24','Christmas Eve','Special Non-Working'),
  ('2027-12-25','Christmas Day','Regular'),
  ('2027-12-30','Rizal Day','Regular'),
  ('2027-12-31','Last Day of the Year','Special Non-Working')
on conflict (holiday_date) do nothing;
