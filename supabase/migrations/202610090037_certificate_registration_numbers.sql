-- =====================================================================
-- Continue New Wave's existing certificate numbers (owner, 9 Oct 2026).
--   * Registration No.: new on every certificate, prefix + running number +
--     "-MMYYYY" of the issue month (e.g. NWMTC007549-102026).
--   * Certificate No. stays per course (certificate_series).
--   * The Doc. No. is written on the printed certificate by hand, so the
--     portal does not number it.
--   The Admin enters the last Registration No. already used on paper;
--   printing takes the next one. Numbers recorded for certificates issued
--   before the portal are reserved and never reused.
-- Additive and idempotent.
-- =====================================================================

begin;

create table if not exists public.certificate_number_settings (
  id boolean primary key default true check (id),
  reg_prefix text not null default 'NWMTC',
  reg_last bigint not null default 0,
  reg_digits integer not null default 6 check (reg_digits between 1 and 12),
  set_by uuid references public.profiles(id),
  set_at timestamptz
);
insert into public.certificate_number_settings(id) values (true) on conflict (id) do nothing;
alter table public.certificate_number_settings enable row level security;

alter table public.certificates add column if not exists registration_number text;
create unique index if not exists certificates_registration_number_unique on public.certificates(registration_number) where registration_number is not null;

-- Certificates printed before the portal (matched to an enrollment when possible).
create table if not exists public.legacy_certificates (
  id uuid primary key default gen_random_uuid(),
  trainee_name text not null,
  nwmtaci_number text,
  course_code text,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  certificate_number text,
  registration_number text,
  issued_on date,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now()
);
create unique index if not exists legacy_certificates_cert_unique on public.legacy_certificates(certificate_number) where certificate_number is not null;
create unique index if not exists legacy_certificates_reg_unique on public.legacy_certificates(registration_number) where registration_number is not null;
alter table public.legacy_certificates enable row level security;

-- Assign the Registration No. to a certificate at print time.
-- Idempotent: a certificate that already has one keeps it (reprints).
create or replace function public.claim_certificate_registration_number(target_certificate uuid, actor uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare cert public.certificates; s public.certificate_number_settings; r bigint; reg text; base text;
begin
  select * into cert from public.certificates where id = target_certificate for update;
  if cert.id is null then raise exception 'Certificate not found'; end if;
  if cert.registration_number is not null then return cert.registration_number; end if;
  select * into s from public.certificate_number_settings where id for update;
  if s.id is null or s.set_at is null then raise exception 'The Admin sets the Registration No. first (Admin › Certificate Numbers).'; end if;
  r := s.reg_last;
  loop
    r := r + 1; base := s.reg_prefix || lpad(r::text, s.reg_digits, '0');
    exit when not exists (select 1 from public.certificates where registration_number like base || '-%')
      and not exists (select 1 from public.legacy_certificates where registration_number like base || '-%');
  end loop;
  reg := base || '-' || to_char(now() at time zone 'Asia/Manila', 'MMYYYY');
  update public.certificate_number_settings set reg_last = greatest(reg_last, r) where id;
  update public.certificates set registration_number = reg, updated_at = now() where id = cert.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'releasing_officer', 'certificate.registration_number_assigned', 'certificate', cert.id::text, jsonb_build_object('registration_number', reg));
  return reg;
end $$;
revoke all on function public.claim_certificate_registration_number(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_certificate_registration_number(uuid, uuid) to service_role;

commit;
