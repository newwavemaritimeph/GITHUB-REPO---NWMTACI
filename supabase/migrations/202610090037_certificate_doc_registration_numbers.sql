-- =====================================================================
-- Continue New Wave's existing certificate numbers (owner, 9 Oct 2026).
--   * Doc. No.: one running series for every certificate (e.g. 00006884).
--   * Registration No.: new on every certificate, prefix + running number +
--     "-MMYYYY" of the issue month (e.g. NWMTC007549-102026).
--   * Certificate No. stays per course (certificate_series).
--   The Admin enters the last numbers already used on paper; printing takes
--   the next one in each series at the same moment. Numbers recorded for
--   certificates issued before the portal are reserved and never reused.
-- Additive and idempotent.
-- =====================================================================

begin;

create table if not exists public.certificate_number_settings (
  id boolean primary key default true check (id),
  doc_last bigint not null default 0,
  doc_digits integer not null default 8 check (doc_digits between 1 and 12),
  reg_prefix text not null default 'NWMTC',
  reg_last bigint not null default 0,
  reg_digits integer not null default 6 check (reg_digits between 1 and 12),
  set_by uuid references public.profiles(id),
  set_at timestamptz
);
insert into public.certificate_number_settings(id) values (true) on conflict (id) do nothing;
alter table public.certificate_number_settings enable row level security;

alter table public.certificates add column if not exists registration_number text;
alter table public.certificates add column if not exists doc_number text;
create unique index if not exists certificates_registration_number_unique on public.certificates(registration_number) where registration_number is not null;
create unique index if not exists certificates_doc_number_unique on public.certificates(doc_number) where doc_number is not null;

-- Certificates printed before the portal (matched to an enrollment when possible).
create table if not exists public.legacy_certificates (
  id uuid primary key default gen_random_uuid(),
  trainee_name text not null,
  nwmtaci_number text,
  course_code text,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  certificate_number text,
  registration_number text,
  doc_number text,
  issued_on date,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now()
);
create unique index if not exists legacy_certificates_cert_unique on public.legacy_certificates(certificate_number) where certificate_number is not null;
create unique index if not exists legacy_certificates_reg_unique on public.legacy_certificates(registration_number) where registration_number is not null;
create unique index if not exists legacy_certificates_doc_unique on public.legacy_certificates(doc_number) where doc_number is not null;
alter table public.legacy_certificates enable row level security;

-- Assign the Doc. No. and Registration No. to a certificate at print time.
-- Idempotent: a certificate that already has them keeps them (reprints).
create or replace function public.claim_certificate_doc_numbers(target_certificate uuid, actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cert public.certificates; s public.certificate_number_settings; d bigint; r bigint; doc text; reg text; suffix text;
begin
  select * into cert from public.certificates where id = target_certificate for update;
  if cert.id is null then raise exception 'Certificate not found'; end if;
  if cert.doc_number is not null and cert.registration_number is not null then
    return jsonb_build_object('doc_number', cert.doc_number, 'registration_number', cert.registration_number);
  end if;
  select * into s from public.certificate_number_settings where id for update;
  if s.id is null or s.set_at is null then raise exception 'The Admin sets the Doc. No. and Registration No. first (Admin › Certificate Numbers).'; end if;
  suffix := to_char(now() at time zone 'Asia/Manila', 'MMYYYY');
  d := s.doc_last; r := s.reg_last;
  if cert.doc_number is null then
    loop
      d := d + 1; doc := lpad(d::text, s.doc_digits, '0');
      exit when not exists (select 1 from public.certificates where doc_number = doc)
        and not exists (select 1 from public.legacy_certificates where doc_number = doc);
    end loop;
  else doc := cert.doc_number; end if;
  if cert.registration_number is null then
    loop
      r := r + 1; reg := s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-' || suffix;
      exit when not exists (select 1 from public.certificates where registration_number like s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-%')
        and not exists (select 1 from public.legacy_certificates where registration_number like s.reg_prefix || lpad(r::text, s.reg_digits, '0') || '-%');
    end loop;
  else reg := cert.registration_number; end if;
  update public.certificate_number_settings set doc_last = greatest(doc_last, d), reg_last = greatest(reg_last, r) where id;
  update public.certificates set doc_number = doc, registration_number = reg, updated_at = now() where id = cert.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'releasing_officer', 'certificate.doc_numbers_assigned', 'certificate', cert.id::text, jsonb_build_object('doc_number', doc, 'registration_number', reg));
  return jsonb_build_object('doc_number', doc, 'registration_number', reg);
end $$;
revoke all on function public.claim_certificate_doc_numbers(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_certificate_doc_numbers(uuid, uuid) to service_role;

commit;
