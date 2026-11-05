-- =====================================================================
-- FINISH CATCH-UP (dynamic grants; run AFTER 040001-060001 already committed).
-- Recreates the batch functions + applies 080001..120001. Grants dynamically,
-- so the 070001 static-grant signature bug (uuid,text vs uuid,uuid) cannot recur.
-- Idempotent — safe to run more than once.
-- =====================================================================

-- ----- 202608070001 (batch functions) -----
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

do $g$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
    where proname in ('create_training_batch','update_training_batch','auto_open_training_batches')
      and pronamespace='public'::regnamespace
  loop execute 'grant execute on function '||r.sig||' to authenticated'; end loop;
end $g$;
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
begin;
set local check_function_bodies = off;
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

do $g$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
    where proname='submit_public_registration' and pronamespace='public'::regnamespace
  loop execute 'grant execute on function '||r.sig||' to service_role'; end loop;
end $g$;
commit;

notify pgrst, 'reload schema';
