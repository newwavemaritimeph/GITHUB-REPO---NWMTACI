-- Agency or consultancy (owner, 8 Oct 2026): the cashier summary report splits
-- collections into direct walk-ins, agencies and consultancies. Additive.

alter table public.marketing_agencies
  add column if not exists kind text not null default 'Agency';

alter table public.marketing_agencies drop constraint if exists marketing_agencies_kind_check;
alter table public.marketing_agencies add constraint marketing_agencies_kind_check check (kind in ('Agency', 'Consultancy'));
