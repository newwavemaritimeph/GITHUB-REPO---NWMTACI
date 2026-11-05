-- In-House courses are a module sent through Google Classroom; the post-test and evaluation links come by email at
-- 4:00 PM on the last training day (owner, 5 Nov 2026). Text the Admin has already edited is left alone. Additive.

update public.instruction_category_templates
set bring = E'Laptop or phone with internet\nThe Google (Gmail) account you registered with', updated_at = now()
where category = 'In-House' and bring = E'Valid ID\nOwn tumbler and ballpen\nLaptop or phone with camera for online classes';

update public.instruction_category_templates
set reminders = E'The module is sent through Google Classroom. Join the class with the link and class code.\nFinish the module by your last training day. The post-test and evaluation links come by email at 4:00 PM that day.\nPass the post-test and answer the evaluation to release your certificate.', updated_at = now()
where category = 'In-House' and reminders = E'Join the Google Classroom with the link and class code the day before.\nFull attendance is required; keep your camera on for online classes.\nComplete the post-test and the evaluation to release your certificate.';

-- Version 3: the list heading reads What You Need for a module and What to Bring otherwise.
insert into public.email_templates(template_code, version, subject, body_html, body_text, active)
select template_code, 3, subject, replace(body_html, 'WHAT TO BRING', '{{bring_title}}'), replace(body_text, 'WHAT TO BRING', '{{bring_title}}'), true
from public.email_templates where template_code = 'training.instructions' and version = 2
on conflict (template_code, version) do update set subject = excluded.subject, body_html = excluded.body_html, body_text = excluded.body_text, active = true;

select category, bring, reminders from public.instruction_category_templates order by category;
select version, active from public.email_templates where template_code = 'training.instructions' order by version;
