# Port plan — demo features → live Supabase app (Cashier & Accounting first)

The demo (`components/portal-app.tsx`, in-memory store) has the full feature set; the
live app (`components/portal-live-app.tsx`, Supabase) is what deploys. Each demo feature
must be rebuilt as: **DB (mostly already exists) → API action in `/api/staff/operations`
(or a new route) → live UI**. This file tracks the Cashier & Accounting port.

## Current state
- **Cashier (Payments)** — partly built: split/full payments, proof upload + OCR, duplicate-
  reference flagging, auto invoice + receipt PDFs. Missing: admin-managed payment channels
  (hardcoded Cash/GCash/Bank/Other today), Other Charges, agency rebates, cashier
  opening/closing + transaction history, combined admission+invoice PDF, per-enrollment
  Payment Invoice.
- **Accounting** — placeholder only (`ConnectedModule`). Missing everything: Overview
  (collections/disbursements/receivables), Invoices & Vouchers (expenses, monthly payables),
  Reconciliation (bank/GCash CSV), Setup (channels, charges, categories, agencies).

## Tables that already exist (no migration needed)
`payment_methods` (channels), `charge_catalog` (other charges), `marketing_agencies`,
`expenses`, `expense_vouchers`, `payables` (monthly payables), `cashier_closings`,
`account_reconciliation_items`, `refunds_and_reversals`, `invoices`, `receipts`,
`payment_allocations`, `payment_proofs`. RLS is enabled on all.

## Slices (each: extend API → build UI → `next build` → commit → verify on Vercel)

### Slice 1 — Accounting Overview + Setup (highest visible win; Accounting is empty today)
- **API GET**: add `payment_methods`, `charge_catalog`, `marketing_agencies`, `expenses`,
  `payables` to the `/api/staff/operations` payload.
- **API POST actions**: `channel-upsert`/`channel-archive`, `charge-upsert`/`charge-archive`,
  `agency-upsert`/`agency-archive`, `payable-upsert`/`payable-remove` (mirror the existing
  action-handler pattern; reuse its auth).
- **UI**: replace the Accounting placeholder with tabs **Overview** (collections by channel,
  disbursements, receivables ageing — computed from `payments`/`enrollments`/`expenses`) and
  **Setup** (channels, other charges, marketing agencies, monthly payables — CRUD).

### Slice 2 — Expenses & vouchers (Cashier raise, Accounting approve)
- **API POST**: `expense-create` (voucher), `expense-decide` (approve/reject/paid).
- **UI**: Cashier "Submit expense"; Accounting "Invoices & Vouchers" tab (voucher list +
  approve/reject, expense-voucher PDF via a documents route); monthly-payables reminder on the
  Accounting & Admin dashboards.

### Slice 3 — Cashier channels + Other Charges + rebates + closing
- Payment form reads channels from `payment_methods` (not hardcoded); post Other Charges to
  the ledger; agency rebate as a discount allocation; cashier opening/closing writing to
  `cashier_closings` with a per-channel transaction history.

### Slice 4 — Reconciliation + combined admission+invoice PDF
- Bank/GCash CSV upload matched to `payments` (session-only, like the demo); the 8×13
  combined ORIGINAL/DUPLICATE admission+invoice document as a live documents route.

## Verify
After each slice: `next build` clean → commit → push → sign in on `nwmtaci-2026.vercel.app`
as Cashier/Accounting and confirm the new UI works against real Supabase data (RLS respected,
no service-role leakage to the browser).
