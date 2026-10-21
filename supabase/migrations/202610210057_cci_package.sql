-- CCI Package (owner, 21 Oct 2026): Safety (Monday), Crowd (Tuesday–Wednesday) and
-- Crisis (Thursday–Saturday) in the same week, ₱4,100.00. A package is three ordinary
-- enrollments in that week's batches (each keeps its batch, attendance and certificate)
-- plus a package discount, so the three fees total the package price.
begin;

-- The Passenger Courses Bundle course (PCB, 8 Oct 2026) becomes the CCI Package; it is a
-- price and rebate record only, never scheduled on its own.
update public.courses set code = 'CCI', name = 'CCI Package (Safety, Crowd and Crisis)', duration_label = '5.5 Days', duration_days = 5.5, standard_price_centavos = 410000, public_visible = false, updated_at = now()
where code = 'PCB' and delivery_type = 'In-House'
  and not exists (select 1 from public.courses where code = 'CCI' and delivery_type = 'In-House');
insert into public.courses(code, name, category_id, delivery_type, duration_label, duration_days, training_mode, standard_price_centavos, default_capacity, public_visible, active)
select 'CCI', 'CCI Package (Safety, Crowd and Crisis)', (select category_id from public.courses where code = 'STPPDSPPS' and delivery_type = 'In-House' limit 1), 'In-House', '5.5 Days', 5.5, 'Face-to-face', 410000, 24, false, true
where not exists (select 1 from public.courses where code = 'CCI' and delivery_type = 'In-House');
-- Empty batches opened for the bundle course are removed (batches with trainees stay).
delete from public.batches b using public.courses c
where b.course_id = c.id and c.code = 'CCI' and c.delivery_type = 'In-House'
  and not exists (select 1 from public.enrollments e where e.batch_id = b.id);

alter table public.enrollments add column if not exists package_code text;
alter table public.enrollments add column if not exists package_id uuid;
create index if not exists enrollments_package_idx on public.enrollments(package_id) where package_id is not null;

-- Enroll a trainee in the CCI Package for the week starting `week_start` (a Monday):
-- the Safety, Crowd and Crisis batches of that week, all or nothing.
create or replace function public.assign_cci_package(target_trainee uuid, week_start date, actor uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pkg_id uuid := gen_random_uuid(); package_price bigint; total bigint := 0; part record; b_id uuid; e public.enrollments; crisis uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not authorized'; end if;
  if extract(isodow from week_start) <> 1 then raise exception 'The CCI Package starts on a Monday.'; end if;
  select standard_price_centavos into package_price from public.courses where code = 'CCI' and delivery_type = 'In-House' and active limit 1;
  if package_price is null then raise exception 'The CCI Package is not set up.'; end if;
  for part in select * from (values ('STPPDSPPS', 0), ('PSCMT', 1), ('PSCMHBT', 3)) as v(code, day_offset) loop
    select bt.id into b_id from public.batches bt join public.courses c on c.id = bt.course_id
      where c.code = part.code and c.delivery_type = 'In-House' and bt.starts_on = week_start + part.day_offset and bt.status = 'Open' and bt.partner_offer_id is null
      order by bt.confirmed_count limit 1;
    if b_id is null then raise exception 'No open % batch on %.', part.code, week_start + part.day_offset; end if;
    e := public.assign_application_course(target_trainee, (select course_id from public.batches where id = b_id), b_id, actor);
    update public.enrollments set package_code = 'CCI', package_id = pkg_id where id = e.id;
    total := total + e.selling_price_centavos;
    if part.code = 'PSCMHBT' then crisis := e.id; end if;
  end loop;
  if total > package_price then
    insert into public.enrollment_charges(enrollment_id, description, amount_centavos, event_type, valid, approval_status, created_by, decided_by, decided_at)
    values (crisis, 'CCI Package discount', total - package_price, 'discount', true, 'Approved', actor, actor, now());
  end if;
  insert into public.audit_logs(actor_id, action, record_type, record_id, new_values)
    values (actor, 'package.assigned', 'trainee', target_trainee::text, jsonb_build_object('package', 'CCI', 'package_id', pkg_id, 'week_start', week_start, 'total', total, 'price', package_price));
  return pkg_id;
end $$;
revoke all on function public.assign_cci_package(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.assign_cci_package(uuid, date, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
