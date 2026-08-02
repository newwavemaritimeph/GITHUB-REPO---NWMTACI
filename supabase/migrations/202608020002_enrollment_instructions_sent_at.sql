-- Registration/Training Operations send reporting instructions to trainees. Track
-- when instructions were sent per enrollment (the existing instructions_status only
-- covers Pending/Acknowledged). Nullable and additive — safe on a live database.

begin;

alter table public.enrollments
  add column if not exists instructions_sent_at timestamptz;

comment on column public.enrollments.instructions_sent_at is
  'When training/reporting instructions were sent to the trainee for this enrollment. Null = not yet sent.';

commit;
