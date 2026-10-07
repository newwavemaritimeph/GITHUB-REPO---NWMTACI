-- =====================================================================
-- Training Admission Record (7 Oct 2026, owner instruction).
-- Registration prints one half-sheet record per trainee that serves as the
-- admission slip and acknowledgement receipt. It carries an AR number from the
-- same AR sequence as payment receipts, so every AR number is unique.
-- A record covers a set of the trainee's enrollments; printing the same set
-- again returns the same AR number (a reprint), and adding a course issues a
-- new record. Payments and balances are read live when the record is printed.
-- Additive; safe to re-run.
-- =====================================================================

begin;

create table if not exists public.admission_records (
  id uuid primary key default gen_random_uuid(),
  ar_number text not null unique,
  trainee_id uuid not null references public.trainees(id),
  enrollment_ids uuid[] not null,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default now(),
  print_count integer not null default 1,
  last_printed_at timestamptz not null default now()
);
create index if not exists admission_records_trainee_idx on public.admission_records(trainee_id);
alter table public.admission_records enable row level security;

create or replace function public.issue_admission_record(target_trainee uuid, target_enrollments uuid[], actor uuid)
returns public.admission_records language plpgsql security definer set search_path=public as $$
declare ids uuid[]; existing public.admission_records; result public.admission_records;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  select array_agg(x order by x) into ids from unnest(target_enrollments) as x;
  if ids is null then raise exception 'The trainee has no active enrollment to print'; end if;
  if exists (select 1 from unnest(ids) as x where not exists (select 1 from public.enrollments e where e.id = x and e.trainee_id = target_trainee)) then
    raise exception 'An enrollment does not belong to this trainee';
  end if;
  select * into existing from public.admission_records where trainee_id = target_trainee and enrollment_ids = ids for update;
  if existing.id is not null then
    update public.admission_records set print_count = print_count + 1, last_printed_at = now() where id = existing.id returning * into result;
    return result;
  end if;
  insert into public.admission_records(ar_number, trainee_id, enrollment_ids, issued_by)
  values (public.next_reference('AR'), target_trainee, ids, actor) returning * into result;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'registration', 'admission_record.issued', 'trainee', target_trainee::text, jsonb_build_object('ar_number', result.ar_number, 'enrollment_ids', to_jsonb(ids)));
  return result;
end $$;
revoke all on function public.issue_admission_record(uuid, uuid[], uuid) from public;
grant execute on function public.issue_admission_record(uuid, uuid[], uuid) to service_role;

commit;
