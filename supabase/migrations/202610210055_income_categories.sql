-- Other Income categories (owner, 21 Oct 2026): Accounting keeps the list the
-- Record Income form picks from. Past income keeps its category text.
begin;

create table if not exists public.income_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.income_categories enable row level security;
drop policy if exists income_categories_staff_read on public.income_categories;
create policy income_categories_staff_read on public.income_categories for select to authenticated using (public.has_staff_role());

insert into public.income_categories(name) values
('Rental'), ('Sale of Items'), ('Refund from Supplier'), ('Interest'), ('Others')
on conflict (name) do nothing;

notify pgrst, 'reload schema';
commit;
