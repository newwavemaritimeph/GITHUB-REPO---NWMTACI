-- Endorsed / partner enrollments have no New Wave batch, so registration staff
-- record a free training date instead of choosing an opened batch. This adds a
-- nullable date column; in-house batch enrollments keep using batch_id and leave
-- this null. Additive and safe to run on a live database.

begin;

alter table public.enrollments
  add column if not exists scheduled_on date;

comment on column public.enrollments.scheduled_on is
  'Free training date for endorsed/partner enrollments that have no New Wave batch. Null for batch-based (in-house) enrollments.';

commit;
