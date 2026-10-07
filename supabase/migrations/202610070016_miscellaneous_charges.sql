-- Miscellaneous charges (owner, 7 Oct 2026).
-- The charge catalog becomes the Schedule of Fees, with two kinds:
--   item: sold at the counter and paid on the spot (T-Shirt, Uniform, Courier).
--         The Cashier adds it in Record Payment; it is approved because it is paid.
--   fee:  a service fee tied to a change request (Rescheduling, Make-up Class,
--         Cancellation, Reprinting). It still follows the request approval flow.
-- Additive and idempotent.

begin;

alter table public.charge_catalog
  add column if not exists kind text not null default 'fee';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.charge_catalog'::regclass and conname = 'charge_catalog_kind_check'
  ) then
    alter table public.charge_catalog
      add constraint charge_catalog_kind_check check (kind in ('item', 'fee'));
  end if;
end $$;

update public.charge_catalog set kind = 'item'
where name in ('Uniform', 'Courier or Delivery Fee');

insert into public.charge_catalog (name, default_amount_centavos, kind)
values ('T-Shirt', 15000, 'item')
on conflict (name) do update set kind = 'item';

commit;
