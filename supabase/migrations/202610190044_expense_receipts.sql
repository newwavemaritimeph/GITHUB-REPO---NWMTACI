-- Receipt photos on every expense (owner, 19 Oct 2026): the Cashier attaches the receipt or bill
-- photos when sending an expense for approval; they are filed in Google Drive and listed here.
-- Each item: { fileId, link, name, mime }.
alter table public.expenses add column if not exists receipt_files jsonb not null default '[]'::jsonb;
