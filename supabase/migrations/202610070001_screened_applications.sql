-- =====================================================================
-- Screened applications (7 Oct 2026, owner instruction).
-- New registrations come only through the website and are screened before
-- they count as enrolled:
-- 1. submit_public_registration now creates enrollments as 'Pending' (the seat
--    on the chosen batch is still held). Existing rows are not touched.
-- 2. enrollment_requirement_checks: an append-only staff checklist of the three
--    requirements (valid ID / passport, seaman's book / SRN, medical
--    certificate). The latest row per enrollment and requirement wins.
-- 3. enroll_screened_application: moves a Pending application to 'Enrolled'
--    only when all three requirements are verified and at least one verified,
--    valid payment is allocated to it.
-- Additive only; safe to apply before or after the portal deploy.
-- =====================================================================

begin;

-- 1. Website applications start as Pending (same signature and body as
--    202608120001 apart from the status and the duplicate message).
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
    -- Skip a batch the trainee already has an active application for (idempotent re-submit).
    if exists(select 1 from public.enrollments where trainee_id=trainee_row.id and batch_id=bid and enrollment_status<>'Cancelled') then
      continue;
    end if;
    select * into course_row from public.courses where id=batch_row.course_id and active;
    insert into public.enrollments(enrollment_number,trainee_id,course_id,batch_id,enrollment_status,source,selling_price_centavos,rebate_centavos,partner_payable_centavos,rate_snapshot)
    values(public.next_reference('ENR'),trainee_row.id,course_row.id,batch_row.id,'Pending','Public registration',course_row.standard_price_centavos,0,0,jsonb_build_object('course_code',course_row.code,'course_name',course_row.name,'selling_price_centavos',course_row.standard_price_centavos,'captured_at',now())) returning * into enrollment_row;
    enrollment_ids := enrollment_ids || enrollment_row.id;
    update public.batches set confirmed_count=confirmed_count+1,status=case when confirmed_count+1>=capacity then 'Full' else status end,updated_at=now() where id=batch_row.id;
  end loop;

  if coalesce(array_length(enrollment_ids,1),0) = 0 then
    raise exception 'You already have an application for the selected schedule(s).';
  end if;

  insert into public.audit_logs(action,record_type,record_id,new_values,request_ip_hash)
  values('registration.public_submitted','trainee',trainee_row.id::text,jsonb_build_object('registration_reference',registration_ref,'enrollment_ids',to_jsonb(enrollment_ids),'terms_version',target_terms_version,'reused_trainee',not is_new),target_ip_hash);

  return jsonb_build_object('registration_reference',registration_ref,'trainee_id',trainee_row.id,'enrollment_ids',to_jsonb(enrollment_ids),'email',trainee_row.email,'complete_name',concat_ws(' ',trainee_row.legal_first_name,trainee_row.legal_last_name));
end $$;
grant execute on function public.submit_public_registration(text,text,text,text,text,text,text,text,text,date,text,text,text,text,uuid[],text,text,uuid) to service_role;


-- 2. Requirement checklist (append-only; corrections are new rows).
create table if not exists public.enrollment_requirement_checks (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  requirement text not null check (requirement in ('valid_id','seamans_book','medical_certificate')),
  status text not null check (status in ('Verified','Rejected')),
  remarks text,
  checked_by uuid references public.profiles(id),
  checked_at timestamptz not null default now(),
  check (status = 'Verified' or nullif(trim(remarks),'') is not null)
);
create index if not exists enrollment_requirement_checks_latest_idx
  on public.enrollment_requirement_checks(enrollment_id, requirement, checked_at desc);
alter table public.enrollment_requirement_checks enable row level security;
drop trigger if exists enrollment_requirement_checks_immutable on public.enrollment_requirement_checks;
create trigger enrollment_requirement_checks_immutable before update or delete on public.enrollment_requirement_checks
  for each row execute function public.prevent_immutable_change();

-- 3. Enroll a screened application. Every rule is re-checked here; the portal's
--    "ready" state is only a hint.
create or replace function public.enroll_screened_application(target_enrollment uuid, actor uuid)
returns public.enrollments language plpgsql security definer set search_path=public as $$
declare
  row_ public.enrollments; batch_row public.batches;
  missing text[]; payment_ids uuid[]; result public.enrollments;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  select * into row_ from public.enrollments where id=target_enrollment for update;
  if row_.id is null then raise exception 'Application not found'; end if;
  if row_.enrollment_status<>'Pending' then raise exception 'Only a Pending application can be enrolled (this one is %)', row_.enrollment_status; end if;
  if row_.batch_id is null then raise exception 'The application has no schedule yet'; end if;
  select * into batch_row from public.batches where id=row_.batch_id;
  if batch_row.status='Cancelled' then raise exception 'The chosen schedule was cancelled'; end if;

  select array_agg(r.label order by r.ord) into missing
  from (values ('valid_id','Valid ID / passport',1),('seamans_book','Seaman''s book / SRN',2),('medical_certificate','Medical certificate',3)) as r(code,label,ord)
  where coalesce((select c.status from public.enrollment_requirement_checks c
                  where c.enrollment_id=row_.id and c.requirement=r.code
                  order by c.checked_at desc limit 1),'')<>'Verified';
  if missing is not null then raise exception 'Not verified yet: %', array_to_string(missing, ', '); end if;

  select array_agg(p.id) into payment_ids
  from public.payment_allocations a join public.payments p on p.id=a.payment_id
  where a.enrollment_id=row_.id and p.verification_state='Verified' and p.valid;
  if payment_ids is null then raise exception 'No verified payment yet'; end if;

  update public.enrollments set enrollment_status='Enrolled', updated_at=now() where id=row_.id returning * into result;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values(actor, 'registration', 'application.enrolled', 'enrollment', row_.id::text,
    jsonb_build_object('payment_ids', to_jsonb(payment_ids),
      'checks', (select jsonb_agg(jsonb_build_object('requirement',c.requirement,'status',c.status,'checked_by',c.checked_by,'checked_at',c.checked_at))
                 from (select distinct on (requirement) * from public.enrollment_requirement_checks where enrollment_id=row_.id order by requirement, checked_at desc) c)));
  return result;
end $$;
revoke all on function public.enroll_screened_application(uuid,uuid) from public;
grant execute on function public.enroll_screened_application(uuid,uuid) to service_role;

commit;
