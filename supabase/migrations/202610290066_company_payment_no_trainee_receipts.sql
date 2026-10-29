-- Company Charge (owner, 29 Oct 2026): no receipt for the trainee, just the TAR. When the Cashier records a
-- company's payment of its Billing Statement, the trainee payments it posts (remarks "BS No. …") get no
-- Acknowledgement Receipt or invoice; the company gets its one receipt on the Billing Statement template.
-- Receipt (AR) and invoice numbers are therefore not used up. Earlier receipts are kept as issued.

do $$
declare
  def text;
  anchor text := 'select * into payment_row from public.payments where id=new.payment_id;';
begin
  def := pg_get_functiondef('public.create_payment_documents()'::regprocedure);
  if position('BS No. %' in def) > 0 then
    raise notice 'Already applied.';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'create_payment_documents changed; nothing was applied.';
  end if;
  def := replace(def, anchor, anchor || E'\n  if payment_row.remarks like ''BS No. %'' then return new; end if;');
  execute def;
end $$;

select position('BS No. %' in pg_get_functiondef('public.create_payment_documents()'::regprocedure)) > 0 as company_payments_skip_trainee_receipts;
