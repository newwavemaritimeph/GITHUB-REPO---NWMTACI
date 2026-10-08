-- Certificate controls (owner, 8 Oct 2026).
-- * Admin sets the first Certificate No. and batch number per course; the system continues.
-- * A certificate prints once; each paid Reprinting request or Admin-approved void allows one more print.
-- * Templates can come from a Google Drive link ("Anyone with the link").
-- * In-House (Google Classroom) courses need the Google Forms evaluation before printing.
-- * The soft copy (PDF) is emailed once the evaluation is in.
-- Additive only.

create table if not exists public.certificate_series (
  course_id uuid primary key references public.courses(id) on delete cascade,
  prefix text not null default '',
  next_number integer not null default 1 check (next_number > 0),
  pad integer not null default 5 check (pad between 1 and 10),
  batch_prefix text not null default '',
  next_batch integer not null default 1 check (next_batch > 0),
  set_by uuid references public.profiles(id),
  set_at timestamptz not null default now()
);
alter table public.certificate_series enable row level security;

alter table public.certificates add column if not exists certificate_number text;
alter table public.certificates add column if not exists batch_label text;
alter table public.certificates add column if not exists print_count integer not null default 0;
alter table public.certificates add column if not exists reprints_allowed integer not null default 0;
alter table public.certificates add column if not exists soft_copy_sent_at timestamptz;
alter table public.certificates add column if not exists void_status text check (void_status in ('Requested', 'Approved', 'Rejected'));
alter table public.certificates add column if not exists void_reason text;
alter table public.certificates add column if not exists void_requested_by uuid references public.profiles(id);
alter table public.certificates add column if not exists void_requested_at timestamptz;
alter table public.certificates add column if not exists void_decided_by uuid references public.profiles(id);
alter table public.certificates add column if not exists void_decided_at timestamptz;
alter table public.certificates add column if not exists void_remarks text;
create unique index if not exists certificates_number_unique on public.certificates (certificate_number) where certificate_number is not null;
-- Certificates already printed count as one print.
update public.certificates set print_count = 1 where print_count = 0 and status in ('Printed', 'Released');

alter table public.certificate_templates add column if not exists drive_link text;
alter table public.certificate_templates add column if not exists drive_file_id text;
alter table public.certificate_templates alter column storage_path drop not null;

alter table public.courses add column if not exists evaluation_form_id text;

alter table public.training_feedback add column if not exists source text not null default 'Portal';
alter table public.training_feedback add column if not exists respondent_email text;
alter table public.training_feedback add column if not exists response_id text;
create unique index if not exists training_feedback_response_unique on public.training_feedback (response_id) where response_id is not null;

-- Next Certificate No. (and batch label) for a certificate, from its course's series. Idempotent.
create or replace function public.claim_certificate_number(target_certificate uuid, actor uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  cert record;
  s record;
  num text;
begin
  select c.id, c.certificate_number, e.course_id, e.batch_id into cert
  from public.certificates c join public.enrollments e on e.id = c.enrollment_id
  where c.id = target_certificate for update of c;
  if not found then raise exception 'Certificate not found.'; end if;
  if cert.certificate_number is not null then return cert.certificate_number; end if;
  select * into s from public.certificate_series where course_id = cert.course_id for update;
  if not found then raise exception 'The Admin has not set the certificate numbering for this course yet.'; end if;
  num := s.prefix || lpad(s.next_number::text, s.pad, '0');
  update public.certificate_series set next_number = next_number + 1 where course_id = cert.course_id;
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

-- Count one print. Refuses once every allowed print is used (1 + reprints_allowed).
create or replace function public.record_certificate_print(target_certificate uuid, actor uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  cert record;
begin
  select id, print_count, reprints_allowed, status into cert from public.certificates where id = target_certificate for update;
  if not found then raise exception 'Certificate not found.'; end if;
  if cert.status = 'Cancelled' then raise exception 'This certificate is cancelled.'; end if;
  if cert.print_count >= 1 + cert.reprints_allowed then
    raise exception 'Already printed. A reprint needs a paid Reprinting request or an Admin-approved void.';
  end if;
  update public.certificates set print_count = print_count + 1,
    status = case when status = 'Released' then status else 'Printed' end,
    printed_at = now(), printed_by = coalesce(actor, printed_by), updated_at = now()
  where id = target_certificate;
  insert into public.audit_logs (actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'releasing_officer', 'certificate.printed', 'certificate', target_certificate::text, jsonb_build_object('print', cert.print_count + 1));
  return cert.print_count + 1;
end $$;
revoke all on function public.record_certificate_print(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_certificate_print(uuid, uuid) to service_role;

-- Soft copy email.
insert into public.email_templates (template_code, version, subject, body_html, body_text, active)
select 'certificate.softcopy', 1,
  'Your certificate — {{course_name}}',
  '<div style="font-family:Arial,sans-serif;color:#0f2638;max-width:560px"><h2 style="color:#123F63;margin:0 0 12px">New Wave Maritime Training and Assessment Center, Inc.</h2><p>Dear {{trainee_name}},</p><p>Thank you for completing <b>{{course_name}}</b> and the evaluation form. Your certificate (No. {{certificate_number}}) is attached as a PDF soft copy.</p><p>The printed certificate can be claimed at our office. Please bring a valid ID.</p><p style="color:#5f7180;font-size:13px">Ride the New Wave of Maritime Excellence</p></div>',
  'Dear {{trainee_name}}, thank you for completing {{course_name}} and the evaluation form. Your certificate (No. {{certificate_number}}) is attached as a PDF soft copy. The printed certificate can be claimed at our office; please bring a valid ID.',
  true
where not exists (select 1 from public.email_templates where template_code = 'certificate.softcopy');
