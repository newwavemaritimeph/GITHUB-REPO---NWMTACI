-- =====================================================================
-- Clear test data — STEP 2 (delete), one self-contained block.
-- Removes trainee and money records created on or after the cutoff below,
-- plus their activity-log entries. Keeps setup (courses, batches, fees,
-- channels, partners, categories, staff). Runs as one unit: if anything
-- fails, nothing is deleted. Cannot be undone.
-- To clear everything regardless of date, change the cutoff to 2000-01-01.
-- =====================================================================
do $$
declare
  cutoff timestamptz := timestamptz '2026-10-07 00:00:00+08';
  cut_day date := (cutoff at time zone 'Asia/Manila')::date;
  t_ids uuid[]; e_ids uuid[]; p_ids uuid[]; r_ids uuid[]; c_ids uuid[]; x_ids uuid[];
  step text;
begin
  select coalesce(array_agg(id), '{}') into t_ids from public.trainees where created_at >= cutoff;
  select coalesce(array_agg(id), '{}') into e_ids from public.enrollments where created_at >= cutoff or trainee_id = any(t_ids);
  select coalesce(array_agg(id), '{}') into p_ids from public.payments
    where created_at >= cutoff or trainee_id = any(t_ids) or id in (select payment_id from public.payment_allocations where enrollment_id = any(e_ids));
  select coalesce(array_agg(id), '{}') into r_ids from public.enrollment_requests where created_at >= cutoff or enrollment_id = any(e_ids);
  select coalesce(array_agg(id), '{}') into c_ids from public.enrollment_charges where created_at >= cutoff or enrollment_id = any(e_ids);
  select coalesce(array_agg(id), '{}') into x_ids from public.expenses where created_at >= cutoff;

  -- Permanent-record guards are lifted only inside this block.
  execute 'alter table public.payments disable trigger payments_immutable';
  execute 'alter table public.payment_allocations disable trigger payment_allocations_immutable';
  execute 'alter table public.refunds_and_reversals disable trigger reversals_immutable';
  execute 'alter table public.audit_logs disable trigger audit_logs_immutable';
  execute 'alter table public.email_logs disable trigger email_logs_immutable';
  execute 'alter table public.attendance_events disable trigger attendance_events_immutable';
  if to_regclass('public.enrollment_requirement_checks') is not null then
    execute 'alter table public.enrollment_requirement_checks disable trigger enrollment_requirement_checks_immutable';
  end if;

  -- Each step: table | statement (uses $1..$6 = trainees, enrollments, payments, requests, charges, expenses; $7 = cutoff; $8 = cutoff day).
  foreach step in array array[
    'request_events|delete from public.request_events where request_id = any($4)',
    'refunds_and_reversals|delete from public.refunds_and_reversals where payment_id = any($3) or enrollment_id = any($2) or approved_request_id = any($4)',
    'account_reconciliation_items|update public.account_reconciliation_items set matched_payment_id = null where matched_payment_id = any($3)',
    'make_up_assignments|delete from public.make_up_assignments where enrollment_id = any($2) or charge_id = any($5)',
    'enrollment_requests|delete from public.enrollment_requests where id = any($4)',
    'classroom_invitations|delete from public.classroom_invitations where enrollment_id = any($2)',
    'training_feedback|delete from public.training_feedback where enrollment_id = any($2)',
    'attendance_events|delete from public.attendance_events where attendance_record_id in (select id from public.attendance_records where enrollment_id = any($2))',
    'attendance_records|delete from public.attendance_records where enrollment_id = any($2)',
    'attendance_tokens|delete from public.attendance_tokens where enrollment_id = any($2)',
    'certificates|delete from public.certificates where enrollment_id = any($2)',
    'training_instructions|delete from public.training_instructions where enrollment_id = any($2)',
    'instruction_acknowledgments|delete from public.instruction_acknowledgments where trainee_id = any($1)',
    'enrollment_requirement_checks|delete from public.enrollment_requirement_checks where enrollment_id = any($2)',
    'agency_rebates|delete from public.agency_rebates where enrollment_id = any($2) or trainee_id = any($1)',
    'payables|delete from public.payables where enrollment_id = any($2)',
    'invoices|delete from public.invoices where enrollment_id = any($2) or payment_id = any($3)',
    'receipts|delete from public.receipts where payment_id = any($3)',
    'payment_allocations|delete from public.payment_allocations where payment_id = any($3) or enrollment_id = any($2)',
    'payments|delete from public.payments where id = any($3)',
    'payment_proofs|delete from public.payment_proofs p where p.created_at >= $7 and not exists (select 1 from public.payments x where x.proof_id = p.id)',
    'enrollment_charges|delete from public.enrollment_charges where id = any($5)',
    'admission_records|delete from public.admission_records where trainee_id = any($1) or issued_at >= $7',
    'enrollments|delete from public.enrollments where id = any($2)',
    'trainees|delete from public.trainees where id = any($1)',
    'expense_reprint_requests|delete from public.expense_reprint_requests where expense_id = any($6)',
    'expense_vouchers|delete from public.expense_vouchers where expense_id = any($6)',
    'expenses|delete from public.expenses where id = any($6)',
    'cashier_openings|delete from public.cashier_openings where opening_date >= $8',
    'cashier_closings|delete from public.cashier_closings where closing_date >= $8',
    'email_logs|delete from public.email_logs where email_job_id in (select id from public.email_jobs where created_at >= $7)',
    'email_jobs|delete from public.email_jobs where created_at >= $7',
    'notifications|delete from public.notifications where created_at >= $7',
    'audit_logs|delete from public.audit_logs where created_at >= $7'
  ] loop
    if to_regclass('public.' || split_part(step, '|', 1)) is not null then
      execute split_part(step, '|', 2) using t_ids, e_ids, p_ids, r_ids, c_ids, x_ids, cutoff, cut_day;
    end if;
  end loop;

  -- Seats: recount each batch from the enrollments that remain; reopen batches that are no longer full.
  update public.batches b set
    confirmed_count = c.n,
    status = case when b.status = 'Full' and c.n < b.capacity then 'Open' else b.status end
  from (select b2.id, (select count(*) from public.enrollments e where e.batch_id = b2.id and e.enrollment_status <> 'Cancelled')::int as n from public.batches b2) c
  where c.id = b.id and b.confirmed_count <> c.n;

  -- Guards back on.
  execute 'alter table public.payments enable trigger payments_immutable';
  execute 'alter table public.payment_allocations enable trigger payment_allocations_immutable';
  execute 'alter table public.refunds_and_reversals enable trigger reversals_immutable';
  execute 'alter table public.audit_logs enable trigger audit_logs_immutable';
  execute 'alter table public.email_logs enable trigger email_logs_immutable';
  execute 'alter table public.attendance_events enable trigger attendance_events_immutable';
  if to_regclass('public.enrollment_requirement_checks') is not null then
    execute 'alter table public.enrollment_requirement_checks enable trigger enrollment_requirement_checks_immutable';
  end if;

  raise notice 'Removed % trainees, % enrollments, % payments, % requests, % expenses.', cardinality(t_ids), cardinality(e_ids), cardinality(p_ids), cardinality(r_ids), cardinality(x_ids);
end $$;
