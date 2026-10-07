-- =====================================================================
-- Email training instructions to the trainee (7 Oct 2026, owner instruction).
-- When Registration clicks Generate, the trainee's registered email receives
-- the instructions (PDF attached) with a one-click Google Classroom join link.
-- * courses.google_classroom_code: the Classroom class code, used to build the
--   join link (…/c/<id>?cjc=<code>) and shown in the email.
-- * email_templates "training.instructions" v1. Variables ending in _html are
--   built by the server (already escaped); all others are escaped on render.
-- Additive; safe to re-run.
-- =====================================================================

begin;

alter table public.courses add column if not exists google_classroom_code text;

insert into public.email_templates(template_code, version, subject, body_html, body_text, active)
values (
  'training.instructions', 1,
  'Your training instructions: {{course_name}} ({{dates}})',
  '<div style="margin:0;padding:24px 12px;background:#eef4f8;font-family:Arial,Helvetica,sans-serif;color:#0b1f33">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe7ec">
    <div style="background:#123F63;padding:18px 22px;border-bottom:4px solid #F25615">
      <div style="color:#ffffff;font-weight:700;font-size:15px;letter-spacing:.02em">NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.</div>
      <div style="color:#9EE3F1;font-size:12px;margin-top:3px">Ride the New Wave of Maritime Excellence</div>
    </div>
    <div style="padding:22px">
      <h1 style="margin:0 0 6px;font-size:20px;color:#123F63">Training instructions</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5">Dear {{trainee_name}}, you are enrolled. Please review your training details below. Your full instructions are attached as a PDF.</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;background:#f1f8fc;border:1px solid #cfe6f2;border-radius:10px;font-size:14px">
        <tr><td style="padding:10px 14px;color:#5b7587;width:110px">Course</td><td style="padding:10px 14px;font-weight:700;color:#123F63">{{course_name}}</td></tr>
        <tr><td style="padding:0 14px 10px;color:#5b7587">Date</td><td style="padding:0 14px 10px;font-weight:700;color:#123F63">{{dates}}</td></tr>
        <tr><td style="padding:0 14px 10px;color:#5b7587">Time</td><td style="padding:0 14px 10px;font-weight:700;color:#123F63">{{time}}</td></tr>
        <tr><td style="padding:0 14px 10px;color:#5b7587">Classroom</td><td style="padding:0 14px 10px;font-weight:700;color:#123F63">{{classroom}}</td></tr>
        <tr><td style="padding:0 14px 12px;color:#5b7587">Enrollment no.</td><td style="padding:0 14px 12px;font-weight:700;color:#123F63">{{enrollment_number}}</td></tr>
      </table>
      {{classroom_block_html}}
      <p style="margin:16px 0 6px;font-size:13px;font-weight:700;color:#c8440e">REMINDERS</p>
      <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6">
        <li>Arrive on time and bring a valid ID.</li>
        <li>Check your printed name on the admission record and report corrections immediately.</li>
        <li>Wear the official training uniform during the training period.</li>
      </ul>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#40606f">Questions? Message us on Facebook (facebook.com/newwavemtc), call 0948-847-6530, or email newwavemaritime@gmail.com.</p>
    </div>
    <div style="padding:12px 22px;background:#f6f9fb;font-size:11.5px;color:#5b7587">Unit 103, Bel-Air Apartments, Roxas Blvd., Ermita, Manila</div>
  </div>
</div>',
  'NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.

Dear {{trainee_name}},

You are enrolled. Your training details:
Course: {{course_name}}
Date: {{dates}}
Time: {{time}}
Classroom: {{classroom}}
Enrollment no.: {{enrollment_number}}

{{classroom_block_text}}
Reminders: arrive on time with a valid ID; check your printed name on the admission record; wear the official training uniform.

Your full instructions are attached as a PDF.
Questions? facebook.com/newwavemtc - 0948-847-6530 - newwavemaritime@gmail.com',
  true
)
on conflict (template_code, version) do update set subject = excluded.subject, body_html = excluded.body_html, body_text = excluded.body_text, active = true;

commit;
