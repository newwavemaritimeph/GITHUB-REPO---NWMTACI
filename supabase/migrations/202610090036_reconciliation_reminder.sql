-- =====================================================================
-- Daily reconciliation reminder for the Accounting Manager (owner, 9 Oct
-- 2026): GCash, PSBank and UnionBank payments from earlier days that the
-- Admin Assistant has not reconciled yet. Sent with the 4:00 PM run.
-- Additive and idempotent.
-- =====================================================================

begin;

insert into public.email_templates(template_code, version, subject, body_html, body_text, active)
values (
  'reconciliation.unreconciled', 1,
  '{{count}} payment(s) not reconciled, oldest {{oldest}}',
  '<div style="margin:0;padding:20px 10px;background:#eef4f8;font-family:Arial,Helvetica,sans-serif;color:#0b1f33">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dbe7ec">
    <div style="background:#123F63;padding:16px 20px;border-bottom:4px solid #F25615;color:#ffffff;font-weight:700">NEW WAVE MARITIME · PAYMENT RECONCILIATION</div>
    <div style="padding:18px 20px">
      <p style="margin:0 0 12px;font-size:14px">{{date}} — GCash, PSBank and UnionBank payments from earlier days not yet reconciled: <b>{{count}}</b>, total <b>{{total}}</b>. Oldest: <b>{{oldest}}</b>.</p>
      {{rows_html}}
      <p style="margin:14px 0 0;font-size:12.5px;color:#5b7587">Ask the Admin Assistant to reconcile them against the printed transaction history.</p>
    </div>
  </div>
</div>',
  'NEW WAVE MARITIME - PAYMENT RECONCILIATION
{{date}}: {{count}} payment(s) from earlier days not yet reconciled, total {{total}}. Oldest: {{oldest}}.
{{rows_text}}
Ask the Admin Assistant to reconcile them against the printed transaction history.',
  true
)
on conflict do nothing;

commit;
