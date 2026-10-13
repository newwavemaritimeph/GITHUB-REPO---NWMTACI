-- =====================================================================
-- Certificate No. and Registration No. per course, given at enrollment
-- (owner, 13 Oct 2026).
--   * Certificate No.: course prefix + the course's running number, in
--     enrollment order. Reserved on the enrollment the moment it becomes
--     Enrolled (or Open Schedule); a cancelled enrollment keeps its number.
--   * Registration No.: one per trainee per course, from that course's own
--     running number. A retake of the same course keeps the trainee's number;
--     another course gives that course's next number.
--     Style "month-number": NWMTC + month + year + "-" + number (NWMTC102026-2290)
--     Style "number-month": NWMTC + number + "-" + MMYYYY (NWMTC002290-102026)
--     The month and year are those of the day the number is given.
--   * The Admin (and, for In-House courses, the Releasing Officer) sets each
--     course's starting numbers in Numbering. Saving numbers the course's
--     enrolled trainees still without one, in enrollment order.
--   * A course without a Registration No. start keeps the single
--     New Wave-wide series (202610090037 / 202610130041).
-- Additive and idempotent. Supersedes the function bodies of 202610130041.
-- =====================================================================

begin;

-- Still needed by the fallback when 202610130041 was not applied.
alter table public.courses add column if not exists registration_no_style text not null default 'number-month';

alter table public.certificate_series add column if not exists reg_prefix text not null default 'NWMTC';
alter table public.certificate_series add column if not exists reg_next bigint check (reg_next is null or reg_next > 0);
alter table public.certificate_series add column if not exists reg_digits integer not null default 4 check (reg_digits between 1 and 12);
alter table public.certificate_series add column if not exists reg_style text not null default 'month-number';
do $$ begin
  alter table public.certificate_series add constraint certificate_series_reg_style_check check (reg_style in ('number-month', 'month-number'));
exception when duplicate_object then null; end $$;

-- The Certificate No. reserved for an enrollment.
alter table public.enrollments add column if not exists certificate_number text;
create unique index if not exists enrollments_certificate_number_unique on public.enrollments(certificate_number) where certificate_number is not null;

-- One Registration No. per trainee per course, for life.
create table if not exists public.trainee_registration_numbers (
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  registration_number text not null unique,
  assigned_at timestamptz not null default now(),
  primary key (trainee_id, course_id)
);
alter table public.trainee_registration_numbers enable row level security;

-- A retake prints the same Registration No. again, so it is no longer unique per certificate.
drop index if exists public.certificates_registration_number_unique;
create index if not exists certificates_registration_number_idx on public.certificates(registration_number);

-- Numbers one enrollment: its Certificate No. and, if the trainee has none for
-- this course yet, a Registration No. Does nothing for partner courses, for
-- enrollments not enrolled yet, or for a course without numbering.
create or replace function public.assign_enrollment_numbers(target_enrollment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.enrollments; s public.certificate_series; n bigint; num text; reg text; m text; y text; held text;
begin
  select * into e from public.enrollments where id = target_enrollment;
  if e.id is null or e.partner_offer_id is not null or e.enrollment_status not in ('Enrolled', 'Open Schedule') then return; end if;
  select * into s from public.certificate_series where course_id = e.course_id for update;
  if s.course_id is null then return; end if;

  -- Certificate No., unless the enrollment or its certificate already has one.
  select certificate_number into held from public.certificates where enrollment_id = e.id;
  if e.certificate_number is null and held is null and coalesce(s.prefix, '') <> '' then
    n := s.next_number;
    loop
      num := s.prefix || lpad(n::text, s.pad, '0');
      exit when not exists (select 1 from public.certificates where certificate_number = num)
        and not exists (select 1 from public.enrollments where certificate_number = num)
        and not exists (select 1 from public.legacy_certificates where certificate_number = num);
      n := n + 1;
    end loop;
    update public.certificate_series set next_number = n + 1 where course_id = s.course_id;
    update public.enrollments set certificate_number = num where id = e.id;
  end if;

  -- Registration No., once per trainee per course.
  if s.reg_next is not null and not exists (select 1 from public.trainee_registration_numbers where trainee_id = e.trainee_id and course_id = e.course_id) then
    m := extract(month from now() at time zone 'Asia/Manila')::int::text;
    y := to_char(now() at time zone 'Asia/Manila', 'YYYY');
    n := s.reg_next;
    loop
      reg := case when s.reg_style = 'month-number'
        then s.reg_prefix || m || y || '-' || lpad(n::text, s.reg_digits, '0')
        else s.reg_prefix || lpad(n::text, s.reg_digits, '0') || '-' || lpad(m, 2, '0') || y end;
      exit when not exists (select 1 from public.trainee_registration_numbers where registration_number = reg)
        and not exists (select 1 from public.legacy_certificates where registration_number = reg);
      n := n + 1;
    end loop;
    insert into public.trainee_registration_numbers(trainee_id, course_id, registration_number) values (e.trainee_id, e.course_id, reg);
    update public.certificate_series set reg_next = n + 1 where course_id = s.course_id;
  end if;
end $$;
revoke all on function public.assign_enrollment_numbers(uuid) from public, anon, authenticated;
grant execute on function public.assign_enrollment_numbers(uuid) to service_role;

-- Numbers every enrolled trainee of a course still without one, in enrollment order.
create or replace function public.assign_course_numbers(target_course uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; c integer := 0;
begin
  for r in select id from public.enrollments
    where course_id = target_course and partner_offer_id is null and enrollment_status in ('Enrolled', 'Open Schedule')
    order by coalesce(enrolled_at, created_at), created_at, id
  loop
    perform public.assign_enrollment_numbers(r.id); c := c + 1;
  end loop;
  return c;
end $$;
revoke all on function public.assign_course_numbers(uuid) from public, anon, authenticated;
grant execute on function public.assign_course_numbers(uuid) to service_role;

-- Number an enrollment as it becomes Enrolled / Open Schedule.
create or replace function public.enrollment_numbers_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.enrollment_status in ('Enrolled', 'Open Schedule') and (tg_op = 'INSERT' or old.enrollment_status is distinct from new.enrollment_status) then
    -- Numbering never blocks an enrollment; a miss is numbered at print or when the Admin saves the course.
    begin
      perform public.assign_enrollment_numbers(new.id);
    exception when others then
      raise warning 'Numbers not assigned to enrollment %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists enrollments_assign_numbers on public.enrollments;
create trigger enrollments_assign_numbers after insert or update of enrollment_status on public.enrollments
  for each row execute function public.enrollment_numbers_trigger();

-- Certificate No. at first preview/print: the one reserved at enrollment, else the next in the course.
create or replace function public.claim_certificate_number(target_certificate uuid, actor uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  cert record;
  s record;
  num text;
  reserved text;
begin
  select c.id, c.certificate_number, e.id as enrollment_id, e.course_id, e.batch_id, e.certificate_number as reserved into cert
  from public.certificates c join public.enrollments e on e.id = c.enrollment_id
  where c.id = target_certificate for update of c;
  if not found then raise exception 'Certificate not found.'; end if;
  if cert.certificate_number is not null then return cert.certificate_number; end if;
  reserved := cert.reserved;
  if reserved is null then
    perform public.assign_enrollment_numbers(cert.enrollment_id);
    select certificate_number into reserved from public.enrollments where id = cert.enrollment_id;
  end if;
  select * into s from public.certificate_series where course_id = cert.course_id for update;
  if not found then raise exception 'The Admin has not set the certificate numbering for this course yet.'; end if;
  if reserved is not null then
    num := reserved;
  else
    num := s.prefix || lpad(s.next_number::text, s.pad, '0');
    update public.certificate_series set next_number = next_number + 1 where course_id = cert.course_id;
  end if;
  update public.certificates set certificate_number = num,
    batch_label = coalesce(batch_label, nullif(s.batch_prefix || s.next_batch::text, '')),
    snapshot = coalesce(snapshot, '{}'::jsonb) || jsonb_build_object('certificate_number', num),
    updated_at = now()
  where id = target_certificate;
  insert into public.audit_logs (actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'releasing_officer', 'certificate.number_assigned', 'certificate', target_certificate::text, jsonb_build_object('certificate_number', num));
  return num;
end $$;
revoke all on function public.claim_certificate_number(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_certificate_number(uuid, uuid) to service_role;

-- Registration No. at print: the trainee's number for this course when the course
-- has its own series; else the single New Wave-wide series.
create or replace function public.claim_certificate_registration_number(target_certificate uuid, actor uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare cert public.certificates; e public.enrollments; s public.certificate_number_settings; cs public.certificate_series; r bigint; reg text; style text; padded text; tail text;
begin
  select * into cert from public.certificates where id = target_certificate for update;
  if cert.id is null then raise exception 'Certificate not found'; end if;
  if cert.registration_number is not null then return cert.registration_number; end if;
  select * into e from public.enrollments where id = cert.enrollment_id;
  select * into cs from public.certificate_series where course_id = e.course_id;
  if cs.course_id is not null and cs.reg_next is not null then
    select registration_number into reg from public.trainee_registration_numbers where trainee_id = e.trainee_id and course_id = e.course_id;
    if reg is null then
      perform public.assign_enrollment_numbers(e.id);
      select registration_number into reg from public.trainee_registration_numbers where trainee_id = e.trainee_id and course_id = e.course_id;
    end if;
    if reg is null then raise exception 'This enrollment is not enrolled yet, so it has no Registration No.'; end if;
  else
    select * into s from public.certificate_number_settings where id for update;
    if s.id is null or s.set_at is null then raise exception 'Set the Registration No. for this course first (Numbering).'; end if;
    select coalesce(c.registration_no_style, 'number-month') into style from public.courses c where c.id = e.course_id;
    r := s.reg_last;
    loop
      r := r + 1; padded := s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-%'; tail := s.reg_prefix || '%-' || r::text;
      exit when not exists (select 1 from public.certificates where registration_number like padded or registration_number like tail)
        and not exists (select 1 from public.legacy_certificates where registration_number like padded or registration_number like tail);
    end loop;
    reg := case when style = 'month-number'
      then s.reg_prefix || extract(month from now() at time zone 'Asia/Manila')::int::text || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || r::text
      else s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-' || to_char(now() at time zone 'Asia/Manila', 'MMYYYY') end;
    update public.certificate_number_settings set reg_last = greatest(reg_last, r) where id;
  end if;
  update public.certificates set registration_number = reg, updated_at = now() where id = cert.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'releasing_officer', 'certificate.registration_number_assigned', 'certificate', cert.id::text, jsonb_build_object('registration_number', reg));
  return reg;
end $$;
revoke all on function public.claim_certificate_registration_number(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_certificate_registration_number(uuid, uuid) to service_role;

commit;
