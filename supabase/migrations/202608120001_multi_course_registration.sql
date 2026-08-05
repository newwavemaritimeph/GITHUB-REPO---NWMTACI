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
