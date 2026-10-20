-- Paying the partnered centers (owner, 20 Oct 2026): New Wave pays the center
-- the full fee on the day the trainee is enrolled, through an expense request
-- (Cashier raises → Accounting approves with a CV number → Cashier releases).
-- Each trainee is paid to its center once; a rejected request frees them again.
-- The center's rebate is collected after that (Other Income › Endorsement Rebates).
begin;

create table if not exists public.center_payment_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  enrollment_id uuid not null unique references public.enrollments(id),
  amount_centavos bigint not null check (amount_centavos >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists center_payment_items_expense_idx on public.center_payment_items(expense_id);
alter table public.center_payment_items enable row level security;

insert into public.expense_categories(name) values ('Partnered Center Payment') on conflict do nothing;

notify pgrst, 'reload schema';
commit;
