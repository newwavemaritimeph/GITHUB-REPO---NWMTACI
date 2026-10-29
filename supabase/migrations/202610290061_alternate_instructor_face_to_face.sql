-- Create Schedule staffing and wording (owner, 29 Oct 2026):
-- 1) an Alternate Instructor beside the Lead Instructor and the Assessor;
-- 2) batch mode "In-person" becomes "Face-to-Face", for existing batches and for the
--    batch functions that write it.
begin;

alter table public.batch_resources add column if not exists alt_instructor_id uuid references public.instructors(id);

update public.batches set mode = 'Face-to-Face' where lower(mode) in ('in-person', 'in person');
update public.courses set training_mode = 'Face-to-Face' where lower(training_mode) in ('in-person', 'in person', 'face-to-face');

-- Patch whatever versions of the batch functions are live (as 054 did) instead of copying old bodies.
do $$
declare f record; def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (case when p.prokind = 'f' then pg_get_functiondef(p.oid) end) like '%''In-person''%'
  loop
    def := replace(pg_get_functiondef(f.oid), '''In-person''', '''Face-to-Face''');
    execute def;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
