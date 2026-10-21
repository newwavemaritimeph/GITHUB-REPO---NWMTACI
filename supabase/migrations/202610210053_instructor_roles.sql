-- Instructors and assessors per course (owner, 21 Oct 2026): each course an instructor holds is
-- marked Instructor, Assessor, or Instructor and Assessor; every batch gets an assessor too.
begin;
alter table public.instructor_accreditations add column if not exists role text not null default 'Instructor';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'instructor_accreditations_role_check') then
    alter table public.instructor_accreditations add constraint instructor_accreditations_role_check check (role in ('Instructor', 'Assessor', 'Instructor and Assessor'));
  end if;
end $$;
alter table public.batch_resources add column if not exists assessor_id uuid references public.instructors(id);
notify pgrst, 'reload schema';
commit;
