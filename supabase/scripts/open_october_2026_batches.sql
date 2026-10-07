-- =====================================================================
-- Open and publish the October 2026 batches for four New Wave courses.
-- RUN ONCE, manually, in the Supabase SQL Editor (postgres role). Not a
-- migration: it inserts schedule data, not schema.
--
-- Same rules as public.auto_open_training_batches_range (lib/scheduling.ts):
--   UBT-PSSR  BT-PSSR  (1 day)  any day Monday–Saturday
--   STPPDSPPS Safety   (1 day)  every Monday
--   PSCMT     Crowd    (2 days) Tuesday–Wednesday
--   PSCMHBT   Crisis   (3 days) Thursday–Saturday
-- Each batch: 24 seats, In-person, 08:00–17:00, Sundays skipped, published so
-- it appears on the public registration form. Only dates still bookable are
-- opened (from tomorrow to 31 October 2026). Dates already opened are skipped,
-- so re-running is safe. Classroom and instructor are left blank for the
-- Scheduler to fill in from the portal (Schedules → Edit).
-- =====================================================================

do $$
declare
  course_row record;
  d date; dow integer; ok boolean;
  required_days integer; training_day date; counted integer; end_day date;
  new_batch public.batches;
  opened integer;
  range_start date := greatest(current_date + 1, date '2026-10-01');
  range_end date := date '2026-10-31';
begin
  for course_row in
    select * from public.courses
    where code in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT') and active and delivery_type = 'In-House'
    order by code
  loop
    required_days := greatest(1, ceil(coalesce(course_row.duration_days, 1)))::integer;
    opened := 0;
    d := range_start;
    while d <= range_end loop
      dow := extract(isodow from d)::integer;
      ok := case course_row.code
        when 'UBT-PSSR' then dow between 1 and 6
        when 'STPPDSPPS' then dow = 1
        when 'PSCMT' then dow = 2
        when 'PSCMHBT' then dow = 4
        else false end;

      if ok and not exists (select 1 from public.batches where course_id = course_row.id and starts_on = d and active) then
        -- End date: count training days forward, skipping Sundays.
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
          'In-person', null, 24, (d + time '08:00') at time zone 'Asia/Manila', now(), null
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
    raise notice '% (%): % batch(es) opened', course_row.code, course_row.name, opened;
  end loop;
end $$;

-- Check: the October batches now open and published, per course.
select c.code, c.name, count(*) as batches, min(b.starts_on) as first_start, max(b.starts_on) as last_start
from public.batches b join public.courses c on c.id = b.course_id
where c.code in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT')
  and b.starts_on between date '2026-10-01' and date '2026-10-31'
  and b.status = 'Open' and b.published_at is not null
group by c.code, c.name
order by c.code;
