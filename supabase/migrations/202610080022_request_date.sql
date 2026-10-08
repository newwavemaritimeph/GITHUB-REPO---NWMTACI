-- Request date and fee rule (owner, 8 Oct 2026). The date the trainee asked is
-- recorded on the request; rescheduling and cancellation fees are worked out
-- from it against the training start date. Additive; safe to re-run.

alter table public.enrollment_requests
  add column if not exists requested_on date,
  add column if not exists fee_rule text;

update public.enrollment_requests
set requested_on = (created_at at time zone 'Asia/Manila')::date
where requested_on is null;
