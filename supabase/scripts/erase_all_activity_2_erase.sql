-- STEP 2 of 2 — PERMANENTLY ERASES all trainee and money activity (owner, 29 Oct 2026). Cannot be undone.
-- Run step 1 (preview) first, and run migration 202610290065 (batch numbers) BEFORE this script.
--
-- Erases: every trainee and enrollment and everything attached (requirements, requests, charges, TARs,
--   instructions, post-test attempts, feedback, deliveries, MISMO lists), every payment, receipt, invoice,
--   proof, reconciliation, billing statement and company payment, every expense, voucher, requisition,
--   payable, other income and cashier opening/closing, every certificate and photo, every batch with its
--   training dates, rooms/instructor assignments and attendance, notifications and queued emails, and the
--   trainees' portal logins.
-- Keeps: courses, categories, classrooms and default rooms, instructors and accreditations, employees, staff
--   accounts and roles, partners, offers, agencies and rebate rates, payment channels, fee list, expense /
--   income / requisition categories, all templates, certificate numbering setup, post-tests, holidays,
--   settings, Google connection, announcements, HR and payroll, inventory, legacy certificates, audit log.
-- Numbering starts over: NWM, REG, ENR, AR, INV, PAY, REQ, DR, ER, CV, INC, RQ, BCH from 000001,
--   NWMTACI from 0000001, Billing Statement from 29, each course's Certificate No. / Registration No. back to
--   the first number the erased certificates used. The STCW batch series (26-609-139 …) is not touched.
-- Storage files (payment-proofs, certificate-photos buckets) and Google Drive files are not removed by SQL.
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

create temp table _global_reg_rewind on commit drop as
select min(nullif(substring(c.registration_number from '^' || n.reg_prefix || '(\d+)-'), '')::bigint) as first_no
from public.certificates c cross join public.certificate_number_settings n
where c.registration_number is not null
  and not exists (select 1 from public.trainee_registration_numbers r where r.registration_number = c.registration_number);

create temp table _trainee_logins on commit drop as
select t.profile_id as id from public.trainees t
where t.profile_id is not null
  and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = t.profile_id and r.is_staff)
  and not exists (select 1 from public.employees e where e.profile_id = t.profile_id);

create temp table _counts (t text, n bigint) on commit drop;

-- 2. Erase. Immutable-record guards are lifted only inside this transaction. Tables are emptied in passes:
--    a table still referenced by another is retried on the next pass, so the order needs no guessing.
do $$
declare
  t text;
  c bigint;
  pass int;
  left_over text[];
  wipe text[] := array[
    'trainees','enrollments','enrollment_requests','request_events','enrollment_requirement_checks',
    'enrollment_charges','agency_rebates','admission_records','trainee_registration_numbers',
    'training_instructions','instruction_acknowledgments','training_feedback','post_test_attempts',
    'classroom_invitations','delivery_requests','mismo_submissions','training_completion_records',
    'payments','payment_allocations','receipts','invoices','payment_proofs','refunds_and_reversals','payment_reconciliations',
    'company_payments','billing_statements','billing_statement_voids','other_income','other_income_rebates','center_payment_items',
    'expenses','expense_vouchers','expense_reprint_requests','requisitions','payables','account_reconciliation_items',
    'cashier_openings','cashier_closings',
    'certificates','certificate_release_events','certificate_photos','certificate_scans',
    'batches','batch_training_dates','resource_assignments','batch_resources',
    'attendance_sessions','attendance_records','attendance_events','attendance_tokens','make_up_assignments',
    'notifications','email_jobs','email_logs'];
  todo text[] := '{}';
begin
  foreach t in array wipe loop
    if to_regclass('public.' || t) is not null then
      todo := todo || t;
      execute format('select count(*) from public.%I', t) into c;
      insert into _counts values (t, c);
      execute format('alter table public.%I disable trigger user', t);
    end if;
  end loop;

  -- Kept records that point at erased ones.
  if to_regclass('public.legacy_certificates') is not null then
    update public.legacy_certificates set enrollment_id = null where enrollment_id is not null;
  end if;
  update public.certificate_number_pool p set state = 'Available', assigned_at = null
    where exists (select 1 from public.certificates c where c.number_pool_id = p.id);

  for pass in 1..12 loop
    left_over := '{}';
    foreach t in array todo loop
      begin
        execute format('delete from public.%I', t);
      exception when foreign_key_violation then
        left_over := left_over || t;
      end;
    end loop;
    todo := left_over;
    exit when cardinality(todo) = 0;
  end loop;
  if cardinality(todo) > 0 then
    raise exception 'Could not empty: % (another table still points at them). Nothing was erased.', array_to_string(todo, ', ');
  end if;

  foreach t in array wipe loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable trigger user', t);
    end if;
  end loop;
end $$;

-- 3. Numbering starts over.
delete from public.id_sequences where code in ('NWM','REG','ENR','AR','INV','PAY','REQ','DR','ER','CV','INC','RQ','BCH');
alter sequence if exists public.application_number_seq restart with 1;
alter sequence if exists public.billing_statement_seq restart with 29;
update public.certificate_series s set next_number = r.first_no from _cert_rewind r where r.course_id = s.course_id and r.first_no > 0;
update public.certificate_series s set reg_next = r.first_no from _reg_rewind r where r.course_id = s.course_id and r.first_no > 0;
update public.certificate_number_settings n set reg_last = g.first_no - 1 from _global_reg_rewind g where g.first_no is not null and g.first_no > 0;

-- 4. Trainee portal logins (a login still named elsewhere, e.g. in the audit log, is kept and counted).
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
  insert into _counts values ('trainee portal logins removed', removed), ('trainee portal logins kept (still referenced)', kept);
end $$;

-- 5. Record the erase in the audit log.
insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values, reason)
select null, 'admin', 'system.reset', 'system', 'erase-all-' || to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD'),
  jsonb_object_agg(t, n), 'Owner: remove all trainee entries, vouchers and receipts; keep courses, classrooms, instructors, categories (29 Oct 2026)'
from _counts;

select t as "Erased", n as "Rows" from _counts order by n desc, t;

commit;
