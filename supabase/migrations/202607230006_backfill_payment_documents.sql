begin;

create unique index if not exists receipts_payment_unique on public.receipts(payment_id);

create or replace function public.ensure_payment_documents(target_payment uuid) returns void language plpgsql security definer set search_path=public as $$
declare payment_row public.payments; allocation_row public.payment_allocations; enrollment_row public.enrollments; trainee_row public.trainees; course_row public.courses; revision_number integer; total_paid bigint; balance bigint; base_snapshot jsonb;
begin
  select * into payment_row from public.payments where id=target_payment;
  select * into allocation_row from public.payment_allocations where payment_id=target_payment order by amount_centavos desc limit 1;
  if payment_row.id is null or allocation_row.payment_id is null then return; end if;
  select * into enrollment_row from public.enrollments where id=allocation_row.enrollment_id;
  select * into trainee_row from public.trainees where id=enrollment_row.trainee_id;
  select * into course_row from public.courses where id=enrollment_row.course_id;
  select coalesce(sum(pa.amount_centavos),0) into total_paid from public.payment_allocations pa join public.payments p on p.id=pa.payment_id where pa.enrollment_id=enrollment_row.id and p.valid and p.received_at<=payment_row.received_at;
  balance:=greatest(0,enrollment_row.selling_price_centavos-total_paid);
  base_snapshot:=jsonb_build_object('payment_number',payment_row.payment_number,'enrollment_number',enrollment_row.enrollment_number,'trainee_number',trainee_row.trainee_number,'trainee_name',concat_ws(' ',trainee_row.legal_first_name,trainee_row.legal_middle_name,trainee_row.legal_last_name,trainee_row.suffix),'address',trainee_row.address,'course_code',course_row.code,'course_name',course_row.name,'amount_centavos',allocation_row.amount_centavos,'method',payment_row.method,'reference_number',payment_row.reference_number,'received_at',payment_row.received_at,'total_due_centavos',enrollment_row.selling_price_centavos,'total_paid_centavos',total_paid,'balance_centavos',balance,'cashier_id',payment_row.cashier_id);
  insert into public.receipts(receipt_number,payment_id,snapshot,issued_by) values(public.next_reference('AR'),payment_row.id,base_snapshot,payment_row.cashier_id) on conflict(payment_id) do nothing;
  if not exists(select 1 from public.invoices where payment_id=payment_row.id) then
    select coalesce(max(revision),0)+1 into revision_number from public.invoices where enrollment_id=enrollment_row.id;
    insert into public.invoices(invoice_number,enrollment_id,payment_id,snapshot,revision,issued_at) values(public.next_reference('INV'),enrollment_row.id,payment_row.id,base_snapshot||jsonb_build_object('invoice_revision',revision_number,'document_type','Payment Invoice'),revision_number,payment_row.received_at);
  end if;
end $$;

do $$ declare row_item record; begin for row_item in select id from public.payments where valid loop perform public.ensure_payment_documents(row_item.id); end loop; end $$;
grant execute on function public.ensure_payment_documents(uuid) to service_role;

commit;
