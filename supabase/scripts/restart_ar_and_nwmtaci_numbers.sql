-- =====================================================================
-- Owner, 9 Nov 2026: "Start everything in 000001 AR, NWMTACI Registration Number!"
-- RUN ONCE in the Supabase SQL Editor, after the reset (reset_keep_today_2_erase.sql).
-- 1. Acknowledgement Receipts start again at AR-2026-000001.
-- 2. NWMTACI numbers start again at NWMTACI-0000001: the trainees who stayed are numbered 0000001, 0000002 …
--    in the order they registered, and the next registration continues after them.
-- One transaction: if any receipt still exists, nothing is changed (a receipt number must never repeat).
-- TARs (TAR-…), enrollment numbers and the certificate Registration No. are not touched. A TAR already
-- printed keeps the NWMTACI number printed on it. Every renumbered trainee is recorded in the audit log.
-- =====================================================================

begin;

do $$
declare n int;
begin
  select count(*) into n from public.receipts;
  if n > 0 then
    raise exception '% receipt(s) still exist, so AR numbers cannot start over without repeating. Nothing was changed. Run the reset first.', n;
  end if;
end $$;

delete from public.id_sequences where code = 'AR';

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

-- Check: the next numbers, and the trainees who stayed.
select 'Next NWMTACI No.' as item, 'NWMTACI-' || lpad((select last_value + case when is_called then 1 else 0 end from public.application_number_seq)::text, 7, '0') as value
union all
select 'Next AR No.', 'AR-' || extract(year from now())::int || '-000001'
union all
select 'Trainee', application_number from public.trainees where application_number is not null
order by 1, 2;
