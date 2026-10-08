-- MARINA MISMO Compliance Officer and certificate delivery requests (owner, 8 Oct 2026). Additive.

-- 1. New staff role.
insert into public.roles(code, name, is_staff) values ('mismo_officer', 'MISMO Compliance Officer', true)
on conflict (code) do nothing;

-- 2. Batches the Compliance Officer submitted to the MARINA MISMO Portal (one record per batch).
create table if not exists public.mismo_submissions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.batches(id) on delete cascade,
  list_date date not null,
  enrollment_ids uuid[] not null default '{}',
  trainee_count integer not null default 0,
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz not null default now()
);
alter table public.mismo_submissions enable row level security;

-- 3. Certificate delivery requests from the website. Trainee requests → Registration checks →
--    Cashier collects the LBC fee (a pay-first "Certificate delivery" request) → Releasing Officer ships.
create table if not exists public.delivery_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  trainee_id uuid not null references public.trainees(id),
  enrollment_id uuid not null references public.enrollments(id),
  recipient_name text not null,
  mobile text not null,
  address_line text not null,
  city text not null,
  province text not null,
  zip text,
  email text not null,
  status text not null default 'Requested' check (status in ('Requested', 'With the Cashier', 'Paid', 'Shipped', 'Delivered', 'Declined')),
  request_id uuid references public.enrollment_requests(id),
  decline_reason text,
  checked_by uuid references public.profiles(id),
  checked_at timestamptz,
  paid_at timestamptz,
  tracking_number text,
  shipped_on date,
  shipped_by uuid references public.profiles(id),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists delivery_requests_status on public.delivery_requests (status, created_at desc);
alter table public.delivery_requests enable row level security;

-- 4. Emails to the trainee at each step.
insert into public.email_templates (template_code, version, subject, body_html, body_text, active)
select v.code, 1, v.subject, v.html, v.txt, true
from (values
  ('delivery.received', 'Certificate delivery request {{request_number}} received',
   '<div style="font-family:Arial,sans-serif;color:#0f2638;max-width:560px"><h2 style="color:#123F63;margin:0 0 12px">New Wave Maritime Training and Assessment Center, Inc.</h2><p>Dear {{trainee_name}},</p><p>We received your request <b>{{request_number}}</b> to deliver your certificate for <b>{{course_name}}</b> to:</p><p>{{address}}</p><p>Registration will check your certificate first. We will then email you how to pay the delivery fee of {{fee}}.</p><p>Track your request: {{track_url}}</p></div>',
   'Dear {{trainee_name}}, we received your request {{request_number}} to deliver your certificate for {{course_name}} to {{address}}. Registration will check your certificate first; we will then email you how to pay the delivery fee of {{fee}}. Track it at {{track_url}}'),
  ('delivery.payment', 'Pay the delivery fee for {{request_number}}',
   '<div style="font-family:Arial,sans-serif;color:#0f2638;max-width:560px"><h2 style="color:#123F63;margin:0 0 12px">New Wave Maritime Training and Assessment Center, Inc.</h2><p>Dear {{trainee_name}},</p><p>Your certificate for <b>{{course_name}}</b> is ready to send. Please pay the delivery fee of <b>{{fee}}</b> at our Cashier — in cash at the office, or by GCash, PSBank or UnionBank (ask the Cashier for the account details). Quote your request number <b>{{request_number}}</b>.</p><p>We ship by LBC once the payment is recorded and email you the tracking number.</p><p>Track your request: {{track_url}}</p></div>',
   'Dear {{trainee_name}}, your certificate for {{course_name}} is ready to send. Please pay the delivery fee of {{fee}} at our Cashier (cash, GCash, PSBank or UnionBank) and quote {{request_number}}. We ship by LBC once paid and email you the tracking number. Track it at {{track_url}}'),
  ('delivery.declined', 'Certificate delivery request {{request_number}}',
   '<div style="font-family:Arial,sans-serif;color:#0f2638;max-width:560px"><h2 style="color:#123F63;margin:0 0 12px">New Wave Maritime Training and Assessment Center, Inc.</h2><p>Dear {{trainee_name}},</p><p>We could not process your delivery request <b>{{request_number}}</b>: {{reason}}</p><p>You may send a new request on our website once this is resolved, or contact us for help.</p></div>',
   'Dear {{trainee_name}}, we could not process your delivery request {{request_number}}: {{reason}}. You may send a new request once this is resolved, or contact us.'),
  ('delivery.shipped', 'Your certificate is on its way — {{request_number}}',
   '<div style="font-family:Arial,sans-serif;color:#0f2638;max-width:560px"><h2 style="color:#123F63;margin:0 0 12px">New Wave Maritime Training and Assessment Center, Inc.</h2><p>Dear {{trainee_name}},</p><p>Your certificate for <b>{{course_name}}</b> was sent by LBC.</p><p>Tracking number: <b>{{tracking_number}}</b></p><p>Track your request: {{track_url}}</p></div>',
   'Dear {{trainee_name}}, your certificate for {{course_name}} was sent by LBC. Tracking number: {{tracking_number}}. Track it at {{track_url}}')
) as v(code, subject, html, txt)
where not exists (select 1 from public.email_templates t where t.template_code = v.code);
