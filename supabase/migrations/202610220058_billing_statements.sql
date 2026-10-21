-- Billing Statements (owner, 22 Oct 2026): one per agency or consultancy and coverage,
-- numbered in sequence (BS No.), with the trainees and amounts kept as issued.
begin;

create sequence if not exists public.billing_statement_seq start with 29;

create table if not exists public.billing_statements (
  id uuid primary key default gen_random_uuid(),
  bs_number integer not null unique default nextval('public.billing_statement_seq'),
  agency_id uuid not null references public.marketing_agencies(id),
  coverage_from date not null,
  coverage_to date not null,
  bill_to text not null,
  total_centavos bigint not null check (total_centavos >= 0),
  rows jsonb not null default '[]'::jsonb,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default now(),
  unique (agency_id, coverage_from, coverage_to)
);
alter table public.billing_statements enable row level security;

-- Issued statements are kept exactly as printed.
drop trigger if exists billing_statements_immutable on public.billing_statements;
create trigger billing_statements_immutable before update or delete on public.billing_statements
  for each row execute function public.prevent_immutable_change();

notify pgrst, 'reload schema';
commit;
