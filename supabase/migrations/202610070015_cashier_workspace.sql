-- =====================================================================
-- Cashier workspace (7 Oct 2026, owner instruction).
-- * Payment modes: Cash, GCash, PSBank, UnionBank only; every mode except Cash
--   requires a reference. Older modes are deactivated (kept for history).
-- * cashier_openings: the opening cash each cashier records at the start of day.
-- * Email template "cashier.balance.summary": the 4:00 PM list of trainees whose
--   training has ended (or ends today) with a balance still due.
-- Additive; safe to re-run.
-- =====================================================================

begin;

insert into public.payment_methods(code, name, requires_reference, allows_proof, active, sort_order)
values ('cash', 'Cash', false, true, true, 10), ('gcash', 'GCash', true, true, true, 20),
       ('psbank', 'PSBank', true, true, true, 30), ('unionbank', 'UnionBank', true, true, true, 40)
on conflict (code) do update set name = excluded.name, requires_reference = excluded.requires_reference, active = true, sort_order = excluded.sort_order;
update public.payment_methods set active = false where code not in ('cash', 'gcash', 'psbank', 'unionbank');

create table if not exists public.cashier_openings (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.profiles(id),
  opening_date date not null,
  opening_cash_centavos bigint not null check (opening_cash_centavos >= 0),
  remarks text,
  created_at timestamptz not null default now(),
  unique (cashier_id, opening_date)
);
alter table public.cashier_openings enable row level security;

insert into public.email_templates(template_code, version, subject, body_html, body_text, active)
values (
  'cashier.balance.summary', 1,
  'Unpaid balances {{date}}: {{count}} trainee(s), {{total}} due',
  '<div style="margin:0;padding:20px 10px;background:#eef4f8;font-family:Arial,Helvetica,sans-serif;color:#0b1f33">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dbe7ec">
    <div style="background:#123F63;padding:16px 20px;border-bottom:4px solid #F25615;color:#ffffff;font-weight:700">NEW WAVE MARITIME · 4:00 PM BALANCE SUMMARY</div>
    <div style="padding:18px 20px">
      <p style="margin:0 0 12px;font-size:14px">{{date}} — trainees whose training has ended or ends today, with a balance still due: <b>{{count}}</b>, total <b>{{total}}</b>.</p>
      {{rows_html}}
      <p style="margin:14px 0 0;font-size:12.5px;color:#5b7587">Open the Cashier portal to record payments.</p>
    </div>
  </div>
</div>',
  'NEW WAVE MARITIME - 4:00 PM BALANCE SUMMARY
{{date}}: {{count}} trainee(s) with a balance after training, total {{total}}.

{{rows_text}}
Open the Cashier portal to record payments.',
  true
)
on conflict (template_code, version) do update set subject = excluded.subject, body_html = excluded.body_html, body_text = excluded.body_text, active = true;

commit;
