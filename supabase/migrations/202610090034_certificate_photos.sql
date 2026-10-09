-- =====================================================================
-- Certificate 2x2 photo and Admin corrections (owner, 9 Oct 2026).
--   * The Releasing Officer uploads the trainee's 2x2 photo (white
--     background, white polo with collar), resized in the browser to
--     600 x 600 JPEG. Only the Admin can replace or remove it.
--   * Printing waits until the photo is on file.
--   * Only the Admin corrects the name, course, batch or dates printed on a
--     certificate (certificates.corrections; every change is audited).
-- Additive and idempotent.
-- =====================================================================

begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('certificate-photos', 'certificate-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create table if not exists public.certificate_photos (
  enrollment_id uuid primary key references public.enrollments(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  width integer,
  height integer,
  bytes integer,
  background_white boolean not null default false,
  confirmed boolean not null default false,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  replaced_by uuid references public.profiles(id),
  replaced_at timestamptz
);
alter table public.certificate_photos enable row level security;

alter table public.certificates add column if not exists corrections jsonb not null default '{}'::jsonb;

commit;
