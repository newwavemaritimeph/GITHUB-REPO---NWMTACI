-- =====================================================================
-- Course now, batch later (7 Oct 2026, owner instruction).
-- Registration can assign any active New Wave (In-House) course to a website
-- applicant even when no batch is open, so the applicant can be screened and
-- handed to the Cashier for payment. They are placed on a batch once one
-- opens; enroll_screened_application already refuses an application without a
-- batch, so enrollment still needs a seat.
-- 1. assign_application_course: the batch becomes optional (new signature,
--    course given explicitly). With a batch it behaves as before.
-- 2. place_application_batch: put a Pending, unplaced application on a
--    bookable batch of its course and hold the seat.
-- Additive; safe to re-run.
-- =====================================================================

begin;

drop function if exists public.assign_application_course(uuid, uuid, uuid);

create or replace function public.assign_application_course(target_trainee uuid, target_course uuid, target_batch uuid default null, actor uuid default null)
returns public.enrollments language plpgsql security definer set search_path=public as $$
declare trainee_row public.trainees; batch_row public.batches; course_row public.courses; result public.enrollments;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  select * into trainee_row from public.trainees where id=target_trainee for update;
  if trainee_row.id is null then raise exception 'Applicant not found'; end if;
  select * into course_row from public.courses where id=target_course and active;
  if course_row.id is null then raise exception 'That course is not active'; end if;
  if course_row.delivery_type<>'In-House' then raise exception 'Only New Wave in-house courses can be assigned here'; end if;

  if target_batch is not null then
    select * into batch_row from public.batches where id=target_batch for update;
    if batch_row.id is null or batch_row.course_id<>course_row.id or batch_row.partner_offer_id is not null or batch_row.status<>'Open' or batch_row.enrollment_deadline<=now() or batch_row.starts_on<=current_date or batch_row.confirmed_count>=batch_row.capacity then
      raise exception 'That batch is no longer open for registration';
    end if;
    if exists(select 1 from public.enrollments where trainee_id=trainee_row.id and batch_id=target_batch and enrollment_status<>'Cancelled') then
      raise exception 'The applicant already has an application for that batch';
    end if;
  elsif exists(select 1 from public.enrollments where trainee_id=trainee_row.id and course_id=course_row.id and batch_id is null and enrollment_status='Pending') then
    raise exception 'The applicant already has an application for this course waiting for a batch';
  end if;

  insert into public.enrollments(enrollment_number,trainee_id,course_id,batch_id,enrollment_status,source,selling_price_centavos,rebate_centavos,partner_payable_centavos,rate_snapshot,created_by)
  values(public.next_reference('ENR'),trainee_row.id,course_row.id,batch_row.id,'Pending','Public registration',course_row.standard_price_centavos,0,0,
    jsonb_build_object('course_code',course_row.code,'course_name',course_row.name,'selling_price_centavos',course_row.standard_price_centavos,'captured_at',now()),actor)
  returning * into result;
  if batch_row.id is not null then
    update public.batches set confirmed_count=confirmed_count+1,status=case when confirmed_count+1>=capacity then 'Full' else status end,updated_at=now() where id=batch_row.id;
  end if;
  update public.trainees set awaiting_course=false where id=trainee_row.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values(actor, 'registration', 'application.course_assigned', 'enrollment', result.id::text,
    jsonb_build_object('trainee_id',trainee_row.id,'course_id',course_row.id,'batch_id',batch_row.id,'enrollment_number',result.enrollment_number));
  return result;
end $$;
revoke all on function public.assign_application_course(uuid,uuid,uuid,uuid) from public;
grant execute on function public.assign_application_course(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.place_application_batch(target_enrollment uuid, target_batch uuid, actor uuid)
returns public.enrollments language plpgsql security definer set search_path=public as $$
declare row_ public.enrollments; batch_row public.batches; result public.enrollments;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  select * into row_ from public.enrollments where id=target_enrollment for update;
  if row_.id is null then raise exception 'Application not found'; end if;
  if row_.enrollment_status<>'Pending' then raise exception 'Only a Pending application can be placed on a batch here'; end if;
  if row_.batch_id is not null then raise exception 'This application already has a batch; use a change-of-batch request instead'; end if;
  select * into batch_row from public.batches where id=target_batch for update;
  if batch_row.id is null or batch_row.course_id<>row_.course_id or batch_row.partner_offer_id is not null or batch_row.status<>'Open' or batch_row.enrollment_deadline<=now() or batch_row.starts_on<=current_date or batch_row.confirmed_count>=batch_row.capacity then
    raise exception 'That batch is no longer open for registration';
  end if;
  update public.enrollments set batch_id=batch_row.id, updated_at=now() where id=row_.id returning * into result;
  update public.batches set confirmed_count=confirmed_count+1,status=case when confirmed_count+1>=capacity then 'Full' else status end,updated_at=now() where id=batch_row.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values(actor, 'registration', 'application.batch_placed', 'enrollment', row_.id::text, jsonb_build_object('batch_id',batch_row.id,'batch_number',batch_row.batch_number));
  return result;
end $$;
revoke all on function public.place_application_batch(uuid,uuid,uuid) from public;
grant execute on function public.place_application_batch(uuid,uuid,uuid) to service_role;

commit;
