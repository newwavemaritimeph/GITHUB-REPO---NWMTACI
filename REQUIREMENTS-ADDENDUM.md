# Requirements addendum — 23 July 2026

New requirements from New Wave that are **not** covered by `MASTERPLAN.md`, with
current status. Source documents supplied: the Acknowledgement Receipt pad
(No. 0001 series) and the Admission Form (`NW-REG-01-26`, revision 01,
issued 28 May 2026).

Status key: **Done** · **Partial** — started, gaps listed · **Open** — not started ·
**Blocked** — needs something only New Wave can provide.

---

## 1. Field formats — **Done**

- Contact numbers must be Philippine format. Mobile (`09XXXXXXXXX`, `+639XXXXXXXXX`,
  `9XXXXXXXXX`) and landline (`(02) 8553 0310`, provincial area codes) are both
  accepted and stored as E.164.
- SRN must be exactly 10 digits. Optional, but validated whenever supplied.
- Email must be a valid address.

Implemented in `lib/validation.ts`, covered by `tests/validation.test.ts`
(10 tests), enforced in `app/api/public/registrations/route.ts` before anything
reaches the database. Values are normalised on the way in, so the same trainee
cannot be stored twice under `0917 123 4567` and `+639171234567`.

## 2. Batch and schedule opening — **Partial**

- New Wave's own courses: batches open automatically from the course's date
  pattern. `lib/scheduling.ts` has `validBatchStart` and `automaticEndDate`
  (skipping Sundays); `tests/scheduling.test.ts` covers 1–6 day patterns.
- **Gap:** nothing yet *generates* the batches ahead of time from those patterns —
  the pattern is only validated when a batch is created by hand.
- **Gap:** endorsement courses must bypass the pattern entirely and use a plain
  date picker.

## 3. Trainee portal removal — **Open**

Trainees must not have a separate portal. Enrollment status is viewed only through
the public registration status lookup.

- `components/registration-status.tsx` already does the public reference + email
  lookup and shows stage, balance, instructions and certificate state.
- **To remove:** `components/trainee-portal.tsx`, `app/trainee/page.tsx`, the
  "Trainee portal" links in `components/public-site.tsx`, and the `/auth/callback`
  redirect to `/trainee`. The registration API currently emails an account
  invitation — that should stop too.

## 4. Certificate gate for in-house courses — **Open**

For New Wave in-house courses, a certificate is only *Ready to Print* once the
trainee has uploaded the required screenshot **or** completed the feedback form.
This is an additional condition on top of verified attendance and an approved
template. Needs a feedback-form record and an upload slot per enrollment.

## 5. Invoices — **Partial**

An invoice must be generated for **every** payment.

- `app/api/documents/payment/[id]/route.ts` and
  `app/api/documents/enrollment/[id]/route.ts` exist.
- **Gap:** the document layout must follow the supplied Acknowledgement Receipt:
  particulars/amount table, TOTAL DUE / BALANCE / AMOUNT DUE, form of payment
  (Cash, GCash, Check with Ref/Bank/Check No./Check Date), "Received From",
  address, TIN, "The sum of", partial/full payment purpose, cashier signature
  block, and the footer "THIS DOCUMENT IS NOT VALID FOR CLAIMING INPUT TAXES".
- **Gap:** the Admission Slip should follow `NW-REG-01-26` — requirements list
  (valid government ID, 1x1/2x2 ID photo, PEME medical), ID photo box, courses
  enrolled, endorsed-by block, and the terms acceptance line.

## 6. Reports must be date sensitive — **Open**

Every report needs a date range filter, and exports must respect it. The current
Reports module exports all records with no period selection.

## 7. Admin-managed reference data — **Open**

Admin must be able to add and edit, without a developer:

- Modes of payment
- Users and their roles
- Training centre partners
- Courses, including price and duration changes
- Marketing agencies

Pricing and duration changes must not alter historical records — enrollments
already snapshot their fee, and that behaviour must be preserved.

## 8. Registration form fields — **Partial**

Required fields: First Name, Middle Name, Last Name, Suffix, SRN, Email,
Present Address, Contact Number, Place of Birth, Date of Birth, Rank, Company,
Emergency Contact Person, Emergency Contact Number, plus a toggle accepting the
New Wave terms and conditions as uploaded in the admission form.

- The server accepts and stores all of these
  (`app/api/public/registrations/route.ts` → `submit_public_registration`), with
  terms version recorded.
- **Gap:** the public wizard in `components/registration-form.tsx` still collects
  the shorter original set and needs suffix, SRN, place of birth, rank, company,
  present address and the terms toggle.

## 9. Named staff accounts — **Blocked**

Each employee needs their own account so entries are attributed automatically:

| Person | Position |
| --- | --- |
| Karen Mallari | Cashier |
| April Cantoneros | General Manager / Admin |
| Kathleen Garcia | Accounting Manager |

The database already has the roles (`cashier`, `admin`, `accounting`) and one
admin profile (`newwavemaritime@gmail.com`). Creating the three auth users is a
New Wave action — accounts and passwords are not something the assistant sets up.
Once they exist, linking each `profiles` row to its `user_roles` entry is a small
change, and audit attribution already flows from the signed-in user.

## 10. Remaining programme areas

Carried forward from the brief, tracked against `MASTERPLAN.md`:
attendance and QR scanning · training instructions and acknowledgments ·
certificate eligibility and approved-template upload · accounting, receipts,
expenses and reconciliation · HR and payroll · reports and exports ·
Resend configuration for instructor email · launch checklist and final
acceptance testing.

---

# Role specification — 23 July 2026 (second pass)

## Access control — **Done**

Registration is restricted to Registration, Trainees, Enrollments,
Courses & centers and Instructions (plus the Dashboard). Schedules, Payments,
Requests and Reports were removed from that role.

Tension worth confirming: Registration is also meant to raise reschedule,
make-up and change-of-course requests, but the Requests module is not in its
allowed list. Resolved by adding a "Request a change" action inside the
enrollment drawer, so requests can be raised without opening the module.

## Duplicate trainees — **Done**

`lib/trainee-identity.ts` matches on a normalised SRN, exactly and never
fuzzily. Approving a registration folds SRN matches into the earliest record so
one seafarer keeps one trainee number; blank fields are filled from the
duplicate and confirmed values are never overwritten. Shared email or mobile is
surfaced for review but never merged automatically, since households and
agencies legitimately share both.

## Trainee fields — **Done**

The staff "New trainee" form now mirrors the public registration form field for
field: first, middle, last, suffix, SRN, email, present address, contact number,
place of birth, date of birth, rank, company, emergency contact person and
number, with the same format validation.

## Open per role

**Registration** — ID and 2x2 photo upload on enrollment (for certificate
printing) · admission slip in New Wave format, soft and hard copy · training
instructions sent automatically once enrolled and paid · instruction templates
per course, and per course *and* training centre for endorsements · feedback
monitoring for in-house certificate tracking.

**Cashier** — payment invoice issuance · bank and GCash reconciliation ·
refund, cancellation and discount requests · other charges (make-up classes,
T-shirt, reprinting, change of course, rescheduling) · automated email
follow-up for pending balances.

**Training Operations** — MARINA MISMO encoding · automated certificate
printing from an approved sample format.

**Accounting** — daily sales and expense summary · approval of rescheduling,
make-up, change of course and cancellation together with their payments ·
expense category management.

**HR** — payroll · leave, absence, lates and attendance · payslip issuance ·
certificate of employment · SSS, Pag-IBIG and PhilHealth benefits · employee
charge reporting, such as reprinting or a reschedule caused by registration
error.
