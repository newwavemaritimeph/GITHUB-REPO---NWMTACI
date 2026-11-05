-- Certificate No. and Registration No. formats (owner, 5 Nov 2026): the Admin configures the format of each course's
-- numbers once; after that the portal gives every number and staff never type one. Tokens: {CODE} {YYYY} {YY} {MM} {M}
-- {N} or {N:6}. A course without a format keeps today's numbers, so nothing changes until the Admin saves one.
-- Numbers already printed never change. Registration No. stays one New Wave-wide count; only its shape can differ.
-- Additive. Patches the live numbering functions in place with a guard, as 068 did.

begin;

alter table public.certificate_series add column if not exists cert_format text;
alter table public.certificate_series add column if not exists reg_format text;
alter table public.certificate_number_settings add column if not exists reg_format text;

-- The same rule as formatNumber in lib/certificate-rules.ts. A longer number is never cut.
create or replace function public.number_from_format(fmt text, course_code text, n bigint)
returns text language plpgsql stable set search_path = public as $$
declare
  at_time timestamp := now() at time zone 'Asia/Manila';
  width text := (regexp_match(fmt, '\{N:(\d{1,2})\}'))[1];
  res text := fmt;
begin
  res := replace(res, '{CODE}', upper(coalesce(course_code, '')));
  res := replace(res, '{YYYY}', to_char(at_time, 'YYYY'));
  res := replace(res, '{YY}', to_char(at_time, 'YY'));
  res := replace(res, '{MM}', to_char(at_time, 'MM'));
  res := replace(res, '{M}', extract(month from at_time)::int::text);
  return regexp_replace(res, '\{N(:\d{1,2})?\}', lpad(n::text, greatest(coalesce(width::int, 0), length(n::text)), '0'), 'g');
end $$;

-- A course's Certificate No.: its format when set, else today's prefix and digits.
create or replace function public.certificate_no_text(course uuid, fmt text, prefix text, pad integer, n bigint)
returns text language plpgsql stable set search_path = public as $$
begin
  if fmt is not null then return public.number_from_format(fmt, (select c.code from public.courses c where c.id = course), n); end if;
  return replace(prefix, '{YYYY}', to_char(now() at time zone 'Asia/Manila', 'YYYY')) || lpad(n::text, pad, '0');
end $$;

do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.assign_enrollment_numbers(uuid)'::regprocedure);
  if position('certificate_no_text' in def) = 0 then
    def := replace(def, $q$num := replace(s.prefix, '{YYYY}', to_char(now() at time zone 'Asia/Manila', 'YYYY')) || lpad(n::text, s.pad, '0');$q$,
      $q$num := public.certificate_no_text(s.course_id, s.cert_format, s.prefix, s.pad, n);$q$);
    def := replace(def, $q$position('{YYYY}' in s.prefix) > 0$q$, $q$position('{YY' in coalesce(s.cert_format, s.prefix)) > 0$q$);
    def := replace(def, $q$coalesce(s.prefix, '') <> ''$q$, $q$coalesce(s.cert_format, s.prefix, '') <> ''$q$);
    if position('certificate_no_text' in def) = 0 or position('coalesce(s.cert_format, s.prefix)' in def) = 0 or position($q$coalesce(s.cert_format, s.prefix, '')$q$ in def) = 0 then
      raise exception 'assign_enrollment_numbers changed; nothing was applied.';
    end if;
    execute def;
  end if;

  def := pg_get_functiondef('public.claim_certificate_number(uuid, uuid)'::regprocedure);
  if position('certificate_no_text' in def) = 0 then
    def := replace(def, $q$num := replace(s.prefix, '{YYYY}', to_char(now() at time zone 'Asia/Manila', 'YYYY')) || lpad(s.next_number::text, s.pad, '0');$q$,
      $q$num := public.certificate_no_text(s.course_id, s.cert_format, s.prefix, s.pad, s.next_number);$q$);
    if position('certificate_no_text' in def) = 0 then raise exception 'claim_certificate_number changed; nothing was applied.'; end if;
    execute def;
  end if;
end $$;

-- Registration No.: a course's own format, else the default; HAZMAT with CFR keeps its month-first shape until it has its own.
create or replace function public.claim_certificate_registration_number(target_certificate uuid, actor uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare cert public.certificates; e public.enrollments; s public.certificate_number_settings; r bigint; reg text; style text; padded text; tail text; fmt text; course_code text;
begin
  select * into cert from public.certificates where id = target_certificate for update;
  if cert.id is null then raise exception 'Certificate not found'; end if;
  if cert.registration_number is not null then return cert.registration_number; end if;
  select * into e from public.enrollments where id = cert.enrollment_id;

  -- The trainee's number for this course, if one was given before (earlier series or an earlier certificate).
  select registration_number into reg from public.trainee_registration_numbers where trainee_id = e.trainee_id and course_id = e.course_id;
  if reg is null then
    select c.registration_number into reg from public.certificates c join public.enrollments x on x.id = c.enrollment_id
    where x.trainee_id = e.trainee_id and x.course_id = e.course_id and c.registration_number is not null
    order by c.created_at limit 1;
  end if;

  if reg is null then
    insert into public.certificate_number_settings(id) values (true) on conflict (id) do nothing;
    select * into s from public.certificate_number_settings where id for update;
    select coalesce(c.registration_no_style, 'number-month'), c.code, cs.reg_format into style, course_code, fmt
    from public.courses c left join public.certificate_series cs on cs.course_id = c.id where c.id = e.course_id;
    fmt := coalesce(fmt, case when style = 'month-number' then null else s.reg_format end);
    r := s.reg_last;
    loop
      r := r + 1; padded := s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-%'; tail := s.reg_prefix || '%-' || r::text;
      reg := case
        when fmt is not null then public.number_from_format(fmt, course_code, r)
        when style = 'month-number' then s.reg_prefix || extract(month from now() at time zone 'Asia/Manila')::int::text || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || r::text
        else s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-' || to_char(now() at time zone 'Asia/Manila', 'MMYYYY') end;
      exit when not exists (select 1 from public.certificates where registration_number = reg or registration_number like padded or registration_number like tail)
        and not exists (select 1 from public.legacy_certificates where registration_number = reg or registration_number like padded or registration_number like tail)
        and not exists (select 1 from public.trainee_registration_numbers where registration_number = reg or registration_number like padded or registration_number like tail);
    end loop;
    update public.certificate_number_settings set reg_last = greatest(reg_last, r) where id;
  end if;

  -- Remember it for this trainee and course, so a retake prints the same number.
  insert into public.trainee_registration_numbers(trainee_id, course_id, registration_number)
  values (e.trainee_id, e.course_id, reg) on conflict do nothing;
  update public.certificates set registration_number = reg, updated_at = now() where id = cert.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'releasing_officer', 'certificate.registration_number_assigned', 'certificate', cert.id::text, jsonb_build_object('registration_number', reg));
  return reg;
end $$;
revoke all on function public.claim_certificate_registration_number(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_certificate_registration_number(uuid, uuid) to service_role;

-- Admin › Certificate Numbers: saves one course's formats and last number used. A number reserved at enrollment but not
-- printed yet is released when the format changes, so the next print takes the new format. Printed numbers are untouched.
create or replace function public.save_certificate_formats(target_course uuid, target_cert_format text, target_reg_format text, target_last bigint, actor uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare prior public.certificate_series; numbered integer;
begin
  select * into prior from public.certificate_series where course_id = target_course for update;
  insert into public.certificate_series (course_id, next_number, cert_format, reg_format, cert_year, set_by, set_at)
  values (target_course, target_last + 1, target_cert_format, target_reg_format, extract(year from now() at time zone 'Asia/Manila')::int, actor, now())
  on conflict (course_id) do update set next_number = excluded.next_number, cert_format = excluded.cert_format, reg_format = excluded.reg_format,
    cert_year = excluded.cert_year, set_by = excluded.set_by, set_at = excluded.set_at;
  if target_cert_format is distinct from prior.cert_format then
    update public.enrollments e set certificate_number = null
    where e.course_id = target_course and e.certificate_number is not null
      and not exists (select 1 from public.certificates c where c.enrollment_id = e.id and c.certificate_number is not null);
  end if;
  numbered := public.assign_course_numbers(target_course);
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values)
  values (actor, 'admin', 'certificate.format_set', 'course', target_course::text,
    case when prior.course_id is null then null else jsonb_build_object('cert_format', prior.cert_format, 'reg_format', prior.reg_format, 'next_number', prior.next_number) end,
    jsonb_build_object('cert_format', target_cert_format, 'reg_format', target_reg_format, 'next_number', target_last + 1));
  return numbered;
end $$;
revoke all on function public.save_certificate_formats(uuid, text, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.save_certificate_formats(uuid, text, text, bigint, uuid) to service_role;
revoke all on function public.number_from_format(text, text, bigint) from public, anon, authenticated;
grant execute on function public.number_from_format(text, text, bigint) to service_role;
revoke all on function public.certificate_no_text(uuid, text, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.certificate_no_text(uuid, text, text, integer, bigint) to service_role;

-- UBT-PSSR had no Certificate No. series. Its format from the approved prototype, starting at 1 until the Admin enters the last number used.
insert into public.certificate_series (course_id, next_number, pad, cert_format, cert_year)
select c.id, 1, 6, 'NWMTACI-{CODE}{YYYY}{N:6}', extract(year from now() at time zone 'Asia/Manila')::int
from public.courses c where upper(c.code) = 'UBT-PSSR' and c.delivery_type = 'In-House'
on conflict (course_id) do update set cert_format = coalesce(certificate_series.cert_format, excluded.cert_format), cert_year = coalesce(certificate_series.cert_year, excluded.cert_year);

-- HAZMAT with CFR shows its month-first shape as its own format on the screen; the numbers it prints do not change.
update public.certificate_series cs set reg_format = st.reg_prefix || '{M}{YYYY}-{N}'
from public.courses c, public.certificate_number_settings st
where c.id = cs.course_id and c.registration_no_style = 'month-number' and cs.reg_format is null;

notify pgrst, 'reload schema';

commit;

select c.code, s.cert_format, s.reg_format, public.number_from_format(coalesce(s.cert_format, 'x{N}'), c.code, s.next_number) as next_certificate
from public.certificate_series s join public.courses c on c.id = s.course_id
where s.cert_format is not null or s.reg_format is not null;
