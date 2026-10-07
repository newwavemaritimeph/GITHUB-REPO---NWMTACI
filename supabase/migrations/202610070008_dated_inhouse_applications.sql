-- =====================================================================
-- Dated In-House applications (7 Oct 2026, owner instruction).
-- On the public Courses page an applicant picks an In-House course and a start
-- date (the end date follows the duration, Sundays skipped). The application
-- carries that date in enrollments.scheduled_on instead of a batch, so it may
-- be enrolled with a date instead of a batch. Every other rule is unchanged.
-- Additive; safe to re-run.
-- =====================================================================

begin;

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
  from (values ('valid_id','Valid ID / passport',1),('seamans_book','Seaman''s book / SRN',2),('medical_certificate','Medical certificate',3)) as r(code,label,ord)
  where coalesce((select c.status from public.enrollment_requirement_checks c
                  where c.enrollment_id=row_.id and c.requirement=r.code
                  order by c.checked_at desc limit 1),'')<>'Verified';
  if missing is not null then raise exception 'Not verified yet: %', array_to_string(missing, ', '); end if;

  select array_agg(p.id) into payment_ids
  from public.payment_allocations a join public.payments p on p.id=a.payment_id
  where a.enrollment_id=row_.id and p.verification_state='Verified' and p.valid;
  if payment_ids is null then raise exception 'No verified payment yet'; end if;

  update public.enrollments set enrollment_status='Enrolled', updated_at=now() where id=row_.id returning * into result;
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
