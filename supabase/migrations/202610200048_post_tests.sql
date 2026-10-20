-- =====================================================================
-- Course post-tests (owner, 20 Oct 2026): 10 multiple-choice questions per
-- course, drafted from each certificate's course description and approved by
-- the Admin; pass mark 70% by default; unlimited retakes. A course's test is
-- live once approved, and its certificates are released only after the trainee
-- passes. Every attempt is kept (append-only).
-- Additive and idempotent.
-- =====================================================================

begin;

create table if not exists public.post_tests (
  course_id uuid primary key references public.courses(id) on delete cascade,
  passing_percent integer not null default 70 check (passing_percent between 1 and 100),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table if not exists public.post_test_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  position integer not null,
  question text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  answer integer not null check (answer >= 0),
  why text,
  unique (course_id, position)
);

create table if not exists public.post_test_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  course_id uuid not null references public.courses(id),
  score integer not null,
  total integer not null,
  percent integer not null,
  passed boolean not null,
  answers jsonb not null,
  submitted_at timestamptz not null default now()
);
create index if not exists post_test_attempts_enrollment_idx on public.post_test_attempts(enrollment_id, submitted_at desc);

alter table public.post_tests enable row level security;
alter table public.post_test_questions enable row level security;
alter table public.post_test_attempts enable row level security;

drop trigger if exists post_test_attempts_immutable on public.post_test_attempts;
create trigger post_test_attempts_immutable before update or delete on public.post_test_attempts
  for each row execute function public.prevent_immutable_change();

-- The end-of-training email (owner's Option B, 20 Oct 2026): training details, then the
-- post-test and the evaluation buttons; the body is built by lib/training-end-email.ts.
insert into public.email_templates(template_code, version, subject, body_html, body_text, active)
values (
  'training.completion', 1,
  'Post-Test and Evaluation: {{course_name}} ({{course_code}})',
  '<div style="margin:0;padding:20px 10px;background:#eef4f8;font-family:Arial,Helvetica,sans-serif;color:#0b1f33">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dbe7ec;font-size:14.5px;line-height:1.6">
    <div style="background:#0571D0;padding:16px 20px;border-bottom:4px solid #F25615;color:#ffffff"><b style="letter-spacing:.04em">NEW WAVE MARITIME</b><br><span style="font-size:12px">Ride the New Wave of Maritime Excellence</span></div>
    <div style="padding:20px">{{body_html}}</div>
    <div style="background:#f6f9fb;border-top:1px solid #e3ecf0;padding:14px 20px;font-size:12.5px;color:#5b7587"><b>New Wave Maritime Training and Assessment Center, Inc.</b><br>103 Bel Air Apartments, Roxas Blvd., 1020 Ermita, Manila<br>0948 847 6530 · newwavemaritime@gmail.com<br>Check your enrollment, payments and certificate anytime at newwavemaritimemtaci.com/registration-search with your SRN and NWMTACI No.</div>
  </div>
</div>',
  '{{body_text}}',
  true
)
on conflict (template_code, version) do update set subject = excluded.subject, body_html = excluded.body_html, body_text = excluded.body_text, active = true;

notify pgrst, 'reload schema';

commit;
