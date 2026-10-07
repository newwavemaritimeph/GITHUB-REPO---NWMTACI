-- =====================================================================
-- Print limits (7 Oct 2026, owner instruction).
-- * Registration may generate a trainee's training instructions at most twice.
-- * The Training Admission Record (printed by the Cashier) may be printed twice;
--   every further reprint needs a "TAR reprint" request approved by the
--   Accounting Manager, and each approval allows one more print.
-- Additive; safe to re-run.
-- =====================================================================

begin;

alter table public.enrollments add column if not exists instructions_generated_count integer not null default 0;
alter table public.admission_records add column if not exists reprints_approved integer not null default 0;

create or replace function public.issue_admission_record(target_trainee uuid, target_enrollments uuid[], actor uuid)
returns public.admission_records language plpgsql security definer set search_path=public as $$
declare ids uuid[]; existing public.admission_records; result public.admission_records;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  select array_agg(x order by x) into ids from unnest(target_enrollments) as x;
  if ids is null then raise exception 'The trainee has no paid enrollment to print'; end if;
  if exists (select 1 from unnest(ids) as x where not exists (select 1 from public.enrollments e where e.id = x and e.trainee_id = target_trainee)) then
    raise exception 'An enrollment does not belong to this trainee';
  end if;
  select * into existing from public.admission_records where trainee_id = target_trainee and enrollment_ids = ids for update;
  if existing.id is not null then
    if existing.print_count >= 2 + existing.reprints_approved then
      raise exception 'Print limit reached for %. Request a TAR reprint approval from the Accounting Manager.', existing.ar_number;
    end if;
    update public.admission_records set print_count = print_count + 1, last_printed_at = now() where id = existing.id returning * into result;
  else
    insert into public.admission_records(ar_number, trainee_id, enrollment_ids, issued_by)
    values (public.next_reference('AR'), target_trainee, ids, actor) returning * into result;
  end if;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'cashier', 'admission_record.printed', 'trainee', target_trainee::text,
    jsonb_build_object('ar_number', result.ar_number, 'print_number', result.print_count, 'enrollment_ids', to_jsonb(ids)));
  return result;
end $$;
revoke all on function public.issue_admission_record(uuid, uuid[], uuid) from public;
grant execute on function public.issue_admission_record(uuid, uuid[], uuid) to service_role;

create or replace function public.record_instructions_generated(target_enrollment uuid, actor uuid, max_count integer)
returns integer language plpgsql security definer set search_path=public as $$
declare current_count integer;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  select instructions_generated_count into current_count from public.enrollments where id = target_enrollment for update;
  if not found then raise exception 'Enrollment not found'; end if;
  if max_count is not null and current_count >= max_count then
    raise exception 'Instructions were already generated % times for this enrollment.', current_count;
  end if;
  update public.enrollments set instructions_generated_count = current_count + 1, instructions_sent_at = now(), updated_at = now()
  where id = target_enrollment;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'registration', 'instructions.generated', 'enrollment', target_enrollment::text, jsonb_build_object('generation', current_count + 1));
  return current_count + 1;
end $$;
revoke all on function public.record_instructions_generated(uuid, uuid, integer) from public;
grant execute on function public.record_instructions_generated(uuid, uuid, integer) to service_role;

commit;
