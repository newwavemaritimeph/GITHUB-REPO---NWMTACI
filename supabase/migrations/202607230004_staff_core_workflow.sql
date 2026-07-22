begin;

alter table public.employees add column if not exists work_email text;
create unique index if not exists employees_work_email_unique on public.employees(lower(work_email)) where work_email is not null;

insert into public.email_templates(template_code,version,subject,body_html,body_text,active) values
('instructor.schedule.updated',1,'Updated New Wave class schedule: {{course_name}}','<p>Hello {{instructor_name}},</p><p>Your New Wave class schedule has been updated.</p><p><strong>{{course_name}}</strong><br>{{training_dates}}<br>{{daily_time}}<br>{{room_name}} — {{venue}}</p><p>Please review your weekly schedule in the staff portal.</p>','Hello {{instructor_name}},\n\nYour New Wave class schedule has been updated.\n\n{{course_name}}\n{{training_dates}}\n{{daily_time}}\n{{room_name}} — {{venue}}\n\nPlease review your weekly schedule in the staff portal.',true),
('instructor.weekly.schedule',1,'Your weekly New Wave instructor schedule','<p>Hello {{instructor_name}},</p><p>Your weekly New Wave instructor schedule has been updated. Sign in to the staff portal to review your assigned classes.</p>','Hello {{instructor_name}},\n\nYour weekly New Wave instructor schedule has been updated. Sign in to the staff portal to review your assigned classes.',true)
on conflict(template_code,version) do update set subject=excluded.subject,body_html=excluded.body_html,body_text=excluded.body_text,active=true;

create or replace function public.create_training_batch(
  target_course uuid,
  target_partner_offer uuid,
  target_instructor_name text,
  target_instructor_email text,
  target_room_name text,
  target_starts_on date,
  target_ends_on date,
  target_daily_start time,
  target_daily_end time,
  target_mode text,
  target_venue text,
  target_capacity integer,
  target_enrollment_deadline timestamptz,
  target_publish boolean default true
) returns public.batches language plpgsql security definer set search_path = public as $$
declare result public.batches; course_row public.courses; instructor_row public.employees; room_row public.classrooms; training_day date; expected_end date; required_days integer; created_days integer := 0; start_dow integer;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into course_row from public.courses where id=target_course and active and delivery_type='In-House';
  if course_row.id is null then raise exception 'Batches are only available for New Wave STCW and In-House courses'; end if;
  if target_partner_offer is not null then raise exception 'Endorsed training center offers do not use New Wave batches'; end if;
  if target_capacity <> 24 then raise exception 'Every New Wave batch must have a capacity of 24 trainees'; end if;
  if target_enrollment_deadline >= target_starts_on::timestamptz + interval '1 day' then raise exception 'Enrollment deadline must be before training starts'; end if;
  if nullif(trim(target_instructor_name),'') is null or nullif(trim(target_instructor_email),'') is null then raise exception 'Instructor name and email are required'; end if;
  if nullif(trim(target_room_name),'') is null or nullif(trim(target_venue),'') is null then raise exception 'Room and venue are required'; end if;
  required_days := greatest(1,ceil(coalesce(course_row.duration_days,1)))::integer;
  start_dow := extract(isodow from target_starts_on)::integer;
  if course_row.code='STPPDSPPS' and start_dow<>1 then raise exception 'Safety starts every Monday';
  elsif course_row.code='PSCMT' and start_dow<>2 then raise exception 'Crowd starts every Tuesday';
  elsif course_row.code='PSCMHBT' and start_dow<>4 then raise exception 'Crisis starts every Thursday';
  elsif course_row.code in ('UBT-PSSR','CCMI') and (start_dow=7 or (course_row.code='CCMI' and start_dow<>1)) then raise exception 'Select a valid Monday-Saturday start for this course';
  elsif course_row.code not in ('STPPDSPPS','PSCMT','PSCMHBT','UBT-PSSR','CCMI') and (
    (required_days=1 and start_dow=7) or (required_days=2 and start_dow not in (1,3,5)) or
    (required_days=3 and start_dow not in (1,4)) or (required_days>=4 and start_dow<>1)
  ) then raise exception 'The start date does not match the required weekday pattern for this course duration'; end if;
  training_day := target_starts_on;
  while created_days < required_days loop
    if extract(isodow from training_day)::integer <> 7 then created_days := created_days + 1; expected_end := training_day; end if;
    if created_days < required_days then training_day := training_day + 1; end if;
  end loop;
  if target_ends_on <> expected_end then raise exception 'End date must match the automatic course duration pattern'; end if;

  select * into instructor_row from public.employees where lower(work_email)=lower(trim(target_instructor_email)) and active limit 1;
  if instructor_row.id is null then
    insert into public.employees(employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,work_email)
    values(public.next_reference('EMP'),trim(target_instructor_name),'Instructor','Active',current_date,'Daily',0,lower(trim(target_instructor_email))) returning * into instructor_row;
  end if;
  select * into room_row from public.classrooms where lower(name)=lower(trim(target_room_name)) and active limit 1;
  if room_row.id is null then
    insert into public.classrooms(name,venue,capacity) values(trim(target_room_name),trim(target_venue),24) returning * into room_row;
  elsif room_row.capacity < 24 then raise exception 'Selected room capacity must be at least 24'; end if;

  insert into public.batches(
    batch_number, course_id, partner_offer_id, starts_on, ends_on, daily_start, daily_end,
    mode, venue, capacity, enrollment_deadline, published_at, created_by
  ) values (
    public.next_reference('BCH'), target_course, target_partner_offer, target_starts_on, target_ends_on,
    target_daily_start, target_daily_end, trim(target_mode), nullif(trim(target_venue), ''), target_capacity,
    target_enrollment_deadline, case when target_publish then now() else null end, auth.uid()
  ) returning * into result;

  training_day := target_starts_on;
  while training_day <= target_ends_on loop
    if extract(isodow from training_day)::integer <> 7 then
      with inserted_date as (
        insert into public.batch_training_dates(batch_id,training_date,starts_at,ends_at)
        values(result.id,training_day,(training_day+target_daily_start) at time zone 'Asia/Manila',(training_day+target_daily_end) at time zone 'Asia/Manila') returning id
      ) insert into public.resource_assignments(batch_training_date_id,instructor_id,classroom_id)
        select id,instructor_row.id,room_row.id from inserted_date;
    end if;
    training_day := training_day + 1;
  end loop;
  insert into public.email_jobs(idempotency_key,template_code,recipient,variables)
  values('instructor-assignment:'||result.id,'instructor.schedule.updated',instructor_row.work_email,
    jsonb_build_object('instructor_name',instructor_row.complete_name,'course_name',course_row.name,'training_dates',target_starts_on||' to '||target_ends_on,'daily_time',target_daily_start||'–'||target_daily_end,'room_name',room_row.name,'venue',room_row.venue));
  insert into public.email_jobs(idempotency_key,template_code,recipient,variables,scheduled_for)
  values('instructor-weekly:'||instructor_row.id||':'||date_trunc('week',target_starts_on::timestamp)::date,'instructor.weekly.schedule',instructor_row.work_email,
    jsonb_build_object('instructor_name',instructor_row.complete_name),date_trunc('week',target_starts_on::timestamp)+interval '4 days 08:00') on conflict(idempotency_key) do nothing;

  insert into public.audit_logs(actor_id,actor_role,action,record_type,record_id,new_values)
  values(auth.uid(),'training_operations','batch.created','batch',result.id::text,to_jsonb(result));
  return result;
end $$;

create or replace function public.create_staff_enrollment(
  target_existing_trainee uuid,
  target_first_name text,
  target_middle_name text,
  target_last_name text,
  target_birthdate date,
  target_email text,
  target_mobile text,
  target_course uuid,
  target_partner_offer uuid,
  target_batch uuid,
  target_source text default 'Staff-assisted registration'
) returns public.enrollments language plpgsql security definer set search_path = public as $$
declare
  trainee_row public.trainees;
  course_row public.courses;
  offer_row public.partner_course_offers;
  batch_row public.batches;
  result public.enrollments;
  selling bigint;
  rebate bigint := 0;
  payable bigint := 0;
begin
  if not public.has_any_role(array['admin','registration','training_operations']) then raise exception 'Not authorized'; end if;
  select * into course_row from public.courses where id = target_course and active;
  if course_row.id is null then raise exception 'Course is not active'; end if;

  if target_existing_trainee is null then
    if nullif(trim(target_first_name),'') is null or nullif(trim(target_last_name),'') is null then raise exception 'Trainee name is required'; end if;
    if exists(select 1 from public.trainees where lower(email)=lower(trim(target_email)) or mobile=trim(target_mobile)) then
      raise exception 'A trainee with this email or mobile number already exists';
    end if;
    insert into public.trainees(
      trainee_number,legal_first_name,legal_middle_name,legal_last_name,birthdate,email,mobile,account_state
    ) values (
      public.next_reference('NWM'),trim(target_first_name),nullif(trim(target_middle_name),''),trim(target_last_name),
      target_birthdate,lower(trim(target_email)),trim(target_mobile),'Active'
    ) returning * into trainee_row;
  else
    select * into trainee_row from public.trainees where id=target_existing_trainee and account_state <> 'Deactivated';
    if trainee_row.id is null then raise exception 'Trainee not found'; end if;
  end if;

  if target_partner_offer is not null then
    select * into offer_row from public.partner_course_offers
    where id=target_partner_offer and course_id=target_course and active
      and effective_from <= current_date and (effective_to is null or effective_to >= current_date);
    if offer_row.id is null then raise exception 'Partner offer is not active for this course'; end if;
    selling := offer_row.training_fee_centavos;
    rebate := offer_row.rebate_centavos;
    payable := offer_row.partner_payable_centavos;
  else
    selling := course_row.standard_price_centavos;
  end if;

  if target_batch is not null then
    select * into batch_row from public.batches where id=target_batch and course_id=target_course;
    if batch_row.id is null or batch_row.partner_offer_id is distinct from target_partner_offer then
      raise exception 'The selected schedule does not match this course offer';
    end if;
  end if;
  if exists (
    select 1 from public.enrollments where trainee_id=trainee_row.id and course_id=target_course
      and enrollment_status in ('Pending','Open Schedule','Enrolled')
      and batch_id is not distinct from target_batch
  ) then raise exception 'This trainee already has an active enrollment for the selected course and schedule'; end if;

  insert into public.enrollments(
    enrollment_number,trainee_id,course_id,partner_offer_id,batch_id,enrollment_status,source,
    selling_price_centavos,rebate_centavos,partner_payable_centavos,rate_snapshot,created_by
  ) values (
    public.next_reference('ENR'),trainee_row.id,target_course,target_partner_offer,null,
    case when target_batch is null then 'Open Schedule' else 'Pending' end,target_source,
    selling,rebate,payable,
    jsonb_build_object('course_code',course_row.code,'course_name',course_row.name,'selling_price_centavos',selling,
      'rebate_centavos',rebate,'partner_payable_centavos',payable,'captured_at',now()),auth.uid()
  ) returning * into result;

  if target_batch is not null then
    result := public.confirm_enrollment(result.id,target_batch);
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,record_type,record_id,new_values)
  values(auth.uid(),'registration','enrollment.created','enrollment',result.id::text,to_jsonb(result));
  return result;
end $$;

grant execute on function public.create_training_batch(uuid,uuid,text,text,text,date,date,time,time,text,text,integer,timestamptz,boolean) to authenticated;
grant execute on function public.create_staff_enrollment(uuid,text,text,text,date,text,text,uuid,uuid,uuid,text) to authenticated;

commit;
