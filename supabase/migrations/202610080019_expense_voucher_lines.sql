-- Expense voucher Design 2 (owner, 8 Oct 2026): an expense can have several
-- lines (particulars, quantity, unit cost) and names its supporting document.
-- Additive. amount_centavos stays the total; the lines are a snapshot of how it was made up.

alter table public.expenses
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists supporting_document text;

alter table public.expenses drop constraint if exists expenses_line_items_is_array;
alter table public.expenses add constraint expenses_line_items_is_array check (jsonb_typeof(line_items) = 'array');
