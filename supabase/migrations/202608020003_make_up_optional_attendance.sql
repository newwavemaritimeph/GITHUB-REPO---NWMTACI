-- Make-up class requests raised by the Cashier and approved by Accounting create a
-- make-up assignment for Training Operations to complete later, before a specific
-- missed attendance record is known. Allow the attendance link to be filled in later.
-- Additive/relaxing (drops a NOT NULL); safe on a live database.

begin;

alter table public.make_up_assignments
  alter column original_attendance_record_id drop not null;

commit;
