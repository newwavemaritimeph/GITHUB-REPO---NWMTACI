-- Accounting edits Opening and Closing (owner, 13 Nov 2026): a correction needs a reason. The row keeps who edited it,
-- when and why; audit_logs keeps every old and new value (cashier_close.edited).
alter table public.cashier_openings
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references public.profiles(id),
  add column if not exists edit_reason text;
alter table public.cashier_closings
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references public.profiles(id),
  add column if not exists edit_reason text;
