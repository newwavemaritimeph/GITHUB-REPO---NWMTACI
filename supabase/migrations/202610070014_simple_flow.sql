-- =====================================================================
-- Simpler registration flow (7 Oct 2026, owner instruction).
-- Trainee registers > Registration verifies requirements > Cashier takes
-- payment > once paid, the trainee is enrolled (automatic).
-- * Requirements: valid ID / passport, medical (PEME format), 2x2 photo,
--   seaman's book / SRN; plus an optional "other" line with a note.
-- * enrollments.enrolled_at: when the trainee became enrolled (dashboard).
-- enroll_screened_application is copied from 202610070008; only the required
-- list and the enrolled_at stamp change. Additive; safe to re-run.
-- =====================================================================

begin;

-- Allow the new requirement codes (the old check had no fixed name).
do $$
declare con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.enrollment_requirement_checks'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%requirement%'
  loop
    execute format('alter table public.enrollment_requirement_checks drop constraint %I', con.conname);
  end loop;
end $$;
alter table public.enrollment_requirement_checks add constraint enrollment_requirement_checks_requirement_check
  check (requirement in ('valid_id','medical_peme','photo_2x2','seamans_book','other','medical_certificate'));

alter table public.enrollments add column if not exists enrolled_at timestamptz;
-- Backfill: the enrolment audit entry when there is one, else the last update.
update public.enrollments e set enrolled_at = coalesce(
  (select min(a.created_at) from public.audit_logs a where a.action = 'application.enrolled' and a.record_id = e.id::text),
  e.updated_at)
where e.enrollment_status = 'Enrolled' and e.enrolled_at is null;

create or replace function public.enroll_screened_application(target_enrollment uuid, actor uuid)
returns public.enrollments language plpgsql security definer set search_path=public as $$
declare
  row_ public.enrollments; batch_row public.batches;
  missing text[]; payment_ids uuid[]; result public.enrollments;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  select * into row_ from public.enrollments where id=target_enrollment for update;
  if row_.id is null then raise exception 'Application not found'; end if;
  if row_.enrollment_status<>'Pending' then raise exception 'Only a Pending application can be enrolled (this one is %)', row_.enrollment_status; end if;
  -- A batch, or (In-House courses) a start date picked on the public site.
  if row_.batch_id is null and row_.scheduled_on is null then raise exception 'The application has no schedule yet'; end if;
  if row_.batch_id is not null then
    select * into batch_row from public.batches where id=row_.batch_id;
    if batch_row.status='Cancelled' then raise exception 'The chosen schedule was cancelled'; end if;
  end if;

  select array_agg(r.label order by r.ord) into missing
  -- Four required documents (owner, 7 Oct 2026); "other" is never required.
  -- A legacy "medical_certificate" tick counts as the PEME medical.
  from (values ('valid_id','Valid ID / passport',1),('medical_peme','Medical (PEME format)',2),('photo_2x2','2x2 photo',3),('seamans_book','Seaman''s book / SRN',4)) as r(code,label,ord)
  where coalesce((select c.status from public.enrollment_requirement_checks c
                  where c.enrollment_id=row_.id and (c.requirement=r.code or (r.code='medical_peme' and c.requirement='medical_certificate'))
                  order by c.checked_at desc limit 1),'')<>'Verified';
  if missing is not null then raise exception 'Not verified yet: %', array_to_string(missing, ', '); end if;

  select array_agg(p.id) into payment_ids
  from public.payment_allocations a join public.payments p on p.id=a.payment_id
  where a.enrollment_id=row_.id and p.verification_state='Verified' and p.valid;
  if payment_ids is null then raise exception 'No verified payment yet'; end if;

  update public.enrollments set enrollment_status='Enrolled', enrolled_at=now(), updated_at=now() where id=row_.id returning * into result;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values(actor, 'registration', 'application.enrolled', 'enrollment', row_.id::text,
    jsonb_build_object('payment_ids', to_jsonb(payment_ids),
      'checks', (select jsonb_agg(jsonb_build_object('requirement',c.requirement,'status',c.status,'checked_by',c.checked_by,'checked_at',c.checked_at))
                 from (select distinct on (requirement) * from public.enrollment_requirement_checks where enrollment_id=row_.id order by requirement, checked_at desc) c)));
  return result;
end $$;
revoke all on function public.enroll_screened_application(uuid,uuid) from public;
grant execute on function public.enroll_screened_application(uuid,uuid) to service_role;

commit;
