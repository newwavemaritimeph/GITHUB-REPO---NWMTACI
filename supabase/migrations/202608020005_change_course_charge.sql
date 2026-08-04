-- Add "Change Course Fee" to the billable charge catalog (alongside Rescheduling,
-- Cancellation, Make-Up, Reprinting, Uniform). Idempotent; safe on a live database.

begin;

insert into public.charge_catalog(name, default_amount_centavos)
values ('Change Course Fee', 0)
on conflict (name) do nothing;

commit;
