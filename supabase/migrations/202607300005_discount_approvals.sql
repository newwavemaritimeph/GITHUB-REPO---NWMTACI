-- =====================================================================
-- Discount / agency-rebate approval workflow.
-- A cashier requests a discount (optionally tagged to an endorsing agency);
-- it is stored as an invalid (non-deducting) 'discount' charge pending
-- approval. The Accounting Manager approves (valid=true → deducts from the
-- trainee's balance) or rejects it.
-- =====================================================================

alter table public.enrollment_charges add column if not exists approval_status text not null default 'Approved' check (approval_status in ('Pending','Approved','Rejected'));
alter table public.enrollment_charges add column if not exists agency_id uuid references public.marketing_agencies(id);
alter table public.enrollment_charges add column if not exists decided_by uuid references public.profiles(id);
alter table public.enrollment_charges add column if not exists decided_at timestamptz;

create or replace function public.request_enrollment_discount(target_enrollment uuid, target_amount bigint, target_description text, target_agency uuid)
returns public.enrollment_charges language plpgsql security definer set search_path = public as $$
declare result public.enrollment_charges;
begin
  if not public.has_any_role(array['admin','accounting','cashier']) then raise exception 'Not authorized'; end if;
  if target_amount <= 0 then raise exception 'Amount must be positive'; end if;
  insert into public.enrollment_charges(enrollment_id, description, amount_centavos, event_type, valid, approval_status, agency_id, created_by)
  values(target_enrollment, coalesce(nullif(trim(target_description), ''), 'Discount'), target_amount, 'discount', false, 'Pending', target_agency, auth.uid())
  returning * into result;
  return result;
end $$;
grant execute on function public.request_enrollment_discount(uuid, bigint, text, uuid) to authenticated;

create or replace function public.decide_enrollment_discount(target_charge uuid, target_approve boolean)
returns public.enrollment_charges language plpgsql security definer set search_path = public as $$
declare result public.enrollment_charges;
begin
  if not public.has_any_role(array['admin','accounting']) then raise exception 'Not authorized'; end if;
  update public.enrollment_charges
    set valid = target_approve,
        approval_status = case when target_approve then 'Approved' else 'Rejected' end,
        decided_by = auth.uid(), decided_at = now()
    where id = target_charge and event_type = 'discount' and approval_status = 'Pending'
    returning * into result;
  if result.id is null then raise exception 'Pending discount not found'; end if;
  return result;
end $$;
grant execute on function public.decide_enrollment_discount(uuid, boolean) to authenticated;
