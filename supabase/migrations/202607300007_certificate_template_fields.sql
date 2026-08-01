-- Editable field config for uploaded certificate templates (number, name, date, …).
alter table public.certificate_templates add column if not exists fields jsonb not null default '[]';
