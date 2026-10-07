-- =====================================================================
-- Late enrollment for CCM Domestic (7 Oct 2026, owner instruction).
-- Crowd and Crisis Management - Domestic (CCMD) keeps taking enrollments after
-- its training has started, until the last training day begins (08:00 Manila).
-- Other courses still close when training starts.
-- * courses.late_enrollment marks such courses (CCMD only for now).
-- * The website submit, Assign course and Choose batch functions accept a
--   started batch of a late-enrollment course while its deadline is open.
-- * Open CCMD batches move their deadline to 08:00 on the last training day.
-- Function bodies are copied from 202610070003 / 202610070005; only the
-- "already started" check changes. Additive; safe to re-run.
-- =====================================================================

begin;

alter table public.courses add column if not exists late_enrollment boolean not null default false;
update public.courses set late_enrollment = true where code = 'CCMD' and delivery_type = 'In-House';

create or replace function public.allows_late_enrollment(target_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select late_enrollment from public.courses where id = target_course), false)
$$;
grant execute on function public.allows_late_enrollment(uuid) to anon, authenticated, service_role;

update public.batches b set enrollment_deadline = (b.ends_on + time '08:00') at time zone 'Asia/Manila'
from public.courses c
where c.id = b.course_id and c.late_enrollment and b.status = 'Open' and b.ends_on >= (now() at time zone 'Asia/Manila')::date;

create or replace function public.submit_public_registration(
  target_first_name text,target_middle_name text,target_last_name text,target_suffix text,target_srn text,target_email text,target_address text,target_mobile text,
  target_place_of_birth text,target_birthdate date,target_rank text,target_company text,target_emergency_name text,target_emergency_mobile text,
  target_batches uuid[],target_terms_version text,target_ip_hash text,target_marketing_agency uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  batch_row public.batches; course_row public.courses; trainee_row public.trainees; existing_trainee public.trainees;
  enrollment_row public.enrollments; registration_ref text; bid uuid;
  enrollment_ids uuid[] := array[]::uuid[]; is_new boolean := false; application_no text;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  if not exists(select 1 from public.terms_documents where version=target_terms_version and active and effective_from<=current_date) then raise exception 'Terms version is not active'; end if;
  -- Schedules are optional: with none, the application waits for Registration
  -- to assign the course and schedule during screening.
  target_batches := coalesce(target_batches, array[]::uuid[]);
  if coalesce(array_length(target_batches,1),0) > 5 then raise exception 'You can select up to 5 courses per submission'; end if;

  -- Reuse a returning applicant: match on SRN first, then email, then mobile.
  select * into existing_trainee from public.trainees
    where (nullif(trim(target_srn),'') is not null and srn = trim(target_srn))
       or lower(email) = lower(trim(target_email))
       or mobile = trim(target_mobile)
    order by case when nullif(trim(target_srn),'') is not null and srn = trim(target_srn) then 0 else 1 end
    limit 1;

  if existing_trainee.id is not null then
    trainee_row := existing_trainee;
    registration_ref := trainee_row.registration_reference;
  else
    registration_ref := public.next_reference('REG');
    insert into public.trainees(trainee_number,registration_reference,legal_first_name,legal_middle_name,legal_last_name,suffix,birthdate,place_of_birth,address,mobile,email,srn,rank,company,emergency_contact,marketing_agency_id,terms_version,terms_accepted_at,terms_acceptance_ip_hash,account_state)
    values(public.next_reference('NWM'),registration_ref,trim(target_first_name),nullif(trim(target_middle_name),''),trim(target_last_name),nullif(trim(target_suffix),''),target_birthdate,trim(target_place_of_birth),trim(target_address),trim(target_mobile),lower(trim(target_email)),nullif(trim(target_srn),''),nullif(trim(target_rank),''),nullif(trim(target_company),''),jsonb_build_object('name',trim(target_emergency_name),'mobile',trim(target_emergency_mobile)),target_marketing_agency,target_terms_version,now(),target_ip_hash,'Pending') returning * into trainee_row;
    is_new := true;
  end if;

  foreach bid in array target_batches loop
    select * into batch_row from public.batches where id=bid for update;
    if batch_row.id is null or batch_row.status<>'Open' or batch_row.published_at is null or batch_row.enrollment_deadline<=now() or (batch_row.starts_on<=current_date and not public.allows_late_enrollment(batch_row.course_id)) or batch_row.ends_on<current_date or batch_row.confirmed_count>=batch_row.capacity then
      raise exception 'One of the selected schedules is no longer available';
    end if;
    -- Skip a batch the trainee already has an active application for (idempotent re-submit).
    if exists(select 1 from public.enrollments where trainee_id=trainee_row.id and batch_id=bid and enrollment_status<>'Cancelled') then
      continue;
    end if;
    select * into course_row from public.courses where id=batch_row.course_id and active;
    insert into public.enrollments(enrollment_number,trainee_id,course_id,batch_id,enrollment_status,source,selling_price_centavos,rebate_centavos,partner_payable_centavos,rate_snapshot)
    values(public.next_reference('ENR'),trainee_row.id,course_row.id,batch_row.id,'Pending','Public registration',course_row.standard_price_centavos,0,0,jsonb_build_object('course_code',course_row.code,'course_name',course_row.name,'selling_price_centavos',course_row.standard_price_centavos,'captured_at',now())) returning * into enrollment_row;
    enrollment_ids := enrollment_ids || enrollment_row.id;
    update public.batches set confirmed_count=confirmed_count+1,status=case when confirmed_count+1>=capacity then 'Full' else status end,updated_at=now() where id=batch_row.id;
  end loop;

  if coalesce(array_length(target_batches,1),0) = 0 then
    update public.trainees set awaiting_course=true where id=trainee_row.id;
  elsif coalesce(array_length(enrollment_ids,1),0) = 0 then
    raise exception 'You already have an application for the selected schedule(s).';
  end if;

  -- Every submission gets its own enrollment number (NWMTACI-0000001). It is
  -- what the applicant quotes on Facebook, so staff can find the application.
  application_no := 'NWMTACI-' || lpad(nextval('public.application_number_seq')::text, 7, '0');
  update public.trainees set application_number = application_no, application_submitted_at = now() where id = trainee_row.id;

  insert into public.audit_logs(action,record_type,record_id,new_values,request_ip_hash)
  values('registration.public_submitted','trainee',trainee_row.id::text,jsonb_build_object('application_number',application_no,'registration_reference',registration_ref,'enrollment_ids',to_jsonb(enrollment_ids),'terms_version',target_terms_version,'reused_trainee',not is_new),target_ip_hash);

  return jsonb_build_object('application_number',application_no,'registration_reference',registration_ref,'trainee_id',trainee_row.id,'enrollment_ids',to_jsonb(enrollment_ids),'email',trainee_row.email,'complete_name',concat_ws(' ',trainee_row.legal_first_name,trainee_row.legal_last_name));
end $$;
grant execute on function public.submit_public_registration(text,text,text,text,text,text,text,text,text,date,text,text,text,text,uuid[],text,text,uuid) to service_role;

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
    if batch_row.id is null or batch_row.course_id<>course_row.id or batch_row.partner_offer_id is not null or batch_row.status<>'Open' or batch_row.enrollment_deadline<=now() or (batch_row.starts_on<=current_date and not public.allows_late_enrollment(batch_row.course_id)) or batch_row.ends_on<current_date or batch_row.confirmed_count>=batch_row.capacity then
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
  if batch_row.id is null or batch_row.course_id<>row_.course_id or batch_row.partner_offer_id is not null or batch_row.status<>'Open' or batch_row.enrollment_deadline<=now() or (batch_row.starts_on<=current_date and not public.allows_late_enrollment(batch_row.course_id)) or batch_row.ends_on<current_date or batch_row.confirmed_count>=batch_row.capacity then
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
