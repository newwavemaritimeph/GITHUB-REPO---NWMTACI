-- =====================================================================
-- Expense categories — an editable list maintained by the Accounting
-- Manager (Utilities, Office Supplies, Salary, Government, …). The expense
-- voucher form picks a category from this list; the amount is typed per voucher.
-- =====================================================================

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.expense_categories enable row level security;
drop policy if exists expense_categories_staff_read on public.expense_categories;
create policy expense_categories_staff_read on public.expense_categories for select to authenticated using (public.has_staff_role());
drop policy if exists expense_categories_acct_write on public.expense_categories;
create policy expense_categories_acct_write on public.expense_categories for all to authenticated using (public.has_any_role(array['admin','accounting'])) with check (public.has_any_role(array['admin','accounting']));

insert into public.expense_categories(name) values
('Utilities'), ('Office Supplies'), ('Salary'), ('Government'), ('Representation'),
('Transportation'), ('Professional Fees'), ('Repairs & Maintenance'), ('Others')
on conflict (name) do nothing;
