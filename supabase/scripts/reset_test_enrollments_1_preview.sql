-- STEP 1 of 2 — PREVIEW ONLY. Changes nothing.
-- Shows how many test records the reset (step 2) will erase (owner, 16 Oct 2026:
-- "Remove all enrollments in the portal. These are just test run!").
-- Run this in the Supabase SQL Editor and check the counts first.

create or replace function pg_temp.n(t text) returns bigint language plpgsql as $$
declare c bigint;
begin
  if to_regclass('public.' || t) is null then return null; end if;
  execute format('select count(*) from public.%I', t) into c;
  return c;
end $$;

select t as "Table", pg_temp.n(t) as "Rows to erase"
from unnest(array[
  'trainees','enrollments','payments','payment_allocations','receipts','invoices','payment_proofs',
  'payment_reconciliations','refunds_and_reversals','enrollment_charges','enrollment_requests','request_events',
  'enrollment_requirement_checks','admission_records','certificates','certificate_release_events','certificate_photos',
  'trainee_registration_numbers','training_instructions','instruction_acknowledgments','training_feedback',
  'attendance_records','attendance_events','attendance_tokens','make_up_assignments','classroom_invitations',
  'agency_rebates','delivery_requests','mismo_submissions','training_completion_records'
]) as t
order by 1;

-- Trainee portal logins that step 2 removes (staff accounts are never touched).
select count(*) as "Trainee portal logins to remove"
from public.trainees t
where t.profile_id is not null
  and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = t.profile_id and r.is_staff);

-- Kept: staff accounts, courses, batches (seat counts go back to 0), partners and rebates,
-- certificates recorded before the portal, expenses, cashier closings, settings and the audit log.
