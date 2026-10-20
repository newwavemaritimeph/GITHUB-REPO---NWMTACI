-- =====================================================================
-- Certificate QR verification, revocation, hologram sticker, direct-SQL audit,
-- portal evaluation PDFs in Drive and the 8:00 PM owner report
-- (owner, 20 Oct 2026; Desktop/NWMTACI_QR_Certificate_Verification_Plan.md, adapted).
--   * verify_code: 12 random Crockford Base32 characters (no I/L/O/U), stored
--     without dashes; the QR opens https://newwavemaritimemtaci.com/verify/XXXX-XXXX-XXXX.
--   * Revoked is a flag (revoked_at), so the status check is untouched; a revoked
--     certificate cannot be printed and the QR page shows REVOKED.
--   * certificate_scans logs every check of the public page (hashed IP only).
--   * Any change to certificates made outside the app (SQL editor: no PostgREST
--     JWT) is written to audit_logs as certificate.direct_sql.
--   * training_feedback keeps only the Drive link of the evaluation PDF.
-- Additive and idempotent.
-- =====================================================================

begin;

alter table public.certificates add column if not exists verify_code text;
create unique index if not exists certificates_verify_code_unique on public.certificates(verify_code) where verify_code is not null;
alter table public.certificates add column if not exists sticker_no text;
alter table public.certificates add column if not exists revoked_at timestamptz;
alter table public.certificates add column if not exists revoked_by uuid references public.profiles(id);
alter table public.certificates add column if not exists revoked_reason text;

create table if not exists public.certificate_scans (
  id bigint generated always as identity primary key,
  certificate_id uuid references public.certificates(id),
  code_tried text not null,
  result text not null check (result in ('valid', 'revoked', 'not_found')),
  ip_hash text,
  user_agent text,
  scanned_at timestamptz not null default now()
);
create index if not exists certificate_scans_at_idx on public.certificate_scans(scanned_at desc);
create index if not exists certificate_scans_ip_idx on public.certificate_scans(ip_hash, scanned_at desc);
alter table public.certificate_scans enable row level security;

alter table public.training_feedback add column if not exists drive_file_id text;
alter table public.training_feedback add column if not exists drive_link text;

-- Changes made without a PostgREST request (the SQL editor, psql) are audited.
create or replace function public.certificates_direct_sql_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then
    insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values, reason)
    values (null, 'service/sql', 'certificate.direct_sql', 'certificate', coalesce(new.id, old.id)::text,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      case when tg_op = 'DELETE' then null else to_jsonb(new) end, tg_op);
  end if;
  return null;
end $$;
drop trigger if exists certificates_direct_sql_audit on public.certificates;
create trigger certificates_direct_sql_audit after insert or update or delete on public.certificates
  for each row execute function public.certificates_direct_sql_audit();

-- Printing refuses a revoked certificate (body of 202610080030 plus the revoked check).
create or replace function public.record_certificate_print(target_certificate uuid, actor uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  cert record;
begin
  select id, print_count, reprints_allowed, status, revoked_at into cert from public.certificates where id = target_certificate for update;
  if not found then raise exception 'Certificate not found.'; end if;
  if cert.status = 'Cancelled' then raise exception 'This certificate is cancelled.'; end if;
  if cert.revoked_at is not null then raise exception 'This certificate is revoked.'; end if;
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

insert into public.email_templates(template_code, version, subject, body_html, body_text, active)
values (
  'certificate.daily_report', 1,
  'New Wave certificates {{date}}: {{printed}} printed, {{reprinted}} reprinted, {{revoked}} revoked',
  '<div style="margin:0;padding:20px 10px;background:#eef4f8;font-family:Arial,Helvetica,sans-serif;color:#0b1f33">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dbe7ec">
    <div style="background:#0571D0;padding:16px 20px;border-bottom:4px solid #F25615;color:#ffffff;font-weight:700">NEW WAVE MARITIME · DAILY CERTIFICATE REPORT</div>
    <div style="padding:18px 20px">
      <p style="margin:0 0 12px;font-size:14px">{{date}}</p>
      {{body_html}}
      <p style="margin:14px 0 0;font-size:12.5px;color:#5b7587">Sent at 8:00 PM by the New Wave portal.</p>
    </div>
  </div>
</div>',
  'NEW WAVE MARITIME - DAILY CERTIFICATE REPORT
{{date}}

{{body_text}}',
  true
)
on conflict (template_code, version) do update set subject = excluded.subject, body_html = excluded.body_html, body_text = excluded.body_text, active = true;

notify pgrst, 'reload schema';

commit;
