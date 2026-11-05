-- STEP 00 — run first. Creates the placeholder course + a persistent staging table.
-- Run 00, then every 01..NN data file in order, then 99_finalize.sql last.

insert into public.courses (code,name,delivery_type,duration_label,standard_price_centavos,public_visible,active,source_document,source_label)
values ('HIST-UNMAPPED','Historical - Unmapped Course','In-House','n/a',0,false,false,'Historical import Jan-Jul 8 2026','Historical - Unmapped Course')
on conflict (code,delivery_type) do nothing;

drop table if exists public.hist_import_stage;
create table public.hist_import_stage (
  ref text, srn text, last_name text, first_name text, middle_name text, sex text,
  place_of_birth text, birthdate date, email text, rank text, mobile text, address text,
  company text, course_match_kind text, course_key text, course_text text,
  schedule text, referred_by text, training_center text, payment_status text,
  amount_centavos bigint, system_status text, status text, person_key text,
  enrollment_status text, course_id uuid, trainee_id uuid
);
