-- =====================================================================
-- Hand-over to the Cashier, and change requests routed through the Cashier
-- (7 Oct 2026, owner instruction).
-- 1. Registration hands a screened applicant (requirements ticked) to the
--    Cashier for payment: enrollments.handed_to_cashier_at / _by.
-- 2. Change requests raised by Registration go to the Cashier first, who adds
--    the applicable charge (or "no charge"); only then can the Accounting
--    Manager decide them. enrollment_requests.stage tracks where a request is;
--    charge_id links the Cashier's charge so approval posts it.
-- Existing pending requests default to 'For approval' and keep working.
-- Additive and safe to re-run.
-- =====================================================================

begin;

alter table public.enrollments add column if not exists handed_to_cashier_at timestamptz;
alter table public.enrollments add column if not exists handed_to_cashier_by uuid references public.profiles(id);
create index if not exists enrollments_handed_to_cashier_idx on public.enrollments(handed_to_cashier_at) where handed_to_cashier_at is not null;

alter table public.enrollment_requests add column if not exists stage text not null default 'For approval';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'enrollment_requests_stage_check') then
    alter table public.enrollment_requests add constraint enrollment_requests_stage_check check (stage in ('With cashier','For approval'));
  end if;
end $$;
alter table public.enrollment_requests add column if not exists charge_id uuid references public.enrollment_charges(id);
alter table public.enrollment_requests add column if not exists charged_by uuid references public.profiles(id);
alter table public.enrollment_requests add column if not exists charged_at timestamptz;
create index if not exists enrollment_requests_stage_idx on public.enrollment_requests(stage) where status = 'Pending';

commit;
