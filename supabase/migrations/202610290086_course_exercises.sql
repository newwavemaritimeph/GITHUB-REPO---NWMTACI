-- Training Reports sheets (owner, 9 Nov 2026).
-- 1. Practical exercise titles per course, printed on the Exercise Performance Sheet.
-- 2. The assessment tasks of UBT-PSSR, Safety (STPPDSPPS) and Crowd (PSCMT) as on New Wave's own TCROA files,
--    filled in only where the course has no tasks yet (tasks the officer already typed are kept).
--    Safety's first three criteria share one task title, so they print under one heading.
-- Crisis (PSCMHBT) and CCM Domestic (CCMD) tasks are encoded by the MISMO Compliance Officer in the portal.

alter table public.course_assessment_tasks add column if not exists exercises jsonb not null default '[]'::jsonb;

with seed(code, tasks) as (values
  ('UBT-PSSR', '[
    {"title": "Illustrate the continuum of harm to show escalation of a harmful beliefs to violent acts", "criteria": "Acceptable practices and procedures designed for the prevention of violence and harassment, including sexual harassment, bullying and sexual assault are observed at all time"},
    {"title": "Recommend preventive measures to be taken given a situation onboard based on a sample company policy and procedures", "criteria": "Acceptable practices and procedures designed for the prevention of violence and harassment, including sexual harassment, bullying and sexual assault are observed at all time"},
    {"title": "List reporting protocols to be followed during incidents of violence and harassment, including sexual harassment, bullying and sexual assault", "criteria": "Able to identify violence and harassment, including sexual harassment, bullying and sexual assault, and the continuum of harm and its effects. Acceptable practices and procedures designed for the intervention in and reporting of violence and harassment, including sexual harassment, bullying and sexual assault are observed at all times"},
    {"title": "Take actions to safely intervene in, and report incidents of violence and harassment, based on onboard reporting protocols and designated support mechanisms in a given scenario", "criteria": "Able to identify violence and harassment, including sexual harassment, bullying and sexual assault, and the continuum of harm and its effects. Acceptable practices and procedures designed for the intervention in and reporting of violence and harassment, including sexual harassment, bullying and sexual assault are observed at all times"}
  ]'::jsonb),
  ('STPPDSPPS', '[
    {"title": "Communication with passengers during emergency", "criteria": "Information given to passengers is clear, simple, accurate, and relevant using plain language"},
    {"title": "Communication with passengers during emergency", "criteria": "Use Elementary English in communicating basic instructions to passenger and crew"},
    {"title": "Communication with passengers during emergency", "criteria": "The use of hand signals, safety signs and symbols and safety placards in lieu of verbal communication"},
    {"title": "Demonstration on the use of personal life-saving appliances", "criteria": "Explanation and demonstration in the proper donning and usage of life jackets are in accordance with the procedures"}
  ]'::jsonb),
  ('PSCMT', '[
    {"title": "Conduct crowd management", "criteria": "Crowd management is conducted in accordance of crowd management plan and framework"},
    {"title": "Give clear orders", "criteria": "Orders are clear and reassuring"},
    {"title": "Lead passengers", "criteria": "Leading of passenger is in accordance with prescribed procedures"},
    {"title": "Evacuate persons with disability", "criteria": "Evacuation of persons with disability is in accordance with prescribed procedures"},
    {"title": "Search passengers accommodation and public areas", "criteria": "Search in accommodation and public areas in accordance with prescribed procedures"},
    {"title": "Conduct mustering", "criteria": "Mustering is conducted in accordance with prescribed procedures"},
    {"title": "Disembark passengers", "criteria": "Passengers are guided in disembarkation to assigned muster station"}
  ]'::jsonb)
)
insert into public.course_assessment_tasks (course_id, tasks, updated_at)
select c.id, s.tasks, now() from seed s join public.courses c on upper(c.code) = s.code
on conflict (course_id) do update set tasks = excluded.tasks, updated_at = now()
where public.course_assessment_tasks.tasks = '[]'::jsonb;

-- Form Numbers for the three sheets (Accounting or the Admin can change them later). The Assessment Performance
-- Sheet starts with the values on New Wave's file.
insert into public.document_controls (form_code, form_no, revision_no, revision_date, issued_date) values
  ('attendance_sheet', '', '', '', ''),
  ('exercise_sheet', '', '', '', ''),
  ('assessment_sheet', 'NW-TRNG-09-26', '', '', '05/25/2026')
on conflict (form_code) do nothing;

-- What each STCW course has now.
select c.code, jsonb_array_length(t.tasks) as tasks, jsonb_array_length(t.exercises) as exercises
from public.courses c left join public.course_assessment_tasks t on t.course_id = c.id
where upper(c.code) in ('UBT-PSSR', 'STPPDSPPS', 'PSCMT', 'PSCMHBT', 'CCMD') order by c.code;
