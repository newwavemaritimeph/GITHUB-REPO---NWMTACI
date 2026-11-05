-- Form Numbers (owner, 5 Nov 2026): Accounting and the Admin set the Form No., Revision No., Revision Date and
-- Issued Date of every form. Text, because existing forms print values such as "00". A form with all four blank
-- prints no details. Additive; the starting values match what the forms print today, plus the owner's voucher values.

create table if not exists public.document_controls (
  form_code text primary key,
  form_no text not null default '',
  revision_no text not null default '',
  revision_date text not null default '',
  issued_date text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.document_controls enable row level security;

insert into public.document_controls (form_code, form_no, revision_no, revision_date, issued_date) values
  ('expense_voucher', '', '01', '', '11/05/2026'),
  ('expenses_summary', '', '', '', ''),
  ('billing_statement', 'NW-FMGR-04-24', '', '', '12/03/2025'),
  ('company_receipt', 'NW-FMGR-04-24', '', '', '12/03/2025'),
  ('cash_sales_summary', '', '', '', ''),
  ('endorsed_courses', '', '', '', ''),
  ('reconciliation', '', '', '', ''),
  ('ack_receipt', '', '', '', ''),
  ('cashier_report', '', '', '', ''),
  ('tar', '', '', '', ''),
  ('terms', '', '03', '11/05/2026', '11/05/2026'),
  ('enrollment_record', '', '', '', ''),
  ('instructions', '', '', '', ''),
  ('completion_record', '05-00', '', '00', '09-14-2023'),
  ('mismo_final', '', '', '', ''),
  ('mismo_unsettled', '', '', '', ''),
  ('batch_roster', '', '', '', ''),
  ('resource_plan', '', '', '', ''),
  ('payslip', '', '', '', '')
on conflict (form_code) do nothing;
