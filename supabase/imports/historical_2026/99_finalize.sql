-- STEP 99 (FAST) — run LAST, after 00_setup + all data files (01..05).
-- Idempotent: de-dupes trainees, keys enrollments by NWMTACI ref, drops the stage table.
-- Indexed + per-person inserts, so it finishes quickly instead of looping row-by-row.

begin;

-- Speed: index the staging table so per-person work is cheap.
create index if not exists hist_stage_pk_idx  on public.hist_import_stage(person_key);
create index if not exists hist_stage_ref_idx on public.hist_import_stage(ref);

-- 1) Resolve course_id (in-house by code, partner by name, else the placeholder).
update public.hist_import_stage i set course_id=c.id from public.courses c
 where i.course_match_kind='code' and c.code=i.course_key and c.delivery_type='In-House';
update public.hist_import_stage i set course_id=c.id from public.courses c
 where i.course_match_kind='name' and lower(c.name)=lower(i.course_key) and i.course_id is null;
update public.hist_import_stage set course_id=(select id from public.courses where code='HIST-UNMAPPED' and delivery_type='In-House')
 where course_id is null;

-- 2) Trainees + enrollments, one person at a time (dedup priority: SRN, then email, then mobile).
do $$
declare r record; tid uuid; new_tr int:=0; existing_tr int:=0;
begin
  for r in
    select distinct on (person_key) * from public.hist_import_stage
    where person_key is not null and person_key<>'' order by person_key, ref
  loop
    select id into tid from public.trainees
      where (nullif(r.srn,'') is not null and srn=r.srn)
         or (nullif(r.email,'') is not null and lower(email)=lower(r.email))
         or (nullif(r.mobile,'') is not null and regexp_replace(coalesce(mobile,''),'\D','','g')=r.mobile)
      limit 1;
    if tid is null then
      insert into public.trainees(trainee_number,registration_reference,legal_first_name,legal_middle_name,legal_last_name,
        birthdate,place_of_birth,sex,address,mobile,email,srn,rank,company,emergency_contact,account_state,registered_at)
      values('HIST-'||coalesce(nullif(r.ref,''),r.person_key), nullif(r.ref,''),
        coalesce(nullif(r.first_name,''),'(unknown)'), nullif(r.middle_name,''), coalesce(nullif(r.last_name,''),'(unknown)'),
        coalesce(r.birthdate, date '1900-01-01'), nullif(r.place_of_birth,''), nullif(r.sex,''), nullif(r.address,''),
        coalesce(nullif(r.mobile,''),'n/a'),
        coalesce(nullif(r.email,''),'HIST-'||coalesce(nullif(r.ref,''),r.person_key)||'@no-email.local'),
        nullif(r.srn,''), nullif(r.rank,''), nullif(r.company,''), '{}'::jsonb, 'Active', now())
      on conflict (trainee_number) do nothing returning id into tid;
      if tid is null then select id into tid from public.trainees where trainee_number='HIST-'||coalesce(nullif(r.ref,''),r.person_key); end if;
      new_tr:=new_tr+1;
    else existing_tr:=existing_tr+1; end if;

    -- enrollments for THIS person only (indexed by person_key; no full-table scan)
    insert into public.enrollments(enrollment_number,trainee_id,course_id,batch_id,enrollment_status,source,
      selling_price_centavos,rebate_centavos,partner_payable_centavos,rate_snapshot,created_at)
    select coalesce(nullif(s.ref,''),'HIST-ENR-'||md5(s.person_key||coalesce(s.course_key,'')||coalesce(s.schedule,''))),
      tid, s.course_id, null, s.enrollment_status, 'Historical import (Jan-Jul 8 2026)',
      coalesce((select standard_price_centavos from public.courses where id=s.course_id),0), 0, 0,
      jsonb_build_object('historical',true,'source_reference',s.ref,'course_text',s.course_text,
        'course_matched',(s.course_match_kind<>'unmapped'),'schedule_text',s.schedule,'training_center',s.training_center,
        'referred_by',s.referred_by,'payment_status',s.payment_status,'amount_paid_centavos',s.amount_centavos,
        'system_status',s.system_status,'form_status',s.status,'captured_at',now()), now()
    from public.hist_import_stage s
    where s.person_key = r.person_key
    on conflict (enrollment_number) do nothing;
  end loop;
  raise notice 'Historical import: % new trainees, % matched existing', new_tr, existing_tr;
end $$;

drop table if exists public.hist_import_stage;

-- Post-import summary.
select 'historical trainees'    as metric, count(*)::text as value from public.trainees where trainee_number like 'HIST-%'
union all
select 'historical enrollments', count(*)::text from public.enrollments where source='Historical import (Jan-Jul 8 2026)'
union all
select 'unmapped-course enrollments',
  count(*)::text from public.enrollments e join public.courses c on c.id=e.course_id
  where e.source='Historical import (Jan-Jul 8 2026)' and c.code='HIST-UNMAPPED';

commit;

-- UNDO (removes everything this import added):
--   begin;
--   delete from public.enrollments where source='Historical import (Jan-Jul 8 2026)';
--   delete from public.trainees where trainee_number like 'HIST-%';
--   delete from public.courses c where c.code='HIST-UNMAPPED'
--     and not exists (select 1 from public.enrollments e where e.course_id=c.id);
--   commit;
