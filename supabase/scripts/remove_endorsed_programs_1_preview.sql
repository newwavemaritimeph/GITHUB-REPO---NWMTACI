-- STEP 1 of 2 — PREVIEW ONLY. Changes nothing.
-- Shows what step 2 does to the endorsed programs (owner, 20 Oct 2026:
-- "Remove Endorsed Programs in the system! I will be encoding new ones!").
-- Run this in the Supabase SQL Editor and check the counts first.
--
-- A program (partner_course_offers row) that an enrollment or batch uses cannot be
-- erased; step 2 archives it instead (active = false, effective_to = today).
-- Partner-only courses ('Partner or Endorsed') are erased when nothing uses them any more.
-- Partner centers are kept.

-- Tables (other than the given ones) whose rows point at a record, found from the
-- foreign keys themselves so a table added later is checked too.
create or replace function pg_temp.used_by(target regclass, row_id uuid, skip text[] default '{}') returns text
language plpgsql as $$
declare r record; hit boolean; found text[] := '{}';
begin
  for r in
    select c.conrelid::regclass as tbl, replace(c.conrelid::regclass::text, 'public.', '') as tname, a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = target and array_length(c.conkey, 1) = 1
  loop
    if r.tname = any(skip) then continue; end if;
    execute format('select exists(select 1 from %s where %I = $1)', r.tbl, r.attname) into hit using row_id;
    if hit then found := found || r.tname; end if;
  end loop;
  return nullif(array_to_string(found, ', '), '');
end $$;

-- Course settings that belong to the course and go with it (deleted by cascade).
create or replace function pg_temp.course_settings() returns text[] language sql as $$
  select array['partner_course_offers','course_requirements','schedule_patterns','agency_course_rebates',
    'certificate_series','course_assessment_tasks','instructor_qualifications']
$$;

drop table if exists _offers;
drop table if exists _courses;

create temp table _offers as
select o.id, o.course_id, pc.name as center, c.code, c.name as course, o.active,
  pg_temp.used_by('public.partner_course_offers', o.id) as used_by
from public.partner_course_offers o
join public.partner_centers pc on pc.id = o.partner_center_id
join public.courses c on c.id = o.course_id;

create temp table _courses as
select c.id, c.code, c.name,
  case
    when exists (select 1 from _offers o where o.course_id = c.id and o.used_by is not null) then 'archived program'
    else pg_temp.used_by('public.courses', c.id, pg_temp.course_settings())
  end as kept_because
from public.courses c
where c.delivery_type = 'Partner or Endorsed';

-- One result (the SQL Editor shows only the last one): the counts, then each
-- program step 2 archives instead of erasing, then each partner-only course it keeps.
select "Section", "Item", "Detail", "Count" from (
  select 1 as o, 'Counts' as "Section", 'Endorsed programs (all)' as "Item", null::text as "Detail", count(*) as "Count" from _offers
  union all select 2, 'Counts', 'Programs to erase (unused)', null, count(*) from _offers where used_by is null
  union all select 3, 'Counts', 'Programs to archive (used by an enrollment or batch)', null, count(*) from _offers where used_by is not null
  union all select 4, 'Counts', 'Partner-only courses (all)', null, count(*) from _courses
  union all select 5, 'Counts', 'Partner-only courses to erase', null, count(*) from _courses where kept_because is null
  union all select 6, 'Counts', 'Partner-only courses kept, hidden from the website', null, count(*) from _courses where kept_because is not null
  union all select 7, 'Counts', 'Partner centers kept', null, count(*) from public.partner_centers
  union all select 8, 'Program to archive', center || ' · ' || course || ' (' || code || ')',
    'Used by ' || used_by || case when active then '' else ' · already archived' end, null from _offers where used_by is not null
  union all select 9, 'Course kept', name || ' (' || code || ')', 'Kept because: ' || kept_because, null from _courses where kept_because is not null
) x
order by o, "Item";
