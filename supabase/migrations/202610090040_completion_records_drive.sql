-- Training Completion Records filed in Google Drive (owner, 9 Oct 2026): each
-- complete record is saved as a PDF in the "TCROA" folder for reference and printing.
alter table public.training_completion_records add column if not exists drive_file_id text;
alter table public.training_completion_records add column if not exists drive_link text;
alter table public.training_completion_records add column if not exists drive_path text;
alter table public.training_completion_records add column if not exists drive_filed_at timestamptz;

-- Let the API see the new tables and columns straight away.
notify pgrst, 'reload schema';
