-- Company Charge (owner, 5 Nov 2026): a company's payment carries its proof and gets a Service Invoice with a system
-- SI No. Accounting sets the format, last number and form details once. Issued invoices never change.
-- Additive. Uses number_from_format from migration 202610290079.

begin;

alter table public.company_payments add column if not exists proof_id uuid references public.payment_proofs(id);

create table if not exists public.service_invoice_settings (
  id boolean primary key default true check (id),
  control_no text not null default '',
  form_no text not null default '',
  revision_no text not null default '',
  revision_date text not null default '',
  issued_date text not null default '',
  tin text not null default '',
  format text not null default 'SI-{YYYY}-{N:6}',
  last_number bigint not null default 0 check (last_number >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.service_invoice_settings (id) values (true) on conflict (id) do nothing;
alter table public.service_invoice_settings enable row level security;

create table if not exists public.service_invoices (
  id uuid primary key default gen_random_uuid(),
  si_number text not null unique,
  company_payment_id uuid not null unique references public.company_payments(id),
  billing_statement_id uuid not null references public.billing_statements(id),
  amount_centavos bigint not null check (amount_centavos > 0),
  snapshot jsonb not null,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default now()
);
alter table public.service_invoices enable row level security;
drop trigger if exists service_invoices_immutable on public.service_invoices;
create trigger service_invoices_immutable before update or delete on public.service_invoices
  for each row execute function public.prevent_immutable_change();

-- The number and the invoice in one step, so an SI No. is never skipped or repeated.
create or replace function public.issue_service_invoice(target_payment uuid, target_statement uuid, target_amount bigint, target_snapshot jsonb, actor uuid)
returns table (invoice_id uuid, invoice_number text)
language plpgsql security definer set search_path = public as $$
declare
  s public.service_invoice_settings;
  num text;
  new_id uuid;
begin
  select i.id, i.si_number into new_id, num from public.service_invoices i where i.company_payment_id = target_payment;
  if found then
    return query select new_id, num;
    return;
  end if;
  update public.service_invoice_settings set last_number = last_number + 1 where id returning * into s;
  num := public.number_from_format(s.format, '', s.last_number);
  insert into public.service_invoices (si_number, company_payment_id, billing_statement_id, amount_centavos, snapshot, issued_by)
    values (num, target_payment, target_statement, target_amount, target_snapshot || jsonb_build_object('tin', s.tin, 'control', jsonb_build_object('controlNo', s.control_no, 'formNo', s.form_no, 'revisionNo', s.revision_no, 'revisionDate', s.revision_date, 'issuedDate', s.issued_date)), actor)
    returning id into new_id;
  return query select new_id, num;
end $$;
revoke all on function public.issue_service_invoice(uuid, uuid, bigint, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.issue_service_invoice(uuid, uuid, bigint, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
