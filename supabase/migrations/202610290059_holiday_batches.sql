-- Holiday Schedule (owner, 29 Oct 2026): open a batch on another weekday when a holiday
-- moves the class (e.g. Safety Tue Nov 3, Crowd Wed Nov 4, Crisis Fri Nov 6). Sundays stay
-- blocked; seats, deadline and the consecutive end date are still checked.
begin;

-- 1) The weekday rule in the live create_training_batch is skipped while nw.holiday_batch is on.
--    Patches whatever version is live (as 054 did) instead of copying an old body.
do $$
declare f record; def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_training_batch'
  loop
    def := pg_get_functiondef(f.oid);
    if position('nw.holiday_batch' in def) = 0 then
      if position('if course_row.code=''STPPDSPPS'' and start_dow<>1 then' in def) = 0 then
        raise exception 'create_training_batch weekday rule not found; nothing changed';
      end if;
      def := replace(def, 'if course_row.code=''STPPDSPPS'' and start_dow<>1 then',
        'if coalesce(current_setting(''nw.holiday_batch'', true), '''') = ''on'' then
    if start_dow=7 then raise exception ''Sunday is not a training day''; end if;
  elsif course_row.code=''STPPDSPPS'' and start_dow<>1 then');
      execute def;
    end if;
  end loop;
end $$;

-- 2) Same arguments as create_training_batch; turns the holiday switch on for this call only.
create or replace function public.create_holiday_batch(
  target_course uuid, target_partner_offer uuid, target_instructor_name text, target_instructor_email text,
  target_room_name text, target_starts_on date, target_ends_on date, target_daily_start time, target_daily_end time,
  target_mode text, target_venue text, target_capacity integer, target_enrollment_deadline timestamptz,
  target_publish boolean default true
) returns public.batches language plpgsql set search_path = public as $$
declare result public.batches;
begin
  perform set_config('nw.holiday_batch', 'on', true);
  select * into result from public.create_training_batch(target_course, target_partner_offer, target_instructor_name, target_instructor_email,
    target_room_name, target_starts_on, target_ends_on, target_daily_start, target_daily_end,
    target_mode, target_venue, target_capacity, target_enrollment_deadline, target_publish);
  perform set_config('nw.holiday_batch', '', true);
  return result;
end $$;
grant execute on function public.create_holiday_batch(uuid, uuid, text, text, text, date, date, time, time, text, text, integer, timestamptz, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
