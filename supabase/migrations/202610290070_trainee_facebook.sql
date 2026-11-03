-- Trainee Facebook link (owner, 3 Nov 2026): Registration records it before handing the
-- trainee to the Cashier or enrolling on Company Charge. Old records may stay blank. Additive.

alter table public.trainees add column if not exists facebook_url text;
