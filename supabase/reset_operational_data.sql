-- =====================================================================
-- NWMTACI — Reset operational data for a dry run
-- RUN MANUALLY in the Supabase SQL Editor (postgres role). Never auto-applied:
-- this file is intentionally NOT under supabase/migrations/.
-- =====================================================================
-- Clears every trainee, application, enrollment, payment and finance record so
-- the portal starts empty and the dry run begins from a clean slate.
--
-- DELETES: trainees (and their trainee-only sign-in accounts), applications and
--   requirement checks, enrollments, payments, receipts, invoices, proofs,
--   refunds, charges, agency rebates, requests, training instructions,
--   attendance, make-ups, certificates, feedback, notifications, expenses,
--   vouchers, reconciliation items, cashier closings, and the audit-log
--   entries about those records.
-- KEEPS: courses, categories, partner centers and offers, schedules/batches
--   (seat counts reset to 0), classrooms, charge catalog, payment channels,
--   expense categories, marketing agencies, agency course rebates, payables,
--   certificate templates, organization settings, terms, roles, staff
--   profiles and accounts, employees, HR records, and id_sequences.
--
-- BEFORE RUNNING: take a backup (Supabase dashboard → Database → Backups, or
-- `supabase db dump`). Payment-proof files in Storage are not removed here;
-- empty the payment-proofs bucket from the dashboard if you want them gone.
-- Everything runs in one transaction: any error rolls the whole reset back.
-- =====================================================================

begin;

-- Trainee sign-in accounts to remove afterwards: only profiles that belong to a
-- trainee and hold no staff role. Captured before the trainees are deleted.
create temporary table reset_trainee_accounts on commit drop as
  select t.profile_id as id from public.trainees t
  where t.profile_id is not null
    and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                    where ur.user_id = t.profile_id and r.is_staff);

-- Financial and audit tables are append-only (a trigger blocks DELETE). Replica
-- mode disables triggers and FK checks for this session only; it is restored
-- below. Delete order is still child -> parent for clarity.
set session_replication_role = replica;

-- Payments and financial documents
delete from public.payment_allocations;
delete from public.receipts;
delete from public.invoices;
delete from public.refunds_and_reversals;
delete from public.payment_proofs;
delete from public.payments;

-- Charges and rebates
delete from public.enrollment_charges;
delete from public.agency_rebates;

-- Requests
delete from public.request_events;
delete from public.enrollment_requests;

-- Application screening (table exists once 202610070001 is applied)
do $$ begin
  if to_regclass('public.enrollment_requirement_checks') is not null then
    execute 'delete from public.enrollment_requirement_checks';
  end if;
end $$;

-- Training instructions and feedback
delete from public.instruction_acknowledgments;
delete from public.training_instructions;
do $$ begin
  if to_regclass('public.training_feedback') is not null then execute 'delete from public.training_feedback'; end if;
end $$;

-- Attendance and make-up
delete from public.attendance_events;
delete from public.attendance_records;
delete from public.attendance_sessions;
delete from public.attendance_tokens;
delete from public.make_up_assignments;

-- Certificates (templates are kept)
delete from public.certificate_release_events;
delete from public.certificates;
delete from public.certificate_number_pool;

-- Enrollments
delete from public.enrollments;

-- Schedules are kept; nobody is booked any more, so seats go back to zero.
update public.batches set confirmed_count = 0, status = case when status = 'Full' then 'Open' else status end, updated_at = now();

-- Notifications
delete from public.notifications;

-- Trainees (after everything that references them)
delete from public.trainees;

-- Accounting activity (vouchers before expenses)
delete from public.expense_vouchers;
delete from public.expenses;
delete from public.account_reconciliation_items;
delete from public.cashier_closings;

-- Audit entries about the deleted records. Configuration, staff and schedule
-- history is kept.
delete from public.audit_logs
where record_type in ('trainee','enrollment','payment','receipt','invoice','expense','expense_voucher','cashier_closing','enrollment_request','request','certificate','attendance','refund','enrollment_charge')
   or split_part(action, '.', 1) in ('registration','application','payment','enrollment','certificate','training','report','request','charge','discount','expense','cashier_closing','attendance','refund');

-- Trainee-only sign-in accounts (staff accounts are never touched).
delete from public.profiles where id in (select id from reset_trainee_accounts);
delete from auth.users where id in (select id from reset_trainee_accounts);

-- Restore normal trigger and constraint enforcement.
set session_replication_role = default;

commit;

-- Check: every count below should be 0.
select 'trainees' as data, count(*) from public.trainees
union all select 'enrollments', count(*) from public.enrollments
union all select 'payments', count(*) from public.payments
union all select 'expenses', count(*) from public.expenses
union all select 'cashier_closings', count(*) from public.cashier_closings;

-- Website enrollment numbers start again at NWMTACI-0000001.
do $$ begin
  if to_regclass('public.application_number_seq') is not null then
    execute 'alter sequence public.application_number_seq restart with 1';
  end if;
end $$;

-- Optional: restart reference numbers (NWM-, REG-, ENR-, AR-, INV-, CV-, REQ- ...)
-- from 1. Leaving it commented keeps numbers monotonic, which is safer if any
-- printed document from before the reset is still around.
-- delete from public.id_sequences;
