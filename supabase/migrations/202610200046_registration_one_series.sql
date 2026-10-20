-- =====================================================================
-- Registration No.: one automatic New Wave-wide series (owner, 20 Oct 2026).
--   * Every course takes the next number from certificate_number_settings
--     (NWMTC + number + "-MMYYYY"; HAZMAT-CFR keeps month first). Nobody
--     types it; the Admin may still set where it continues from.
--   * A trainee keeps their Registration No. for a course: a re-print or a
--     retake of the same course prints the number given before.
--   * Per-course Registration series (202610130042) are switched off.
--   * Certificate No. per course is unchanged: the Releasing Officer encodes
--     the last number used once and the portal continues from it.
-- Additive and idempotent. Supersedes claim_certificate_registration_number of 202610130042.
-- =====================================================================

begin;

-- Every course uses the single series; assign_enrollment_numbers then gives no per-course Registration No.
update public.certificate_series set reg_next = null where reg_next is not null;

insert into public.certificate_number_settings(id) values (true) on conflict (id) do nothing;

create or replace function public.claim_certificate_registration_number(target_certificate uuid, actor uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare cert public.certificates; e public.enrollments; s public.certificate_number_settings; r bigint; reg text; style text; padded text; tail text;
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
    select coalesce(c.registration_no_style, 'number-month') into style from public.courses c where c.id = e.course_id;
    r := s.reg_last;
    loop
      r := r + 1; padded := s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-%'; tail := s.reg_prefix || '%-' || r::text;
      exit when not exists (select 1 from public.certificates where registration_number like padded or registration_number like tail)
        and not exists (select 1 from public.legacy_certificates where registration_number like padded or registration_number like tail)
        and not exists (select 1 from public.trainee_registration_numbers where registration_number like padded or registration_number like tail);
    end loop;
    reg := case when style = 'month-number'
      then s.reg_prefix || extract(month from now() at time zone 'Asia/Manila')::int::text || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || r::text
      else s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-' || to_char(now() at time zone 'Asia/Manila', 'MMYYYY') end;
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

notify pgrst, 'reload schema';

commit;
