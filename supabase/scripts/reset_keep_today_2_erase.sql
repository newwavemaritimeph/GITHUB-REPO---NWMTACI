-- =====================================================================
-- STEP 2 of 2: ERASE. Run step 1 first. One transaction: if any step fails, nothing is erased.
-- Every erased row is first copied into the schema reset_backup_2026_11_09 (not reachable from the portal or the
-- internet). To undo, ask for the restore script. When sure, remove the copy with:
--   drop schema reset_backup_2026_11_09 cascade;
-- Reset all entries made before 9 Nov 2026, keep today's (owner, 9 Nov 2026).
-- Erases: trainees registered before today with nothing made today, with everything attached (enrollments,
--   payments, receipts, TARs, charges, requests, certificates and photos, instructions, post-tests, feedback,
--   deliveries, MISMO entries) and their portal logins; and every voucher (expense), other income, company
--   payment, Company Charge statement, service invoice, cash drawer opening and closing, reconciliation and
--   requisition dated before today.
-- Keeps: today's entries; trainees with anything made today, whole, with their older records too; anything
--   a today's entry points at; courses, batches and schedules, rooms, instructors, staff, settings, templates,
--   numbering (numbers continue, nothing starts over), emails sent, the audit log.
-- Storage files (proof screenshots, photos) and Google Drive files are not removed by SQL.
-- =====================================================================

begin;

create schema if not exists reset_backup_2026_11_09;
revoke all on schema reset_backup_2026_11_09 from public, anon, authenticated;

-- What counts as today: anything made from 9 Nov 2026, 12:00 AM Manila time.
drop table if exists pg_temp._cut, pg_temp._keep, pg_temp._plan, pg_temp._counts, pg_temp._touched, pg_temp._logins;
create temp table _cut as select timestamptz '2026-11-09 00:00:00+08' as at, date '2026-11-09' as on_date;
create temp table _keep (id uuid primary key);
create temp table _plan (t text not null, cond text not null);
create temp table _counts (t text not null, n bigint not null);
create temp table _touched (t text primary key);
create temp table _logins (id uuid primary key);

-- Trainees who stay: registered today, or with anything made today (owner: keep them whole, with all their records).
do $$
declare cut timestamptz := (select at from _cut);
begin
  insert into _keep select id from public.trainees where created_at >= cut on conflict do nothing;
  insert into _keep select trainee_id from public.enrollments where created_at >= cut on conflict do nothing;
  insert into _keep select trainee_id from public.payments where created_at >= cut on conflict do nothing;
  if to_regclass('public.enrollment_requests') is not null then
    insert into _keep select trainee_id from public.enrollment_requests where created_at >= cut on conflict do nothing;
  end if;
  if to_regclass('public.payment_proofs') is not null then
    insert into _keep select trainee_id from public.payment_proofs where trainee_id is not null and created_at >= cut on conflict do nothing;
  end if;
  if to_regclass('public.center_payment_items') is not null then
    insert into _keep select e.trainee_id from public.center_payment_items i join public.enrollments e on e.id = i.enrollment_id where i.created_at >= cut on conflict do nothing;
  end if;
  if to_regclass('public.other_income_rebates') is not null then
    insert into _keep select e.trainee_id from public.other_income_rebates r join public.other_income o on o.id = r.income_id join public.enrollments e on e.id = r.enrollment_id where o.created_at >= cut on conflict do nothing;
  end if;
end $$;

-- Portal logins of the trainees who go (never a staff member's or an employee's).
insert into _logins
select t.profile_id from public.trainees t
where t.profile_id is not null and t.id not in (select id from _keep)
  and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = t.profile_id and r.is_staff)
  and not exists (select 1 from public.employees e where e.profile_id = t.profile_id)
on conflict do nothing;

-- Lifts a table's own guards (immutable records) for this transaction only.
create or replace function pg_temp.reset_quiet(tbl text) returns void language plpgsql as $f$
begin
  if not exists (select 1 from _touched where t = tbl) then
    execute format('alter table public.%I disable trigger user', tbl);
    insert into _touched values (tbl);
  end if;
end $f$;

-- Copies the rows about to go into the backup schema.
create or replace function pg_temp.reset_backup(tbl text, cond text) returns void language plpgsql as $f$
begin
  if to_regclass(format('reset_backup_2026_11_09.%I', tbl)) is null then
    execute format('create table reset_backup_2026_11_09.%I as select * from public.%I where false', tbl, tbl);
  end if;
  execute format('insert into reset_backup_2026_11_09.%I select * from public.%I where %s', tbl, tbl, cond);
end $f$;

-- Erases (or, in the preview, only plans) the rows of tbl matching cond, after every row that points at them.
-- It follows the database's own links, so a table added later is not missed. It stops, and nothing is erased,
-- if it would ever reach a table that must stay, or a trainee, enrollment or payment through a money entry.
create or replace function pg_temp.reset_wipe(tbl text, cond text, root text, depth int, dry boolean) returns void language plpgsql as $f$
declare fk record; n bigint;
begin
  if depth > 8 then raise exception 'Links go deeper than expected at %. Nothing was erased.', tbl; end if;
  if tbl in ('audit_logs', 'email_logs', 'email_jobs', 'courses', 'course_categories', 'batches', 'profiles', 'employees', 'user_roles',
             'legacy_certificates', 'certificate_series', 'certificate_templates', 'organization_settings', 'id_sequences') then
    raise exception 'Would erase from %, which must stay. Nothing was erased.', tbl;
  end if;
  if root <> 'trainees' and tbl in ('trainees', 'enrollments', 'payments') then
    raise exception 'Would erase % through %. Nothing was erased.', tbl, root;
  end if;
  for fk in
    select cl.relname as child, ns.nspname as sch, a.attname as col, af.attname as pcol, c.confdeltype as act, array_length(c.conkey, 1) as width
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
    where c.contype = 'f' and c.confrelid = format('public.%I', tbl)::regclass and c.conrelid <> c.confrelid
  loop
    if fk.sch <> 'public' or fk.width <> 1 then
      raise exception 'Unexpected link from %.% to %. Nothing was erased.', fk.sch, fk.child, tbl;
    end if;
    if fk.act in ('n', 'd') then
      -- The database clears this link itself (e.g. legacy_certificates.enrollment_id); only its guards are lifted.
      if not dry then perform pg_temp.reset_quiet(fk.child); end if;
      continue;
    end if;
    perform pg_temp.reset_wipe(fk.child, format('%I in (select %I from public.%I where %s)', fk.col, fk.pcol, tbl, cond), root, depth + 1, dry);
  end loop;
  insert into _plan values (tbl, cond);
  if not dry then
    perform pg_temp.reset_quiet(tbl);
    perform pg_temp.reset_backup(tbl, cond);
    execute format('delete from public.%I where %s', tbl, cond);
    get diagnostics n = row_count;
    insert into _counts values (tbl, n);
  end if;
end $f$;

-- A money table: rows dated before today, except one that a row made today still points at.
create or replace function pg_temp.reset_root(tbl text, datecol text, dry boolean) returns void language plpgsql as $f$
declare fk record; cond text; typ text;
begin
  if to_regclass(format('public.%I', tbl)) is null then return; end if;
  select data_type into typ from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name = datecol;
  if typ is null then raise exception 'public.% has no % column. Nothing was erased.', tbl, datecol; end if;
  cond := format('%I < (select %s from _cut)', datecol, case when typ = 'date' then 'on_date' else 'at' end);
  for fk in
    select cl.relname as child, a.attname as col, af.attname as pcol
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
    where c.contype = 'f' and c.confrelid = format('public.%I', tbl)::regclass and c.conrelid <> c.confrelid
      and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = cl.relname and k.column_name = 'created_at')
  loop
    cond := cond || format(' and not exists (select 1 from public.%I k where k.%I = public.%I.%I and k.created_at >= (select at from _cut))', fk.child, fk.col, tbl, fk.pcol);
  end loop;
  perform pg_temp.reset_wipe(tbl, cond, tbl, 0, dry);
end $f$;

-- One table's rows in total and those planned to go.
create or replace function pg_temp.reset_count(tbl text, conds text, out total bigint, out erased bigint) language plpgsql as $f$
begin
  execute format('select count(*), count(*) filter (where %s) from public.%I', conds, tbl) into total, erased;
end $f$;

do $$
begin
  perform pg_temp.reset_wipe('trainees', 'id not in (select id from _keep)', 'trainees', 0, false);
  perform pg_temp.reset_root('expenses', 'created_at', false);
  perform pg_temp.reset_root('other_income', 'created_at', false);
  perform pg_temp.reset_root('company_payments', 'created_at', false);
  perform pg_temp.reset_root('billing_statements', 'issued_at', false);
  perform pg_temp.reset_root('service_invoices', 'issued_at', false);
  perform pg_temp.reset_root('cashier_openings', 'opening_date', false);
  perform pg_temp.reset_root('cashier_closings', 'closing_date', false);
  perform pg_temp.reset_root('payment_reconciliations', 'checked_at', false);
  perform pg_temp.reset_root('account_reconciliation_items', 'created_at', false);
  perform pg_temp.reset_root('requisitions', 'created_at', false);
end $$;

-- Guards back on.
do $$
declare t text;
begin
  for t in select _touched.t from _touched loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end $$;

-- Portal logins of the erased trainees (a login still named elsewhere, e.g. in the audit log, is kept and counted).
do $$
declare p uuid; removed int := 0; kept int := 0;
begin
  for p in select id from _logins loop
    begin
      delete from auth.users where id = p;
      removed := removed + 1;
    exception when others then
      kept := kept + 1;
    end;
  end loop;
  insert into _counts values ('trainee portal logins removed', removed), ('trainee portal logins kept (still referenced)', kept);
end $$;

insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values, reason)
select null, 'admin', 'system.reset_keep_today', 'system', 'reset-before-2026-11-09', jsonb_object_agg(t, n),
  'Owner: reset payments, trainees and vouchers except today''s entries (9 Nov 2026); copies in reset_backup_2026_11_09'
from (select t, sum(n) as n from _counts group by t) s;

commit;

select e.key as "Erased", e.value::bigint as "Rows"
from public.audit_logs a cross join lateral jsonb_each_text(a.new_values) e
where a.id = (select id from public.audit_logs where action = 'system.reset_keep_today' order by created_at desc limit 1)
order by 2 desc, 1;
