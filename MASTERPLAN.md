# CLAUDE CODE MASTER INSTRUCTION

## NEW WAVE MARITIME INTEGRATED MANAGEMENT SYSTEM

Build a secure, production-ready, mobile-friendly integrated management system for **New Wave Maritime Training and Assessment Center, Inc.**

The system must manage the complete operational lifecycle:

**Public Registration → Trainee Record → Enrollment → Payment → Schedule and Resource Assignment → Training Instructions → Attendance → Training Completion → Certificate Printing → Certificate Release**

This is an operational system, not a static UI prototype. Implement real authentication, role permissions, database persistence, document generation, email notifications, audit logs, validation, reporting, and responsive interfaces.

---

# 1. DEVELOPMENT APPROACH

Before changing code:

1. Inspect the existing repository, framework, database structure, environment variables, and reusable components.
2. Preserve working features and user data.
3. Do not replace the existing stack without a strong technical reason.
4. If this is a greenfield project, use:
   - Latest stable Next.js with App Router and TypeScript
   - Tailwind CSS and accessible reusable UI components
   - Supabase Postgres, Authentication, Storage and Row Level Security
   - A transactional email provider through a server-side service abstraction
   - Browser-based QR scanning using the device camera
   - Server-side PDF generation for official documents
5. Store secrets only in environment variables and provide `.env.example`.
6. Use database migrations and seed scripts. Do not depend on browser local storage for operational data.
7. Build features in connected vertical workflows. Do not stop after creating mock screens.
8. Run type checks, linting, migrations and relevant automated tests before declaring completion.

If a business detail is missing, use a configurable setting instead of hardcoding an assumption.

---

# 2. DESIGN PRINCIPLES

The interface must be:

- Minimalist, clean, professional and approachable
- Mobile-friendly for trainees, instructors and staff
- Easy to use with limited technical training
- Focused on each role's actual responsibilities
- Consistent across dashboards and documents
- Based on the New Wave logo and existing brand assets in the repository

Avoid:

- Scattered dashboard cards
- Redundant modules
- Excessive dropdowns
- Too many visible statuses
- Repeated trainee information
- Decorative charts without operational value
- Permanent deletion of operational or financial records

Dashboard standard:

- Five to nine essential summary cards
- One urgent action list
- One upcoming activity section
- Four to six primary quick actions
- Role-specific reports only

Use search, segmented controls, sensible defaults and autocomplete where these are clearer than long dropdown menus.

---

# 3. USER ROLES

Implement role-based access control with support for multiple roles per employee.

## Admin

- Full management oversight
- Approval Center
- User and role management
- System settings
- Other Charges management
- Course and schedule approvals
- Financial and operational summaries
- Announcements
- Audit access

## Registration Officer

- Trainee search and creation
- Enrollment creation
- Course and schedule selection
- Admission slip generation
- Training instruction generation and resending
- Enrollment-related requests
- Read-only payment history

## Cashier

- Full and partial payments
- Payment screenshot upload
- Reference number reading and correction
- Receipts and invoices
- Admission slip reprinting with payment history
- Other Charges
- Expenses and vouchers
- Daily Cashier Summary and closing

## Accounting Manager

- All accounting monitoring
- Payment verification
- Collections and reconciliation
- Expense review and approval
- Payables
- Refund and adjustment review
- Cashier closing review
- Financial reports

## Training Operations Officer

Use this role name everywhere. Do not use `IT/Scheduler`.

- Courses and batches
- Automated schedule generation
- Capacity and available slots
- Instructor and classroom assignment
- Resource planning
- Training instructions and Google Classroom links
- Attendance verification
- Certificate templates and number pools
- Certificate preview, printing and release

## HR Officer

- Employees and user access initiation
- Employee attendance
- Payroll and payslips
- Benefits
- Charges and cash advances
- Leaves, absences and lates
- 13th-month pay
- Certificate of Employment requests
- Instructor compensation

## Instructor

- Assigned classes
- Trainee lists
- QR attendance scanning
- Manual attendance fallback
- Attendance submission
- Make-up identification
- Class completion
- Incident reporting
- Weekly teaching schedule

## Trainee

- Enrollments
- Open schedule selection or request
- Payment history and proof upload
- Admission slip, invoice and receipt
- Training instructions and acknowledgment
- QR code
- Attendance summary
- Requests
- Certificate status and notifications

Enforce permissions in both the user interface and database policies. Hiding a button is not sufficient authorization.

---

# 4. CORE STATUS RULES

Use the following user-facing statuses exactly. Do not add extra visible statuses without approval.

## Enrollment Status

- `Pending`
- `Open Schedule`
- `Enrolled`
- `Cancelled`

Definitions:

- **Pending:** enrollment was created but is not finalized.
- **Open Schedule:** the course is selected but no batch is confirmed.
- **Enrolled:** the course and batch are confirmed.
- **Cancelled:** the enrollment was cancelled through an approved request.

## Payment Status

- `Paid`
- `Unpaid`
- `Partially Paid`
- `Cancelled`

The enrollment payment status must be derived from valid posted payments, charges, refunds and reversals. Individual ledger entries may use internal flags or event types, but do not expose additional payment-status categories in routine dashboards.

## Schedule Status

- `Open`
- `Full`
- `Cancelled`
- `Ongoing`

When training and attendance are completed, move the batch to Batch History without adding another visible schedule status.

## Training Instruction Status

- `Pending`
- `Acknowledged`

## Attendance Status

- `Present`
- `Late`
- `Absent`
- `Incomplete`
- `Make-Up Required`
- `Make-Up Completed`

## Certificate Status

- `Pending Attendance`
- `Ready to Print`
- `Printed`
- `Released`
- `Cancelled`

## Request Status

- `Pending`
- `Approved`
- `Rejected`
- `Returned for Clarification`

## Expense Status

- `Pending`
- `Approved`
- `Rejected`
- `Paid`

---

# 5. COMPLETE WORKFLOW

1. A trainee registers through the public portal or is created by Registration.
2. The system checks possible duplicates using name and birthdate, email, mobile number and SRN.
3. Registration creates an enrollment.
4. Registration selects a course and an available batch, or saves it as Open Schedule.
5. Registration generates the initial admission slip.
6. Cashier records full or partial payments and issues receipts.
7. The live admission slip reflects the updated payment history and balance.
8. Training instructions and the Google Classroom link, when applicable, are emailed to the trainee.
9. Training Operations assigns the classroom and qualified instructor.
10. Instructor receives the weekly schedule and immediate change notifications.
11. Instructor or authorized staff scans trainee QR codes for daily check-in and check-out.
12. Instructor submits attendance after every class date.
13. Training Operations verifies completion and unresolved make-up requirements.
14. When attendance, certificate template and certificate number are complete, the certificate becomes Ready to Print.
15. The trainee is automatically emailed and notified in the portal that the certificate is ready for printing.
16. Training Operations prints the certificate and records its release.

---

# 6. PUBLIC PORTAL

Create the following public pages:

- Home
- About New Wave Maritime
- Courses
- Available Schedules
- Enroll or Register
- Search Registration
- Contact Us
- Trainee Login
- Authorized Staff Login

Group courses into:

- In-House Courses
- Partner or Endorsed Courses
- STCW Courses
- Specialized In-House Courses
- Bundles or Packages

Public course cards may show:

- Course name
- Duration
- Training mode
- Price when enabled
- Requirements
- Available future schedules
- Available slots
- Enroll action

Never publicly display or offer a schedule that is:

- Full
- Cancelled
- Ongoing
- Starting today
- Already past
- Beyond its enrollment deadline

Do not delete these batches. Keep them internally for history and reporting.

---

# 7. TRAINEE MASTER RECORD

Maintain one central profile per trainee.

Required fields:

- System trainee number
- Complete legal name
- Birthdate
- Sex
- Nationality
- Address
- Mobile number
- Email address
- SRN when applicable
- Emergency contact
- Optional profile photo
- Registration date
- Account state

Suggested identifiers:

- Trainee: `NWM-000001`
- Registration: `REG-YYYY-000001`
- Enrollment: `ENR-YYYY-000001`
- Payment: `PAY-YYYY-000001`
- Receipt: `OR-YYYY-000001`
- Request: `REQ-YYYY-000001`
- Voucher: `CV-YYYY-000001`

Duplicate detection must warn staff about matches involving:

- Complete name and birthdate
- Email address
- Mobile number
- SRN

Allow an authorized user to confirm a legitimate non-duplicate. Record that decision.

---

# 8. REGISTRATION OFFICER MODULE

## Dashboard

Show only:

- New registrations
- Pending enrollments
- Enrollments with Open Schedule
- Upcoming trainees
- Recently enrolled trainees
- Cancelled enrollments
- Pending requests
- Admission slips not yet generated

Do not show Unpaid or Partially Paid enrollment cards. Those belong to Cashier.

Do not include a Registrations Requiring Review card.

## Functions

- Search or create trainee
- Create enrollment
- Select course
- View future Open batches and available slots
- Select batch
- Save as Open Schedule
- Generate admission slip
- View payment status and payment history without editing
- Generate or resend training instructions
- Submit rescheduling, change course or cancellation requests
- View request decisions

Registration cannot add, edit, void, reverse or refund payments.

---

# 9. REQUEST MODULE AND APPROVAL CENTER

Make the Request Module accessible from relevant staff and trainee accounts.

Supported request types:

- Rescheduling
- Change Course
- Cancellation
- Correction of Trainee Information
- Transfer Payment
- Payment Adjustment
- Refund
- Make-Up Class
- Attendance Correction
- Certificate Correction
- Certificate Reprint
- Other Authorized Request

Each request must store:

- Request number
- Trainee and enrollment
- Request type
- Existing values
- Requested values
- Reason
- Supporting file when needed
- Requester
- Request date and time
- Assigned approver
- Decision and remarks
- Decision date and time
- Full activity history

Admin approval is required before applying rescheduling, course change or cancellation.

Centralize approvals for:

- Enrollment requests
- Refunds, reversals and payment adjustments
- Expenses
- Course additions, edits and deactivation
- Special schedule exceptions
- Capacity overrides
- Attendance corrections after submission
- Certificate corrections, reprints and voided numbers

Apply approved changes in a database transaction. Never silently overwrite the original value.

---

# 10. CASHIER MODULE

## Dashboard

- Collections today
- Paid enrollments
- Unpaid enrollments
- Partially Paid enrollments
- Payments requiring confirmation
- Other Charges collected
- Expenses recorded
- Receipts issued
- Cashier closing status

## Payment Functions

- Record full payment
- Record partial payment
- Record multiple payments for one enrollment
- Select payment method and receiving account
- Upload payment proof
- Read and prefill the reference number
- Manually enter or correct the reference number
- Warn about duplicate reference numbers
- Generate receipt
- Generate invoice
- Reprint current admission slip with payment history
- Record authorized Other Charges
- Submit expense and generate voucher
- Generate daily Cashier Summary
- Submit end-of-day closing

## Simplified Screenshot Reader

The payment screenshot reader must do only the following:

1. Accept an uploaded image.
2. Attempt to read the transaction reference number.
3. Prefill the Reference Number field.
4. Allow the Cashier to verify or correct it.
5. Warn when that reference number already exists.

Do not build an unnecessarily complex payment OCR workflow. The Cashier manually enters amount, date, method, receiving account and remarks.

## Cashier Closing

Record:

- Opening cash
- Cash collections
- Online collections
- Refunds or reversals
- Expenses released
- Expected cash
- Actual cash
- Shortage or overage
- Cashier remarks
- Submission and review timestamps

---

# 11. OTHER CHARGES

Seed the following:

- Rescheduling Fee
- Cancellation Fee
- Uniform
- Make-Up Class Fee
- Certificate Reprinting
- Courier or Delivery Fee

Do not seed ID Replacement or Training Materials.

Admin can:

- Add a charge
- Edit its name and default amount
- Activate or deactivate it
- Remove it only if it has never been used

Once used, a charge must be deactivated rather than deleted. Every paid charge must appear in the invoice, payment history and receipt.

---

# 12. ADMISSION SLIP, INVOICE, RECEIPT AND VOUCHER

## Admission Slip

Use one live admission slip per enrollment with revision history.

Include:

- Trainee information
- Enrollment number
- Course
- Batch and training dates
- Mode and venue
- Charges and discount
- Payment history
- Remaining balance
- Requirements
- Training reminders
- QR or verification code

Registration generates the initial slip. Cashier may print the updated slip after payments.

## Invoice

Include enrollment charges, Other Charges, discounts, payments and balance.

## Receipt

Include receipt number, trainee, enrollment, amount, method, reference number, receiving account, Cashier and timestamp.

## Expense Voucher

Include voucher number, payee, category, amount, purpose, requested by, approval, payment details and attachments.

Generate print-friendly PDFs with consistent New Wave branding.

---

# 13. ACCOUNTING MANAGER MODULE

## Dashboard

- Gross collections
- Net collections
- Cash collections
- Online collections
- Outstanding balances
- Payables
- Pending, approved and paid expenses
- Refunds
- Other Charges income
- Unverified payments
- Unreconciled transactions
- Cashier shortages or overages
- Daily, weekly and monthly summaries

## Functions

- View all payment activity
- Verify online payments
- Monitor duplicate or missing references
- Review Cashier closings
- Approve or reject expenses
- Approve and mark vouchers paid
- Manage supplier and partner-center payables
- Review refunds, reversals and adjustments
- Reconcile cash, bank and e-wallet accounts
- Lock finalized accounting periods
- Export PDF and spreadsheet reports

Financial definitions:

`Net Collections = Validated Collections - Refunds - Reversed Payments`

`Operating Result = Net Collections - Paid Expenses - Paid Payables`

Show expenses and payables separately. Use immutable ledger events for financial corrections instead of overwriting history.

---

# 14. COURSE MANAGEMENT

Each course must support:

- Name
- Code
- Category
- Delivery type
- Duration in days
- Training mode
- Standard price
- Requirements
- Default capacity
- Schedule pattern
- Instruction template
- Google Classroom link when applicable
- Certificate template when applicable
- Active or inactive state

Delivery type uses only:

- In-House
- Partner or Endorsed

## In-House

New Wave controls schedule, instructor, room, attendance, certificate number, printing and release.

## Partner or Endorsed

Record partner center, schedule, selling price, partner cost or payable, endorsement and certificate follow-up. Do not enable New Wave certificate printing unless New Wave is authorized to issue that certificate.

Course creation, edits and deactivation by Training Operations require Admin approval before publication.

---

# 15. SCHEDULE AND BATCH MANAGEMENT

Batch fields:

- Batch number
- Course
- Start and end dates
- Training dates
- Daily start and end time
- Mode
- Venue
- Classroom
- Instructor
- Capacity
- Confirmed enrollment count
- Available slots
- Enrollment deadline
- Schedule status
- Internal history timestamp

Default capacity is **24 trainees per batch**, but allow configuration per course or classroom.

Rules:

- Automatically change Open to Full when confirmed enrollment reaches capacity.
- Block the 25th confirmed trainee unless Admin approves an override.
- Hide Full, Cancelled and Ongoing batches from enrollment choices.
- Hide batches starting today or already past.
- Change an eligible batch to Ongoing when training starts.
- Do not delete batches when full or past.
- After training and attendance are closed, move the batch to Batch History.

Use transactional capacity checks to prevent two staff members from taking the last slot simultaneously.

---

# 16. AUTOMATED IN-HOUSE SCHEDULE GENERATOR

Generate future batch options using configurable patterns.

Default patterns:

| Duration | Pattern |
| --- | --- |
| 1 Day | Monday through Saturday |
| 2 Days | Monday–Tuesday, Wednesday–Thursday, Friday–Saturday |
| 3 Days | Monday–Wednesday, Thursday–Saturday |
| 4 Days | Monday–Thursday |
| 5 Days | Monday–Friday |
| 6 Days | Monday–Saturday |

Specific recurring rules:

| Course | Pattern | Capacity |
| --- | --- | ---: |
| BT-PSSR | Every day except Sunday | 24 |
| Safety | Every Monday | 24 |
| Crowd | Tuesday–Wednesday | 24 |
| Crisis | Thursday–Saturday | 24 |

Before publishing generated schedules, check:

- Sunday restrictions
- Configured holidays
- Instructor availability
- Instructor qualifications
- Classroom availability
- Classroom capacity
- Existing assignments
- Blocked dates
- Enrollment deadline

Generated schedules should be reviewed before publication. Training Operations may propose a special schedule outside the normal pattern, subject to Admin approval.

---

# 17. RESOURCE PLANNING

Create a calendar-based Resource Planning module connecting:

**Course → Batch → Training Date → Classroom → Instructor → Capacity**

Provide:

- Instructor availability calendar
- Classroom availability calendar
- Instructor qualifications per course
- Classroom capacities
- Substitute instructor assignment
- Conflict warnings
- Weekly resource utilization report

Prevent:

- One instructor in overlapping sessions
- One classroom in overlapping sessions
- An unqualified instructor assignment
- Enrollment beyond permitted capacity
- Duplicate training-date assignments

---

# 18. TRAINING INSTRUCTIONS

Training Operations maintains reusable course templates and batch-specific instructions.

Support:

- Course and batch
- Training dates and time
- Mode
- Venue and classroom
- Requirements
- Attire
- Items to bring
- Google Classroom link
- Online meeting link
- Attendance and late policy
- Contact details
- Additional reminders

Registration may generate or resend instructions but cannot alter the approved master template.

When instructions are sent, status is Pending. The trainee clicks **Acknowledge Training Instructions**, which records the date, time and user and changes the status to Acknowledged.

For module or blended classes, automatically include the Google Classroom link in the enrollment or instruction email.

---

# 19. QR ATTENDANCE CHECKER

Implement a hybrid attendance system:

- Face-to-face classes: authorized staff scans each trainee's QR at check-in and check-out.
- Online or module classes: Instructor verifies meeting attendance, Google Classroom completion or required activity.
- Technical failure: manual fallback with a mandatory reason.
- Final control: Instructor submits attendance; Training Operations verifies it.

Do not require dedicated biometric equipment for the first version.

## QR Design

Each enrollment receives a unique, revocable attendance token. The QR code must not expose readable personal information. Store only a secure random or signed token reference.

Show the QR code in:

- Trainee portal
- Admission slip
- Optional digital trainee ID

The Instructor or authorized staff scans the trainee's QR using the browser camera. Do not make self-scanning the default. Staff-controlled scanning reduces attendance sharing.

## Attendance Session

Create one attendance session for every batch training date and, when needed, separate morning or afternoon sessions.

Store:

- Batch
- Course
- Training date
- Session start and end
- Check-in opening and closing window
- Late threshold
- Minimum required minutes
- Authorized scanner
- Session state

## Check-In Flow

1. Instructor opens today's assigned batch.
2. Instructor taps Start Attendance.
3. Instructor scans the trainee's QR.
4. Server validates token, enrollment, batch, date and existing events.
5. Display trainee name, optional photo, course, batch, enrollment status and payment status.
6. Instructor confirms check-in.
7. Record server timestamp, staff user and method.

## Check-Out Flow

1. Scan the same trainee QR at the end of training.
2. Validate an existing check-in.
3. Record server checkout time.
4. Calculate attended minutes.
5. Suggest Present, Late or Incomplete based on configured rules.
6. Instructor confirms or overrides with a reason.

## Scan Validation

Reject or warn when:

- QR token is invalid, expired or revoked
- Enrollment is Cancelled
- Trainee is not assigned to the selected batch
- Training date is not valid
- Duplicate check-in or duplicate check-out is attempted
- Check-out occurs without check-in
- Trainee is assigned to overlapping sessions
- Attendance window is closed

Use server timestamps, idempotency keys and database constraints. Do not trust the device clock.

## Manual Fallback

Authorized Instructor or Training Operations staff can select a trainee and record attendance manually for:

- Unavailable or damaged QR
- Camera failure
- Internet or device problem
- Incorrect assignment being resolved
- Authorized attendance correction

Require:

- Manual reason
- Staff user
- Server timestamp
- Optional remarks

Corrections after Instructor submission require Training Operations or Admin approval and must keep the previous value in the audit log.

## Attendance Screen

For every batch show:

- Total enrolled
- Present
- Late
- Absent
- Incomplete
- Make-Up Required
- Make-Up Completed
- Not yet recorded

Each trainee row shows:

- Name and optional photo
- Check-in
- Check-out
- Attended duration
- Status
- QR or Manual method
- Remarks
- Edit history indicator

Quick actions:

- Scan QR
- Manual Entry
- Mark Remaining as Absent
- Submit Attendance
- Download Attendance Sheet

The `Mark Remaining as Absent` action must require confirmation and only affect trainees without an attendance record.

## Online and Module Attendance

Allow Instructor to:

- Import a meeting attendance CSV when available
- Record verified online attendance manually
- Record required activity or assessment completion
- Attach supporting attendance evidence

Merely opening a Google Classroom link must not automatically count as attendance.

## Make-Up Workflow

1. Instructor marks Absent, Incomplete or Make-Up Required.
2. Registration or Training Operations assigns an authorized make-up batch or date.
3. Trainee receives email and portal notification.
4. Cashier adds a Make-Up Class Fee when applicable.
5. The same enrollment QR is used for the authorized make-up session.
6. The make-up record links to the original missed session.
7. After verification, status changes to Make-Up Completed.

## Attendance Submission and Locking

- Instructor reviews and submits daily attendance.
- Submitted attendance becomes read-only for the Instructor.
- Training Operations reviews and verifies the batch attendance.
- Approved corrections create new audit events; they do not erase old values.

---

# 20. INSTRUCTOR PORTAL

Dashboard:

- Classes today
- Upcoming classes
- Weekly schedule
- Attendance requiring action
- Recent schedule changes
- Announcements
- Teaching-day summary

Functions:

- View assigned batches and rooms
- View trainee list
- Confirm availability
- Start attendance
- Scan QR for check-in and check-out
- Use manual attendance fallback
- Mark attendance status and remarks
- Identify make-up requirements
- Submit attendance
- Report incidents
- Request a schedule change

Instructor cannot directly change a published batch schedule or unlock submitted attendance.

---

# 21. WEEKLY INSTRUCTOR EMAIL

Send each instructor an updated schedule every Friday afternoon for the following week. Make the sending time configurable.

Include:

- Course
- Batch number
- Training dates
- Time
- Classroom
- Number of enrolled trainees
- Mode
- Google Classroom link when applicable
- Newly assigned, changed or cancelled classes

Also send immediate notifications for assignment, rescheduling, classroom change, cancellation or substitute assignment.

Record email delivery attempts and provide an authorized Resend action.

---

# 22. CERTIFICATE MANAGEMENT

A certificate remains Pending Attendance until every completion rule passes.

Required before Ready to Print:

- Attendance exists for all required sessions
- No unresolved absence or incomplete session remains
- Required make-up sessions are completed
- Instructor submitted attendance
- Training Operations verified attendance
- Correct certificate template is active
- Valid unused certificate number is assigned
- Trainee legal name, course and training dates are confirmed

When all conditions pass, update the certificate to Ready to Print in one controlled server operation.

## Certificate Templates and Numbers

Training Operations can:

- Upload certificate templates
- Assign templates to courses
- Upload certificate number pools
- Assign a number individually or in bulk
- Preview the rendered certificate
- Print certificates
- Mark damaged certificates
- Request voiding or reprinting
- Record release

Prevent duplicate certificate numbers with a database uniqueness constraint.

Admin approval is required for:

- Changing an active template
- Correcting a printed certificate
- Reprinting
- Voiding or reassigning a certificate number

## Certificate Record

Store:

- Trainee and enrollment
- Course and batch
- Training and completion dates
- Certificate number
- Template version
- Status
- Printed by and printed time
- Release recipient
- Released by and release time
- Reprint count and reasons

---

# 23. CERTIFICATE READY EMAIL

Immediately after the certificate changes to Ready to Print:

- Email the trainee's registered email
- Create a trainee portal notification
- Record delivery status and timestamp
- Prevent duplicate automatic sends
- Allow Training Operations to resend manually

Use this email:

**Subject:** Your Training Certificate Is Ready for Printing

Dear **[Trainee Name]**,

Good news! Your training certificate is now ready for printing.

**Course:** [Course Name]  
**Training Dates:** [Training Dates]  
**Certificate Number:** [Certificate Number]  
**Status:** Ready to Print

Please wait for a separate update once your certificate is available for collection or release.

Thank you,  
**New Wave Maritime Training and Assessment Center, Inc.**

Record trainee, course, batch, certificate number, recipient, send time, delivery state, automatic/manual type and resending staff user.

Do not tell the trainee the certificate is ready for pickup unless it has actually reached the appropriate release state.

---

# 24. HR AND PAYROLL

## HR Dashboard

- Employees present today
- Lates and absences
- Pending leave requests
- Upcoming payroll
- Employee charges and cash advances
- HR requests
- Instructor teaching days
- Benefit records requiring attention
- COE requests

## Employee Record

- Employee number
- Complete name
- Position
- Roles
- Employment status
- Date hired
- Pay type: Monthly, Weekly or Daily
- Monthly, weekly or daily rate as applicable
- Instructor daily rate when applicable
- SSS
- Pag-IBIG
- PhilHealth
- TIN
- Payroll account
- Emergency contact
- Leave balances
- User-account state

## Functions

- Add and deactivate employees
- Assign roles
- Initiate secure password reset
- Record employee attendance
- Record lates, absences and undertime
- Manage leave
- Manage cash advances and charges
- Calculate payroll
- Generate payslips
- Track benefits
- Calculate 13th-month pay
- Process COE requests
- Calculate Instructor compensation from verified teaching assignments

Never display stored passwords. Use secure password reset flows.

---

# 25. TRAINEE PORTAL

Dashboard:

- Current enrollment
- Course and schedule
- Admission slip
- Payment status and balance
- Training instructions
- Google Classroom link
- Instruction acknowledgment
- Personal QR code
- Attendance summary
- Requests
- Certificate status
- Announcements

Functions:

- View all enrollments
- View available batches for Open Schedule enrollments
- Upload payment proof
- View payment history
- Download admission slip, invoice and receipts
- Acknowledge instructions
- View QR
- View attendance without editing
- Submit requests
- Track request decisions
- Track certificate status

Trainees cannot directly change a confirmed course, batch, attendance record or payment.

---

# 26. EMAIL AUTOMATIONS

Implement configurable email templates and queues for:

- Successful registration
- Enrollment confirmation
- Pending registration follow-up after 24 hours
- Second registration follow-up after 3 days
- Final registration follow-up after 5 days
- Payment receipt
- Balance reminder 5 days before due date
- Balance reminder 3 days before due date
- Balance reminder on due date
- Training instructions
- Google Classroom link
- Request approval, rejection or clarification
- Make-up class assignment
- Instructor weekly schedule
- Instructor schedule change
- Certificate Ready to Print
- Certificate release when enabled
- Payslip availability
- Announcements

Stop registration follow-ups when the enrollment becomes Enrolled or Cancelled.

Stop balance reminders when Paid, Cancelled, under an approved extension or manually excluded by an authorized user.

Use queued, retryable, idempotent email jobs. Keep an email log and never send duplicate automatic messages for the same event.

---

# 27. NOTIFICATION BELL

Every authenticated portal must have a notification bell and unread count.

Support:

- Open notification to mark it read
- Mark as Read
- Mark All as Read
- Notification history
- Deep link to the related record

Notification types include:

- New registration or enrollment
- Payment or verification
- Request and decision
- Schedule or room change
- Instructor assignment
- Instructions and acknowledgment
- Balance reminder
- Attendance issue
- Make-up assignment
- Certificate Ready to Print
- Expense approval
- Payroll or payslip
- Announcement

The unread number must decrease only when the notification is opened or explicitly marked read.

---

# 28. ROLE-SPECIFIC DASHBOARDS

## Admin

- Enrollments today
- Collections today
- Open batches and available slots
- Pending approvals
- Outstanding balances
- Payables and expenses
- Attendance exceptions
- Certificates Ready to Print

## Registration

- New registrations
- Pending and Open Schedule enrollments
- Upcoming trainees
- Pending requests
- Admission slips not generated

## Cashier

- Paid, Unpaid and Partially Paid enrollments
- Collections today
- Payments requiring confirmation
- Other Charges
- Expenses and Cashier closing

## Accounting

- Net Collections
- Payables
- Expenses
- Outstanding balances
- Reconciliation and Cashier exceptions

## Training Operations

- Today's classes
- Open, Full, Ongoing and Cancelled batches
- Available slots
- Unassigned instructor or classroom
- Attendance requiring verification
- Certificates Ready to Print

## HR

- Employee attendance
- Leaves
- Payroll
- Benefits
- Charges
- Instructor compensation

## Instructor

- Today's classes
- Weekly schedule
- Attendance requiring action
- Schedule changes

---

# 29. REPORTS

Provide date, course, batch, payment method and staff filters where relevant.

## Registration

- Registrations
- Pending, Open Schedule, Enrolled and Cancelled enrollments
- Course enrollment summary
- Enrollment source

## Cashier

- Daily collections
- Payment-method summary
- Unpaid and Partially Paid enrollments
- Other Charges
- Receipts
- Expenses
- Cashier closing

## Accounting

- Gross and Net Collections
- Outstanding balances
- Expenses
- Payables
- Refunds and reversals
- Reconciliation
- Monthly financial summary

## Training Operations

- Open and Full batches
- Available slots
- Instructor assignments
- Classroom utilization
- Daily and batch attendance
- Lates, absences and incomplete sessions
- Make-up classes
- Certificates Ready to Print, Printed and Released

## HR

- Employee attendance
- Lates and absences
- Leaves
- Payroll
- Benefits
- Charges and cash advances
- 13th-month pay
- Instructor compensation

Allow authorized export to PDF and spreadsheet.

---

# 30. DATA MODEL

Create a normalized schema including, at minimum:

- `profiles`
- `roles`
- `user_roles`
- `trainees`
- `course_categories`
- `courses`
- `course_requirements`
- `schedule_patterns`
- `partner_centers`
- `classrooms`
- `instructor_qualifications`
- `batches`
- `batch_training_dates`
- `resource_assignments`
- `enrollments`
- `enrollment_requests`
- `request_events`
- `charge_catalog`
- `enrollment_charges`
- `payments`
- `payment_allocations`
- `payment_proofs`
- `refunds_and_reversals`
- `receipts`
- `invoices`
- `cashier_closings`
- `expenses`
- `expense_vouchers`
- `payables`
- `account_reconciliation_items`
- `training_instruction_templates`
- `training_instructions`
- `instruction_acknowledgments`
- `attendance_tokens`
- `attendance_sessions`
- `attendance_records`
- `attendance_events`
- `make_up_assignments`
- `certificate_templates`
- `certificate_number_pool`
- `certificates`
- `certificate_release_events`
- `employees`
- `employee_attendance`
- `leave_requests`
- `employee_charges`
- `cash_advances`
- `payroll_periods`
- `payroll_items`
- `payslips`
- `benefit_records`
- `coe_requests`
- `notifications`
- `email_templates`
- `email_jobs`
- `email_logs`
- `announcements`
- `file_attachments`
- `audit_logs`

Use foreign keys, uniqueness constraints, checks, timestamps and soft-deactivation fields. Add indexes for trainee lookup, batch availability, payment references, attendance tokens, certificate numbers, unread notifications and reporting dates.

Critical constraints:

- Unique trainee system number
- Unique enrollment number
- Unique receipt number
- Unique active attendance token
- Unique attendance record per session and enrollment
- Unique certificate number
- Duplicate payment-reference warning and review mechanism
- Capacity-safe enrollment transaction
- Immutable audit and financial event history

---

# 31. SECURITY, PRIVACY AND AUDIT

Implement:

- Supabase Row Level Security or equivalent database-enforced authorization
- Server-side permission checks
- Secure password reset
- Session expiry
- Rate limiting on public registration, login and QR validation
- Private storage buckets for proofs, vouchers, templates and HR documents
- Signed, time-limited file access
- No readable PII inside QR codes
- Audit log for create, update, approval, rejection, void, print, release and export actions
- Soft deactivation rather than destructive deletion
- Backup and recovery documentation
- Data privacy consent on registration

Audit entries must include actor, role, record type, record id, prior values, new values, reason, timestamp and request correlation id when applicable.

---

# 32. REQUIRED DOCUMENTS

Generate branded, print-friendly documents for:

- Registration confirmation
- Enrollment confirmation
- Admission slip
- Invoice
- Receipt
- Payment history
- Expense voucher
- Cashier Summary
- Training instructions
- Instructor weekly schedule
- Class list
- Attendance sheet
- Payslip
- Certificate
- Certificate release acknowledgment
- Operational and financial reports

Use snapshot data or version references so a previously issued document can be reproduced accurately.

---

# 33. TESTING REQUIREMENTS

Create automated tests for critical logic:

- Duplicate trainee warning
- Enrollment status transitions
- Payment-status calculation
- Partial and split payments
- Duplicate reference warning
- Schedule capacity and simultaneous last-slot booking
- Automatic Full and Ongoing visibility rules
- Recurring schedule generation
- Instructor and classroom conflicts
- QR token validation
- Duplicate check-in and checkout prevention
- Manual attendance reason requirement
- Attendance status calculation
- Attendance locking and correction approval
- Make-up linkage
- Certificate eligibility gate
- Unique certificate number
- Single Certificate Ready email per transition
- Notification unread counter
- Role permission boundaries

Also test responsive workflows on phone-sized screens, especially Registration, Cashier, Instructor QR scanning and Trainee Portal.

---

# 34. IMPLEMENTATION ORDER

Implement in this order while keeping the complete data model compatible with later modules:

1. Repository inspection, shared design system, authentication and roles
2. Database migrations, audit framework and seed data
3. Trainee, Registration and Enrollment
4. Course, Schedule and Resource Planning
5. Cashier, documents and Accounting
6. Training Instructions and notifications
7. QR Attendance Checker and Instructor Portal
8. Certificate management and certificate email
9. HR and Payroll
10. Reports, exports, security review and end-to-end testing

After each stage, verify that the connected workflow works against real persisted records. Do not leave primary actions as non-functional placeholders.

---

# 35. DEFINITION OF DONE

The system is complete only when:

- Each role can sign in and sees only its authorized dashboard and records.
- A trainee can register and receive one centralized record.
- Registration can create an enrollment, select an Open batch or use Open Schedule, and generate an admission slip.
- Cashier can record split payments, prefill a reference number from a screenshot, issue a receipt and produce a closing report.
- Accounting can monitor Net Collections, payables, expenses and reconciliation.
- Training Operations can create recurring in-house schedules, enforce 24-person capacity, assign rooms and instructors and publish instructions.
- Instructor can scan trainee QR codes for check-in and check-out and use an audited manual fallback.
- Attendance cannot be duplicated, silently overwritten or completed with unresolved make-up requirements.
- Certificate printing is blocked until attendance and certificate requirements are satisfied.
- Ready to Print triggers exactly one automatic trainee email and portal notification.
- Training Operations can print and release a uniquely numbered certificate.
- HR can maintain employee records, attendance, payroll, payslips, benefits, leaves, charges and instructor compensation.
- Every approval and sensitive change is auditable.
- The primary workflows work on mobile and desktop.
- Type checks, tests and production build pass.

Provide a concise completion report containing:

- Implemented modules
- Database migrations created
- Environment variables required
- Tests run and results
- Remaining limitations, if any
- Exact local and deployment startup instructions

