-- Referral per course (owner, 3 Nov 2026): a partner's rebate follows each enrollment, not the trainee.
-- The portal no longer falls back to trainees.marketing_agency_id, so courses that relied on that fallback
-- get their own partner here. No rebate, discount or payment is changed. Additive and safe to re-run.

-- 1. Courses with a recorded partner rebate keep that partner.
update public.enrollments e set referral_agency_id = r.agency_id
from public.agency_rebates r
where r.enrollment_id = e.id and e.referral_agency_id is null;

-- 2. Courses marked as coming from an agency take the trainee's partner.
update public.enrollments e set referral_agency_id = t.marketing_agency_id
from public.trainees t
where t.id = e.trainee_id and e.referral_agency_id is null and e.source = 'Agency' and t.marketing_agency_id is not null;

-- Every other course stays unreferred (walk-in, online or Meta).
select count(*) filter (where referral_agency_id is not null) as referred_courses, count(*) as all_courses from public.enrollments where enrollment_status <> 'Cancelled';
