-- =====================================================================
-- Agency (consultancy) rebates
--   agency_course_rebates : matrix of rebate amount per (agency, course),
--                           maintained by the Accounting Manager.
--   agency_rebates        : rebate payables recorded when a cashier tags the
--                           endorsing agency on a trainee's payment.
-- =====================================================================

create table if not exists public.agency_course_rebates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.marketing_agencies(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  rebate_centavos bigint not null default 0 check (rebate_centavos >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (agency_id, course_id)
);

create table if not exists public.agency_rebates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.marketing_agencies(id),
  enrollment_id uuid not null unique references public.enrollments(id) on delete cascade,
  trainee_id uuid references public.trainees(id),
  course_id uuid references public.courses(id),
  rebate_centavos bigint not null check (rebate_centavos >= 0),
  status text not null default 'Pending' check (status in ('Pending','Paid','Cancelled')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.agency_course_rebates enable row level security;
alter table public.agency_rebates enable row level security;

drop policy if exists agency_course_rebates_staff_read on public.agency_course_rebates;
create policy agency_course_rebates_staff_read on public.agency_course_rebates for select to authenticated using (public.has_staff_role());
drop policy if exists agency_course_rebates_acct_write on public.agency_course_rebates;
create policy agency_course_rebates_acct_write on public.agency_course_rebates for all to authenticated using (public.has_any_role(array['admin','accounting'])) with check (public.has_any_role(array['admin','accounting']));

drop policy if exists agency_rebates_staff_read on public.agency_rebates;
create policy agency_rebates_staff_read on public.agency_rebates for select to authenticated using (public.has_staff_role());
drop policy if exists agency_rebates_staff_write on public.agency_rebates;
create policy agency_rebates_staff_write on public.agency_rebates for all to authenticated using (public.has_any_role(array['admin','accounting','cashier'])) with check (public.has_any_role(array['admin','accounting','cashier']));

-- Accounting Manager sets the rebate for an (agency, course) pair.
create or replace function public.set_agency_course_rebate(target_agency uuid, target_course uuid, target_cents bigint)
returns public.agency_course_rebates language plpgsql security definer set search_path = public as $$
declare result public.agency_course_rebates;
begin
  if not public.has_any_role(array['admin','accounting']) then raise exception 'Not authorized'; end if;
  if target_cents < 0 then raise exception 'Rebate cannot be negative'; end if;
  insert into public.agency_course_rebates(agency_id, course_id, rebate_centavos, updated_by, updated_at)
  values(target_agency, target_course, target_cents, auth.uid(), now())
  on conflict (agency_id, course_id) do update set rebate_centavos = excluded.rebate_centavos, updated_by = auth.uid(), updated_at = now()
  returning * into result;
  return result;
end $$;
grant execute on function public.set_agency_course_rebate(uuid, uuid, bigint) to authenticated;

-- Records the rebate owed to the endorsing agency for a trainee's enrollment.
create or replace function public.record_agency_rebate(target_enrollment uuid, target_agency uuid)
returns public.agency_rebates language plpgsql security definer set search_path = public as $$
declare enrollment_row public.enrollments; matrix_cents bigint; result public.agency_rebates;
begin
  if not public.has_any_role(array['admin','accounting','cashier']) then raise exception 'Not authorized'; end if;
  select * into enrollment_row from public.enrollments where id = target_enrollment;
  if enrollment_row.id is null then raise exception 'Enrollment not found'; end if;
  select rebate_centavos into matrix_cents from public.agency_course_rebates where agency_id = target_agency and course_id = enrollment_row.course_id;
  if matrix_cents is null then raise exception 'No rebate is configured for this agency and course'; end if;
  insert into public.agency_rebates(agency_id, enrollment_id, trainee_id, course_id, rebate_centavos, created_by)
  values(target_agency, target_enrollment, enrollment_row.trainee_id, enrollment_row.course_id, matrix_cents, auth.uid())
  on conflict (enrollment_id) do update set agency_id = excluded.agency_id, course_id = excluded.course_id,
    trainee_id = excluded.trainee_id, rebate_centavos = excluded.rebate_centavos
  where public.agency_rebates.status <> 'Paid'
  returning * into result;
  return result;
end $$;
grant execute on function public.record_agency_rebate(uuid, uuid) to authenticated;

-- Accounting Manager marks a recorded rebate as settled (paid to the agency).
create or replace function public.settle_agency_rebate(target_entry uuid, target_status text)
returns public.agency_rebates language plpgsql security definer set search_path = public as $$
declare result public.agency_rebates;
begin
  if not public.has_any_role(array['admin','accounting']) then raise exception 'Not authorized'; end if;
  if target_status not in ('Pending','Paid','Cancelled') then raise exception 'Invalid status'; end if;
  update public.agency_rebates set status = target_status where id = target_entry returning * into result;
  if result.id is null then raise exception 'Rebate entry not found'; end if;
  return result;
end $$;
grant execute on function public.settle_agency_rebate(uuid, text) to authenticated;
