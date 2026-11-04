-- Training Instructions by category (owner, 3 Nov 2026): the Admin edits one template for STCW courses and
-- one for In-House courses; Registration generates the sheet and the email for enrolled trainees. One line per item.
-- Placeholders: {{trainee}} {{course}} {{dates}} {{time}} {{room}} {{classroom_link}} {{class_code}}. Additive.

create table if not exists public.instruction_category_templates (
  category text primary key check (category in ('STCW', 'In-House')),
  subject text not null,
  bring text not null default '',
  reminders text not null default '',
  policies text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.instruction_category_templates enable row level security;

insert into public.instruction_category_templates (category, subject, bring, reminders, policies) values
('STCW', 'Your training instructions · {{course}}',
 E'Valid ID and Seaman''s Book (SIRB)\nTraining uniform (white polo, black pants, black shoes)\nOwn tumbler and ballpen',
 E'Report by 7:30 AM on the first day; late arrivals over 15 minutes are rescheduled.\nAttendance is required on all training days for MARINA reporting.\nCheck your name on the TAR; report corrections before the first day.',
 E'Payment: Full payment for 1-day courses; 50% down payment otherwise.\nReschedule: 5+ days before: Php 350.00. Under 5 days: 50% of the fee + Php 250.00.\nCancellation: 5+ days before: Php 350.00. Under 5 days: 50% of the fee + Php 250.00.\nCertificate: Released after all requirements and balances are complete.'),
('In-House', 'Your training instructions · {{course}}',
 E'Valid ID\nOwn tumbler and ballpen\nLaptop or phone with camera for online classes',
 E'Join the Google Classroom with the link and class code the day before.\nFull attendance is required; keep your camera on for online classes.\nComplete the post-test and the evaluation to release your certificate.',
 E'Payment: Full payment for 1-day courses; 50% down payment otherwise.\nReschedule: 5+ days before: Php 350.00. Under 5 days: 50% of the fee + Php 250.00.\nCancellation: 5+ days before: Php 350.00. Under 5 days: 50% of the fee + Php 250.00.\nCertificate: Released after all requirements and balances are complete.')
on conflict (category) do nothing;

-- The email Registration sends with Generate Training Instructions (Design 11, "The Email"). The code fills
-- every variable when the email is sent; variables ending in _html are built by the server.
insert into public.email_templates(template_code, version, subject, body_html, body_text, active)
values ('training.instructions', 2, '{{email_subject}}',
$html$<div style="margin:0;padding:18px 12px;background:#eef3f6;font-family:Arial,Helvetica,sans-serif;color:#0f2638">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">
    <table role="presentation" style="width:100%;border-collapse:collapse"><tr>
      <td style="width:44px;padding:16px 0 12px 20px"><div style="width:44px;height:44px;line-height:44px;border-radius:50%;background:#0571D0;color:#ffffff;text-align:center;font-weight:700;font-size:14px">NW</div></td>
      <td style="padding:16px 20px 12px 12px"><div style="color:#123F63;font-weight:700;font-size:14px">NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.</div><div style="color:#587184;font-size:11.5px;line-height:1.4">Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000 · +63 948 847 6530 · (02) 8553 0310 · newwavemaritime@gmail.com</div></td>
    </tr></table>
    <div style="background:#123F63;color:#ffffff;padding:8px 20px;font-size:13px;font-weight:700;letter-spacing:.06em;border-bottom:4px solid #F25615">TRAINING INSTRUCTIONS <span style="font-weight:400;letter-spacing:0">· {{enrollment_number}}</span></div>
    <p style="margin:0;padding:16px 20px 8px;font-size:14.5px;line-height:1.5">Dear {{first_name}}, you are enrolled. Here is everything you need for your training.</p>
    <div style="margin:0 20px;background:#f3f8fb;border-radius:8px;padding:8px 12px;font-size:13px;color:#587184"><b style="color:#0f2638">{{formal_name}}</b> · {{nwmtaci_number}}{{srn_text}}</div>
    <div style="padding:14px 15px 4px">
      <div style="display:inline-block;vertical-align:top;width:47%;min-width:240px;box-sizing:border-box;margin:0 5px 10px;border:1px solid #d6e9f1;border-top:3px solid #0571D0;border-radius:8px;padding:10px 12px"><div style="font-size:11.5px;font-weight:700;letter-spacing:.08em;color:#0571D0;margin-bottom:4px">WHEN</div><div style="font-size:13.5px;line-height:1.45"><b>{{dates}}</b><br>{{time}} · {{arrive_note}}</div></div>
      <div style="display:inline-block;vertical-align:top;width:47%;min-width:240px;box-sizing:border-box;margin:0 5px 10px;border:1px solid #d6e9f1;border-top:3px solid #123F63;border-radius:8px;padding:10px 12px"><div style="font-size:11.5px;font-weight:700;letter-spacing:.08em;color:#123F63;margin-bottom:4px">WHERE</div><div style="font-size:13.5px;line-height:1.45"><b>{{classroom}}</b><br>{{where_detail}}</div></div>
      <div style="display:inline-block;vertical-align:top;width:47%;min-width:240px;box-sizing:border-box;margin:0 5px 10px;border:1px solid #d6e9f1;border-top:3px solid #F25615;border-radius:8px;padding:10px 12px"><div style="font-size:11.5px;font-weight:700;letter-spacing:.08em;color:#b23d0c;margin-bottom:4px">WHAT TO BRING</div><ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.45">{{bring_html}}</ul></div>
      <div style="display:inline-block;vertical-align:top;width:47%;min-width:240px;box-sizing:border-box;margin:0 5px 10px;border:1px solid #d6e9f1;border-top:3px solid #0a7a3e;border-radius:8px;padding:10px 12px"><div style="font-size:11.5px;font-weight:700;letter-spacing:.08em;color:#0a7a3e;margin-bottom:4px">REMINDERS</div><ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.45">{{reminders_html}}</ul></div>
    </div>
    <div style="padding:0 20px">{{classroom_block_html}}</div>
    <div style="padding:14px 20px 4px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#123F63;margin-bottom:8px">YOUR FIVE STEPS</div><table role="presentation" style="border-collapse:collapse">{{steps_html}}</table></div>
    <div style="padding:4px 20px 10px;font-size:12.5px;line-height:1.55;color:#587184">{{policies_html}}</div>
    <p style="margin:0;padding:0 20px 16px;font-size:13px;color:#587184">Your full instructions are attached as a PDF.</p>
    <div style="background:#123F63;color:#cfe3ef;padding:12px 20px;font-size:12px;line-height:1.6"><b style="color:#ffffff">Questions?</b> Call or text 0948-847-6530 · newwavemaritime@gmail.com · facebook.com/newwavemtc<br>Ride the New Wave of Maritime Excellence</div>
  </div>
</div>$html$,
$text$NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.
TRAINING INSTRUCTIONS · {{enrollment_number}}

Dear {{first_name}}, you are enrolled. Here is everything you need for your training.
{{formal_name}} · {{nwmtaci_number}}{{srn_text}}

WHEN
{{dates}}
{{time}} · {{arrive_note}}

WHERE
{{classroom}}
{{where_detail}}

WHAT TO BRING
{{bring_text}}

REMINDERS
{{reminders_text}}

{{classroom_block_text}}
YOUR FIVE STEPS
{{steps_text}}

{{policies_text}}

Your full instructions are attached as a PDF.
Questions? Call or text 0948-847-6530 · newwavemaritime@gmail.com · facebook.com/newwavemtc$text$,
true)
on conflict (template_code, version) do update set subject = excluded.subject, body_html = excluded.body_html, body_text = excluded.body_text, active = true;

select category, subject from public.instruction_category_templates order by category;
