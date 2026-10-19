-- Expense category "Instructors" (owner, 19 Oct 2026): instructor payments are recorded with the
-- payee and one amount, without line items.
insert into public.expense_categories(name) values ('Instructors') on conflict (name) do nothing;
