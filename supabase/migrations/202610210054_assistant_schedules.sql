-- Class Schedules for the Admin Assistant (owner, 21 Oct 2026): opening, editing and
-- cancelling batches. Cancelling moves every trainee to another batch of the same course.
begin;

-- 1) Let admin_assistant run the batch functions. Patches whatever version is live
--    (keeps later rule changes) instead of copying old bodies.
do $$
declare f record; def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('auto_open_training_batches', 'auto_open_training_batches_range', 'create_training_batch', 'update_training_batch')
  loop
    def := pg_get_functiondef(f.oid);
    if position('''admin_assistant''' in def) = 0 then
      def := replace(def, 'array[''admin'',''training_operations'']', 'array[''admin'',''training_operations'',''admin_assistant'']');
      execute def;
    end if;
  end loop;
end $$;

-- 2) Who cancelled a batch, when and why.
alter table public.batches add column if not exists cancel_reason text;
alter table public.batches add column if not exists cancelled_by uuid references public.profiles(id);
alter table public.batches add column if not exists cancelled_at timestamptz;

-- 3) Cancel a batch, moving its trainees to another open batch of the same course.
create or replace function public.cancel_training_batch(target_batch uuid, move_to uuid, actor uuid, reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare src public.batches; dst public.batches; moved uuid[]; n integer;
begin
  if nullif(trim(reason), '') is null then raise exception 'Give a reason for cancelling.'; end if;
  select * into src from public.batches where id = target_batch for update;
  if src.id is null then raise exception 'Schedule not found.'; end if;
  if src.status = 'Cancelled' then raise exception 'This batch is already cancelled.'; end if;
  select coalesce(array_agg(id), '{}') into moved from public.enrollments
    where batch_id = target_batch and enrollment_status <> 'Cancelled';
  n := coalesce(array_length(moved, 1), 0);
  if n > 0 then
    if move_to is null then raise exception 'Choose the batch the trainees move to.'; end if;
    select * into dst from public.batches where id = move_to for update;
    if dst.id is null or dst.id = src.id then raise exception 'Choose another batch.'; end if;
    if dst.course_id is distinct from src.course_id then raise exception 'The new batch must be the same course.'; end if;
    if dst.status not in ('Open', 'Full') or dst.starts_on <= current_date then raise exception 'The new batch must be open and not started yet.'; end if;
    if dst.confirmed_count + n > dst.capacity then raise exception 'Only % seats left on %.', dst.capacity - dst.confirmed_count, dst.batch_number; end if;
    update public.enrollments set batch_id = move_to, updated_at = now() where id = any(moved);
    update public.batches set confirmed_count = confirmed_count + n,
      status = case when confirmed_count + n >= capacity then 'Full' else status end, updated_at = now() where id = move_to;
  end if;
  update public.batches set status = 'Cancelled', confirmed_count = 0, published_at = null,
    cancel_reason = trim(reason), cancelled_by = actor, cancelled_at = now(), updated_at = now() where id = target_batch;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values)
    values(actor, null, 'batch.cancelled', 'batch', target_batch::text,
      jsonb_build_object('status', src.status, 'batch_number', src.batch_number),
      jsonb_build_object('reason', trim(reason), 'moved_to', move_to, 'moved_to_batch', dst.batch_number, 'enrollments', to_jsonb(moved)));
  return n;
end $$;
revoke all on function public.cancel_training_batch(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_training_batch(uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
