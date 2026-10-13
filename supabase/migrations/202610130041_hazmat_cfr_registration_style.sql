-- =====================================================================
-- HAZMAT with CFR Registration No. like New Wave's own certificate
-- (owner's sample, 13 Oct 2026):
--   prefix + issue month (no leading zero) + year + "-" + running number,
--   e.g. NWMTC32026-2290.
-- Every other course keeps prefix + running number + "-MMYYYY"
-- (NWMTC007549-102026). Both styles share the one running number, and a
-- number used in either style is never given out again.
-- Additive and idempotent.
-- =====================================================================

begin;

alter table public.courses add column if not exists registration_no_style text not null default 'number-month';
do $$ begin
  alter table public.courses add constraint courses_registration_no_style_check check (registration_no_style in ('number-month', 'month-number'));
exception when duplicate_object then null; end $$;

update public.courses set registration_no_style = 'month-number'
where (code ilike '%hazmat%' or name ilike '%hazmat%') and (code ~* '\mcfr\M' or name ~* '\mcfr\M');

create or replace function public.claim_certificate_registration_number(target_certificate uuid, actor uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare cert public.certificates; s public.certificate_number_settings; r bigint; reg text; style text; padded text; tail text;
begin
  select * into cert from public.certificates where id = target_certificate for update;
  if cert.id is null then raise exception 'Certificate not found'; end if;
  if cert.registration_number is not null then return cert.registration_number; end if;
  select * into s from public.certificate_number_settings where id for update;
  if s.id is null or s.set_at is null then raise exception 'The Admin sets the Registration No. first (Admin › Certificate Numbers).'; end if;
  select coalesce(c.registration_no_style, 'number-month') into style
  from public.enrollments e join public.courses c on c.id = e.course_id where e.id = cert.enrollment_id;
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
  update public.certificates set registration_number = reg, updated_at = now() where id = cert.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'releasing_officer', 'certificate.registration_number_assigned', 'certificate', cert.id::text, jsonb_build_object('registration_number', reg));
  return reg;
end $$;
revoke all on function public.claim_certificate_registration_number(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_certificate_registration_number(uuid, uuid) to service_role;

commit;
