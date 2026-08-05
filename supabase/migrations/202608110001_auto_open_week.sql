-- =====================================================================
-- Weekly auto-open: open + PUBLISH in-house batches for an arbitrary date
-- range (used for a single week). Same generation rules as the monthly
-- auto_open_training_batches, just bounded to [range_start, range_end].
-- New function name (no signature conflict) — safe additive install.
-- =====================================================================

begin;

create or replace function public.auto_open_training_batches_range(
  target_course uuid, range_start date, range_end date
) returns integer language plpgsql security definer set search_path = public as $$
declare
  course_row public.courses;
  required_days integer;
  d date; dow integer; ok boolean;
  training_day date; created_days integer; end_day date;
  new_batch public.batches;
  created_count integer := 0;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into course_row from public.courses where id = target_course and active and delivery_type = 'In-House';
  if course_row.id is null then raise exception 'Batches are only available for New Wave STCW and In-House courses'; end if;
  if range_end < range_start then raise exception 'range_end must be on or after range_start'; end if;
  required_days := greatest(1, ceil(coalesce(course_row.duration_days, 1)))::integer;

  d := range_start;
  while d <= range_end loop
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
grant execute on function public.auto_open_training_batches_range(uuid, date, date) to authenticated;

commit;
