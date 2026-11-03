-- In-House Certificate No. pattern (owner, 3 Nov 2026): NWMTACI-<code><year><6 digits>, e.g. NWMTACI-HPT2026000001.
-- Replaces NWMTACI-<year>-<code>- from migration 068. The count per course and the January restart stay;
-- certificates already printed keep their numbers.

drop table if exists _inhouse;
create temp table _inhouse as
select s.course_id as id, upper(c.code) as code
from public.certificate_series s join public.courses c on c.id = s.course_id
where s.prefix like 'NWMTACI-{YYYY}-%';

update public.certificate_series s set prefix = 'NWMTACI-' || i.code || '{YYYY}', pad = 6, set_at = now()
from _inhouse i where i.id = s.course_id;

-- Numbers reserved at enrollment but not printed yet are released, so the next print takes the new pattern.
update public.enrollments e set certificate_number = null
where e.certificate_number is not null and e.course_id in (select id from _inhouse)
  and not exists (select 1 from public.certificates c where c.enrollment_id = e.id and c.certificate_number is not null);

select count(*) as inhouse_courses,
  min(replace(s.prefix, '{YYYY}', to_char(now() at time zone 'Asia/Manila', 'YYYY')) || lpad(s.next_number::text, s.pad, '0')) as example_next
from public.certificate_series s join _inhouse i on i.id = s.course_id;
