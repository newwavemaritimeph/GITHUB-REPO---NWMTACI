-- =====================================================================
-- Admin setup (owner, 20 Oct 2026):
--   * Google Classroom link and class code per batch, for courses with one class
--     per batch (CCMD0076, CCMD0077 …); the batch's link wins over the course's.
--   * Default room per course: BT-PSSR in Room 103; Safety, Crowd and Crisis in
--     Room 304. New batches take it automatically; open batches without a room
--     get it now. The Admin can still change one batch.
-- Additive and idempotent.
-- =====================================================================

begin;

alter table public.batches add column if not exists google_classroom_link text;
alter table public.batches add column if not exists google_classroom_code text;

create table if not exists public.course_default_rooms (
  course_id uuid primary key references public.courses(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.course_default_rooms enable row level security;

-- Room 103 and Room 304: an existing room whose name carries the number, else a new one.
do $$
declare r103 uuid; r304 uuid;
begin
  select id into r103 from public.classrooms where regexp_replace(name, '\D', '', 'g') = '103' order by active desc limit 1;
  if r103 is null then insert into public.classrooms(name, venue, capacity) values ('Room 103', 'New Wave Maritime, Ermita, Manila', 24) returning id into r103; end if;
  select id into r304 from public.classrooms where regexp_replace(name, '\D', '', 'g') = '304' order by active desc limit 1;
  if r304 is null then insert into public.classrooms(name, venue, capacity) values ('Room 304', 'New Wave Maritime, Ermita, Manila', 24) returning id into r304; end if;
  insert into public.course_default_rooms(course_id, classroom_id)
    select id, case when code = 'UBT-PSSR' then r103 else r304 end from public.courses
    where delivery_type = 'In-House' and code in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT')
  on conflict (course_id) do nothing;
end $$;

-- Open batches from today on without a room get the course's default.
update public.batches b set classroom_id = d.classroom_id
from public.course_default_rooms d
where d.course_id = b.course_id and b.classroom_id is null and b.status <> 'Cancelled' and b.starts_on >= (now() at time zone 'Asia/Manila')::date;

insert into public.batch_resources(batch_id, classroom_id)
  select b.id, b.classroom_id from public.batches b join public.course_default_rooms d on d.course_id = b.course_id
  where b.status <> 'Cancelled' and b.starts_on >= (now() at time zone 'Asia/Manila')::date
on conflict (batch_id) do update set classroom_id = coalesce(public.batch_resources.classroom_id, excluded.classroom_id);

-- New batches take the course's default room.
create or replace function public.batches_default_room()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.classroom_id is null and new.partner_offer_id is null then
    select classroom_id into new.classroom_id from public.course_default_rooms where course_id = new.course_id;
  end if;
  return new;
end $$;
drop trigger if exists batches_default_room on public.batches;
create trigger batches_default_room before insert on public.batches for each row execute function public.batches_default_room();

notify pgrst, 'reload schema';

commit;
