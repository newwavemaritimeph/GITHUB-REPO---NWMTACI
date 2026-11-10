-- New Wave Queue windows (owner, 10 Nov 2026: "We have 2 Walk-in Registrations and 1 Cashier"): Window 1 and Window 2
-- are Registration and share one line (Enrollment, Inquiry, Certificate Release); Window 3 is the Cashier (Payment).
-- A waiting ticket has no window yet; whichever window of its line calls next takes it.
-- Run after 202610290093. Additive and idempotent.

begin;

insert into public.queue_windows (no, name, service_codes, active) values
  (1, 'Registration', '{E,I,C}', true), (2, 'Registration', '{E,I,C}', true), (3, 'Cashier', '{P}', true)
on conflict (no) do update set name = excluded.name, service_codes = excluded.service_codes, active = true;
update public.queue_services set default_window = 1 where code in ('E','I','C');
update public.queue_services set default_window = 3 where code = 'P';
-- Tickets still waiting from before this change join the shared line.
update public.queue_tickets set window_no = null where status = 'waiting';

create or replace function public.queue_join(target_service text, target_name text, target_mobile text, target_ip_hash text, actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare svc public.queue_services; today date := (now() at time zone 'Asia/Manila')::date; n int; existing public.queue_tickets; t public.queue_tickets;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into svc from public.queue_services where code = target_service and active;
  if svc.code is null then raise exception 'Choose a service.'; end if;
  if target_mobile is not null then
    select * into existing from public.queue_tickets where day = today and mobile = target_mobile and status in ('waiting','serving') limit 1;
    if existing.id is not null then
      return jsonb_build_object('ticket_no', existing.ticket_no, 'ticket_token', existing.ticket_token, 'service_code', existing.service_code, 'window_no', existing.window_no, 'existing', true);
    end if;
  end if;
  insert into public.queue_counters (service_code, day, last_no) values (svc.code, today, 1)
    on conflict (service_code, day) do update set last_no = public.queue_counters.last_no + 1
    returning last_no into n;
  -- No window yet: the first free window of this service's line calls it.
  insert into public.queue_tickets (day, ticket_no, ticket_token, service_code, full_name, mobile, window_no, ip_hash, added_by)
    values (today, svc.code || '-' || lpad(n::text, 3, '0'), public.queue_new_token(), svc.code, nullif(trim(target_name), ''), target_mobile, null, target_ip_hash, actor)
    returning * into t;
  return jsonb_build_object('ticket_no', t.ticket_no, 'ticket_token', t.ticket_token, 'service_code', t.service_code, 'window_no', t.window_no, 'existing', false);
exception when unique_violation then
  select * into existing from public.queue_tickets where day = today and mobile = target_mobile and status in ('waiting','serving') limit 1;
  if existing.id is null then raise; end if;
  return jsonb_build_object('ticket_no', existing.ticket_no, 'ticket_token', existing.ticket_token, 'service_code', existing.service_code, 'window_no', existing.window_no, 'existing', true);
end $$;

-- Call next: the oldest waiting ticket for any service this window serves (SKIP LOCKED: two windows never take the same one).
create or replace function public.queue_call_next(target_window int, actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.queue_windows; today date := (now() at time zone 'Asia/Manila')::date; t public.queue_tickets;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into w from public.queue_windows where no = target_window and active;
  if w.no is null then raise exception 'That window is not open.'; end if;
  update public.queue_tickets set status = 'done', finished_at = now(), called_by = actor where day = today and window_no = w.no and status = 'serving';
  select * into t from public.queue_tickets where day = today and status = 'waiting' and service_code = any(w.service_codes) and (window_no is null or window_no = w.no)
    order by created_at for update skip locked limit 1;
  if t.id is null then return null; end if;
  update public.queue_tickets set status = 'serving', window_no = w.no, called_at = now(), called_by = actor where id = t.id returning * into t;
  return jsonb_build_object('id', t.id, 'ticket_no', t.ticket_no, 'service_code', t.service_code, 'window_no', t.window_no);
end $$;

-- The trainee's ticket: while waiting, the windows of its line ("1 or 2") and how many of that line are ahead.
create or replace function public.queue_ticket_status(target_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.queue_tickets; ahead int; svc text; wname text; line int[]; codes text[];
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into t from public.queue_tickets where ticket_token = target_token;
  if t.id is null then return null; end if;
  select array_agg(no order by no), array_agg(distinct c) into line, codes
    from public.queue_windows, unnest(service_codes) c where active and t.service_code = any(service_codes);
  select count(*) into ahead from public.queue_tickets where day = t.day and status = 'waiting' and service_code = any(coalesce(codes, array[t.service_code])) and created_at < t.created_at;
  select name into svc from public.queue_services where code = t.service_code;
  select name into wname from public.queue_windows where no = coalesce(t.window_no, line[1]);
  return jsonb_build_object('ticket_no', t.ticket_no, 'service', svc, 'status', t.status, 'window_no', t.window_no, 'windows', to_jsonb(coalesce(line, array[]::int[])), 'window_name', wname,
    'ahead_count', case when t.status = 'waiting' then ahead else 0 end, 'day', t.day);
end $$;

revoke all on function public.queue_join(text, text, text, text, uuid), public.queue_call_next(int, uuid), public.queue_ticket_status(text) from public, anon, authenticated;
grant execute on function public.queue_join(text, text, text, text, uuid), public.queue_call_next(int, uuid), public.queue_ticket_status(text) to service_role;

notify pgrst, 'reload schema';
commit;
