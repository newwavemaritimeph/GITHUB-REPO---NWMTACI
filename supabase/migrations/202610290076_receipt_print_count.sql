-- Safety net (owner, 4 Nov 2026): payments were missing from the Trainee Account. The likeliest cause is that
-- receipts.print_count (202610080026) never reached this database. Same statements as that file; safe to re-run.
alter table public.receipts add column if not exists print_count integer not null default 0;

create or replace function public.record_receipt_print(target_payment uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select id, print_count into r from public.receipts where payment_id = target_payment for update;
  if not found then raise exception 'Receipt not found.'; end if;
  if r.print_count >= 2 then raise exception 'This receipt was already printed twice.'; end if;
  update public.receipts set print_count = print_count + 1 where id = r.id;
  return r.print_count + 1;
end $$;
revoke all on function public.record_receipt_print(uuid) from public, anon, authenticated;
grant execute on function public.record_receipt_print(uuid) to service_role;

select count(*) = 1 as print_count_ready from information_schema.columns
where table_schema = 'public' and table_name = 'receipts' and column_name = 'print_count';
