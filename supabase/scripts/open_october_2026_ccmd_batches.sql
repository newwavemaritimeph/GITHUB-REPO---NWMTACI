-- =====================================================================
-- Open and publish the October 2026 batches for CCM Domestic (CCMD).
-- RUN ONCE, manually, in the Supabase SQL Editor (postgres role). Not a
-- migration: it inserts schedule data, not schema.
--
-- Owner instruction (7 Oct 2026): Crowd and Crisis Management - Domestic
-- (CCMD, 3 days) runs Monday–Wednesday, every week (lib/scheduling.ts).
-- CCMD takes late enrollment: it stays open until 07:00 on the last training day.
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
    where code = 'CCMD' and active and delivery_type = 'In-House'
    order by code
  loop
    required_days := greatest(1, ceil(coalesce(course_row.duration_days, 1)))::integer;
    opened := 0;
    d := range_start;
    while d <= range_end loop
      dow := extract(isodow from d)::integer;
      ok := dow = 1;

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
          'In-person', null, 24, (end_day + time '07:00') at time zone 'Asia/Manila', now(), null
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
where c.code = 'CCMD'
  and b.starts_on between date '2026-10-01' and date '2026-10-31'
  and b.status = 'Open' and b.published_at is not null
group by c.code, c.name
order by c.code;
