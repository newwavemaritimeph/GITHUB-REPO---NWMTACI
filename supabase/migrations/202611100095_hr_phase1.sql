-- HR Module, Phase 1 (owner, 10 Nov 2026).
-- 1. The HR Officer role comes back (one HR role; the Admin keeps every HR power).
-- 2. Employee 201: biodata, Medical Fit to Work every 6 months, biodata review every 6 months.
-- 3. Memorandums with acknowledgment, 201 change requests, and the reminder log behind the bell.
-- 4. HR tables become readable only by Admin and HR (and the employee, for their own row).
--    Every portal read and write already goes through the server with the service role,
--    so this only closes direct reads by other staff.

-- 1. HR Officer role.
update public.roles set active = true, name = 'HR Officer', is_staff = true where code = 'hr';
insert into public.roles (code, name, is_staff, active)
select 'hr', 'HR Officer', true, true where not exists (select 1 from public.roles where code = 'hr');

-- 2. Employee 201.
alter table public.employees
  add column if not exists birth_date date,
  add column if not exists sex text,
  add column if not exists civil_status text,
  add column if not exists address text,
  add column if not exists mobile text,
  add column if not exists personal_email text,
  add column if not exists employment_type text not null default 'Regular',
  add column if not exists biometric_id text,
  add column if not exists regularization_date date,
  -- Medical Fit to Work: the accepted certificate date, and a newer upload waiting for HR to check.
  add column if not exists fit_to_work_on date,
  add column if not exists fit_to_work_path text,
  add column if not exists fit_to_work_pending_on date,
  add column if not exists fit_to_work_pending_path text,
  add column if not exists fit_to_work_uploaded_at timestamptz,
  -- Biodata review: the employee confirms "no changes", or HR accepts a 201 change.
  add column if not exists biodata_confirmed_at timestamptz;
create unique index if not exists employees_biometric_id_key on public.employees (biometric_id) where biometric_id is not null;

-- Reminder settings: one row. Every 6 months, first reminder 30 days before, repeat every 7 days.
create table if not exists public.hr_settings (
  id boolean primary key default true check (id),
  fit_to_work_months integer not null default 6 check (fit_to_work_months between 1 and 24),
  biodata_months integer not null default 6 check (biodata_months between 1 and 24),
  first_reminder_days integer not null default 30 check (first_reminder_days between 1 and 90),
  repeat_days integer not null default 7 check (repeat_days between 1 and 30),
  include_in_daily_email boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.hr_settings (id) values (true) on conflict (id) do nothing;

-- Reminders HR sent from the bell (insert-only).
create table if not exists public.hr_reminders (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  reminder_type text not null check (reminder_type in ('fit_to_work', 'biodata')),
  sent_by uuid references public.profiles(id),
  sent_at timestamptz not null default now()
);
create index if not exists hr_reminders_employee_idx on public.hr_reminders (employee_id, reminder_type, sent_at desc);

-- 3. Memorandums. Never edited after issue: a correction is a new memo.
create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  memo_no text not null unique,
  memo_type text not null,
  subject text not null,
  body text not null,
  audience text not null default 'All Employees',
  issued_by uuid references public.profiles(id),
  issued_at timestamptz not null default now()
);
create table if not exists public.memo_recipients (
  memo_id uuid not null references public.memos(id),
  employee_id uuid not null references public.employees(id),
  acknowledged_at timestamptz,
  primary key (memo_id, employee_id)
);

-- 201 change requests (and later request types) filed in MyHR.
create table if not exists public.hr_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  employee_id uuid not null references public.employees(id),
  request_type text not null,
  details text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_remarks text,
  created_at timestamptz not null default now()
);
create index if not exists hr_requests_status_idx on public.hr_requests (status, created_at desc);

drop trigger if exists memos_immutable on public.memos;
create trigger memos_immutable before update or delete on public.memos for each row execute function public.prevent_immutable_change();
drop trigger if exists hr_reminders_immutable on public.hr_reminders;
create trigger hr_reminders_immutable before update or delete on public.hr_reminders for each row execute function public.prevent_immutable_change();

alter table public.hr_settings enable row level security;
alter table public.hr_reminders enable row level security;
alter table public.memos enable row level security;
alter table public.memo_recipients enable row level security;
alter table public.hr_requests enable row level security;

-- 4. HR-only reads (Admin and HR), plus the employee's own row where it applies.
do $$ declare t text; begin
  foreach t in array array['employees','leave_requests','cash_advances','payroll_items','payslips','benefit_records','employment_contracts','employee_attendance','hr_settings','hr_reminders','memos','memo_recipients','hr_requests'] loop
    execute format('drop policy if exists %I_staff_read on public.%I', t, t);
    execute format('drop policy if exists %I_hr_read on public.%I', t, t);
    execute format('create policy %I_hr_read on public.%I for select to authenticated using (public.has_any_role(array[''admin'',''hr'']))', t, t);
  end loop;
end $$;
drop policy if exists employees_self_read on public.employees;
create policy employees_self_read on public.employees for select to authenticated using (profile_id = auth.uid());

-- E-mail for HR reminders and memos (subject and body are filled in by the portal).
insert into public.email_templates (template_code, version, subject, body_html, body_text, active)
select 'hr.notice', 1, '{{subject}}',
  '<div style="margin:0;padding:20px 10px;background:#eef4f8;font-family:Arial,Helvetica,sans-serif;color:#0b1f33">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dbe7ec">
    <div style="background:#123F63;padding:16px 20px;border-bottom:4px solid #F25615;color:#ffffff;font-weight:700">NEW WAVE MARITIME · HR</div>
    <div style="padding:18px 20px;font-size:14px;line-height:1.55">
      <p style="margin:0 0 10px">Hi {{name}},</p>
      {{body_html}}
      <p style="margin:16px 0 0"><a href="{{link}}" style="display:inline-block;background:#F25615;color:#ffffff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px">Open MyHR</a></p>
    </div>
  </div>
</div>',
  'Hi {{name}},

{{body_text}}

Open MyHR: {{link}}', true
where not exists (select 1 from public.email_templates where template_code = 'hr.notice' and version = 1);
