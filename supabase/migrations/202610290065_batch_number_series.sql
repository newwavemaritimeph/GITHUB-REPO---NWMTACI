-- MARINA-style batch numbers for the four STCW courses (owner, 29 Oct 2026):
--   UBT-PSSR 26-609-139, STPPDSPPS 26-506-023, PSCMT 26-507-023, PSCMHBT 26-508-023 are the NEXT numbers.
-- Format YY-<course number>-NNN; each January the year changes and the count restarts at 001.
-- Every other course keeps BCH-YYYY-000001 from next_reference('BCH').

create table if not exists public.batch_number_series (
  course_id uuid primary key references public.courses(id),
  middle text not null check (middle ~ '^[0-9A-Za-z]+$'),
  series_year int not null,
  next_number int not null check (next_number > 0),
  updated_at timestamptz not null default now()
);
alter table public.batch_number_series enable row level security;

insert into public.batch_number_series (course_id, middle, series_year, next_number)
select c.id, v.middle, 2026, v.next_number
from (values ('UBT-PSSR', '609', 139), ('STPPDSPPS', '506', 23), ('PSCMT', '507', 23), ('PSCMHBT', '508', 23)) as v(code, middle, next_number)
join public.courses c on upper(c.code) = v.code
on conflict (course_id) do update set middle = excluded.middle, series_year = excluded.series_year, next_number = excluded.next_number, updated_at = now();

create or replace function public.next_batch_number(target_course uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  yr int := extract(year from (now() at time zone 'Asia/Manila'))::int;
  s public.batch_number_series%rowtype;
begin
  select * into s from public.batch_number_series where course_id = target_course for update;
  if not found then
    return public.next_reference('BCH');
  end if;
  if s.series_year <> yr then
    s.series_year := yr;
    s.next_number := 1;
  end if;
  update public.batch_number_series
    set series_year = s.series_year, next_number = s.next_number + 1, updated_at = now()
    where course_id = target_course;
  return lpad((s.series_year % 100)::text, 2, '0') || '-' || s.middle || '-' || lpad(s.next_number::text, 3, '0');
end;
$$;
revoke all on function public.next_batch_number(uuid) from public, anon, authenticated;

-- Every batch-opening function (create, holiday, auto-open, monthly STCW opener) now asks for the course's number.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%next_reference(''BCH'')%' and p.proname <> 'next_batch_number'
  loop
    def := pg_get_functiondef(f.oid);
    def := regexp_replace(def, 'public\.next_reference\(''BCH''\),(\s*)(target_course|course_row\.id)', 'public.next_batch_number(\2),\1\2', 'g');
    execute def;
  end loop;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%next_reference(''BCH'')%' and p.proname <> 'next_batch_number'
  ) then
    raise exception 'A batch function still uses next_reference(''BCH'') directly; nothing was changed.';
  end if;
end $$;

select c.code, s.series_year, s.middle, s.next_number,
  lpad((s.series_year % 100)::text, 2, '0') || '-' || s.middle || '-' || lpad(s.next_number::text, 3, '0') as next_batch_no
from public.batch_number_series s join public.courses c on c.id = s.course_id order by c.code;
