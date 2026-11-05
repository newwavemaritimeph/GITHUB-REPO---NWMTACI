-- MISMO ticks remember the batch and start date they were encoded under (owner, 5 Nov 2026: encoding for upcoming
-- batches). If the trainee later moves, the tick stops counting and the trainee returns to For Encoding.
-- Older ticks stay null and count as current.
alter table public.mismo_entries
  add column if not exists batch_number text,
  add column if not exists class_start date;

notify pgrst, 'reload schema';
