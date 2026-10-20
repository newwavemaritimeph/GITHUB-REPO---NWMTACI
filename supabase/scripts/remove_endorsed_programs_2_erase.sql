-- STEP 2 of 2 — PERMANENTLY ERASES the endorsed programs (owner, 20 Oct 2026:
-- "Remove Endorsed Programs in the system! I will be encoding new ones!").
-- Run step 1 (preview) first. This cannot be undone.
--
-- Erases: every endorsed program (partner_course_offers row) that no enrollment or
-- batch uses, and every partner-only course ('Partner or Endorsed') nothing uses any
-- more (its requirements, schedule patterns, agency rebate amounts and numbering
-- settings go with it).
-- Archives instead: programs an enrollment or batch uses (active = false,
-- effective_to = today), so those enrollments keep their rate and history.
-- Hides: partner-only courses that must stay are taken off the website
-- (public_visible = false).
-- Keeps: partner centers, In-House courses, enrollments, batches and the audit log
-- (a 'catalog.endorsed_programs_removed' entry records the counts).
--
-- Everything runs in one transaction: if any step fails, nothing is erased.

begin;

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
drop table if exists _counts;
create temp table _counts (o int, t text, n bigint) on commit drop;

-- 1. Which programs something still uses.
create temp table _offers on commit drop as
select o.id, pg_temp.used_by('public.partner_course_offers', o.id) as used_by
from public.partner_course_offers o;

insert into _counts select 1, 'Endorsed programs before', count(*) from _offers;

-- 2. Erase unused programs.
with d as (delete from public.partner_course_offers o using _offers x where x.id = o.id and x.used_by is null returning 1)
insert into _counts select 2, 'Programs erased', count(*) from d;

-- 3. Archive programs an enrollment or batch uses.
with u as (
  update public.partner_course_offers o set active = false, effective_to = coalesce(o.effective_to, current_date)
  from _offers x where x.id = o.id and x.used_by is not null returning 1)
insert into _counts select 3, 'Programs archived (used by an enrollment or batch)', count(*) from u;

-- 4. Partner-only courses nothing uses any more (every remaining program is an archived, used one).
create temp table _courses on commit drop as
select c.id from public.courses c
where c.delivery_type = 'Partner or Endorsed'
  and not exists (select 1 from public.partner_course_offers o where o.course_id = c.id)
  and pg_temp.used_by('public.courses', c.id, pg_temp.course_settings()) is null;

with d as (delete from public.courses c using _courses x where x.id = c.id returning 1)
insert into _counts select 4, 'Partner-only courses erased', count(*) from d;

-- 5. Partner-only courses that must stay come off the website.
with u as (update public.courses set public_visible = false where delivery_type = 'Partner or Endorsed' and public_visible returning 1)
insert into _counts select 5, 'Partner-only courses kept, hidden from the website', count(*) from u;

insert into _counts select 6, 'Partner centers kept', count(*) from public.partner_centers;

-- 6. Record the removal in the audit log.
insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values, reason)
select null, 'admin', 'catalog.endorsed_programs_removed', 'catalog',
  'endorsed-programs-' || to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD'),
  jsonb_object_agg(t, n), 'Owner: remove the endorsed programs; new ones will be encoded in the portal (20 Oct 2026)'
from _counts;

drop function pg_temp.used_by(regclass, uuid, text[]);
drop function pg_temp.course_settings();

select t as "Result", n as "Count" from _counts order by o;

commit;
