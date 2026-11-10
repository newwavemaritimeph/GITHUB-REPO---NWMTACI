-- Referral Voucher by the Cashier (owner, 10 Nov 2026): the Cashier prepares it with the mode of payment and details and
-- submits it; Accounting previews the PDF and approves or returns it; the Cashier releases it. The voucher itself stays
-- as issued (202610290088); each step is an event of its own, never edited. The latest event is the voucher's status.
-- Additive and idempotent.

begin;

create table if not exists public.referral_voucher_events (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.referral_vouchers(id),
  status text not null check (status in ('For Approval', 'Approved', 'Returned', 'Released')),
  remarks text,
  reference text,
  actor uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists referral_voucher_events_voucher_idx on public.referral_voucher_events (voucher_id, created_at desc);
alter table public.referral_voucher_events enable row level security;
drop policy if exists referral_voucher_events_staff_read on public.referral_voucher_events;
create policy referral_voucher_events_staff_read on public.referral_voucher_events for select to authenticated using (public.has_staff_role());

drop trigger if exists referral_voucher_events_immutable on public.referral_voucher_events;
create trigger referral_voucher_events_immutable before update or delete on public.referral_voucher_events
  for each row execute function public.prevent_immutable_change();

-- Vouchers issued before this update wait for Accounting like new ones.
insert into public.referral_voucher_events (voucher_id, status, actor, created_at)
select v.id, 'For Approval', v.issued_by, v.issued_at from public.referral_vouchers v
where not exists (select 1 from public.referral_voucher_events e where e.voucher_id = v.id);

notify pgrst, 'reload schema';
commit;
