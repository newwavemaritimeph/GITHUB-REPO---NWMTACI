-- =====================================================================
-- NWMTACI — Reset operational data (RUN ONCE, manually, in the Supabase SQL Editor)
-- =====================================================================
-- Clears all trainee/enrollment/payment/schedule/request/finance activity so the
-- live portal starts empty and new entries land in the database as fresh samples.
--
-- KEEPS: courses, course_categories, partner_centers, partner_course_offers,
--        charge_catalog, payment_methods, expense_categories, marketing_agencies,
--        agency_course_rebates, payables, certificate_templates, organization_settings,
--        roles, profiles, user_roles, employees, id_sequences.
--
-- This file is intentionally NOT under supabase/migrations/ so it never auto-applies.
-- Deletes run in FK-safe child -> parent order inside one transaction.
-- =====================================================================

begin;

-- Payments & financial documents
delete from public.payment_allocations;
delete from public.receipts;
delete from public.invoices;
delete from public.refunds_and_reversals;
delete from public.payment_proofs;
delete from public.payments;

-- Charges & rebates
delete from public.enrollment_charges;
delete from public.agency_rebates;

-- Requests
delete from public.request_events;
delete from public.enrollment_requests;

-- Training instructions
delete from public.instruction_acknowledgments;
delete from public.training_instructions;

-- Attendance & make-up
delete from public.attendance_events;
delete from public.attendance_records;
delete from public.attendance_sessions;
delete from public.attendance_tokens;
delete from public.make_up_assignments;

-- Certificates (templates are catalog and are kept)
delete from public.certificate_release_events;
delete from public.certificates;
delete from public.certificate_number_pool;

-- Enrollments
delete from public.enrollments;

-- Schedules / batches
delete from public.batch_training_dates;
delete from public.resource_assignments;
delete from public.batches;

-- Notifications
delete from public.notifications;

-- Trainees (after everything referencing them is gone)
delete from public.trainees;

-- Accounting activity (expense vouchers before expenses; keep expense_categories/payables catalog)
delete from public.expense_vouchers;
delete from public.expenses;
delete from public.account_reconciliation_items;
delete from public.cashier_closings;

commit;

-- Optional: to restart reference numbering (NWM-, ENR-, AR-, INV-, CV-, REQ- ...) from 1,
-- uncomment the next line. Leaving it commented keeps numbers monotonic (safer).
-- delete from public.id_sequences;
