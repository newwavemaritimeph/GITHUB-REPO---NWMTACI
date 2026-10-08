-- Proof of payment goes straight to Google Drive (owner, 7 Oct 2026).
-- GCash, PSBank and UnionBank proofs are uploaded to the connected Google
-- account's Drive (NWMTACI Payment Proofs / <mode> / <YYYY-MM Month> /
-- LASTNAME - YYYY-MM-DD.ext). The portal keeps no copy of the file, only the
-- Drive reference on the payment_proofs row. Additive and idempotent.

begin;

alter table public.payment_proofs alter column storage_path drop not null;
alter table public.payment_proofs add column if not exists drive_file_id text;
alter table public.payment_proofs add column if not exists drive_link text;
alter table public.payment_proofs add column if not exists drive_path text;

-- Drive folder ids the portal created, so folders are not searched every time.
create table if not exists public.google_drive_folders (
  key text primary key,
  folder_id text not null,
  created_at timestamptz not null default now()
);
alter table public.google_drive_folders enable row level security;

commit;
