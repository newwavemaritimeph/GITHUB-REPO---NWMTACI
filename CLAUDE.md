# Claude Code handoff

Read `MASTERPLAN.md` before changing the system. It is the product source of truth. Preserve the existing Next.js/Vinext/Sites structure and Supabase architecture; do not replace them with a mock or client-only implementation.

## Product identity

- Organization: New Wave Maritime Training and Assessment Center, Inc. (NWMTACI)
- Tagline: Ride the New Wave of Maritime Excellence
- Brand colors: orange `#F25615`, blue `#0571D0`, cyan `#35CCFA`, light cyan `#9EE3F1`, dark blue `#123F63`, and white
- Use readable Geist/system sans-serif text, sentence case, regular body weight, and mobile-friendly controls.
- Never restore Tara Barko names, sample metadata, or identifiers.

## Architecture and invariants

- Next.js 16 App Router, TypeScript, React, Vinext, Cloudflare Worker/Sites packaging.
- Supabase provides Postgres, email/password authentication, private Storage, and RLS.
- Browser bundles may receive only the Supabase URL and publishable/anonymous key. Service-role, database, Resend, webhook, and scheduler credentials stay server-only.
- Money is stored as integer centavos. Operational timestamps are timezone-aware.
- Financial and audit events are append-only. Corrections use compensating events; issued documents retain immutable snapshots.
- All sensitive commands need server-side permission checks and RLS. UI visibility alone is not authorization.
- Endorsed-course rebates are visible to authenticated staff, never to trainees or anonymous visitors.
- Certificate issuance stays disabled until an approved active template exists and `CERTIFICATE_ISSUANCE_ENABLED=true` is deliberately configured.
- Do not publish a partial production release. Use staging until the launch checklist and acceptance suite pass.

## Current implementation

Implemented foundations include:

- Branded responsive public pages and staff/trainee authentication surfaces.
- Supabase schema, RLS, storage policies, roles, identifiers, audit data, organization settings, and catalog seeds.
- 148 New Wave course records and exactly 96 endorsed partner offers.
- Public registration with complete trainee details, terms acceptance, duplicate protection, automatic trainee account invitation, and registration search.
- Trainee, enrollment, course, schedule, batch, instructor/room, and 24-seat capacity workflows.
- New Wave batch cadence rules, including the dedicated BT-PSSR, Safety, Crowd, and Crisis patterns.
- Cashier full/split payments, screenshot proof storage, OCR-assisted reference entry with manual correction, duplicate-reference review, ledger posting, and payment documents.
- Admission slip, invoice, and acknowledgment receipt PDF endpoints using the supplied reference artwork.
- Admin-managed courses, partner centers, marketing agencies, payment modes, pricing, duration, staff invitation, and organization settings.
- Date-sensitive operational reports and export endpoints.

Known incomplete production modules:

- Live QR attendance scanning, corrections, evidence, make-up linkage, and attendance submission locks.
- Versioned training instructions, trainee acknowledgment, delivery logs, and resend controls.
- Certificate template upload/approval, number pools, preview/print/void/reprint/release UI and full test coverage.
- Complete expenses, vouchers, reconciliation, accounting locks, payables, refunds, and Cashier closing workflows.
- HR attendance, leave, benefits, advances, payroll finalization, payslips, 13th-month calculations, and COE requests.
- Resend production configuration, signature-verified webhooks, retrying jobs, weekly instructor email schedule, and delivery observability.
- Role-complete end-to-end, accessibility, concurrency, backup/restore, security, and final acceptance tests.
- Final pixel calibration of text overlays on the supplied admission and acknowledgment-receipt artwork.

Do not describe the repository as production-complete until these items and every acceptance requirement in `MASTERPLAN.md` are verified.

## Local setup

1. Run `npm install` with Node.js 22.13 or newer.
2. Copy `.env.example` to `.env.local` and fill in credentials locally. Never commit `.env.local`.
3. Apply `supabase/migrations/*.sql` in filename order.
4. Run `npm run db:seed`.
5. Run `npm run dev`.

Validation commands:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

For a single migration file, use `npm run db:migrate:file -- supabase/migrations/<file>.sql`. Keep migrations append-only after they have been applied remotely.

## Supabase and staff access

The migrations seed employee profiles for Karen Mallari (Cashier), April Cantoneros (General Manager/Admin), and Kathleen Garcia (Accounting Manager), but real staff sign-in accounts require their actual email addresses. Invite staff through the Admin configuration UI or Supabase Auth; never invent production emails or share passwords in the repository.

## Recommended next vertical slice

Finish attendance end to end first: database transaction and idempotency tests, staff camera scanner, hashed/revocable token validation, check-in/out windows, manual fallback, approval-based correction, trainee summary, and reports. Then complete training instructions and certificate readiness because those depend directly on verified attendance.

After every slice, add tests at the database, integration, and role UI levels. Keep date filters on reports and audit every sensitive export.
