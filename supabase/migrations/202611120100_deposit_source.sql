-- Bank Deposits "From" (owner, 12 Nov 2026): where the money comes from. 'Cash' (the Cashier's drawer), 'GCash',
-- a bank channel (e.g. 'PSBank'), or 'Cheques Received' (with the cheque number). Deposits already recorded stay Cash.
alter table public.bank_deposits
  add column if not exists source text not null default 'Cash',
  add column if not exists cheque_no text;
