-- Certificate soft copy (owner, 6 Nov 2026; design/soft-copy-sample.html): the email a trainee receives once the
-- certificate is printed, in the same letterhead as the Training Instructions. Version 1 keeps sending until this runs.
begin;

insert into public.email_templates (template_code, version, subject, body_html, body_text, active)
values ('certificate.softcopy', 2,
  'Your Certificate of Completion · {{course_name}}',
  '<div style="margin:0;padding:18px 12px;background:#eef3f6;font-family:Arial,Helvetica,sans-serif;color:#0f2638">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">
    <table role="presentation" style="width:100%;border-collapse:collapse"><tr>
      <td style="width:44px;padding:16px 0 12px 20px;vertical-align:top"><div style="width:44px;height:44px;line-height:44px;border-radius:50%;background:#0571D0;color:#ffffff;text-align:center;font-weight:700;font-size:14px">NW</div></td>
      <td style="padding:16px 20px 12px 12px"><div style="color:#123F63;font-weight:700;font-size:14px">NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.</div><div style="color:#587184;font-size:11.5px;line-height:1.4">Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000 · +63 948 847 6530 · (02) 8553 0310 · newwavemaritime@gmail.com</div></td>
    </tr></table>
    <div style="background:#123F63;color:#ffffff;padding:8px 20px;font-size:13px;font-weight:700;letter-spacing:.06em;border-bottom:4px solid #F25615">CERTIFICATE OF COMPLETION</div>
    <p style="margin:0;padding:16px 20px 10px;font-size:14.5px;line-height:1.5">Dear {{first_name}}, your certificate has been printed. Your soft copy is attached to this email as a PDF.</p>
    <div style="margin:0 20px;background:#f3f8fb;border-radius:8px;padding:8px 14px">
      <table role="presentation" style="border-collapse:collapse;width:100%">{{details_html}}</table>
    </div>
    <div style="padding:14px 20px 4px">
      {{verify_block_html}}<a href="{{delivery_url}}" style="display:inline-block;margin:0 0 8px;border:1px solid #0571D0;color:#0571D0;text-decoration:none;font-size:13.5px;font-weight:700;padding:9px 15px;border-radius:8px">Request Delivery by LBC</a>
    </div>
    <p style="margin:0;padding:4px 20px 16px;font-size:13.5px;line-height:1.5;color:#587184">You can claim the printed certificate at our office with a valid ID, or have it delivered by LBC.</p>
    <div style="background:#123F63;color:#cfe3ef;padding:12px 20px;font-size:12px;line-height:1.6"><b style="color:#ffffff">Questions?</b> Call or text 0948-847-6530 · newwavemaritime@gmail.com · facebook.com/newwavemtc<br>Ride the New Wave of Maritime Excellence</div>
  </div>
</div>',
  'Dear {{first_name}}, your certificate has been printed. Your soft copy is attached to this email as a PDF.

Course: {{course_name}}
Training Dates: {{training_dates}}
Certificate No.: {{certificate_number}}
Registration No.: {{registration_number}}
Date of Issue: {{issued_on}}

Verify this certificate: {{verify_url}}
Request delivery by LBC: {{delivery_url}}

You can claim the printed certificate at our office with a valid ID, or have it delivered by LBC.

Questions? Call or text 0948-847-6530 or email newwavemaritime@gmail.com.
Ride the New Wave of Maritime Excellence',
  true)
on conflict (template_code, version) do update set subject = excluded.subject, body_html = excluded.body_html, body_text = excluded.body_text, active = true;

commit;
