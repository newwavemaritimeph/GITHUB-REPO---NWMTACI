-- STEP 1 of 2 — PREVIEW ONLY (owner, 29 Oct 2026). Changes nothing.
-- Shows how many rows step 2 (erase_all_activity_2_erase.sql) would erase.

drop table if exists _preview;
create temp table _preview (t text, n bigint);

do $$
declare
  t text;
  n bigint;
  wipe text[] := array[
    -- trainees and enrollments
    'trainees','enrollments','enrollment_requests','request_events','enrollment_requirement_checks',
    'enrollment_charges','agency_rebates','admission_records','trainee_registration_numbers',
    'training_instructions','instruction_acknowledgments','training_feedback','post_test_attempts',
    'classroom_invitations','delivery_requests','mismo_submissions','training_completion_records',
    -- money
    'payments','payment_allocations','receipts','invoices','payment_proofs','refunds_and_reversals','payment_reconciliations',
    'company_payments','billing_statements','billing_statement_voids','other_income','other_income_rebates','center_payment_items',
    -- vouchers and cash
    'expenses','expense_vouchers','expense_reprint_requests','requisitions','payables','account_reconciliation_items',
    'cashier_openings','cashier_closings',
    -- certificates
    'certificates','certificate_release_events','certificate_photos','certificate_scans',
    -- schedules and attendance
    'batches','batch_training_dates','resource_assignments','batch_resources',
    'attendance_sessions','attendance_records','attendance_events','attendance_tokens','make_up_assignments',
    -- messages
    'notifications','email_jobs','email_logs'];
begin
  foreach t in array wipe loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      insert into _preview values (t, n);
    end if;
  end loop;
  select count(*) into n from public.trainees tr
  where tr.profile_id is not null
    and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = tr.profile_id and r.is_staff)
    and not exists (select 1 from public.employees e where e.profile_id = tr.profile_id);
  insert into _preview values ('(trainee portal logins)', n);
end $$;

select t as "Will be erased", n as "Rows" from _preview order by n desc, t;
