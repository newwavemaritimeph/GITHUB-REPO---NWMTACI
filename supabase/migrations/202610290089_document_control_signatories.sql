-- Uniform letterhead and footer (owner, 10 Nov 2026, Corporate Two-Tone): every report's footer prints
-- Issued to, Controlled by and Approved by, set per form in Accounting › Form Numbers.
-- Additive and idempotent.

begin;

alter table public.document_controls add column if not exists issued_to text not null default '';
alter table public.document_controls add column if not exists controlled_by text not null default '';
alter table public.document_controls add column if not exists approved_by text not null default '';

-- The owner's names, where nothing is set yet.
update public.document_controls set controlled_by = 'VAM' where controlled_by = '';
update public.document_controls set approved_by = 'MAAV' where approved_by = '';

notify pgrst, 'reload schema';
commit;
