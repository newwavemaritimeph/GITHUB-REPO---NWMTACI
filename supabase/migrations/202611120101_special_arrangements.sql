-- Special Arrangement fees (owner, 12 Nov 2026): some courses cost more under a special arrangement
-- (e.g. Online BT-PSSR for an agency: P2,500 instead of P900). Accounting or the Admin keep a list of rates;
-- the Cashier requests one for an enrollment; Accounting or the Admin approve or reject it.
-- The request is an enrollment charge for the difference, Pending and not valid until approved, so the
-- course price is never edited and the record stays append-only.

create table if not exists public.special_rates (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  arrangement text not null check (length(trim(arrangement)) between 2 and 60),
  price_centavos bigint not null check (price_centavos > 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, arrangement)
);
alter table public.special_rates enable row level security;
drop policy if exists special_rates_staff_read on public.special_rates;
create policy special_rates_staff_read on public.special_rates for select to authenticated using (public.has_any_role(array['admin','accounting','cashier']));
-- Rates are switched off, never deleted, so old requests keep their rate.
create or replace function public.special_rates_no_delete() returns trigger language plpgsql as $$ begin raise exception 'Special arrangement rates cannot be deleted; switch the rate off instead'; end $$;
drop trigger if exists special_rates_no_delete on public.special_rates;
create trigger special_rates_no_delete before delete on public.special_rates for each row execute function public.special_rates_no_delete();

alter table public.enrollment_charges
  add column if not exists request_no text,
  add column if not exists special_rate_id uuid references public.special_rates(id),
  add column if not exists arrangement text,
  add column if not exists standard_centavos bigint,
  add column if not exists special_centavos bigint,
  add column if not exists reason text,
  add column if not exists off_list boolean not null default false,
  add column if not exists decision_remarks text;

-- One open Special Arrangement per enrollment.
create unique index if not exists enrollment_charges_one_open_special on public.enrollment_charges (enrollment_id) where arrangement is not null and approval_status = 'Pending';
create index if not exists enrollment_charges_special_idx on public.enrollment_charges (created_at desc) where arrangement is not null;
