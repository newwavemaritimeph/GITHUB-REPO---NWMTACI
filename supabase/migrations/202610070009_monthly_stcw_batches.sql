-- =====================================================================
-- Open next month's STCW batches automatically on the 15th (owner, 7 Oct 2026).
--
-- Every 15th of the month, at 09:00 Manila time, the database opens and
-- publishes the following month's batches for the STCW courses New Wave
-- schedules (the same five shown on the public Courses page):
--   UBT-PSSR  BT-PSSR       1 day   every Monday–Saturday
--   STPPDSPPS Safety        1 day   every Monday
--   PSCMT     Crowd         2 days  Tuesday–Wednesday
--   PSCMHBT   Crisis        3 days  Thursday–Saturday
--   CCMD      CCM Domestic  3 days  Monday–Wednesday
-- Each batch: 24 seats, In-person, 08:00–17:00, Sundays skipped, enrollment
-- closes at 08:00 on the first day (CCMD: on the last day, late enrollment). Dates that already have a batch are
-- skipped, so a re-run (or a batch the Scheduler opened by hand) is safe.
-- Classroom and instructor stay blank for the Scheduler to fill in.
--
-- Uses pg_cron (Supabase: Database › Extensions › pg_cron). Run by hand at any
-- time with:  select public.open_monthly_stcw_batches(date '2026-11-01');
-- Additive; safe to re-run.
-- =====================================================================

create extension if not exists pg_cron with schema extensions;

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
          'In-person', null, 24, ((case when course_row.code = 'CCMD' then end_day else d end) + time '08:00') at time zone 'Asia/Manila', now(), null
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

-- 09:00 Manila on the 15th = 01:00 UTC on the 15th (pg_cron runs in UTC).
-- Replaces any earlier schedule with the same name.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'open-monthly-stcw-batches';
  perform cron.schedule('open-monthly-stcw-batches', '0 1 15 * *', 'select public.open_monthly_stcw_batches()');
end $$;

-- Check: the schedule is registered.
select jobname, schedule, command, active from cron.job where jobname = 'open-monthly-stcw-batches';
