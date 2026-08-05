-- =====================================================================
-- In-house batches: instructor/classroom/venue are now OPTIONAL, and
-- auto-opened batches are PUBLISHED immediately (so internal Open batches are
-- publicly bookable). Re-creates three functions; bodies are otherwise identical
-- to their originals (202607230004, 202607300001). Additive / safe to re-run.
-- =====================================================================

begin;

-- 1) Auto-open a month of blank batches — now PUBLISHED on creation.
create or replace function public.auto_open_training_batches(
  target_course uuid, target_year integer, target_month integer
) returns integer language plpgsql security definer set search_path = public as $$
declare
  course_row public.courses;
  required_days integer;
  first_day date; last_day date; d date; dow integer; ok boolean;
  training_day date; created_days integer; end_day date;
  new_batch public.batches;
  created_count integer := 0;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into course_row from public.courses where id = target_course and active and delivery_type = 'In-House';
  if course_row.id is null then raise exception 'Batches are only available for New Wave STCW and In-House courses'; end if;
  required_days := greatest(1, ceil(coalesce(course_row.duration_days, 1)))::integer;
  first_day := make_date(target_year, target_month, 1);
  last_day := (first_day + interval '1 month' - interval '1 day')::date;

  d := first_day;
  while d <= last_day loop
    dow := extract(isodow from d)::integer;
    if course_row.code = 'STPPDSPPS' then ok := (dow = 1);
    elsif course_row.code = 'PSCMT' then ok := (dow = 2);
    elsif course_row.code = 'PSCMHBT' then ok := (dow = 4);
    elsif course_row.code = 'CCMI' then ok := (dow = 1);
    elsif course_row.code = 'UBT-PSSR' then ok := (dow between 1 and 6);
    elsif required_days = 1 then ok := (dow <> 7);
    elsif required_days = 2 then ok := (dow in (1, 3, 5));
    elsif required_days = 3 then ok := (dow in (1, 4));
    else ok := (dow = 1);
    end if;

    if ok and not exists (select 1 from public.batches where course_id = target_course and starts_on = d and active) then
      training_day := d; created_days := 0; end_day := d;
      while created_days < required_days loop
        if extract(isodow from training_day)::integer <> 7 then created_days := created_days + 1; end_day := training_day; end if;
        if created_days < required_days then training_day := training_day + 1; end if;
      end loop;

      insert into public.batches(
        batch_number, course_id, partner_offer_id, starts_on, ends_on, daily_start, daily_end,
        mode, venue, capacity, enrollment_deadline, published_at, created_by
      ) values (
        public.next_reference('BCH'), target_course, null, d, end_day, time '08:00', time '17:00',
        'In-person', null, 24, d::timestamptz, now(), auth.uid()
      ) returning * into new_batch;

      training_day := d;
      while training_day <= end_day loop
        if extract(isodow from training_day)::integer <> 7 then
          insert into public.batch_training_dates(batch_id, training_date, starts_at, ends_at)
          values(new_batch.id, training_day,
            (training_day + time '08:00') at time zone 'Asia/Manila',
            (training_day + time '17:00') at time zone 'Asia/Manila');
        end if;
        training_day := training_day + 1;
      end loop;

      created_count := created_count + 1;
    end if;
    d := d + 1;
  end loop;

  return created_count;
end $$;
grant execute on function public.auto_open_training_batches(uuid, integer, integer) to authenticated;

-- 2) Create a batch — instructor / room / venue are OPTIONAL.
create or replace function public.create_training_batch(
  target_course uuid, target_partner_offer uuid, target_instructor_name text, target_instructor_email text,
  target_room_name text, target_starts_on date, target_ends_on date, target_daily_start time, target_daily_end time,
  target_mode text, target_venue text, target_capacity integer, target_enrollment_deadline timestamptz,
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

  if nullif(trim(target_instructor_email),'') is not null then
    select * into instructor_row from public.employees where lower(work_email)=lower(trim(target_instructor_email)) and active limit 1;
    if instructor_row.id is null then
      insert into public.employees(employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,work_email)
      values(public.next_reference('EMP'),coalesce(nullif(trim(target_instructor_name),''),'Instructor'),'Instructor','Active',current_date,'Daily',0,lower(trim(target_instructor_email))) returning * into instructor_row;
    end if;
  end if;
  if nullif(trim(target_room_name),'') is not null then
    select * into room_row from public.classrooms where lower(name)=lower(trim(target_room_name)) and active limit 1;
    if room_row.id is null then
      insert into public.classrooms(name,venue,capacity) values(trim(target_room_name),nullif(trim(target_venue),''),24) returning * into room_row;
    elsif room_row.capacity < 24 then raise exception 'Selected room capacity must be at least 24'; end if;
  end if;

  insert into public.batches(
    batch_number, course_id, partner_offer_id, starts_on, ends_on, daily_start, daily_end,
    mode, venue, capacity, enrollment_deadline, published_at, created_by, classroom_id
  ) values (
    public.next_reference('BCH'), target_course, target_partner_offer, target_starts_on, target_ends_on,
    target_daily_start, target_daily_end, trim(target_mode), nullif(trim(target_venue), ''), target_capacity,
    target_enrollment_deadline, case when target_publish then now() else null end, auth.uid(), room_row.id
  ) returning * into result;

  training_day := target_starts_on;
  while training_day <= target_ends_on loop
    if extract(isodow from training_day)::integer <> 7 then
      if instructor_row.id is not null and room_row.id is not null then
        with inserted_date as (
          insert into public.batch_training_dates(batch_id,training_date,starts_at,ends_at)
          values(result.id,training_day,(training_day+target_daily_start) at time zone 'Asia/Manila',(training_day+target_daily_end) at time zone 'Asia/Manila') returning id
        ) insert into public.resource_assignments(batch_training_date_id,instructor_id,classroom_id)
          select id,instructor_row.id,room_row.id from inserted_date;
      else
        insert into public.batch_training_dates(batch_id,training_date,starts_at,ends_at)
        values(result.id,training_day,(training_day+target_daily_start) at time zone 'Asia/Manila',(training_day+target_daily_end) at time zone 'Asia/Manila');
      end if;
    end if;
    training_day := training_day + 1;
  end loop;

  if instructor_row.id is not null then
    insert into public.email_jobs(idempotency_key,template_code,recipient,variables)
    values('instructor-assignment:'||result.id,'instructor.schedule.updated',instructor_row.work_email,
      jsonb_build_object('instructor_name',instructor_row.complete_name,'course_name',course_row.name,'training_dates',target_starts_on||' to '||target_ends_on,'daily_time',target_daily_start||'–'||target_daily_end,'room_name',coalesce(room_row.name,''),'venue',coalesce(room_row.venue,'')));
    insert into public.email_jobs(idempotency_key,template_code,recipient,variables,scheduled_for)
    values('instructor-weekly:'||instructor_row.id||':'||date_trunc('week',target_starts_on::timestamp)::date,'instructor.weekly.schedule',instructor_row.work_email,
      jsonb_build_object('instructor_name',instructor_row.complete_name),date_trunc('week',target_starts_on::timestamp)+interval '4 days 08:00') on conflict(idempotency_key) do nothing;
  end if;

  insert into public.audit_logs(actor_id,actor_role,action,record_type,record_id,new_values)
  values(auth.uid(),'training_operations','batch.created','batch',result.id::text,to_jsonb(result));
  return result;
end $$;
grant execute on function public.create_training_batch(uuid, text, text, text, text, date, date, time, time, text, text, integer, timestamptz, boolean) to authenticated;

-- 3) Edit a batch — instructor / room / venue are OPTIONAL.
create or replace function public.update_training_batch(
  target_batch uuid, target_instructor_name text, target_instructor_email text, target_room_name text,
  target_venue text, target_daily_start time, target_daily_end time, target_mode text,
  target_enrollment_deadline timestamptz, target_publish boolean
) returns public.batches language plpgsql security definer set search_path = public as $$
declare batch_row public.batches; instructor_row public.employees; room_row public.classrooms; result public.batches;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into batch_row from public.batches where id = target_batch and active;
  if batch_row.id is null then raise exception 'Schedule not found'; end if;
  if batch_row.status = 'Cancelled' then raise exception 'Cancelled schedules cannot be edited'; end if;
  if target_enrollment_deadline >= batch_row.starts_on::timestamptz + interval '1 day' then raise exception 'Enrollment deadline must be before training starts'; end if;

  if nullif(trim(target_instructor_email), '') is not null then
    select * into instructor_row from public.employees where lower(work_email) = lower(trim(target_instructor_email)) and active limit 1;
    if instructor_row.id is null then
      insert into public.employees(employee_number, complete_name, position, employment_status, date_hired, pay_type, base_rate_centavos, work_email)
      values(public.next_reference('EMP'), coalesce(nullif(trim(target_instructor_name),''),'Instructor'), 'Instructor', 'Active', current_date, 'Daily', 0, lower(trim(target_instructor_email)))
      returning * into instructor_row;
    end if;
  end if;
  if nullif(trim(target_room_name), '') is not null then
    select * into room_row from public.classrooms where lower(name) = lower(trim(target_room_name)) and active limit 1;
    if room_row.id is null then
      insert into public.classrooms(name, venue, capacity) values(trim(target_room_name), nullif(trim(target_venue),''), 24) returning * into room_row;
    elsif room_row.capacity < 24 then raise exception 'Selected room capacity must be at least 24'; end if;
  end if;

  update public.batches set
    daily_start = target_daily_start, daily_end = target_daily_end, mode = trim(target_mode),
    venue = nullif(trim(target_venue), ''), classroom_id = coalesce(room_row.id, classroom_id), enrollment_deadline = target_enrollment_deadline,
    published_at = case when target_publish then coalesce(published_at, now()) else null end, updated_at = now()
  where id = target_batch returning * into result;

  update public.batch_training_dates set
    starts_at = (training_date + target_daily_start) at time zone 'Asia/Manila',
    ends_at = (training_date + target_daily_end) at time zone 'Asia/Manila'
  where batch_id = target_batch;

  if instructor_row.id is not null and room_row.id is not null then
    insert into public.resource_assignments(batch_training_date_id, instructor_id, classroom_id)
      select btd.id, instructor_row.id, room_row.id from public.batch_training_dates btd
      where btd.batch_id = target_batch
        and not exists (select 1 from public.resource_assignments ra where ra.batch_training_date_id = btd.id);
    update public.resource_assignments ra set instructor_id = instructor_row.id, classroom_id = room_row.id
      from public.batch_training_dates btd
      where ra.batch_training_date_id = btd.id and btd.batch_id = target_batch;
  end if;

  return result;
end $$;
grant execute on function public.update_training_batch(uuid, text, text, text, text, time, time, text, timestamptz, boolean) to authenticated;

commit;
