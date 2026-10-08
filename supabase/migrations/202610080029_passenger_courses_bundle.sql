-- Passenger Courses Bundle (owner, 8 Oct 2026): Safety (STPPDSPPS), Crowd (PSCMT)
-- and Crisis (PSCMHBT) as one New Wave in-house course, Monday to Saturday,
-- ₱4,100.00. Listed on the website's In-House courses and the registration form,
-- where a 6-day course starts on a Monday. Safe to re-run.
insert into public.courses(code, name, category_id, delivery_type, duration_label, duration_days, training_mode, standard_price_centavos, default_capacity, public_visible, active)
select 'PCB', 'Passenger Courses Bundle (Safety, Crowd and Crisis)', c.category_id, 'In-House', '6 days', 6, 'Face-to-face', 410000, 24, true, true
from (select (select category_id from public.courses where code = 'STPPDSPPS' and delivery_type = 'In-House' limit 1) as category_id) c
on conflict (code, delivery_type) do update set name = excluded.name, standard_price_centavos = excluded.standard_price_centavos, duration_label = excluded.duration_label, duration_days = excluded.duration_days, public_visible = true, active = true, updated_at = now();
