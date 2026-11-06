-- =====================================================================
-- Owner, 6 Nov 2026: "There is something wrong with MARPOL Certification. Fix the course title!"
-- RUN ONCE in the Supabase SQL Editor (run the whole file).
-- Upload Many gave the 5-Day MARPOL file (40 Hours, a title that breaks across two lines) to the 3-Day MARPOL
-- course, and the HUPH file (16 Hours) to the 1-Day HACCP course, as the newest and so the active template.
-- This puts back each course's own template, already stored. No file is uploaded or deleted.
-- =====================================================================

begin;

update public.certificate_templates t
   set active = (t.storage_path like '%MARPOL-3DAY---%')
 where t.course_id in (select id from public.courses where code = 'MARPOL');

update public.certificate_templates t
   set active = (t.storage_path like '%Hazard-Analysis-and-Critical-Control-Points%')
 where t.course_id in (select id from public.courses where code = 'HACCP');

commit;

-- Each course should show one row with active = true.
select c.code, t.version, t.active, t.storage_path
  from public.certificate_templates t join public.courses c on c.id = t.course_id
 where c.code in ('MARPOL', 'HACCP')
 order by c.code, t.version;
