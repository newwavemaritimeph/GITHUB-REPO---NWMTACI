-- =====================================================================
-- Clear test data from 7 Oct 2026 (Manila) onward — owner request, 8 Oct 2026.
-- Removes trainee and money records and their activity-log entries.
-- Keeps setup: courses, batches, fees, payment channels, agencies and
-- referral codes, expense categories, staff accounts.
--
-- Run STEP 1 first and check the counts. Then run STEP 2 (one transaction:
-- if anything fails, nothing is deleted). This cannot be undone.
-- =====================================================================

-- ---------------- STEP 1: preview (deletes nothing) ----------------
with cut as (select timestamptz '2026-10-07 00:00:00+08' as at),
t as (select id from public.trainees where created_at >= (select at from cut)),
e as (select id from public.enrollments where created_at >= (select at from cut) or trainee_id in (select id from t)),
p as (select id from public.payments where created_at >= (select at from cut) or trainee_id in (select id from t)
      or id in (select payment_id from public.payment_allocations where enrollment_id in (select id from e)))
select 'trainees' as records, count(*) from t
union all select 'enrollments', count(*) from e
union all select 'payments', count(*) from p
union all select 'requests', count(*) from public.enrollment_requests where created_at >= (select at from cut) or enrollment_id in (select id from e)
union all select 'expenses', count(*) from public.expenses where created_at >= (select at from cut)
union all select 'cashier closings', count(*) from public.cashier_closings where closing_date >= date '2026-10-07'
union all select 'activity log entries', count(*) from public.audit_logs where created_at >= (select at from cut);


-- ---------------- STEP 2: delete ----------------
begin;

create temp table _cut on commit drop as select timestamptz '2026-10-07 00:00:00+08' as at;
create temp table _t on commit drop as select id from public.trainees where created_at >= (select at from _cut);
create temp table _e on commit drop as select id from public.enrollments where created_at >= (select at from _cut) or trainee_id in (select id from _t);
create temp table _p on commit drop as select id from public.payments where created_at >= (select at from _cut) or trainee_id in (select id from _t)
  or id in (select payment_id from public.payment_allocations where enrollment_id in (select id from _e));
create temp table _r on commit drop as select id from public.enrollment_requests where created_at >= (select at from _cut) or enrollment_id in (select id from _e);
create temp table _c on commit drop as select id from public.enrollment_charges where created_at >= (select at from _cut) or enrollment_id in (select id from _e);
create temp table _x on commit drop as select id from public.expenses where created_at >= (select at from _cut);

-- Permanent-record guards are lifted only inside this transaction.
alter table public.payments disable trigger payments_immutable;
alter table public.payment_allocations disable trigger payment_allocations_immutable;
alter table public.refunds_and_reversals disable trigger reversals_immutable;
alter table public.audit_logs disable trigger audit_logs_immutable;
alter table public.email_logs disable trigger email_logs_immutable;
alter table public.attendance_events disable trigger attendance_events_immutable;
do $$ begin
  if to_regclass('public.enrollment_requirement_checks') is not null then
    execute 'alter table public.enrollment_requirement_checks disable trigger enrollment_requirement_checks_immutable';
  end if;
end $$;

-- Tables that may not exist yet are skipped.
do $$
declare step text;
begin
  foreach step in array array[
    'request_events|delete from public.request_events where request_id in (select id from _r)',
    'refunds_and_reversals|delete from public.refunds_and_reversals where payment_id in (select id from _p) or enrollment_id in (select id from _e) or approved_request_id in (select id from _r)',
    'account_reconciliation_items|update public.account_reconciliation_items set matched_payment_id = null where matched_payment_id in (select id from _p)',
    'make_up_assignments|delete from public.make_up_assignments where enrollment_id in (select id from _e) or charge_id in (select id from _c)',
    'enrollment_requests|delete from public.enrollment_requests where id in (select id from _r)',
    'classroom_invitations|delete from public.classroom_invitations where enrollment_id in (select id from _e)',
    'training_feedback|delete from public.training_feedback where enrollment_id in (select id from _e)',
    'attendance_events|delete from public.attendance_events where attendance_record_id in (select id from public.attendance_records where enrollment_id in (select id from _e))',
    'attendance_records|delete from public.attendance_records where enrollment_id in (select id from _e)',
    'attendance_tokens|delete from public.attendance_tokens where enrollment_id in (select id from _e)',
    'certificates|delete from public.certificates where enrollment_id in (select id from _e)',
    'training_instructions|delete from public.training_instructions where enrollment_id in (select id from _e)',
    'instruction_acknowledgments|delete from public.instruction_acknowledgments where trainee_id in (select id from _t)',
    'enrollment_requirement_checks|delete from public.enrollment_requirement_checks where enrollment_id in (select id from _e)',
    'agency_rebates|delete from public.agency_rebates where enrollment_id in (select id from _e) or trainee_id in (select id from _t)',
    'payables|delete from public.payables where enrollment_id in (select id from _e)',
    'invoices|delete from public.invoices where enrollment_id in (select id from _e) or payment_id in (select id from _p)',
    'receipts|delete from public.receipts where payment_id in (select id from _p)',
    'payment_allocations|delete from public.payment_allocations where payment_id in (select id from _p) or enrollment_id in (select id from _e)',
    'payments|delete from public.payments where id in (select id from _p)',
    'payment_proofs|delete from public.payment_proofs p where p.created_at >= (select at from _cut) and not exists (select 1 from public.payments x where x.proof_id = p.id)',
    'enrollment_charges|delete from public.enrollment_charges where id in (select id from _c)',
    'admission_records|delete from public.admission_records where trainee_id in (select id from _t) or issued_at >= (select at from _cut)',
    'enrollments|delete from public.enrollments where id in (select id from _e)',
    'trainees|delete from public.trainees where id in (select id from _t)',
    'expense_reprint_requests|delete from public.expense_reprint_requests where expense_id in (select id from _x)',
    'expense_vouchers|delete from public.expense_vouchers where expense_id in (select id from _x)',
    'expenses|delete from public.expenses where id in (select id from _x)',
    'cashier_openings|delete from public.cashier_openings where opening_date >= date ''2026-10-07''',
    'cashier_closings|delete from public.cashier_closings where closing_date >= date ''2026-10-07''',
    'email_logs|delete from public.email_logs where email_job_id in (select id from public.email_jobs where created_at >= (select at from _cut))',
    'email_jobs|delete from public.email_jobs where created_at >= (select at from _cut)',
    'notifications|delete from public.notifications where created_at >= (select at from _cut)',
    'audit_logs|delete from public.audit_logs where created_at >= (select at from _cut)'
  ] loop
    if to_regclass('public.' || split_part(step, '|', 1)) is not null then
      execute split_part(step, '|', 2);
    end if;
  end loop;
end $$;

-- Seats: recount each batch from the enrollments that remain, and reopen batches that are no longer full.
update public.batches b set
  confirmed_count = c.n,
  status = case when b.status = 'Full' and c.n < b.capacity then 'Open' else b.status end
from (select b2.id, (select count(*) from public.enrollments e where e.batch_id = b2.id and e.enrollment_status <> 'Cancelled')::int as n from public.batches b2) c
where c.id = b.id and b.confirmed_count <> c.n;

-- Guards back on.
alter table public.payments enable trigger payments_immutable;
alter table public.payment_allocations enable trigger payment_allocations_immutable;
alter table public.refunds_and_reversals enable trigger reversals_immutable;
alter table public.audit_logs enable trigger audit_logs_immutable;
alter table public.email_logs enable trigger email_logs_immutable;
alter table public.attendance_events enable trigger attendance_events_immutable;
do $$ begin
  if to_regclass('public.enrollment_requirement_checks') is not null then
    execute 'alter table public.enrollment_requirement_checks enable trigger enrollment_requirement_checks_immutable';
  end if;
end $$;

commit;
