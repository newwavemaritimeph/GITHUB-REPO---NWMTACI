-- STEP 2 of 2 — PERMANENTLY ERASES the test-run enrollments (owner, 16 Oct 2026).
-- Run step 1 (preview) first. This cannot be undone.
--
-- Erases: every trainee, enrollment and everything attached to them — payments,
-- receipts, invoices, proofs, charges, requests, requirement checks, TARs,
-- certificates and photos, Registration Nos., instructions, attendance,
-- agency rebates, deliveries, MISMO submissions and completion records — and the
-- trainees' portal logins.
-- Keeps: staff accounts, courses, batches (seat counts reset to 0), partners and
-- rebates, certificates recorded before the portal, expenses, cashier closings,
-- settings and the audit log (a 'system.test_reset' entry records the reset).
-- Numbering starts over: ENR, NWM, AR, INV, PAY, REG, REQ and DR from 000001,
-- NWMTACI from 0000001, and each course's Certificate No. / Registration No.
-- back to the first number the portal gave (the starting number set in Numbering).
--
-- Everything runs in one transaction: if any step fails, nothing is erased.

begin;

-- 1. Remember what to rewind and which logins to remove, before erasing.
create temp table _cert_rewind on commit drop as
select s.course_id, min(substring(x.num from length(s.prefix) + 1)::bigint) as first_no
from public.certificate_series s
join (
  select e.course_id, e.certificate_number as num from public.enrollments e where e.certificate_number is not null
  union all
  select e.course_id, c.certificate_number from public.certificates c join public.enrollments e on e.id = c.enrollment_id where c.certificate_number is not null
) x on x.course_id = s.course_id
where coalesce(s.prefix, '') <> '' and x.num like s.prefix || '%' and substring(x.num from length(s.prefix) + 1) ~ '^\d{1,15}$'
group by s.course_id;

create temp table _reg_rewind on commit drop as
select s.course_id, min(case when s.reg_style = 'month-number'
    then nullif(substring(r.registration_number from '-(\d+)$'), '')::bigint
    else nullif(substring(r.registration_number from '^' || s.reg_prefix || '(\d+)-'), '')::bigint end) as first_no
from public.certificate_series s
join public.trainee_registration_numbers r on r.course_id = s.course_id
where s.reg_next is not null
group by s.course_id;

-- New Wave-wide Registration No. (courses without their own series).
create temp table _global_reg_rewind on commit drop as
select min(nullif(substring(c.registration_number from '^' || n.reg_prefix || '(\d+)-'), '')::bigint) as first_no
from public.certificates c cross join public.certificate_number_settings n
where c.registration_number is not null
  and not exists (select 1 from public.trainee_registration_numbers r where r.registration_number = c.registration_number);

create temp table _trainee_logins on commit drop as
select t.profile_id as id from public.trainees t
where t.profile_id is not null
  and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = t.profile_id and r.is_staff);

create temp table _counts (t text, n bigint) on commit drop;

-- 2. Erase, children first. Immutable-record guards are lifted only for this transaction.
do $$
declare
  t text;
  wipe text[] := array[
    'attendance_events','make_up_assignments','attendance_tokens','attendance_records',
    'certificate_release_events','certificate_photos','certificates',
    'classroom_invitations','instruction_acknowledgments','training_instructions','training_feedback',
    'enrollment_requirement_checks','request_events','delivery_requests','refunds_and_reversals',
    'payment_reconciliations','receipts','invoices','payment_allocations','agency_rebates',
    'enrollment_requests','enrollment_charges','admission_records','trainee_registration_numbers',
    'mismo_submissions','training_completion_records',
    'payments','payment_proofs','enrollments','trainees'];
  c bigint;
begin
  foreach t in array wipe loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I disable trigger user', t);
    end if;
  end loop;

  -- Records that stay but point at test enrollments or payments.
  if to_regclass('public.legacy_certificates') is not null then update public.legacy_certificates set enrollment_id = null where enrollment_id is not null; end if;
  if to_regclass('public.account_reconciliation_items') is not null then update public.account_reconciliation_items set matched_payment_id = null where matched_payment_id is not null; end if;
  if to_regclass('public.payables') is not null then delete from public.payables where enrollment_id is not null; end if;

  foreach t in array wipe loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I', t);
      get diagnostics c = row_count;
      insert into _counts values (t, c);
    end if;
  end loop;

  foreach t in array wipe loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable trigger user', t);
    end if;
  end loop;
end $$;

-- 3. Seats back to zero; full batches reopen.
update public.batches set confirmed_count = 0, status = case when status = 'Full' then 'Open' else status end
where confirmed_count <> 0 or status = 'Full';

-- 4. Numbering starts over.
delete from public.id_sequences where code in ('ENR','NWM','AR','INV','PAY','REG','REQ','DR');
alter sequence if exists public.application_number_seq restart with 1;
update public.certificate_series s set next_number = r.first_no from _cert_rewind r where r.course_id = s.course_id and r.first_no > 0;
update public.certificate_series s set reg_next = r.first_no from _reg_rewind r where r.course_id = s.course_id and r.first_no > 0;
update public.certificate_number_settings n set reg_last = g.first_no - 1 from _global_reg_rewind g where g.first_no is not null and g.first_no > 0;

-- 5. Trainee portal logins (a login the audit log still names is kept and counted).
do $$
declare p uuid; removed int := 0; kept int := 0;
begin
  for p in select id from _trainee_logins loop
    begin
      delete from auth.users where id = p;
      removed := removed + 1;
    exception when others then
      kept := kept + 1;
    end;
  end loop;
  insert into _counts values ('trainee portal logins removed', removed), ('trainee portal logins kept (named in the audit log)', kept);
end $$;

-- 6. Record the reset in the audit log.
insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values, reason)
select null, 'admin', 'system.test_reset', 'system', 'test-run-' || to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD'),
  jsonb_object_agg(t, n), 'Owner: remove all test-run enrollments (16 Oct 2026)'
from _counts;

select t as "Erased", n as "Rows" from _counts order by 1;

commit;
