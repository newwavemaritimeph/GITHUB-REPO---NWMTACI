-- Receipts and TARs (owner, 3 Nov 2026):
--  1. The Training Admission Record gets its own number series (TAR-2026-000001), apart from the
--     Acknowledgement Receipt (AR-2026-…). TARs already issued keep their AR numbers.
--  2. Miscellaneous items and service fees are posted as their own payments (own receipt) alongside the
--     training fee, with the same reference; those sibling payments are not flagged as duplicates.
--  3. Accounting reprints a receipt or a TAR from the Trainee Account, with a reason, beyond the print limit.

do $$
declare
  def text;
  anchor text := 'public.next_reference(''AR'')';
begin
  def := pg_get_functiondef('public.issue_admission_record(uuid,uuid[],uuid)'::regprocedure);
  if position('next_reference(''TAR''' in def) > 0 then
    raise notice 'TAR series already applied.';
  elsif position(anchor in def) = 0 then
    raise exception 'issue_admission_record changed; nothing was applied.';
  else
    execute replace(def, anchor, 'public.next_reference(''TAR'', extract(year from (now() at time zone ''Asia/Manila''))::int)');
  end if;
end $$;

do $$
declare
  def text;
  anchor text := 'where lower(reference_number) = lower(trim(target_reference)) and valid)';
begin
  def := pg_get_functiondef('public.post_payment(uuid,bigint,text,text,text,timestamptz,uuid,jsonb,text)'::regprocedure);
  if position('interval ''5 minutes''' in def) > 0 then
    raise notice 'Sibling payments already applied.';
  elsif position(anchor in def) = 0 then
    raise exception 'post_payment changed; nothing was applied.';
  else
    execute replace(def, anchor, 'where lower(reference_number) = lower(trim(target_reference)) and valid and not (trainee_id = target_trainee and cashier_id = auth.uid() and created_at > now() - interval ''5 minutes''))');
  end if;
end $$;

-- One more copy of a receipt, counted, with the reason. Returns the copy number.
create or replace function public.record_receipt_reprint(target_payment uuid, actor uuid, reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if coalesce(trim(reason), '') = '' then raise exception 'Give the reason for the reprint.'; end if;
  select id, receipt_number, print_count into r from public.receipts where payment_id = target_payment for update;
  if not found then raise exception 'Receipt not found.'; end if;
  update public.receipts set print_count = print_count + 1 where id = r.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'accounting', 'receipt.reprinted', 'payment', target_payment::text, jsonb_build_object('receipt', r.receipt_number, 'copy', r.print_count + 1, 'reason', reason));
  return r.print_count + 1;
end $$;
revoke all on function public.record_receipt_reprint(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_receipt_reprint(uuid, uuid, text) to service_role;

create or replace function public.record_tar_reprint(target_record uuid, actor uuid, reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if coalesce(trim(reason), '') = '' then raise exception 'Give the reason for the reprint.'; end if;
  select id, ar_number, print_count, trainee_id into r from public.admission_records where id = target_record for update;
  if not found then raise exception 'Training Admission Record not found.'; end if;
  update public.admission_records set print_count = print_count + 1, last_printed_at = now() where id = r.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'accounting', 'admission_record.reprinted', 'trainee', r.trainee_id::text, jsonb_build_object('ar_number', r.ar_number, 'copy', r.print_count + 1, 'reason', reason));
  return r.print_count + 1;
end $$;
revoke all on function public.record_tar_reprint(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_tar_reprint(uuid, uuid, text) to service_role;

select position('next_reference(''TAR''' in pg_get_functiondef('public.issue_admission_record(uuid,uuid[],uuid)'::regprocedure)) > 0 as tar_series,
       position('interval ''5 minutes''' in pg_get_functiondef('public.post_payment(uuid,bigint,text,text,text,timestamptz,uuid,jsonb,text)'::regprocedure)) > 0 as sibling_payments;
