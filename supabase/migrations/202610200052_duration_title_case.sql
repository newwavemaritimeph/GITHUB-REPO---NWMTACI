-- Course durations in Title Case (owner, 20 Oct 2026): "1 day" → "1 Day", "5 days" → "5 Days", "40 hours" → "40 Hours".
-- Words only change their first letter; the numbers stay as they are.
begin;
update public.courses set duration_label = initcap(duration_label) where duration_label is not null and duration_label <> initcap(duration_label);
update public.partner_course_offers set duration_label = initcap(duration_label) where duration_label is not null and duration_label <> initcap(duration_label);
commit;
