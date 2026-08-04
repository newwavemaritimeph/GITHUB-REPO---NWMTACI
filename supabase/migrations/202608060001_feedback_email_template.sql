-- =====================================================================
-- Email template for the training-feedback form (online-training attendance).
-- The Releasing Officer / Registration can send the per-trainee feedback link to
-- the trainee's registered email; the email-jobs worker delivers it via Resend.
-- Additive and idempotent.
-- =====================================================================

begin;

insert into public.email_templates (template_code, version, subject, body_html, body_text, active)
values (
  'training.feedback', 1,
  'Your New Wave training feedback (and attendance)',
  '<p>Hi {{trainee_name}},</p><p>Thank you for training with New Wave Maritime. Please complete this short feedback form for <strong>{{course_name}}</strong>. Submitting it also records your attendance for the online training, and your certificate will then be prepared.</p><p><a href="{{feedback_url}}">Open the feedback form</a></p><p>If the link does not work, copy and paste this address into your browser:<br>{{feedback_url}}</p><p>— New Wave Maritime Training and Assessment Center</p>',
  'Hi {{trainee_name}},

Thank you for training with New Wave Maritime. Please complete this short feedback form for {{course_name}}. Submitting it also records your attendance for the online training, and your certificate will then be prepared.

Open the feedback form: {{feedback_url}}

— New Wave Maritime Training and Assessment Center',
  true
)
on conflict (template_code, version) do nothing;

commit;
