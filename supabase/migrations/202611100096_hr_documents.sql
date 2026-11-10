-- HR documents (owner, 10 Nov 2026): Certificate of Employment (A4), Notice to Explain and Memorandum (Legal)
-- on the New Wave letterhead and footer. HR edits the wording and the signatories; each save is a new version.
-- An issued COE or memo keeps a snapshot of exactly what was printed, so a later template change never alters it.

create table if not exists public.hr_document_templates (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('coe', 'nte', 'memo')),
  version integer not null,
  body text not null,
  signatories jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (doc_type, version)
);
drop trigger if exists hr_document_templates_immutable on public.hr_document_templates;
create trigger hr_document_templates_immutable before update or delete on public.hr_document_templates for each row execute function public.prevent_immutable_change();
alter table public.hr_document_templates enable row level security;
drop policy if exists hr_document_templates_hr_read on public.hr_document_templates;
create policy hr_document_templates_hr_read on public.hr_document_templates for select to authenticated using (public.has_any_role(array['admin','hr']));

insert into public.hr_document_templates (doc_type, version, body, signatories)
select 'coe', 1,
'This is to certify that {{title}} {{employee_name}} has been employed by New Wave Maritime Training and Assessment Center, Inc. as {{position}} from {{date_hired}} up to {{date_until}}, on a {{employment_type}} employment status.

This certification is issued upon the request of {{title}} {{last_name}} for {{purpose}}, and for whatever legal purpose it may serve.

Issued this {{date_issued}} at Ermita, Manila, Philippines.',
'[{"label":"Prepared by","name":"HR OFFICER","title":"HR/Payroll Officer"},{"label":"Certified by","name":"GENERAL MANAGER","title":"General Manager"}]'::jsonb
where not exists (select 1 from public.hr_document_templates where doc_type = 'coe');

insert into public.hr_document_templates (doc_type, version, body, signatories)
select 'nte', 1,
'This notice is issued to give you the opportunity to explain your side regarding the incident described below.

1. What Happened
{{incident_facts}}

2. Rule Violated
{{rule_violated}}

3. Possible Sanction
{{possible_sanction}}

4. What You Need to Do
Submit your written explanation within five (5) calendar days from receipt of this notice, on or before {{response_due}}, through MyHR or in writing to HR. You may attach any document that supports your explanation. You may ask for an administrative conference and may be assisted by a representative of your choice. If you do not submit an explanation by the deadline, the case will be decided based on the available records.',
'[{"label":"Issued by","name":"ADMIN","title":"Admin / General Manager"}]'::jsonb
where not exists (select 1 from public.hr_document_templates where doc_type = 'nte');

insert into public.hr_document_templates (doc_type, version, body, signatories)
select 'memo', 1,
'{{memo_body}}

For your information and guidance.',
'[{"label":"","name":"ADMIN","title":"Admin / General Manager"}]'::jsonb
where not exists (select 1 from public.hr_document_templates where doc_type = 'memo');

-- COE requests (table from the base schema): number, snapshot, who issued it.
alter table public.coe_requests
  add column if not exists coe_no text unique,
  add column if not exists snapshot jsonb,
  add column if not exists issued_by uuid references public.profiles(id),
  add column if not exists drive_link text;
drop policy if exists coe_requests_staff_read on public.coe_requests;
drop policy if exists coe_requests_hr_read on public.coe_requests;
create policy coe_requests_hr_read on public.coe_requests for select to authenticated using (public.has_any_role(array['admin','hr']));

-- Memos: the printed snapshot, saved when the memo is issued (memos are never updated).
alter table public.memos add column if not exists snapshot jsonb;

-- Form Numbers: the three HR forms (set them in Admin › Form Numbers).
insert into public.document_controls (form_code, form_no) values ('coe', ''), ('nte', ''), ('memo', '') on conflict (form_code) do nothing;

-- Portal sounds (owner, 10 Nov 2026): the new-arrival chime per role is set only by the Admin, on by default.
alter table public.organization_settings
  add column if not exists portal_sound jsonb not null default '{"registration": true, "cashier": true, "releasing_officer": true, "mismo_officer": true}'::jsonb;
