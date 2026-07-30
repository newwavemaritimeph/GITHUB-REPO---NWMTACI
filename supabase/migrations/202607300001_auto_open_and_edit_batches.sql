-- =====================================================================
-- Auto-open a month of blank batches + edit an existing batch.
--
-- auto_open_training_batches(course, year, month):
--   Creates every pattern-valid batch for an In-House course in the given
--   month, blank (no instructor/room/venue), unpublished, 24 seats,
--   08:00-17:00, Sundays skipped. Duplicate start dates are skipped.
--
-- update_training_batch(...):
--   Fills instructor / room / venue / times on an existing batch, wires the
--   per-day resource assignments, and optionally publishes it.
-- =====================================================================

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
        'In-person', null, 24, d::timestamptz, null, auth.uid()
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

create or replace function public.update_training_batch(
  target_batch uuid,
  target_instructor_name text,
  target_instructor_email text,
  target_room_name text,
  target_venue text,
  target_daily_start time,
  target_daily_end time,
  target_mode text,
  target_enrollment_deadline timestamptz,
  target_publish boolean
) returns public.batches language plpgsql security definer set search_path = public as $$
declare batch_row public.batches; instructor_row public.employees; room_row public.classrooms; result public.batches;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into batch_row from public.batches where id = target_batch and active;
  if batch_row.id is null then raise exception 'Schedule not found'; end if;
  if batch_row.status = 'Cancelled' then raise exception 'Cancelled schedules cannot be edited'; end if;
  if target_enrollment_deadline >= batch_row.starts_on::timestamptz + interval '1 day' then raise exception 'Enrollment deadline must be before training starts'; end if;
  if nullif(trim(target_instructor_name), '') is null or nullif(trim(target_instructor_email), '') is null then raise exception 'Instructor name and email are required'; end if;
  if nullif(trim(target_room_name), '') is null or nullif(trim(target_venue), '') is null then raise exception 'Room and venue are required'; end if;

  select * into instructor_row from public.employees where lower(work_email) = lower(trim(target_instructor_email)) and active limit 1;
  if instructor_row.id is null then
    insert into public.employees(employee_number, complete_name, position, employment_status, date_hired, pay_type, base_rate_centavos, work_email)
    values(public.next_reference('EMP'), trim(target_instructor_name), 'Instructor', 'Active', current_date, 'Daily', 0, lower(trim(target_instructor_email)))
    returning * into instructor_row;
  end if;
  select * into room_row from public.classrooms where lower(name) = lower(trim(target_room_name)) and active limit 1;
  if room_row.id is null then
    insert into public.classrooms(name, venue, capacity) values(trim(target_room_name), trim(target_venue), 24) returning * into room_row;
  elsif room_row.capacity < 24 then raise exception 'Selected room capacity must be at least 24'; end if;

  update public.batches set
    daily_start = target_daily_start, daily_end = target_daily_end, mode = trim(target_mode),
    venue = nullif(trim(target_venue), ''), classroom_id = room_row.id, enrollment_deadline = target_enrollment_deadline,
    published_at = case when target_publish then coalesce(published_at, now()) else null end, updated_at = now()
  where id = target_batch returning * into result;

  update public.batch_training_dates set
    starts_at = (training_date + target_daily_start) at time zone 'Asia/Manila',
    ends_at = (training_date + target_daily_end) at time zone 'Asia/Manila'
  where batch_id = target_batch;

  insert into public.resource_assignments(batch_training_date_id, instructor_id, classroom_id)
    select btd.id, instructor_row.id, room_row.id from public.batch_training_dates btd
    where btd.batch_id = target_batch
      and not exists (select 1 from public.resource_assignments ra where ra.batch_training_date_id = btd.id);
  update public.resource_assignments ra set instructor_id = instructor_row.id, classroom_id = room_row.id
    from public.batch_training_dates btd
    where ra.batch_training_date_id = btd.id and btd.batch_id = target_batch;

  return result;
end $$;
grant execute on function public.update_training_batch(uuid, text, text, text, text, time, time, text, timestamptz, boolean) to authenticated;
