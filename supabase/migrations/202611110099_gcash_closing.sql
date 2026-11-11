-- Opening and Closing with Cash and GCash (owner, 11 Nov 2026). The Cashier opens with the drawer cash and the GCash
-- balance, and closes with the counted cash (bill by bill) and the GCash balance shown in the app (with a screenshot).
alter table public.cashier_openings add column if not exists opening_gcash_centavos bigint check (opening_gcash_centavos >= 0);
alter table public.cashier_closings
  add column if not exists cash_expenses_centavos bigint,
  add column if not exists bank_deposits_centavos bigint,
  add column if not exists denominations jsonb,
  add column if not exists opening_gcash_centavos bigint,
  add column if not exists gcash_collections_centavos bigint,
  add column if not exists gcash_expenses_centavos bigint,
  add column if not exists expected_gcash_centavos bigint,
  add column if not exists actual_gcash_centavos bigint,
  add column if not exists gcash_variance_centavos bigint,
  add column if not exists gcash_screenshot_link text;
