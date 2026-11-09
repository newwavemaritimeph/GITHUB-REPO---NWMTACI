-- =====================================================================
-- Owner, 9 Nov 2026: "Start everything in 000001 AR, NWMTACI Registration Number!"
-- RUN ONCE in the Supabase SQL Editor, after the reset (reset_keep_today_2_erase.sql).
-- 1. Acknowledgement Receipts start again at AR-2026-000001. The receipts issued after the reset take 000001,
--    000002 … in the order issued (owner: renumber them; Accounting reprints them), and the next continues after.
-- 2. NWMTACI numbers start again at NWMTACI-0000001: the trainees who stayed are numbered 0000001, 0000002 …
--    in the order they registered, and the next registration continues after them.
-- One transaction: if a receipt from before 9 Nov still exists, nothing is changed.
-- TARs (TAR-…), enrollment numbers and the certificate Registration No. are not touched. Paper already printed
-- keeps the numbers printed on it. Every renumbered receipt and trainee is recorded in the audit log.
-- =====================================================================

begin;

do $$
declare n int;
begin
  select count(*) into n from public.receipts where issued_at < timestamptz '2026-11-09 00:00:00+08';
  if n > 0 then
    raise exception '% receipt(s) from before 9 Nov still exist. Run the reset first. Nothing was changed.', n;
  end if;
end $$;

-- 1. Receipts, in the order issued. Two steps, so no two receipts ever share a number midway.
create temp table _ar on commit drop as
select id, receipt_number as old_number,
  'AR-' || extract(year from now())::int || '-' || lpad(row_number() over (order by issued_at, receipt_number)::text, 6, '0') as new_number
from public.receipts;

alter table public.receipts disable trigger user;
update public.receipts r set receipt_number = 'RENUMBER-' || r.id from _ar a where a.id = r.id and a.old_number <> a.new_number;
update public.receipts r set receipt_number = a.new_number from _ar a where a.id = r.id and a.old_number <> a.new_number;
alter table public.receipts enable trigger user;

insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values, reason)
select null, 'admin', 'receipt.renumbered', 'receipt', id::text,
  jsonb_build_object('receipt_number', old_number), jsonb_build_object('receipt_number', new_number),
  'Owner: start AR numbers at 000001; reprint this receipt (9 Nov 2026)'
from _ar where old_number <> new_number;

delete from public.id_sequences where code = 'AR';
insert into public.id_sequences(code, sequence_year, last_value)
select 'AR', extract(year from now())::int, count(*) from _ar having count(*) > 0;

-- 2. NWMTACI numbers, in the order the trainees registered.
with ordered as (
  select id, application_number as old_number,
    'NWMTACI-' || lpad(row_number() over (order by coalesce(application_submitted_at, created_at), created_at, id)::text, 7, '0') as new_number
  from public.trainees where application_number is not null
), changed as (
  update public.trainees t set application_number = o.new_number
  from ordered o
  where o.id = t.id and t.application_number is distinct from o.new_number
  returning t.id, o.old_number, o.new_number
)
insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values, reason)
select null, 'admin', 'trainee.application_number_restarted', 'trainee', id::text,
  jsonb_build_object('application_number', old_number), jsonb_build_object('application_number', new_number),
  'Owner: start NWMTACI numbers at 0000001 (9 Nov 2026)'
from changed;

select setval('public.application_number_seq',
  greatest((select count(*) from public.trainees where application_number is not null), 1),
  (select count(*) from public.trainees where application_number is not null) > 0);

commit;

-- Check: the renumbered receipts (old → new), the trainees, and the next numbers.
select 'Receipt' as item, a.audit_old || ' → ' || r.receipt_number as value
from public.receipts r
cross join lateral (select coalesce((select l.prior_values->>'receipt_number' from public.audit_logs l where l.action = 'receipt.renumbered' and l.record_id = r.id::text order by l.created_at desc limit 1), r.receipt_number) as audit_old) a
union all
select 'Trainee', application_number from public.trainees where application_number is not null
union all
select 'Next AR No.', 'AR-' || extract(year from now())::int || '-' || lpad(((select coalesce(max(last_value), 0) from public.id_sequences where code = 'AR' and sequence_year = extract(year from now())::int) + 1)::text, 6, '0')
union all
select 'Next NWMTACI No.', 'NWMTACI-' || lpad((select last_value + case when is_called then 1 else 0 end from public.application_number_seq)::text, 7, '0')
order by 1, 2;
