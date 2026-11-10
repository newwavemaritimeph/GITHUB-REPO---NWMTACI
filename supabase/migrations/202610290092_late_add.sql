-- Late add (owner, 10 Nov 2026): Registration may add a trainee to a batch that has already started, any day up to
-- its last day, with a reason. Seats still count (24). The website and the normal placement keep their rules
-- (assign_application_course / place_application_batch are unchanged). Additive and idempotent.

begin;

alter table public.enrollments add column if not exists late_add_reason text;
alter table public.enrollments add column if not exists late_added_by uuid references public.profiles(id);
alter table public.enrollments add column if not exists late_added_at timestamptz;

create or replace function public.late_add_to_batch(target_enrollment uuid, target_batch uuid, actor uuid, reason text)
returns public.enrollments language plpgsql security definer set search_path=public as $$
declare row_ public.enrollments; batch_row public.batches; result public.enrollments;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  if coalesce(length(trim(reason)),0)<3 then raise exception 'Enter the reason for the late add.'; end if;
  select * into row_ from public.enrollments where id=target_enrollment for update;
  if row_.id is null then raise exception 'Application not found'; end if;
  if row_.enrollment_status<>'Pending' then raise exception 'Only a Pending application can be placed on a batch here'; end if;
  if row_.batch_id is not null then raise exception 'This application already has a batch; use a change-of-batch request instead'; end if;
  select * into batch_row from public.batches where id=target_batch for update;
  -- Started or not, open until its last day, with seats left; the enrollment deadline does not apply to a late add.
  if batch_row.id is null or batch_row.course_id<>row_.course_id or batch_row.partner_offer_id is not null
     or batch_row.status not in ('Open','Ongoing') or batch_row.ends_on<current_date or batch_row.confirmed_count>=batch_row.capacity then
    raise exception 'That batch has ended, is full or is closed';
  end if;
  if exists(select 1 from public.enrollments where trainee_id=row_.trainee_id and batch_id=batch_row.id and enrollment_status<>'Cancelled') then
    raise exception 'The trainee is already on that batch';
  end if;
  update public.enrollments set batch_id=batch_row.id, late_add_reason=trim(reason), late_added_by=actor, late_added_at=now(), updated_at=now()
    where id=row_.id returning * into result;
  update public.batches set confirmed_count=confirmed_count+1,status=case when confirmed_count+1>=capacity then 'Full' else status end,updated_at=now() where id=batch_row.id;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values, reason)
  values(actor, 'registration', 'enrollment.late_added', 'enrollment', row_.id::text,
    jsonb_build_object('batch_id',batch_row.id,'batch_number',batch_row.batch_number,'starts_on',batch_row.starts_on,'ends_on',batch_row.ends_on), trim(reason));
  return result;
end $$;
revoke all on function public.late_add_to_batch(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.late_add_to_batch(uuid,uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;
