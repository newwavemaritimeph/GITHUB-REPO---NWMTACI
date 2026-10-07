-- =====================================================================
-- READ-ONLY check: New Wave courses stored more than once (same code, or the
-- same name under different codes). The website and portal already list each
-- course once; run this in the Supabase SQL Editor to see which rows to retire
-- (set active = false on the extra copy) from Admin › Courses.
-- =====================================================================
select 'same code' as duplicate_by, upper(trim(code)) as key, count(*) as copies,
       string_agg(name || ' [' || id || ', ' || case when active then 'active' else 'inactive' end || ']', ' | ' order by created_at) as rows
from public.courses where delivery_type = 'In-House'
group by upper(trim(code)) having count(*) > 1
union all
select 'same name', lower(regexp_replace(trim(name), '\s+', ' ', 'g')), count(*),
       string_agg(code || ' [' || id || ', ' || case when active then 'active' else 'inactive' end || ']', ' | ' order by created_at)
from public.courses where delivery_type = 'In-House'
group by lower(regexp_replace(trim(name), '\s+', ' ', 'g')) having count(*) > 1
order by 1, 2;
