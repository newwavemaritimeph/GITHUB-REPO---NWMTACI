-- Faster saving and loading (owner, 4 Nov 2026). Additive; no data changes; safe to re-run.
-- * Indexes for how the portal reads its lists: newest first, by month, and by enrollment.
-- * portal_change_stamp(): one small read that tells an open portal whether anything changed, so its
--   10-second refresh reloads everything only when there is something new.

create index if not exists enrollments_created_idx on public.enrollments(created_at desc);
create index if not exists enrollments_updated_idx on public.enrollments(updated_at desc);
create index if not exists trainees_created_idx on public.trainees(created_at desc);
create index if not exists trainees_updated_idx on public.trainees(updated_at desc);
create index if not exists payments_received_idx on public.payments(received_at desc);
create index if not exists payments_created_idx on public.payments(created_at desc);
create index if not exists payments_trainee_idx on public.payments(trainee_id);
create index if not exists payment_allocations_enrollment_idx on public.payment_allocations(enrollment_id);
create index if not exists enrollment_charges_enrollment_idx on public.enrollment_charges(enrollment_id);
create index if not exists enrollment_charges_created_idx on public.enrollment_charges(created_at desc);
create index if not exists expenses_created_idx on public.expenses(created_at desc);
create index if not exists enrollment_requests_created_idx on public.enrollment_requests(created_at desc);
create index if not exists enrollment_requests_updated_idx on public.enrollment_requests(updated_at desc);
create index if not exists certificates_created_idx on public.certificates(created_at desc);
create index if not exists certificates_updated_idx on public.certificates(updated_at desc);
create index if not exists batches_starts_idx on public.batches(starts_on);
create index if not exists batches_updated_idx on public.batches(updated_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, created_at desc);

create or replace function public.portal_change_stamp() returns text
language sql stable security definer set search_path = public as $$
  select concat_ws('|',
    (select max(updated_at) from trainees),
    (select max(updated_at) from enrollments),
    (select max(updated_at) from batches),
    (select max(updated_at) from courses),
    (select max(updated_at) from enrollment_requests),
    (select max(updated_at) from certificates),
    (select max(created_at) from payments),
    (select max(created_at) from enrollment_charges),
    (select max(created_at) from expenses),
    (select max(created_at) from audit_logs),
    (select max(created_at) from request_events),
    (select max(created_at) from notifications),
    (select max(created_at) from delivery_requests),
    (select max(checked_at) from enrollment_requirement_checks),
    (select max(last_printed_at) from admission_records),
    (select max(submitted_at) from payment_proofs),
    (select max(submitted_at) from training_feedback),
    (select max(submitted_at) from cashier_closings),
    (select max(published_at) from announcements)
  );
$$;
revoke all on function public.portal_change_stamp() from public, anon, authenticated;
grant execute on function public.portal_change_stamp() to service_role;

select public.portal_change_stamp() is not null as stamp_works;
