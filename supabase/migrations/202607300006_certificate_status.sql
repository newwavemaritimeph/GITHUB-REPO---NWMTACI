-- =====================================================================
-- Certificate status override (Stage 1).
-- Admin / Training Operations can issue a certificate for an enrollment and
-- move it through its status (Draft = Pending Attendance, For Printing =
-- Ready to Print, Printed, Released, Cancelled). Creates the certificate row
-- on first use.
-- =====================================================================

create or replace function public.set_certificate_status(target_enrollment uuid, target_status text)
returns public.certificates language plpgsql security definer set search_path = public as $$
declare result public.certificates;
begin
  if not public.has_any_role(array['admin','training_operations']) then raise exception 'Not authorized'; end if;
  if target_status not in ('Pending Attendance','Ready to Print','Printed','Released','Cancelled') then raise exception 'Invalid certificate status'; end if;
  insert into public.certificates(enrollment_id, status, printed_at, printed_by)
  values(
    target_enrollment, target_status,
    case when target_status in ('Printed','Released') then now() else null end,
    case when target_status in ('Printed','Released') then auth.uid() else null end
  )
  on conflict (enrollment_id) do update set
    status = excluded.status,
    printed_at = case when excluded.status in ('Printed','Released') then coalesce(public.certificates.printed_at, now()) else public.certificates.printed_at end,
    printed_by = case when excluded.status in ('Printed','Released') then coalesce(public.certificates.printed_by, auth.uid()) else public.certificates.printed_by end,
    updated_at = now()
  returning * into result;
  return result;
end $$;
grant execute on function public.set_certificate_status(uuid, text) to authenticated;
