-- Batch numbers never repeat (owner, 9 Nov 2026: Open Batches showed "duplicate key value violates unique constraint
-- batches_batch_number_key"). The STCW counter (202610290065) could point at a number a batch already has, and a failed
-- save rolled the counter back, so every try failed the same way. A number already on any batch is now skipped and the
-- counter moves past it; gaps left on purpose are kept.
begin;

create or replace function public.next_batch_number(target_course uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  yr int := extract(year from (now() at time zone 'Asia/Manila'))::int;
  s public.batch_number_series%rowtype;
  candidate text;
begin
  select * into s from public.batch_number_series where course_id = target_course for update;
  if not found then
    return public.next_reference('BCH');
  end if;
  if s.series_year <> yr then
    s.series_year := yr;
    s.next_number := 1;
  end if;
  loop
    candidate := lpad((s.series_year % 100)::text, 2, '0') || '-' || s.middle || '-' || lpad(s.next_number::text, 3, '0');
    s.next_number := s.next_number + 1;
    exit when not exists (select 1 from public.batches where batch_number = candidate);
  end loop;
  update public.batch_number_series
    set series_year = s.series_year, next_number = s.next_number, updated_at = now()
    where course_id = target_course;
  return candidate;
end;
$$;
revoke all on function public.next_batch_number(uuid) from public, anon, authenticated;

commit;

-- The STCW counters: the number the next batch takes (or the first free one after it) and the highest already used.
select c.code as "Course",
  lpad((s.series_year % 100)::text, 2, '0') || '-' || s.middle || '-' || lpad(s.next_number::text, 3, '0') as "Next Batch No.",
  (select max(b.batch_number) from public.batches b
    where b.batch_number like lpad((s.series_year % 100)::text, 2, '0') || '-' || s.middle || '-%') as "Highest Used"
from public.batch_number_series s join public.courses c on c.id = s.course_id
order by c.code;
