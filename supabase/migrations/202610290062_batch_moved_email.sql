-- Batch moved to new dates (owner, 29 Oct 2026): the email each trainee on the batch receives.
begin;

insert into public.email_templates (template_code, version, subject, body_html, body_text, active)
select v.code, 1, v.subject, v.html, v.txt, true
from (values
  ('batch.moved', 'Your training dates changed: {{course_name}}',
   '<div style="font-family:Arial,sans-serif;color:#0f2638;max-width:560px"><h2 style="color:#123F63;margin:0 0 12px">New Wave Maritime Training and Assessment Center, Inc.</h2><p>Dear {{trainee_name}},</p><p>Your training <b>{{course_name}}</b> ({{batch_number}}) has been moved.</p><table style="border-collapse:collapse;margin:10px 0"><tr><td style="padding:4px 12px 4px 0;color:#5f7180">Before</td><td style="padding:4px 0;text-decoration:line-through">{{old_dates}}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#5f7180">New dates</td><td style="padding:4px 0"><b>{{new_dates}}</b></td></tr><tr><td style="padding:4px 12px 4px 0;color:#5f7180">Time</td><td style="padding:4px 0">{{daily_time}}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#5f7180">Reason</td><td style="padding:4px 0">{{reason}}</td></tr></table><p>Your enrollment and payments stay the same. Please report on the new first day.</p><p style="color:#5f7180;font-size:13px">Questions? Call or text 0948 847 6530, or email newwavemaritime@gmail.com.</p></div>',
   'Dear {{trainee_name}}, your training {{course_name}} ({{batch_number}}) has been moved from {{old_dates}} to {{new_dates}}, {{daily_time}}. Reason: {{reason}}. Your enrollment and payments stay the same. Questions? Call 0948 847 6530 or email newwavemaritime@gmail.com.')
) as v(code, subject, html, txt)
where not exists (select 1 from public.email_templates t where t.template_code = v.code);

commit;
