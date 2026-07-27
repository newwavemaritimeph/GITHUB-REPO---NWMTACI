# Staging deployment — Supabase + Vercel

This runbook stands up a **staging** deployment of the New Wave portal on **Vercel**
(Next.js) backed by **Supabase** (Postgres, Auth, Storage, RLS). Staging first is
required by `CLAUDE.md` — do not publish a partial production release.

## What this deploys (read first)

- The deployed portal is the **Supabase-backed live app** (`components/portal-live-app.tsx`).
- In production the unauthenticated in-memory **demo** (`components/portal-app.tsx`) is
  **disabled by design** (`lib/system/mode.ts`, `app/portal/page.tsx`). Features built in the
  demo (combined admission+invoice PDF, monthly payables, auto-merge, instructors-in-HR,
  classroom instructor, the Accounting/HR/Admin/Training restructures, ALL-CAPS portal
  styling) are **not** in this deploy yet — they live only in the demo store and must be
  ported to the Supabase backend later.
- The public marketing site and branding (including the new emblem logo) **are** included.

## Prerequisites

- Node.js ≥ 22.13 locally (for migrations/seed).
- A Supabase account + a **new staging project** (you create this — I can't create accounts
  or handle secrets).
- A Vercel account with this Git repo connected.
- `next build` already verified locally (Vercel uses `vercel.json`: `buildCommand: next build`,
  region `sin1`).

## Environment variables

| Variable | Scope | Where | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Vercel + local | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Vercel + local | Publishable/anon key (browser-safe) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | optional | Fallback for the above |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | Vercel (server) + local seed | **Never** `NEXT_PUBLIC_`. Server-only. |
| `DATABASE_URL` | **secret** | local only | Pooled/direct Postgres URL — used only by migration/seed scripts |
| `RESEND_API_KEY` | **secret** | Vercel | Email sending |
| `RESEND_WEBHOOK_SECRET` | **secret** | Vercel | Verifies Resend webhooks |
| `EMAIL_FROM` | config | Vercel | e.g. `New Wave Maritime <no-reply@yourdomain>` |
| `APP_BASE_URL` | config | Vercel | The Vercel staging URL (set after first deploy) |
| `SCHEDULED_JOB_SECRET` | **secret** | Vercel | Guards `/api/jobs/*` |
| `CERTIFICATE_ISSUANCE_ENABLED` | config | Vercel | Keep `false` until an approved template exists |
| `NEXT_PUBLIC_DEMO_MODE` | config | Vercel | **`false`** in all hosted envs |
| `TEMP_STAFF_EMAIL` / `TEMP_STAFF_PASSWORD` / `TEMP_STAFF_SESSION_TOKEN` | dev only | — | **Do NOT set in staging/production** |

## Steps

> **Supabase is already provisioned.** An existing project on the `newwavemaritimeph`
> free account is the New Wave backend:
> - ref `bgcrfyuhrqynohbargcl`, region `ap-southeast-1`, status ACTIVE_HEALTHY
> - full schema present (RLS on every table), catalog seeded (`partner_course_offers` = 96),
>   roles seeded, and **one staff account already linked** (`user_roles`).
> - Public config values are captured in `.env.staging.example`.
>
> So **skip project creation, migrations, and seed** (steps 1–2 below) — they are done.
> Only re-run them if you deliberately stand up a *different* project.
> (Free-tier caveat: the project pauses after ~7 days idle and has lower limits — fine for
> staging, not for always-on production.)

### 1. ~~Create the Supabase staging project~~ — already done
Project `bgcrfyuhrqynohbargcl`. The public URL + publishable/anon keys are in
`.env.staging.example`. The `service_role` key and `DATABASE_URL` remain in your Supabase
dashboard (**Settings → API / Database**) — needed only if you seed/migrate a fresh project.

### 2. ~~Apply migrations + seed~~ — already applied (schema + data present)
For reference, a *fresh* project would apply migrations in order (bare filename) then seed:
`202607230001…`, `0002`, `0003`, `0004`, `0005`, `0006`, then `npm run db:seed`. Private
**Storage buckets** are created by migration `…0002`. Migrations are append-only once applied.

### 3. Configure Supabase Auth + Storage (you)
- **Auth → URL Configuration**: set **Site URL** and add a **Redirect URL** for your Vercel
  domain: `https://<your-staging>.vercel.app/auth/callback`.
- Email/password auth is used; leave sign-ups closed (staff are invited).
- Storage buckets are private by policy (created by the migration) — no public bucket.

### 4. Create the Vercel project (you)
- Import this Git repo. Vercel reads `vercel.json` (framework `nextjs`, `next build`, region `sin1`).
- Add all env vars from the table above (except the dev-only `TEMP_STAFF_*` and `DATABASE_URL`,
  which are only needed locally for migrations/seed). Mark the secrets as **Encrypted**.
- Deploy.

### 5. Point base URLs at the deploy, redeploy
After the first deploy, set `APP_BASE_URL` to the Vercel URL and confirm the Supabase
redirect URL matches, then redeploy so links/emails/auth callbacks resolve correctly.

### 6. Staff account — one already exists
`user_roles` already has 1 linked staff account, so you can sign in immediately with that
Supabase Auth user's email/password. To add more staff: in **Supabase → Auth** invite a real
email (never invent one — `CLAUDE.md`), then link it to a role in `user_roles` (via the Admin
config flow once signed in, or a one-off SQL insert). Without a role, `/portal` redirects to
`/registration-search`.

### 7. Verify staging (checklist)
- [ ] Public site loads; branding/logo correct.
- [ ] `/staff-login` reachable; a seeded/invited staff account can sign in.
- [ ] `/portal` renders the **live** app for a staff user (not the demo).
- [ ] Public registration submits; appears in staff registration search.
- [ ] RLS: an anonymous/trainee session cannot read staff-only data (rebates, ledger).
- [ ] Documents endpoints (`/api/documents/*`) generate PDFs.
- [ ] `CERTIFICATE_ISSUANCE_ENABLED=false`; certificate issuance stays disabled.
- [ ] `NEXT_PUBLIC_DEMO_MODE=false`; the demo workspace is not reachable.

## Security invariants (from CLAUDE.md)

- Browser bundles receive **only** the Supabase URL + publishable/anon key. Service-role,
  `DATABASE_URL`, Resend, webhook, and scheduler secrets are **server-only**.
- Financial/audit events are append-only; issued documents keep immutable snapshots.
- Certificate issuance stays disabled until an approved active template exists **and**
  `CERTIFICATE_ISSUANCE_ENABLED=true` is deliberately set.
- Do not promote staging to production until the launch checklist and acceptance suite pass.

## Auth email & SMTP (staff invites, password resets)

Auth emails (invitations, password recovery) are sent by Supabase, not the app.

### Required — URL configuration (fixes "site can't be reached")
Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://nwmtaci-2026.vercel.app`
- **Redirect URLs**: add `https://nwmtaci-2026.vercel.app/**`

Without these, recovery/invite links fall back to `localhost:3000`. The app now
builds `redirectTo` from the live request origin, but Supabase still only honors
allowlisted redirect URLs and otherwise uses the Site URL.

Optional: set `APP_BASE_URL=https://nwmtaci-2026.vercel.app` in Vercel to make the
redirect origin explicit (the request-origin fallback already covers it).

### Required for real use — custom SMTP (removes the built-in rate limit)
The built-in Supabase sender is test-only (~2–4 auth emails/hour across invites +
resets → "email rate limit exceeded"). Configure a real sender in
**Authentication → Emails → SMTP Settings** (matches the Resend plan in CLAUDE.md):

- **Host**: `smtp.resend.com`
- **Port**: `465` (SSL) or `587` (STARTTLS)
- **Username**: `resend`
- **Password**: your Resend API key (`re_…`) — entered in the Supabase dashboard only, never committed
- **Sender email**: an address on a domain verified in Resend (e.g. `no-reply@yourdomain`)
- **Sender name**: `New Wave Maritime`

After saving, raise **Rate Limits** (Authentication → Rate Limits) to your provider's capacity.

### Passwords
Never set/stored in the portal by design (browser only gets the anon key). Users set
their own via the invite or reset email. To force a reset without email, use
**Authentication → Users → (user) → Reset/Update password** in the Supabase dashboard.
