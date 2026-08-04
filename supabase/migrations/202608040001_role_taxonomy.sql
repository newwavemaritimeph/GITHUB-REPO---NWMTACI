-- =====================================================================
-- Role taxonomy update (LIVE portal).
-- Adds two staff roles (super_admin, releasing_officer), relabels two
-- existing roles, elevates super_admin to admin-equivalent everywhere via a
-- single has_any_role() change, and moves the certificate functions from
-- training_operations (now "Schedule Officer") to releasing_officer.
-- Additive and idempotent — safe to run once on a live database.
-- =====================================================================

begin;

-- 1. New staff roles (idempotent).
insert into public.roles(code, name, is_staff) values
  ('super_admin', 'Super Admin', true),
  ('releasing_officer', 'Releasing Officer', true)
on conflict (code) do nothing;

-- 2. Relabel existing roles (codes untouched — only the display name changes).
update public.roles set name = 'Accounting Officer (Cashier)' where code = 'cashier';
update public.roles set name = 'Schedule Officer' where code = 'training_operations';

-- 3. No-lockout elevation: every current admin also becomes super_admin so
--    user/role management (which moves to super_admin only) is never orphaned.
insert into public.user_roles(user_id, role_id)
select ur.user_id, sr.id
from public.user_roles ur
  join public.roles ar on ar.id = ur.role_id and ar.code = 'admin'
  cross join public.roles sr
where sr.code = 'super_admin'
on conflict (user_id, role_id) do nothing;

-- 4. Super-admin elevation in ONE place: any gate that allows 'admin' also
--    allows a super_admin. Covers every RLS policy and RPC using has_any_role.
create or replace function public.has_any_role(role_codes text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.active and (
      r.code = any(role_codes)
      or (r.code = 'super_admin' and 'admin' = any(role_codes))
    )
  );
$$;

-- 5. Certificates move from training_operations to releasing_officer.
--    Re-create the three certificate functions with the swapped gate; bodies
--    are otherwise identical to their original migrations.
create or replace function public.set_certificate_status(target_enrollment uuid, target_status text)
returns public.certificates language plpgsql security definer set search_path = public as $$
declare result public.certificates;
begin
  if not public.has_any_role(array['admin','releasing_officer']) then raise exception 'Not authorized'; end if;
  if target_status not in ('Pending Attendance','Ready to Print','Printed','Released','Cancelled') then raise exception 'Invalid certificate status'; end if;
  insert into public.certificates(enrollment_id, status, printed_at, printed_by)
  values(
    target_enrollment, target_status,
    case when target_status in ('Printed','Released') then now() else null end,
    case when target_status in ('Printed','Released') then auth.uid() else null end
  )
  on conflict (enrollment_id) do update set
    status = excluded.status,
    printed_at = case when excluded.status in ('Printed','Released') then coalesce(public.certificates.printed_at, now()) else public.certificates.printed_at end,
    printed_by = case when excluded.status in ('Printed','Released') then coalesce(public.certificates.printed_by, auth.uid()) else public.certificates.printed_by end,
    updated_at = now()
  returning * into result;
  return result;
end $$;

create or replace function public.refresh_certificate_eligibility(target_enrollment uuid)
returns public.certificates language plpgsql security definer set search_path = public as $$
declare enrollment_row public.enrollments; cert public.certificates; eligible boolean;
begin
  if not public.has_any_role(array['admin','releasing_officer']) then raise exception 'Not authorized'; end if;
  select * into enrollment_row from public.enrollments where id=target_enrollment;
  if enrollment_row.id is null then raise exception 'Enrollment not found'; end if;
  select exists(select 1 from public.attendance_records where enrollment_id=target_enrollment)
    and not exists(select 1 from public.attendance_records where enrollment_id=target_enrollment and status not in ('Present','Late','Make-Up Completed'))
    into eligible;
  insert into public.certificates(enrollment_id,status,snapshot)
  values(target_enrollment,case when eligible then 'Ready to Print' else 'Pending Attendance' end,jsonb_build_object('evaluated_at',now(),'eligible',eligible))
  on conflict(enrollment_id) do update set status=excluded.status,snapshot=excluded.snapshot,updated_at=now()
  returning * into cert;
  if eligible and cert.ready_notified_at is null then
    update public.certificates set ready_notified_at=now() where id=cert.id returning * into cert;
    insert into public.notifications(recipient_id,notification_type,title,body,related_record_type,related_record_id,deep_link)
    select ur.user_id,'certificate.ready','Certificate ready to print','An enrollment passed certificate eligibility checks.','certificate',cert.id,'/portal?module=Certificates'
    from public.user_roles ur join public.roles r on r.id=ur.role_id where r.code in ('admin','releasing_officer')
    on conflict do nothing;
  end if;
  return cert;
end $$;

create or replace function public.allocate_certificate_number(target_certificate uuid)
returns public.certificates language plpgsql security definer set search_path = public as $$
declare cert public.certificates; number_row public.certificate_number_pool; template_row public.certificate_templates;
begin
  if not public.has_any_role(array['admin','releasing_officer']) then raise exception 'Not authorized'; end if;
  if coalesce(current_setting('app.certificate_issuance_enabled',true),'false') <> 'true'
     or not exists(select 1 from public.organization_settings where id and certificate_issuance_enabled) then raise exception 'Certificate issuance is disabled'; end if;
  select * into cert from public.certificates where id=target_certificate and status='Ready to Print' for update;
  if cert.id is null then raise exception 'Certificate is not ready'; end if;
  select ct.* into template_row from public.certificate_templates ct join public.enrollments e on e.id=cert.enrollment_id
    where ct.course_id=e.course_id and ct.active and ct.approved_at is not null order by ct.version desc limit 1;
  if template_row.id is null then raise exception 'No approved active template'; end if;
  select p.* into number_row from public.certificate_number_pool p join public.enrollments e on e.id=cert.enrollment_id
    where p.state='Available' and (p.course_id is null or p.course_id=e.course_id) order by p.certificate_number for update skip locked limit 1;
  if number_row.id is null then raise exception 'Certificate number pool is empty'; end if;
  update public.certificate_number_pool set state='Assigned',assigned_at=now() where id=number_row.id;
  update public.certificates set template_id=template_row.id,number_pool_id=number_row.id,snapshot=jsonb_build_object('certificate_number',number_row.certificate_number,'template_version',template_row.version,'allocated_at',now()),updated_at=now()
  where id=cert.id returning * into cert;
  return cert;
end $$;

commit;
