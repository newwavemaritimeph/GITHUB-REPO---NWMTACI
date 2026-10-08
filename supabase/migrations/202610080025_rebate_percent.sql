-- Rebate as a percentage of the actual training fee (owner, 8 Oct 2026), e.g. 50%
-- for some agencies on New Wave in-house courses. When set, it is used instead of
-- the peso amounts in Rebates per course. Additive; safe to re-run.

alter table public.marketing_agencies add column if not exists rebate_percent numeric(5,2);
alter table public.marketing_agencies drop constraint if exists marketing_agencies_rebate_percent_check;
alter table public.marketing_agencies add constraint marketing_agencies_rebate_percent_check check (rebate_percent is null or (rebate_percent > 0 and rebate_percent <= 100));
