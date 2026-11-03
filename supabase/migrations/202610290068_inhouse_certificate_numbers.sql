-- In-House Certificate No. (owner, 3 Nov 2026): NWMTACI-<year>-<course code>-000001, counted per course and
-- restarting at 000001 every January (NWMTACI-2027-HPT-000001). Automatic: no Numbering tab. STCW and MARINA
-- courses keep their own series; the Registration No. is unchanged; issued certificates keep their numbers.

alter table public.certificate_series add column if not exists cert_year int;

-- 1. The numbering functions read {YYYY} in a prefix as the current Manila year, and restart the count at 1
--    when the year changes.
do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.assign_enrollment_numbers(uuid)'::regprocedure);
  if position('cert_year' in def) = 0 then
    def := regexp_replace(def,
      'n := s\.next_number;(\s+)loop(\s+)num := s\.prefix \|\| lpad\(n::text, s\.pad, ''0''\);',
      'n := s.next_number;
    if position(''{YYYY}'' in s.prefix) > 0 and coalesce(s.cert_year, 0) <> extract(year from now() at time zone ''Asia/Manila'')::int then
      n := 1;
      update public.certificate_series set cert_year = extract(year from now() at time zone ''Asia/Manila'')::int where course_id = s.course_id;
    end if;\1loop\2num := replace(s.prefix, ''{YYYY}'', to_char(now() at time zone ''Asia/Manila'', ''YYYY'')) || lpad(n::text, s.pad, ''0'');');
    if position('cert_year' in def) = 0 then raise exception 'assign_enrollment_numbers changed; nothing was applied.'; end if;
    execute def;
  end if;

  def := pg_get_functiondef('public.claim_certificate_number(uuid, uuid)'::regprocedure);
  if position('{YYYY}' in def) = 0 then
    def := replace(def, 'num := s.prefix || lpad(s.next_number::text, s.pad, ''0'');',
      'num := replace(s.prefix, ''{YYYY}'', to_char(now() at time zone ''Asia/Manila'', ''YYYY'')) || lpad(s.next_number::text, s.pad, ''0'');');
    if position('{YYYY}' in def) = 0 then raise exception 'claim_certificate_number changed; nothing was applied.'; end if;
    execute def;
  end if;
end $$;

-- 2. Every In-House course that is not STCW / MARINA gets the new series, starting at 000001.
drop table if exists _inhouse;
create temp table _inhouse as
select c.id, upper(c.code) as code
from public.courses c left join public.course_categories cc on cc.id = c.category_id
where c.delivery_type = 'In-House' and upper(c.code) <> 'CCI'
  and coalesce(cc.name, '') !~* '(stcw|marina)'
  and upper(c.code) not in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT', 'CCMD');

insert into public.certificate_series (course_id, prefix, next_number, pad, cert_year)
select id, 'NWMTACI-{YYYY}-' || code || '-', 1, 6, extract(year from now() at time zone 'Asia/Manila')::int from _inhouse
on conflict (course_id) do update set prefix = excluded.prefix, next_number = 1, pad = 6, cert_year = excluded.cert_year, set_at = now();

-- 3. Numbers reserved at enrollment but not printed yet are released, so the next print takes the new format.
update public.enrollments e set certificate_number = null
where e.certificate_number is not null and e.course_id in (select id from _inhouse)
  and not exists (select 1 from public.certificates c where c.enrollment_id = e.id and c.certificate_number is not null);

select count(*) as inhouse_courses, min(replace(s.prefix, '{YYYY}', to_char(now() at time zone 'Asia/Manila', 'YYYY')) || lpad(s.next_number::text, s.pad, '0')) as example_next
from public.certificate_series s join _inhouse i on i.id = s.course_id;
