-- =====================================================================
-- Course-less website applications (7 Oct 2026, owner instruction for the
-- dry run). The website now collects personal details only; Registration
-- assigns the course and schedule while screening.
-- 1. trainees.awaiting_course marks an application that has no course yet.
-- 2. submit_public_registration accepts zero schedules (same signature). With
--    none it creates or reuses the trainee and sets awaiting_course; with some
--    it behaves exactly as in 202610070001 (Pending enrollments, seats held).
-- 3. assign_application_course places an applicant on a bookable batch as a
--    Pending enrollment, then screening continues as before.
-- Additive only.
-- =====================================================================

begin;

alter table public.trainees add column if not exists awaiting_course boolean not null default false;
create index if not exists trainees_awaiting_course_idx on public.trainees(awaiting_course) where awaiting_course;

create or replace function public.submit_public_registration(
  target_first_name text,target_middle_name text,target_last_name text,target_suffix text,target_srn text,target_email text,target_address text,target_mobile text,
  target_place_of_birth text,target_birthdate date,target_rank text,target_company text,target_emergency_name text,target_emergency_mobile text,
  target_batches uuid[],target_terms_version text,target_ip_hash text,target_marketing_agency uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  batch_row public.batches; course_row public.courses; trainee_row public.trainees; existing_trainee public.trainees;
  enrollment_row public.enrollments; registration_ref text; bid uuid;
  enrollment_ids uuid[] := array[]::uuid[]; is_new boolean := false;
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
    if batch_row.id is null or batch_row.status<>'Open' or batch_row.published_at is null or batch_row.enrollment_deadline<=now() or batch_row.starts_on<=current_date or batch_row.confirmed_count>=batch_row.capacity then
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

  insert into public.audit_logs(action,record_type,record_id,new_values,request_ip_hash)
  values('registration.public_submitted','trainee',trainee_row.id::text,jsonb_build_object('registration_reference',registration_ref,'enrollment_ids',to_jsonb(enrollment_ids),'terms_version',target_terms_version,'reused_trainee',not is_new),target_ip_hash);

  return jsonb_build_object('registration_reference',registration_ref,'trainee_id',trainee_row.id,'enrollment_ids',to_jsonb(enrollment_ids),'email',trainee_row.email,'complete_name',concat_ws(' ',trainee_row.legal_first_name,trainee_row.legal_last_name));
end $$;
grant execute on function public.submit_public_registration(text,text,text,text,text,text,text,text,text,date,text,text,text,text,uuid[],text,text,uuid) to service_role;

-- Registration assigns the course and schedule to a course-less application.
-- The batch must be bookable on the same rules as the website.
create or replace function public.assign_application_course(target_trainee uuid, target_batch uuid, actor uuid)
returns public.enrollments language plpgsql security definer set search_path=public as $$
declare trainee_row public.trainees; batch_row public.batches; course_row public.courses; result public.enrollments;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  select * into trainee_row from public.trainees where id=target_trainee for update;
  if trainee_row.id is null then raise exception 'Applicant not found'; end if;
  select * into batch_row from public.batches where id=target_batch for update;
  if batch_row.id is null or batch_row.partner_offer_id is not null or batch_row.status<>'Open' or batch_row.enrollment_deadline<=now() or batch_row.starts_on<=current_date or batch_row.confirmed_count>=batch_row.capacity then
    raise exception 'That schedule is no longer open for registration';
  end if;
  if exists(select 1 from public.enrollments where trainee_id=trainee_row.id and batch_id=target_batch and enrollment_status<>'Cancelled') then
    raise exception 'The applicant already has an application for that schedule';
  end if;
  select * into course_row from public.courses where id=batch_row.course_id and active;
  if course_row.id is null then raise exception 'That course is not active'; end if;
  insert into public.enrollments(enrollment_number,trainee_id,course_id,batch_id,enrollment_status,source,selling_price_centavos,rebate_centavos,partner_payable_centavos,rate_snapshot,created_by)
  values(public.next_reference('ENR'),trainee_row.id,course_row.id,batch_row.id,'Pending','Public registration',course_row.standard_price_centavos,0,0,
    jsonb_build_object('course_code',course_row.code,'course_name',course_row.name,'selling_price_centavos',course_row.standard_price_centavos,'captured_at',now()),actor)
  returning * into result;
  update public.batches set confirmed_count=confirmed_count+1,status=case when confirmed_count+1>=capacity then 'Full' else status end,updated_at=now() where id=batch_row.id;
  update public.trainees set awaiting_course=false where id=trainee_row.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values(actor, 'registration', 'application.course_assigned', 'enrollment', result.id::text,
    jsonb_build_object('trainee_id',trainee_row.id,'batch_id',batch_row.id,'course_id',course_row.id,'enrollment_number',result.enrollment_number));
  return result;
end $$;
revoke all on function public.assign_application_course(uuid,uuid,uuid) from public;
grant execute on function public.assign_application_course(uuid,uuid,uuid) to service_role;

commit;
