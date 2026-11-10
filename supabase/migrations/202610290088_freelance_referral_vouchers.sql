-- Freelance partners and Referral Vouchers (owner, 10 Nov 2026).
-- 1. A partner can be an Agency, a Consultancy or a Freelance referrer.
-- 2. Referral Voucher (Design 1): one per partner and period, listing the trainees the partner endorsed with
--    the date enrolled, course and rebate, and the total. Kept exactly as issued (RV-YYYY-NNNNNN).
-- Additive and idempotent.

begin;

alter table public.marketing_agencies drop constraint if exists marketing_agencies_kind_check;
alter table public.marketing_agencies add constraint marketing_agencies_kind_check check (kind in ('Agency', 'Consultancy', 'Freelance'));

create table if not exists public.referral_vouchers (
  id uuid primary key default gen_random_uuid(),
  voucher_number text not null unique,
  agency_id uuid not null references public.marketing_agencies(id),
  period_from date not null,
  period_to date not null check (period_to >= period_from),
  total_centavos bigint not null check (total_centavos >= 0),
  snapshot jsonb not null,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default now()
);
create index if not exists referral_vouchers_agency_idx on public.referral_vouchers (agency_id, issued_at desc);
alter table public.referral_vouchers enable row level security;
drop policy if exists referral_vouchers_staff_read on public.referral_vouchers;
create policy referral_vouchers_staff_read on public.referral_vouchers for select to authenticated using (public.has_staff_role());

-- Issued vouchers are kept exactly as printed.
drop trigger if exists referral_vouchers_immutable on public.referral_vouchers;
create trigger referral_vouchers_immutable before update or delete on public.referral_vouchers
  for each row execute function public.prevent_immutable_change();

-- Its Form Numbers row, filled in from Accounting › Form Numbers.
insert into public.document_controls (form_code, form_no, revision_no, revision_date, issued_date) values ('referral_voucher', '', '', '', '')
on conflict (form_code) do nothing;

notify pgrst, 'reload schema';
commit;
