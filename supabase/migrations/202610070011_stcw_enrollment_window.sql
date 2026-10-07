-- =====================================================================
-- STCW enrollment window and seats (7 Oct 2026, owner instruction).
-- * Each STCW batch takes 24 trainees; it closes (Full) at 24.
-- * Enrollment stays open until 07:00 Manila on the training date: the first
--   day for BT-PSSR, Safety, Crowd and Crisis; the last day for CCM Domestic
--   (late enrollment). A batch starting today can still be booked before 07:00.
-- * Open batches get the new deadline; the monthly auto-open uses it too.
-- Function bodies are copied from 202610070009 / 202610070010; only the
-- "already started" check and the deadline change. Additive; safe to re-run.
-- =====================================================================

begin;

-- 24 seats per STCW batch.
update public.batches b set capacity = 24, updated_at = now()
from public.courses c
where c.id = b.course_id and c.delivery_type = 'In-House'
  and c.code in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT', 'CCMD')
  and b.status in ('Open', 'Full') and b.capacity <> 24 and b.confirmed_count <= 24;
update public.batches b set status = case when b.confirmed_count >= 24 then 'Full' else 'Open' end, updated_at = now()
from public.courses c
where c.id = b.course_id and c.delivery_type = 'In-House'
  and c.code in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT', 'CCMD')
  and b.status in ('Open', 'Full') and b.ends_on >= (now() at time zone 'Asia/Manila')::date;

-- Deadline 07:00 on the training date (CCMD: on the last training day).
update public.batches b
set enrollment_deadline = ((case when c.late_enrollment then b.ends_on else b.starts_on end) + time '07:00') at time zone 'Asia/Manila', updated_at = now()
from public.courses c
where c.id = b.course_id and c.delivery_type = 'In-House'
  and c.code in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT', 'CCMD')
  and b.status in ('Open', 'Full') and b.ends_on >= (now() at time zone 'Asia/Manila')::date;

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
    if batch_row.id is null or batch_row.status<>'Open' or batch_row.published_at is null or batch_row.enrollment_deadline<=now() or (batch_row.starts_on<current_date and not public.allows_late_enrollment(batch_row.course_id)) or batch_row.ends_on<current_date or batch_row.confirmed_count>=batch_row.capacity then
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
    if batch_row.id is null or batch_row.course_id<>course_row.id or batch_row.partner_offer_id is not null or batch_row.status<>'Open' or batch_row.enrollment_deadline<=now() or (batch_row.starts_on<current_date and not public.allows_late_enrollment(batch_row.course_id)) or batch_row.ends_on<current_date or batch_row.confirmed_count>=batch_row.capacity then
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
  if batch_row.id is null or batch_row.course_id<>row_.course_id or batch_row.partner_offer_id is not null or batch_row.status<>'Open' or batch_row.enrollment_deadline<=now() or (batch_row.starts_on<current_date and not public.allows_late_enrollment(batch_row.course_id)) or batch_row.ends_on<current_date or batch_row.confirmed_count>=batch_row.capacity then
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

create or replace function public.open_monthly_stcw_batches(target_month date default null)
returns table(course_code text, batches_opened integer)
language plpgsql security definer set search_path = public as $$
declare
  month_start date := date_trunc('month', coalesce(target_month, (now() at time zone 'Asia/Manila')::date + interval '1 month'))::date;
  month_end date := (date_trunc('month', coalesce(target_month, (now() at time zone 'Asia/Manila')::date + interval '1 month')) + interval '1 month - 1 day')::date;
  range_start date;
  course_row record;
  d date; dow integer; ok boolean;
  required_days integer; training_day date; counted integer; end_day date;
  new_batch public.batches;
  opened integer;
begin
  -- Never open a date that has already started.
  range_start := greatest(month_start, (now() at time zone 'Asia/Manila')::date + 1);
  for course_row in
    select * from public.courses
    where code in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT', 'CCMD') and active and delivery_type = 'In-House'
    order by code
  loop
    required_days := greatest(1, ceil(coalesce(course_row.duration_days, 1)))::integer;
    opened := 0;
    d := range_start;
    while d <= month_end loop
      dow := extract(isodow from d)::integer;
      ok := case course_row.code
        when 'UBT-PSSR' then dow between 1 and 6
        when 'STPPDSPPS' then dow = 1
        when 'PSCMT' then dow = 2
        when 'PSCMHBT' then dow = 4
        when 'CCMD' then dow = 1
        else false end;

      if ok and not exists (
        select 1 from public.batches b join public.courses c on c.id = b.course_id
        where c.code = course_row.code and c.delivery_type = 'In-House' and b.starts_on = d and b.active
      ) then
        training_day := d; counted := 0; end_day := d;
        while counted < required_days loop
          if extract(isodow from training_day)::integer <> 7 then counted := counted + 1; end_day := training_day; end if;
          if counted < required_days then training_day := training_day + 1; end if;
        end loop;

        insert into public.batches(
          batch_number, course_id, partner_offer_id, starts_on, ends_on, daily_start, daily_end,
          mode, venue, capacity, enrollment_deadline, published_at, created_by
        ) values (
          public.next_reference('BCH'), course_row.id, null, d, end_day, time '08:00', time '17:00',
          'In-person', null, 24, ((case when course_row.code = 'CCMD' then end_day else d end) + time '07:00') at time zone 'Asia/Manila', now(), null
        ) returning * into new_batch;

        training_day := d;
        while training_day <= end_day loop
          if extract(isodow from training_day)::integer <> 7 then
            insert into public.batch_training_dates(batch_id, training_date, starts_at, ends_at)
            values (new_batch.id, training_day,
              (training_day + time '08:00') at time zone 'Asia/Manila',
              (training_day + time '17:00') at time zone 'Asia/Manila');
          end if;
          training_day := training_day + 1;
        end loop;
        opened := opened + 1;
      end if;
      d := d + 1;
    end loop;
    course_code := course_row.code; batches_opened := opened;
    return next;
  end loop;

  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (null, 'system', 'batches.monthly_auto_open', 'month', to_char(month_start, 'YYYY-MM'),
    jsonb_build_object('month', to_char(month_start, 'YYYY-MM'), 'opened_from', range_start));
end $$;

revoke all on function public.open_monthly_stcw_batches(date) from public, anon, authenticated;
grant execute on function public.open_monthly_stcw_batches(date) to service_role;

commit;
