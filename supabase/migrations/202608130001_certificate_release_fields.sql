-- =====================================================================
-- Releasing Officer workspace: release method, claimant, courier and
-- correction tracking on certificates.
--
-- The base schema only knew a certificate's status plus a release-event log
-- (recipient name / id type). It had no concept of HOW a certificate leaves
-- the office (pickup, authorised representative, courier), no courier
-- booking or tracking, no expected-pickup queue, and no correction workflow.
-- All additive and idempotent; nothing existing changes meaning.
-- =====================================================================

begin;

-- How the certificate is claimed: 'Pickup' | 'Representative' | 'Courier'.
alter table public.certificates add column if not exists release_method text;
alter table public.certificates add column if not exists expected_pickup_on date;

-- Who is collecting, and the two checks the officer must confirm in person.
alter table public.certificates add column if not exists claimant_name text;
alter table public.certificates add column if not exists claimant_relationship text;
alter table public.certificates add column if not exists id_checked boolean not null default false;
alter table public.certificates add column if not exists authorization_checked boolean not null default false;

-- Courier / LBC booking. courier_status: 'For Booking' | 'Booked' | 'Shipped' | 'Delivered'.
alter table public.certificates add column if not exists courier_name text;
alter table public.certificates add column if not exists tracking_number text;
alter table public.certificates add column if not exists shipping_fee_status text;
alter table public.certificates add column if not exists shipping_address text;
alter table public.certificates add column if not exists courier_status text;

-- Correction workflow. issue_status: 'For Correction' | 'Resolved'.
alter table public.certificates add column if not exists issue_status text;
alter table public.certificates add column if not exists issue_note text;
alter table public.certificates add column if not exists issue_reported_on date;

commit;
