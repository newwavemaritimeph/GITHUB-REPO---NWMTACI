-- =====================================================================
-- BRING PRODUCTION UP TO DATE — applies every Aug-2026 migration in order.
-- Every statement is idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS /
-- ON CONFLICT / drop-first for changed function signatures), so this is safe
-- whether a given migration was already applied or not. Run once, top to bottom.
-- =====================================================================

-- ----- 202608040001_role_taxonomy -----
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

-- ----- 202608050001_training_feedback -----
-- =====================================================================
-- Training feedback = online-attendance for in-house courses.
-- Each enrollment gets a shareable feedback token. When the trainee submits
-- the feedback form, that counts as their online-training attendance and, for
-- In-House courses, marks the certificate "Ready to Print". Additive, idempotent.
-- =====================================================================

begin;

-- Per-enrollment share token for the public feedback link (backfilled for existing rows).
alter table public.enrollments add column if not exists feedback_token uuid not null default gen_random_uuid();

create table if not exists public.training_feedback (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id) on delete cascade,
  overall_rating int check (overall_rating between 1 and 5),
  instructor_rating int check (instructor_rating between 1 and 5),
  comments text,
  submitted_at timestamptz not null default now()
);

alter table public.training_feedback enable row level security;

-- Staff may read feedback; writes happen only through the service-role public API.
drop policy if exists training_feedback_staff_read on public.training_feedback;
create policy training_feedback_staff_read on public.training_feedback
  for select using (public.has_staff_role());

commit;

-- ----- 202608060001_feedback_email_template -----
-- =====================================================================
-- Email template for the training-feedback form (online-training attendance).
-- The Releasing Officer / Registration can send the per-trainee feedback link to
-- the trainee's registered email; the email-jobs worker delivers it via Resend.
-- Additive and idempotent.
-- =====================================================================

begin;

insert into public.email_templates (template_code, version, subject, body_html, body_text, active)
values (
  'training.feedback', 1,
  'Your New Wave training feedback (and attendance)',
  '<p>Hi {{trainee_name}},</p><p>Thank you for training with New Wave Maritime. Please complete this short feedback form for <strong>{{course_name}}</strong>. Submitting it also records your attendance for the online training, and your certificate will then be prepared.</p><p><a href="{{feedback_url}}">Open the feedback form</a></p><p>If the link does not work, copy and paste this address into your browser:<br>{{feedback_url}}</p><p>— New Wave Maritime Training and Assessment Center</p>',
  'Hi {{trainee_name}},

Thank you for training with New Wave Maritime. Please complete this short feedback form for {{course_name}}. Submitting it also records your attendance for the online training, and your certificate will then be prepared.

Open the feedback form: {{feedback_url}}

— New Wave Maritime Training and Assessment Center',
  true
)
on conflict (template_code, version) do nothing;

commit;

-- ----- 202608070001_optional_instructor_autopublish -----
-- =====================================================================
-- In-house batches: instructor/classroom/venue are now OPTIONAL, and
-- auto-opened batches are PUBLISHED immediately (so internal Open batches are
-- publicly bookable). Re-creates three functions; bodies are otherwise identical
-- to their originals (202607230004, 202607300001). Additive / safe to re-run.
-- =====================================================================

begin;
set local check_function_bodies = off;
do $catch$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
    where proname in ('create_training_batch','update_training_batch','auto_open_training_batches')
      and pronamespace='public'::regnamespace
  loop execute 'drop function '||r.sig||' cascade'; end loop;
end $catch$;

-- 1) Auto-open a month of blank batches — now PUBLISHED on creation.
create or replace function public.auto_open_training_batches(
  target_course uuid, target_year integer, target_month integer
) returns integer language plpgsql security definer set search_path = public as $$
declare
  course_row public.courses;
  required_days integer;
  first_day date; last_day date; d date; dow integer; ok boolean;
  training_day date; created_days integer; end_day date;
  new_batch public.batches;
  created_count integer := 0;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into course_row from public.courses where id = target_course and active and delivery_type = 'In-House';
  if course_row.id is null then raise exception 'Batches are only available for New Wave STCW and In-House courses'; end if;
  required_days := greatest(1, ceil(coalesce(course_row.duration_days, 1)))::integer;
  first_day := make_date(target_year, target_month, 1);
  last_day := (first_day + interval '1 month' - interval '1 day')::date;

  d := first_day;
  while d <= last_day loop
    dow := extract(isodow from d)::integer;
    if course_row.code = 'STPPDSPPS' then ok := (dow = 1);
    elsif course_row.code = 'PSCMT' then ok := (dow = 2);
    elsif course_row.code = 'PSCMHBT' then ok := (dow = 4);
    elsif course_row.code = 'CCMI' then ok := (dow = 1);
    elsif course_row.code = 'UBT-PSSR' then ok := (dow between 1 and 6);
    elsif required_days = 1 then ok := (dow <> 7);
    elsif required_days = 2 then ok := (dow in (1, 3, 5));
    elsif required_days = 3 then ok := (dow in (1, 4));
    else ok := (dow = 1);
    end if;

    if ok and not exists (select 1 from public.batches where course_id = target_course and starts_on = d and active) then
      training_day := d; created_days := 0; end_day := d;
      while created_days < required_days loop
        if extract(isodow from training_day)::integer <> 7 then created_days := created_days + 1; end_day := training_day; end if;
        if created_days < required_days then training_day := training_day + 1; end if;
      end loop;

      insert into public.batches(
        batch_number, course_id, partner_offer_id, starts_on, ends_on, daily_start, daily_end,
        mode, venue, capacity, enrollment_deadline, published_at, created_by
      ) values (
        public.next_reference('BCH'), target_course, null, d, end_day, time '08:00', time '17:00',
        'In-person', null, 24, d::timestamptz, now(), auth.uid()
      ) returning * into new_batch;

      training_day := d;
      while training_day <= end_day loop
        if extract(isodow from training_day)::integer <> 7 then
          insert into public.batch_training_dates(batch_id, training_date, starts_at, ends_at)
          values(new_batch.id, training_day,
            (training_day + time '08:00') at time zone 'Asia/Manila',
            (training_day + time '17:00') at time zone 'Asia/Manila');
        end if;
        training_day := training_day + 1;
      end loop;

      created_count := created_count + 1;
    end if;
    d := d + 1;
  end loop;

  return created_count;
end $$;
grant execute on function public.auto_open_training_batches(uuid, integer, integer) to authenticated;

-- 2) Create a batch — instructor / room / venue are OPTIONAL.
create or replace function public.create_training_batch(
  target_course uuid, target_partner_offer uuid, target_instructor_name text, target_instructor_email text,
  target_room_name text, target_starts_on date, target_ends_on date, target_daily_start time, target_daily_end time,
  target_mode text, target_venue text, target_capacity integer, target_enrollment_deadline timestamptz,
  target_publish boolean default true
) returns public.batches language plpgsql security definer set search_path = public as $$
declare result public.batches; course_row public.courses; instructor_row public.employees; room_row public.classrooms; training_day date; expected_end date; required_days integer; created_days integer := 0; start_dow integer;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into course_row from public.courses where id=target_course and active and delivery_type='In-House';
  if course_row.id is null then raise exception 'Batches are only available for New Wave STCW and In-House courses'; end if;
  if target_partner_offer is not null then raise exception 'Endorsed training center offers do not use New Wave batches'; end if;
  if target_capacity <> 24 then raise exception 'Every New Wave batch must have a capacity of 24 trainees'; end if;
  if target_enrollment_deadline >= target_starts_on::timestamptz + interval '1 day' then raise exception 'Enrollment deadline must be before training starts'; end if;
  required_days := greatest(1,ceil(coalesce(course_row.duration_days,1)))::integer;
  start_dow := extract(isodow from target_starts_on)::integer;
  if course_row.code='STPPDSPPS' and start_dow<>1 then raise exception 'Safety starts every Monday';
  elsif course_row.code='PSCMT' and start_dow<>2 then raise exception 'Crowd starts every Tuesday';
  elsif course_row.code='PSCMHBT' and start_dow<>4 then raise exception 'Crisis starts every Thursday';
  elsif course_row.code in ('UBT-PSSR','CCMI') and (start_dow=7 or (course_row.code='CCMI' and start_dow<>1)) then raise exception 'Select a valid Monday-Saturday start for this course';
  elsif course_row.code not in ('STPPDSPPS','PSCMT','PSCMHBT','UBT-PSSR','CCMI') and (
    (required_days=1 and start_dow=7) or (required_days=2 and start_dow not in (1,3,5)) or
    (required_days=3 and start_dow not in (1,4)) or (required_days>=4 and start_dow<>1)
  ) then raise exception 'The start date does not match the required weekday pattern for this course duration'; end if;
  training_day := target_starts_on;
  while created_days < required_days loop
    if extract(isodow from training_day)::integer <> 7 then created_days := created_days + 1; expected_end := training_day; end if;
    if created_days < required_days then training_day := training_day + 1; end if;
  end loop;
  if target_ends_on <> expected_end then raise exception 'End date must match the automatic course duration pattern'; end if;

  if nullif(trim(target_instructor_email),'') is not null then
    select * into instructor_row from public.employees where lower(work_email)=lower(trim(target_instructor_email)) and active limit 1;
    if instructor_row.id is null then
      insert into public.employees(employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,work_email)
      values(public.next_reference('EMP'),coalesce(nullif(trim(target_instructor_name),''),'Instructor'),'Instructor','Active',current_date,'Daily',0,lower(trim(target_instructor_email))) returning * into instructor_row;
    end if;
  end if;
  if nullif(trim(target_room_name),'') is not null then
    select * into room_row from public.classrooms where lower(name)=lower(trim(target_room_name)) and active limit 1;
    if room_row.id is null then
      insert into public.classrooms(name,venue,capacity) values(trim(target_room_name),nullif(trim(target_venue),''),24) returning * into room_row;
    elsif room_row.capacity < 24 then raise exception 'Selected room capacity must be at least 24'; end if;
  end if;

  insert into public.batches(
    batch_number, course_id, partner_offer_id, starts_on, ends_on, daily_start, daily_end,
    mode, venue, capacity, enrollment_deadline, published_at, created_by, classroom_id
  ) values (
    public.next_reference('BCH'), target_course, target_partner_offer, target_starts_on, target_ends_on,
    target_daily_start, target_daily_end, trim(target_mode), nullif(trim(target_venue), ''), target_capacity,
    target_enrollment_deadline, case when target_publish then now() else null end, auth.uid(), room_row.id
  ) returning * into result;

  training_day := target_starts_on;
  while training_day <= target_ends_on loop
    if extract(isodow from training_day)::integer <> 7 then
      if instructor_row.id is not null and room_row.id is not null then
        with inserted_date as (
          insert into public.batch_training_dates(batch_id,training_date,starts_at,ends_at)
          values(result.id,training_day,(training_day+target_daily_start) at time zone 'Asia/Manila',(training_day+target_daily_end) at time zone 'Asia/Manila') returning id
        ) insert into public.resource_assignments(batch_training_date_id,instructor_id,classroom_id)
          select id,instructor_row.id,room_row.id from inserted_date;
      else
        insert into public.batch_training_dates(batch_id,training_date,starts_at,ends_at)
        values(result.id,training_day,(training_day+target_daily_start) at time zone 'Asia/Manila',(training_day+target_daily_end) at time zone 'Asia/Manila');
      end if;
    end if;
    training_day := training_day + 1;
  end loop;

  if instructor_row.id is not null then
    insert into public.email_jobs(idempotency_key,template_code,recipient,variables)
    values('instructor-assignment:'||result.id,'instructor.schedule.updated',instructor_row.work_email,
      jsonb_build_object('instructor_name',instructor_row.complete_name,'course_name',course_row.name,'training_dates',target_starts_on||' to '||target_ends_on,'daily_time',target_daily_start||'–'||target_daily_end,'room_name',coalesce(room_row.name,''),'venue',coalesce(room_row.venue,'')));
    insert into public.email_jobs(idempotency_key,template_code,recipient,variables,scheduled_for)
    values('instructor-weekly:'||instructor_row.id||':'||date_trunc('week',target_starts_on::timestamp)::date,'instructor.weekly.schedule',instructor_row.work_email,
      jsonb_build_object('instructor_name',instructor_row.complete_name),date_trunc('week',target_starts_on::timestamp)+interval '4 days 08:00') on conflict(idempotency_key) do nothing;
  end if;

  insert into public.audit_logs(actor_id,actor_role,action,record_type,record_id,new_values)
  values(auth.uid(),'training_operations','batch.created','batch',result.id::text,to_jsonb(result));
  return result;
end $$;
grant execute on function public.create_training_batch(uuid, text, text, text, text, date, date, time, time, text, text, integer, timestamptz, boolean) to authenticated;

-- 3) Edit a batch — instructor / room / venue are OPTIONAL.
create or replace function public.update_training_batch(
  target_batch uuid, target_instructor_name text, target_instructor_email text, target_room_name text,
  target_venue text, target_daily_start time, target_daily_end time, target_mode text,
  target_enrollment_deadline timestamptz, target_publish boolean
) returns public.batches language plpgsql security definer set search_path = public as $$
declare batch_row public.batches; instructor_row public.employees; room_row public.classrooms; result public.batches;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into batch_row from public.batches where id = target_batch and active;
  if batch_row.id is null then raise exception 'Schedule not found'; end if;
  if batch_row.status = 'Cancelled' then raise exception 'Cancelled schedules cannot be edited'; end if;
  if target_enrollment_deadline >= batch_row.starts_on::timestamptz + interval '1 day' then raise exception 'Enrollment deadline must be before training starts'; end if;

  if nullif(trim(target_instructor_email), '') is not null then
    select * into instructor_row from public.employees where lower(work_email) = lower(trim(target_instructor_email)) and active limit 1;
    if instructor_row.id is null then
      insert into public.employees(employee_number, complete_name, position, employment_status, date_hired, pay_type, base_rate_centavos, work_email)
      values(public.next_reference('EMP'), coalesce(nullif(trim(target_instructor_name),''),'Instructor'), 'Instructor', 'Active', current_date, 'Daily', 0, lower(trim(target_instructor_email)))
      returning * into instructor_row;
    end if;
  end if;
  if nullif(trim(target_room_name), '') is not null then
    select * into room_row from public.classrooms where lower(name) = lower(trim(target_room_name)) and active limit 1;
    if room_row.id is null then
      insert into public.classrooms(name, venue, capacity) values(trim(target_room_name), nullif(trim(target_venue),''), 24) returning * into room_row;
    elsif room_row.capacity < 24 then raise exception 'Selected room capacity must be at least 24'; end if;
  end if;

  update public.batches set
    daily_start = target_daily_start, daily_end = target_daily_end, mode = trim(target_mode),
    venue = nullif(trim(target_venue), ''), classroom_id = coalesce(room_row.id, classroom_id), enrollment_deadline = target_enrollment_deadline,
    published_at = case when target_publish then coalesce(published_at, now()) else null end, updated_at = now()
  where id = target_batch returning * into result;

  update public.batch_training_dates set
    starts_at = (training_date + target_daily_start) at time zone 'Asia/Manila',
    ends_at = (training_date + target_daily_end) at time zone 'Asia/Manila'
  where batch_id = target_batch;

  if instructor_row.id is not null and room_row.id is not null then
    insert into public.resource_assignments(batch_training_date_id, instructor_id, classroom_id)
      select btd.id, instructor_row.id, room_row.id from public.batch_training_dates btd
      where btd.batch_id = target_batch
        and not exists (select 1 from public.resource_assignments ra where ra.batch_training_date_id = btd.id);
    update public.resource_assignments ra set instructor_id = instructor_row.id, classroom_id = room_row.id
      from public.batch_training_dates btd
      where ra.batch_training_date_id = btd.id and btd.batch_id = target_batch;
  end if;

  return result;
end $$;
grant execute on function public.update_training_batch(uuid, text, text, text, text, time, time, text, timestamptz, boolean) to authenticated;

commit;

-- ----- 202608080001_employee_charges -----
-- =====================================================================
-- Employee salary charges: an employee self-reports a charge against
-- themselves in MyHR (category + note, no amount). The Accounting Manager
-- then enters the peso amount — that entry activates the charge — and it
-- auto-deducts from the employee's next payroll, grouped as an "Others"
-- deduction line. The Accounting Manager can also input a charge directly.
--
-- Reuses the existing (previously unused) public.employee_charges table.
-- All writes happen through the service-role API; browsers only read.
-- Additive and idempotent.
-- =====================================================================

begin;

-- New per-charge fields. category = Rescheduling/Cancellation/Wrong Enrollment/Reprinting/Others.
alter table public.employee_charges add column if not exists category text;
alter table public.employee_charges add column if not exists note text;
alter table public.employee_charges add column if not exists filed_by uuid;
alter table public.employee_charges add column if not exists amount_set_by uuid;
alter table public.employee_charges add column if not exists activated_at timestamptz;
alter table public.employee_charges add column if not exists balance_centavos bigint;

-- A Pending charge exists before the Accounting Manager sets its amount, so the
-- amount is no longer required and defaults to 0.
alter table public.employee_charges alter column amount_centavos drop not null;
alter table public.employee_charges alter column amount_centavos set default 0;

-- Lifecycle: Pending (filed, awaiting amount) -> Active (amount set, deducting)
-- -> Settled (fully deducted) / Cancelled. New rows start Pending.
alter table public.employee_charges alter column status set default 'Pending';

alter table public.employee_charges enable row level security;

-- Staff may read charges; writes happen only through the service-role API.
drop policy if exists employee_charges_staff_read on public.employee_charges;
create policy employee_charges_staff_read on public.employee_charges
  for select using (public.has_staff_role());

commit;

-- ----- 202608090001_hr_benefits_contracts -----
-- =====================================================================
-- HR module completion: employment contracts + government-benefit records.
-- - employment_contracts: per-employee contract details (type, position, rate,
--   dates, status, notes). Details only — no file upload.
-- - benefit_records already exists (SSS/PhilHealth/Pag-IBIG/TIN reference +
--   optional contribution amount); this adds created_at + staff-read RLS.
-- Self clock-in writes to the existing employee_attendance table (no change).
-- All writes go through the service-role API; staff read via RLS. Idempotent.
-- =====================================================================

begin;

create table if not exists public.employment_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  contract_type text not null,
  position text,
  rate_centavos bigint,
  starts_on date not null,
  ends_on date,
  status text not null default 'Active',
  notes text,
  created_at timestamptz not null default now()
);

alter table public.employment_contracts enable row level security;
drop policy if exists employment_contracts_staff_read on public.employment_contracts;
create policy employment_contracts_staff_read on public.employment_contracts
  for select using (public.has_staff_role());

-- benefit_records exists from the base schema; make it readable by staff and
-- give it a stable ordering column.
alter table public.benefit_records add column if not exists created_at timestamptz not null default now();
alter table public.benefit_records enable row level security;
drop policy if exists benefit_records_staff_read on public.benefit_records;
create policy benefit_records_staff_read on public.benefit_records
  for select using (public.has_staff_role());

commit;

-- ----- 202608100001_expense_channel_reference -----
-- =====================================================================
-- Expenses: payment channel (Cash / GCash / Unionbank / Cheque / PSBank /
-- Other) + a reference number, for the expenses report and daily summary.
-- Additive and idempotent. Existing expenses RLS/policies are unchanged.
-- =====================================================================

begin;

alter table public.expenses add column if not exists payment_channel text;
alter table public.expenses add column if not exists reference_number text;

commit;

-- ----- 202608110001_auto_open_week -----
-- =====================================================================
-- Weekly auto-open: open + PUBLISH in-house batches for an arbitrary date
-- range (used for a single week). Same generation rules as the monthly
-- auto_open_training_batches, just bounded to [range_start, range_end].
-- New function name (no signature conflict) — safe additive install.
-- =====================================================================

begin;

create or replace function public.auto_open_training_batches_range(
  target_course uuid, range_start date, range_end date
) returns integer language plpgsql security definer set search_path = public as $$
declare
  course_row public.courses;
  required_days integer;
  d date; dow integer; ok boolean;
  training_day date; created_days integer; end_day date;
  new_batch public.batches;
  created_count integer := 0;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  select * into course_row from public.courses where id = target_course and active and delivery_type = 'In-House';
  if course_row.id is null then raise exception 'Batches are only available for New Wave STCW and In-House courses'; end if;
  if range_end < range_start then raise exception 'range_end must be on or after range_start'; end if;
  required_days := greatest(1, ceil(coalesce(course_row.duration_days, 1)))::integer;

  d := range_start;
  while d <= range_end loop
    dow := extract(isodow from d)::integer;
    if course_row.code = 'STPPDSPPS' then ok := (dow = 1);
    elsif course_row.code = 'PSCMT' then ok := (dow = 2);
    elsif course_row.code = 'PSCMHBT' then ok := (dow = 4);
    elsif course_row.code = 'CCMI' then ok := (dow = 1);
    elsif course_row.code = 'UBT-PSSR' then ok := (dow between 1 and 6);
    elsif required_days = 1 then ok := (dow <> 7);
    elsif required_days = 2 then ok := (dow in (1, 3, 5));
    elsif required_days = 3 then ok := (dow in (1, 4));
    else ok := (dow = 1);
    end if;

    if ok and not exists (select 1 from public.batches where course_id = target_course and starts_on = d and active) then
      training_day := d; created_days := 0; end_day := d;
      while created_days < required_days loop
        if extract(isodow from training_day)::integer <> 7 then created_days := created_days + 1; end_day := training_day; end if;
        if created_days < required_days then training_day := training_day + 1; end if;
      end loop;

      insert into public.batches(
        batch_number, course_id, partner_offer_id, starts_on, ends_on, daily_start, daily_end,
        mode, venue, capacity, enrollment_deadline, published_at, created_by
      ) values (
        public.next_reference('BCH'), target_course, null, d, end_day, time '08:00', time '17:00',
        'In-person', null, 24, d::timestamptz, now(), auth.uid()
      ) returning * into new_batch;

      training_day := d;
      while training_day <= end_day loop
        if extract(isodow from training_day)::integer <> 7 then
          insert into public.batch_training_dates(batch_id, training_date, starts_at, ends_at)
          values(new_batch.id, training_day,
            (training_day + time '08:00') at time zone 'Asia/Manila',
            (training_day + time '17:00') at time zone 'Asia/Manila');
        end if;
        training_day := training_day + 1;
      end loop;

      created_count := created_count + 1;
    end if;
    d := d + 1;
  end loop;

  return created_count;
end $$;
grant execute on function public.auto_open_training_batches_range(uuid, date, date) to authenticated;

commit;

-- ----- 202608120001_multi_course_registration -----
-- =====================================================================
-- Public registration: allow returning applicants + up to 5 courses per submit.
-- - A returning trainee is auto-detected by SRN (then email, then mobile) and
--   REUSED instead of being rejected as a duplicate — new enrollments are added
--   to the same trainee. This is the "resend / submit again" fix.
-- - target_batch (single) becomes target_batches (uuid[], 1..5). Each valid
--   batch becomes one enrollment; batches the trainee is already enrolled in are
--   skipped. Signature changes, so the old function is dropped first.
-- =====================================================================

begin;

-- Drop every existing overload (signature changes from target_batch uuid).
do $$
declare r record;
begin
  for r in
    select oid::regprocedure as sig from pg_proc
    where proname = 'submit_public_registration' and pronamespace = 'public'::regnamespace
  loop execute 'drop function ' || r.sig || ' cascade'; end loop;
end $$;

create or replace function public.submit_public_registration(
  target_first_name text,target_middle_name text,target_last_name text,target_suffix text,target_srn text,target_email text,target_address text,target_mobile text,
  target_place_of_birth text,target_birthdate date,target_rank text,target_company text,target_emergency_name text,target_emergency_mobile text,
  target_batches uuid[],target_terms_version text,target_ip_hash text,target_marketing_agency uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  batch_row public.batches; course_row public.courses; trainee_row public.trainees; existing_trainee public.trainees;
  enrollment_row public.enrollments; registration_ref text; bid uuid;
  enrollment_ids uuid[] := array[]::uuid[]; is_new boolean := false;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  if not exists(select 1 from public.terms_documents where version=target_terms_version and active and effective_from<=current_date) then raise exception 'Terms version is not active'; end if;
  if target_batches is null or coalesce(array_length(target_batches,1),0) < 1 then raise exception 'Select at least one schedule'; end if;
  if array_length(target_batches,1) > 5 then raise exception 'You can select up to 5 courses per submission'; end if;

  -- Reuse a returning applicant: match on SRN first, then email, then mobile.
  select * into existing_trainee from public.trainees
    where (nullif(trim(target_srn),'') is not null and srn = trim(target_srn))
       or lower(email) = lower(trim(target_email))
       or mobile = trim(target_mobile)
    order by case when nullif(trim(target_srn),'') is not null and srn = trim(target_srn) then 0 else 1 end
    limit 1;

  if existing_trainee.id is not null then
    trainee_row := existing_trainee;
    registration_ref := trainee_row.registration_reference;
  else
    registration_ref := public.next_reference('REG');
    insert into public.trainees(trainee_number,registration_reference,legal_first_name,legal_middle_name,legal_last_name,suffix,birthdate,place_of_birth,address,mobile,email,srn,rank,company,emergency_contact,marketing_agency_id,terms_version,terms_accepted_at,terms_acceptance_ip_hash,account_state)
    values(public.next_reference('NWM'),registration_ref,trim(target_first_name),nullif(trim(target_middle_name),''),trim(target_last_name),nullif(trim(target_suffix),''),target_birthdate,trim(target_place_of_birth),trim(target_address),trim(target_mobile),lower(trim(target_email)),nullif(trim(target_srn),''),nullif(trim(target_rank),''),nullif(trim(target_company),''),jsonb_build_object('name',trim(target_emergency_name),'mobile',trim(target_emergency_mobile)),target_marketing_agency,target_terms_version,now(),target_ip_hash,'Pending') returning * into trainee_row;
    is_new := true;
  end if;

  foreach bid in array target_batches loop
    select * into batch_row from public.batches where id=bid for update;
    if batch_row.id is null or batch_row.status<>'Open' or batch_row.published_at is null or batch_row.enrollment_deadline<=now() or batch_row.starts_on<=current_date or batch_row.confirmed_count>=batch_row.capacity then
      raise exception 'One of the selected schedules is no longer available';
    end if;
    -- Skip a batch the trainee is already actively enrolled in (idempotent re-submit).
    if exists(select 1 from public.enrollments where trainee_id=trainee_row.id and batch_id=bid and enrollment_status<>'Cancelled') then
      continue;
    end if;
    select * into course_row from public.courses where id=batch_row.course_id and active;
    insert into public.enrollments(enrollment_number,trainee_id,course_id,batch_id,enrollment_status,source,selling_price_centavos,rebate_centavos,partner_payable_centavos,rate_snapshot)
    values(public.next_reference('ENR'),trainee_row.id,course_row.id,batch_row.id,'Enrolled','Public registration',course_row.standard_price_centavos,0,0,jsonb_build_object('course_code',course_row.code,'course_name',course_row.name,'selling_price_centavos',course_row.standard_price_centavos,'captured_at',now())) returning * into enrollment_row;
    enrollment_ids := enrollment_ids || enrollment_row.id;
    update public.batches set confirmed_count=confirmed_count+1,status=case when confirmed_count+1>=capacity then 'Full' else status end,updated_at=now() where id=batch_row.id;
  end loop;

  if coalesce(array_length(enrollment_ids,1),0) = 0 then
    raise exception 'You are already enrolled in the selected schedule(s).';
  end if;

  insert into public.audit_logs(action,record_type,record_id,new_values,request_ip_hash)
  values('registration.public_submitted','trainee',trainee_row.id::text,jsonb_build_object('registration_reference',registration_ref,'enrollment_ids',to_jsonb(enrollment_ids),'terms_version',target_terms_version,'reused_trainee',not is_new),target_ip_hash);

  return jsonb_build_object('registration_reference',registration_ref,'trainee_id',trainee_row.id,'enrollment_ids',to_jsonb(enrollment_ids),'email',trainee_row.email,'complete_name',concat_ws(' ',trainee_row.legal_first_name,trainee_row.legal_last_name));
end $$;
grant execute on function public.submit_public_registration(text,text,text,text,text,text,text,text,text,date,text,text,text,text,uuid[],text,text,uuid) to service_role;

commit;

-- Refresh the PostgREST schema cache so recreated functions are visible immediately.
notify pgrst, 'reload schema';
