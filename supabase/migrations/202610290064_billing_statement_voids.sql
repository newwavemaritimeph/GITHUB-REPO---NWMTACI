-- Billing Statement amounts typed by Accounting, and void and reissue (owner, 29 Oct 2026).
-- An issued statement never changes; a voided one is replaced by a new BS No. for the same
-- partner and coverage, so the one-per-coverage rule gives way to "one un-voided per coverage".
begin;

do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.billing_statements'::regclass and contype = 'u'
    and pg_get_constraintdef(oid) like '%agency_id, coverage_from, coverage_to%'
  loop
    execute format('alter table public.billing_statements drop constraint %I', c);
  end loop;
end $$;

create table if not exists public.billing_statement_voids (
  billing_statement_id uuid primary key references public.billing_statements(id),
  reason text not null check (length(trim(reason)) >= 3),
  voided_by uuid references public.profiles(id),
  voided_at timestamptz not null default now()
);
alter table public.billing_statement_voids enable row level security;
drop trigger if exists billing_statement_voids_immutable on public.billing_statement_voids;
create trigger billing_statement_voids_immutable before update or delete on public.billing_statement_voids
  for each row execute function public.prevent_immutable_change();

notify pgrst, 'reload schema';
commit;
