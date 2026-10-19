-- Other income (owner, 19 Oct 2026): endorsement rebates received from partner
-- centers and any other income (rental, sale of items, refunds from suppliers,
-- interest). Recorded by the Cashier with an income number (INC-) and a proof
-- photo filed in Google Drive; viewed by Accounting; voided only by the Admin.
create table if not exists public.other_income (
  id uuid primary key default gen_random_uuid(),
  income_number text not null unique,
  source text not null,
  partner_center_id uuid references public.partner_centers(id),
  payer text not null,
  amount_centavos bigint not null check (amount_centavos > 0),
  channel text not null,
  reference text,
  received_on date not null,
  notes text,
  proof_files jsonb not null default '[]'::jsonb,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  void_reason text,
  voided_by uuid references public.profiles(id),
  voided_at timestamptz
);

-- Which endorsed enrollments an endorsement-rebate receipt covers (each enrollment once).
create table if not exists public.other_income_rebates (
  income_id uuid not null references public.other_income(id) on delete cascade,
  enrollment_id uuid not null unique references public.enrollments(id),
  amount_centavos bigint not null check (amount_centavos >= 0),
  primary key (income_id, enrollment_id)
);

alter table public.other_income enable row level security;
alter table public.other_income_rebates enable row level security;

notify pgrst, 'reload schema';
