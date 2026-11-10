-- New Wave Queue, Phase 1 (owner, 10 Nov 2026; NWMTACI_Queue_System_Plan.md): walk-in tickets by QR at
-- queue.newwavemaritimemtaci.com. Same Supabase project and staff logins as ITMS.
-- Rules: anon has no access to any queue table; tickets are created and changed only by the security definer
-- functions below, which only the server (service role) may call; queue_events is insert-only.
-- Additive and idempotent.

begin;

create table if not exists public.queue_services (
  code text primary key check (code ~ '^[A-Z]$'),
  name text not null,
  default_window int not null,
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists public.queue_windows (
  no int primary key,
  name text not null,
  service_codes text[] not null,
  active boolean not null default true
);

create table if not exists public.queue_counters (
  service_code text references public.queue_services(code),
  day date not null,
  last_no int not null default 0,
  primary key (service_code, day)
);

create table if not exists public.queue_tickets (
  id uuid primary key default gen_random_uuid(),
  day date not null default (now() at time zone 'Asia/Manila')::date,
  ticket_no text not null,
  ticket_token text unique not null,
  service_code text not null references public.queue_services(code),
  full_name text,
  mobile text,
  status text not null default 'waiting' check (status in ('waiting','serving','done','no_show','cancelled')),
  window_no int references public.queue_windows(no),
  called_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  called_at timestamptz,
  finished_at timestamptz,
  recall_count int not null default 0,
  ip_hash text,
  added_by uuid references auth.users(id),
  enrollment_id uuid references public.enrollments(id),
  unique (day, ticket_no)
);
create index if not exists queue_tickets_day_status_idx on public.queue_tickets (day, status, window_no, created_at);
create unique index if not exists queue_one_active_ticket_per_mobile on public.queue_tickets (day, mobile) where status in ('waiting','serving') and mobile is not null;

create table if not exists public.queue_events (
  id bigint generated always as identity primary key,
  ticket_id uuid references public.queue_tickets(id),
  action text not null check (action in ('join','call','recall','done','no_show','cancel','requeue','transfer')),
  window_no int,
  actor uuid,
  at timestamptz not null default now()
);

create table if not exists public.queue_settings (
  id int primary key default 1 check (id = 1),
  require_screen_qr boolean not null default false,
  show_first_name boolean not null default false,
  open_time time not null default '08:00',
  close_time time not null default '17:00',
  closed_message text not null default 'The queue is closed. Please come back during office hours.',
  ticker_message text not null default 'Welcome to New Wave Maritime. Scan the QR on the screen to get your number.'
);

insert into public.queue_services (code, name, default_window, sort) values
  ('E', 'Enrollment', 1, 1), ('I', 'Inquiry', 1, 2), ('P', 'Payment', 2, 3), ('C', 'Certificate Release', 3, 4)
on conflict (code) do nothing;
insert into public.queue_windows (no, name, service_codes) values
  (1, 'Registration', '{E,I}'), (2, 'Cashier', '{P}'), (3, 'Releasing', '{C}')
on conflict (no) do nothing;
insert into public.queue_settings (id) values (1) on conflict (id) do nothing;

-- RLS: no anon access at all; staff read the services, windows and settings and today's tickets; nobody writes directly.
alter table public.queue_services enable row level security;
alter table public.queue_windows enable row level security;
alter table public.queue_counters enable row level security;
alter table public.queue_tickets enable row level security;
alter table public.queue_events enable row level security;
alter table public.queue_settings enable row level security;
revoke all on public.queue_services, public.queue_windows, public.queue_counters, public.queue_tickets, public.queue_events, public.queue_settings from anon;
drop policy if exists queue_services_staff_read on public.queue_services;
create policy queue_services_staff_read on public.queue_services for select to authenticated using (public.has_staff_role());
drop policy if exists queue_windows_staff_read on public.queue_windows;
create policy queue_windows_staff_read on public.queue_windows for select to authenticated using (public.has_staff_role());
drop policy if exists queue_settings_staff_read on public.queue_settings;
create policy queue_settings_staff_read on public.queue_settings for select to authenticated using (public.has_staff_role());
drop policy if exists queue_tickets_staff_today on public.queue_tickets;
create policy queue_tickets_staff_today on public.queue_tickets for select to authenticated using (public.has_staff_role() and day = (now() at time zone 'Asia/Manila')::date);

-- queue_events: insert-only for everyone, the Admin included.
drop trigger if exists queue_events_immutable on public.queue_events;
create trigger queue_events_immutable before update or delete on public.queue_events
  for each row execute function public.prevent_immutable_change();

-- Every join and status change is written to queue_events.
create or replace function public.queue_log_ticket() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.queue_events (ticket_id, action, window_no, actor) values (new.id, 'join', new.window_no, new.added_by);
  elsif new.recall_count > old.recall_count then
    insert into public.queue_events (ticket_id, action, window_no, actor) values (new.id, 'recall', new.window_no, new.called_by);
  elsif new.status is distinct from old.status then
    insert into public.queue_events (ticket_id, action, window_no, actor)
    values (new.id, case new.status when 'serving' then 'call' when 'done' then 'done' when 'no_show' then 'no_show' when 'cancelled' then 'cancel' else 'requeue' end, new.window_no, new.called_by);
  end if;
  return new;
end $$;
drop trigger if exists queue_tickets_log on public.queue_tickets;
create trigger queue_tickets_log after insert or update on public.queue_tickets for each row execute function public.queue_log_ticket();

-- A 16-character Crockford Base32 token from 80 random bits, for the trainee's /t/{token} link.
create or replace function public.queue_new_token() returns text language plpgsql volatile set search_path = public, extensions as $$
declare alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; bytes bytea := gen_random_bytes(10); bits bigint; res text := ''; i int;
begin
  for i in 0..1 loop
    bits := (get_byte(bytes, i*5)::bigint << 32) | (get_byte(bytes, i*5+1)::bigint << 24) | (get_byte(bytes, i*5+2)::bigint << 16) | (get_byte(bytes, i*5+3)::bigint << 8) | get_byte(bytes, i*5+4)::bigint;
    for j in reverse 7..0 loop res := res || substr(alphabet, ((bits >> (j*5)) & 31)::int + 1, 1); end loop;
  end loop;
  return res;
end $$;

-- Join: one transaction numbers the ticket (daily per service, Manila date) and inserts it. A mobile with an active ticket
-- today gets that ticket back instead of a new one.
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
  insert into public.queue_tickets (day, ticket_no, ticket_token, service_code, full_name, mobile, window_no, ip_hash, added_by)
    values (today, svc.code || '-' || lpad(n::text, 3, '0'), public.queue_new_token(), svc.code, nullif(trim(target_name), ''), target_mobile, svc.default_window, target_ip_hash, actor)
    returning * into t;
  return jsonb_build_object('ticket_no', t.ticket_no, 'ticket_token', t.ticket_token, 'service_code', t.service_code, 'window_no', t.window_no, 'existing', false);
exception when unique_violation then
  -- Two joins with the same mobile at the same moment: hand back the one that won.
  select * into existing from public.queue_tickets where day = today and mobile = target_mobile and status in ('waiting','serving') limit 1;
  if existing.id is null then raise; end if;
  return jsonb_build_object('ticket_no', existing.ticket_no, 'ticket_token', existing.ticket_token, 'service_code', existing.service_code, 'window_no', existing.window_no, 'existing', true);
end $$;

-- Call next: the window's current ticket is done; the oldest waiting ticket for that window is served. SKIP LOCKED so two
-- staff pressing at once get two different tickets.
create or replace function public.queue_call_next(target_window int, actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.queue_windows; today date := (now() at time zone 'Asia/Manila')::date; t public.queue_tickets;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into w from public.queue_windows where no = target_window and active;
  if w.no is null then raise exception 'That window is not open.'; end if;
  update public.queue_tickets set status = 'done', finished_at = now(), called_by = actor where day = today and window_no = w.no and status = 'serving';
  select * into t from public.queue_tickets where day = today and status = 'waiting' and window_no = w.no order by created_at for update skip locked limit 1;
  if t.id is null then return null; end if;
  update public.queue_tickets set status = 'serving', called_at = now(), called_by = actor where id = t.id returning * into t;
  return jsonb_build_object('id', t.id, 'ticket_no', t.ticket_no, 'service_code', t.service_code, 'window_no', t.window_no);
end $$;

-- Recall, Done and No-Show on one ticket.
create or replace function public.queue_set(target_ticket uuid, target_action text, actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.queue_tickets;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into t from public.queue_tickets where id = target_ticket for update;
  if t.id is null then raise exception 'Ticket not found.'; end if;
  if t.status <> 'serving' then raise exception 'Only the ticket being served can be changed here.'; end if;
  if target_action = 'recall' then update public.queue_tickets set recall_count = recall_count + 1, called_by = actor where id = t.id returning * into t;
  elsif target_action = 'done' then update public.queue_tickets set status = 'done', finished_at = now(), called_by = actor where id = t.id returning * into t;
  elsif target_action = 'no_show' then update public.queue_tickets set status = 'no_show', finished_at = now(), called_by = actor where id = t.id returning * into t;
  else raise exception 'Unknown action.'; end if;
  return jsonb_build_object('id', t.id, 'ticket_no', t.ticket_no, 'service_code', t.service_code, 'window_no', t.window_no, 'status', t.status);
end $$;

-- The trainee's ticket by its token: the number, service, status, window and how many are ahead. Never a name or mobile.
create or replace function public.queue_ticket_status(target_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.queue_tickets; ahead int; svc text; wname text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into t from public.queue_tickets where ticket_token = target_token;
  if t.id is null then return null; end if;
  select count(*) into ahead from public.queue_tickets where day = t.day and window_no = t.window_no and status = 'waiting' and created_at < t.created_at;
  select name into svc from public.queue_services where code = t.service_code;
  select name into wname from public.queue_windows where no = t.window_no;
  return jsonb_build_object('ticket_no', t.ticket_no, 'service', svc, 'status', t.status, 'window_no', t.window_no, 'window_name', wname, 'ahead_count', case when t.status = 'waiting' then ahead else 0 end, 'day', t.day);
end $$;

revoke all on function public.queue_join(text, text, text, text, uuid), public.queue_call_next(int, uuid), public.queue_set(uuid, text, uuid), public.queue_ticket_status(text), public.queue_new_token() from public, anon, authenticated;
grant execute on function public.queue_join(text, text, text, text, uuid), public.queue_call_next(int, uuid), public.queue_set(uuid, text, uuid), public.queue_ticket_status(text), public.queue_new_token() to service_role;

notify pgrst, 'reload schema';
commit;
