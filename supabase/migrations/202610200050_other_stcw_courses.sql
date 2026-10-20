-- Other STCW Courses (owner, 20 Oct 2026): STCW courses held at partnered
-- centers, from the owner's sheet "ENDORSED COURSES".
--   * The trainee pays New Wave the fee; New Wave pays the center the full fee;
--     the center releases the rebate to New Wave later (Other Income).
--   * Agency share: the part of that rebate that goes to the referring
--     consultancy or agency ("Marketing" in the sheet). Accounting edits both.
--   * The public form lists the course only; Registration sets the training
--     center (the offer) and the training date afterwards.
begin;

alter table public.partner_course_offers add column if not exists agency_share_centavos bigint not null default 0 check (agency_share_centavos >= 0);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'partner_course_offers_share_le_rebate') then
    alter table public.partner_course_offers add constraint partner_course_offers_share_le_rebate check (agency_share_centavos <= rebate_centavos);
  end if;
end $$;
alter table public.enrollments add column if not exists agency_share_centavos bigint not null default 0 check (agency_share_centavos >= 0);

insert into public.course_categories(name, public_visible, sort_order) values ('Other STCW Courses', true, 15) on conflict (name) do nothing;
insert into public.partner_centers(name) values ('Nautical Options'), ('Altitude Maritime'), ('Mariana') on conflict (name) do nothing;

-- The sheet: center, code, course, days, fee, rebate, agency share (pesos). Blank or -100 entered as 0.
do $$
declare r record; cat uuid; ctr uuid; crs uuid; dl text;
begin
  select id into cat from public.course_categories where name = 'Other STCW Courses';
  for r in select * from (values
    ('Nautical Options','BT','Basic Training',10,5500,1300,1000),
    ('Nautical Options','SCRB','Survival Craft and Rescue Boat',5,3900,900,800),
    ('Nautical Options','AFF','Advanced Fire Fighting',6,4200,800,700),
    ('Nautical Options','FRB','Fast Rescue Boat',5,3900,700,0),
    ('Nautical Options','BTR','Basic Training Refresher',2,2600,600,500),
    ('Nautical Options','SCRBR','Survival Craft and Rescue Boat Refresher',1,2400,600,500),
    ('Nautical Options','AFFR','Advanced Fire Fighting Refresher',1.5,2500,600,500),
    ('Nautical Options','FRBR','Fast Rescue Boat Refresher',1,2600,500,400),
    ('Nautical Options','BTOC','Basic Training Oil for Chemical Tanker',6,3200,700,600),
    ('Nautical Options','BTLGT','Basic Training for Liquefied Gas Tanker',6,3500,700,600),
    ('Nautical Options','ATOT','Advanced Training for Oil Tanker',8,4700,800,700),
    ('Nautical Options','ATCT','Advanced Training for Chemical Tanker',8,4700,800,700),
    ('Nautical Options','MEFA','Medical First Aid',5,2000,200,100),
    ('Nautical Options','SSO','Ship''s Security Officer',4,2000,500,0),
    ('Altitude Maritime','BT','Basic Training',10,6000,1200,1100),
    ('Altitude Maritime','SCRB','Survival Craft and Rescue Boat',5,3600,0,0),
    ('Altitude Maritime','AFF','Advanced Fire Fighting',6,4000,0,0),
    ('Altitude Maritime','BTR','Basic Training Refresher',3,2800,0,0),
    ('Altitude Maritime','SCRBR','Survival Craft and Rescue Boat Refresher',1.5,2400,0,0),
    ('Altitude Maritime','AFFR','Advanced Fire Fighting Refresher',1.5,2500,0,0),
    ('Altitude Maritime','BTOC','Basic Training Oil for Chemical Tanker',6,3000,0,0),
    ('Altitude Maritime','MECA','Medical Care',5.5,3000,500,400),
    ('Altitude Maritime','MEFA','Medical First Aid',4.5,1500,200,100),
    ('Altitude Maritime','RFPNW','Deck Watchkeeping',5.5,2500,600,500),
    ('Altitude Maritime','RFPEW','Engine Watchkeeping',6,2500,600,500),
    ('Altitude Maritime','SDSD','SATSDSD',1,600,250,150),
    ('Altitude Maritime','SSO','Ship''s Security Officer',3,1000,300,200),
    ('Mariana','II-4','II-4 (Ratings for Deck)',2,2200,800,700),
    ('Mariana','III-4','III-4 (Ratings for Engine)',2,2200,800,700),
    ('Mariana','II-5','II-5 (AB for Deck)',2,5200,500,400),
    ('Mariana','III-5','III-5 (AB for Engine)',2,5200,500,400),
    ('Mariana','OIC-DECK','OIC for Deck',2,5200,500,400),
    ('Mariana','OIC-ENGINE','OIC for Engine',2,5200,500,400),
    ('Mariana','ML-DECK','ML for Deck',2,13000,1500,1400),
    ('Mariana','ML-ENGINE','ML for Engine',2,13000,1500,1400),
    ('Mariana','RASD','Ratings As Able Seafarer Deck',5,5700,500,0),
    ('Mariana','RASE','Ratings As Able Seafarer Engine',5,5700,500,0)
  ) v(center, code, name, days, fee, rebate, share) loop
    select id into ctr from public.partner_centers where name = r.center;
    dl := (case when r.days = trunc(r.days) then trunc(r.days)::int::text else r.days::text end) || case when r.days = 1 then ' day' else ' days' end;
    select id into crs from public.courses where upper(code) = r.code and delivery_type = 'Partner or Endorsed' order by created_at limit 1;
    if crs is null then
      insert into public.courses(code, name, category_id, delivery_type, duration_label, duration_days, training_mode, standard_price_centavos, public_visible, active, source_document, source_label)
      values (r.code, r.name, cat, 'Partner or Endorsed', dl, r.days, 'Face-to-face', r.fee * 100, true, true, 'ENDORSED COURSES sheet', r.center)
      returning id into crs;
    else
      update public.courses set category_id = cat, public_visible = true, active = true where id = crs;
    end if;
    if not exists (select 1 from public.partner_course_offers where partner_center_id = ctr and course_id = crs and active) then
      insert into public.partner_course_offers(course_id, partner_center_id, duration_label, training_fee_centavos, rebate_centavos, agency_share_centavos, source_document, source_row, source_label, active)
      values (crs, ctr, dl, r.fee * 100, least(r.rebate, r.fee) * 100, least(r.share, r.rebate) * 100, 'ENDORSED COURSES sheet', 0, r.center, true);
    end if;
  end loop;
end $$;

-- A website application for an Other STCW course: Pending, no center yet (price set when Registration picks the center).
create or replace function public.assign_other_course(target_trainee uuid, target_course uuid, actor uuid default null)
returns public.enrollments language plpgsql security definer set search_path = public as $$
declare course_row public.courses; result public.enrollments;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into course_row from public.courses where id = target_course and active and delivery_type = 'Partner or Endorsed';
  if course_row.id is null then raise exception 'That course is not offered right now'; end if;
  if exists (select 1 from public.enrollments where trainee_id = target_trainee and course_id = course_row.id and enrollment_status = 'Pending') then
    raise exception 'The applicant already has an application for this course';
  end if;
  insert into public.enrollments(enrollment_number, trainee_id, course_id, enrollment_status, source, selling_price_centavos, rebate_centavos, partner_payable_centavos, rate_snapshot, created_by)
  values (public.next_reference('ENR'), target_trainee, course_row.id, 'Pending', 'Public registration', 0, 0, 0,
    jsonb_build_object('course_code', course_row.code, 'course_name', course_row.name, 'center', null, 'captured_at', now()), actor)
  returning * into result;
  update public.trainees set awaiting_course = false where id = target_trainee;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, new_values)
  values (actor, 'registration', 'application.course_assigned', 'enrollment', result.id::text, jsonb_build_object('course_id', course_row.id, 'other_stcw', true));
  return result;
end $$;
revoke all on function public.assign_other_course(uuid, uuid, uuid) from public;
grant execute on function public.assign_other_course(uuid, uuid, uuid) to service_role;

-- Registration sets (or changes) the training center and date of a Pending Other STCW application; the fee, rebate and agency share come from that center's offer.
create or replace function public.set_other_course_center(target_enrollment uuid, target_offer uuid, target_date date, actor uuid)
returns public.enrollments language plpgsql security definer set search_path = public as $$
declare row_ public.enrollments; offer_row public.partner_course_offers; center_name text; result public.enrollments;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into row_ from public.enrollments where id = target_enrollment for update;
  if row_.id is null then raise exception 'Application not found'; end if;
  if row_.enrollment_status <> 'Pending' then raise exception 'Only a Pending application can change its training center'; end if;
  select * into offer_row from public.partner_course_offers where id = target_offer and active;
  if offer_row.id is null or offer_row.course_id <> row_.course_id then raise exception 'That center does not offer this course'; end if;
  if target_date is null then raise exception 'Enter the training date'; end if;
  select name into center_name from public.partner_centers where id = offer_row.partner_center_id;
  update public.enrollments set partner_offer_id = offer_row.id, scheduled_on = target_date,
    selling_price_centavos = offer_row.training_fee_centavos, rebate_centavos = offer_row.rebate_centavos,
    partner_payable_centavos = offer_row.training_fee_centavos, agency_share_centavos = offer_row.agency_share_centavos,
    rate_snapshot = coalesce(rate_snapshot, '{}'::jsonb) || jsonb_build_object('center', center_name, 'selling_price_centavos', offer_row.training_fee_centavos, 'rebate_centavos', offer_row.rebate_centavos, 'agency_share_centavos', offer_row.agency_share_centavos, 'captured_at', now()),
    updated_at = now()
  where id = row_.id returning * into result;
  insert into public.audit_logs(actor_id, actor_role, action, record_type, record_id, prior_values, new_values)
  values (actor, 'registration', 'application.center_set', 'enrollment', row_.id::text,
    jsonb_build_object('partner_offer_id', row_.partner_offer_id, 'scheduled_on', row_.scheduled_on),
    jsonb_build_object('partner_offer_id', offer_row.id, 'center', center_name, 'scheduled_on', target_date));
  return result;
end $$;
revoke all on function public.set_other_course_center(uuid, uuid, date, uuid) from public;
grant execute on function public.set_other_course_center(uuid, uuid, date, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
