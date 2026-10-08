import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hardDeleteEnrollment, pruneUnpaidEnrollments, deletePastEmptyBatches } from "@/lib/enrollments";
import { VALIDATION_MESSAGES, isEmail, isPhContactNumber, isSrn, normalizeEmail, normalizePhContactNumber, normalizeSrn } from "@/lib/validation";
import { emailConfigured, processEmailJobs } from "@/lib/email-jobs";
import { classroomEmailBlocks } from "@/lib/classroom";
import { loadInstructionDetails } from "@/lib/training-instructions";
import { fileVoucherInDrive } from "@/lib/expense-voucher";
import { activeConnection, googleConfigured, hasDriveScope, inviteStudent, listClasses, revokeConnection } from "@/lib/google-classroom";
import { sendBalanceSummary } from "@/lib/balance-summary";
import { RULED_REQUESTS, requestFee } from "@/lib/request-fees";
import { applyReferralRebates, suggestReferralCode } from "@/lib/referral";
import { certificateContext, claimCertificateNumber, downloadDriveFile, ensureCertificate, trySendSoftCopy } from "@/lib/certificates";
import { driveFileId, googleFormId } from "@/lib/certificate-rules";

const manilaDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);

const enrollmentInput = z.object({
  action: z.literal("create-enrollment"), existingTraineeId: z.string().uuid().nullable().optional(),
  firstName: z.string().trim().max(80).optional().default(""), middleName: z.string().trim().max(80).optional().default(""), lastName: z.string().trim().max(80).optional().default(""),
  birthDate: z.string().date().optional(), email: z.string().email().optional(), mobile: z.string().trim().min(7).max(30).optional(),
  // The staff intake mirrors the public form field for field (addendum). These
  // are stored on the trainee after the enrollment RPC, which is unchanged.
  suffix: z.string().trim().max(20).optional(), srn: z.string().trim().refine((v) => !v || isSrn(v), VALIDATION_MESSAGES.srn).optional(),
  presentAddress: z.string().trim().max(500).optional(), placeOfBirth: z.string().trim().max(160).optional(), rank: z.string().trim().max(100).optional(), company: z.string().trim().max(160).optional(),
  emergencyContactName: z.string().trim().max(160).optional(), emergencyContactMobile: z.string().trim().refine((v) => !v || isPhContactNumber(v), VALIDATION_MESSAGES.contact).optional(),
  courseId: z.string().uuid(), partnerOfferId: z.string().uuid().nullable().optional(), batchId: z.string().uuid().nullable().optional(),
  scheduledOn: z.string().date().nullable().optional(),
});

const batchInput = z.object({
  action: z.literal("create-batch"), courseId: z.string().uuid(), partnerOfferId: z.string().uuid().nullable().optional(),
  // Instructor / room / venue are optional for In-House batches (assigned later, or never).
  instructorName: z.string().trim().max(160).optional().default(""), instructorEmail: z.string().trim().max(160).optional().default(""), roomName: z.string().trim().max(120).optional().default(""),
  startsOn: z.string().date(), endsOn: z.string().date(), dailyStart: z.string().regex(/^\d{2}:\d{2}$/), dailyEnd: z.string().regex(/^\d{2}:\d{2}$/),
  mode: z.string().trim().min(2).max(80), venue: z.string().trim().max(160).optional().default(""), capacity: z.literal(24),
  enrollmentDeadline: z.string().datetime({ offset: true }), publish: z.boolean().default(true),
});

const autoOpenBatchInput = z.object({
  action: z.literal("auto-open-batches"), courseId: z.string().uuid(),
  year: z.number().int().min(2024).max(2100), month: z.number().int().min(1).max(12),
});
const autoOpenAllInput = z.object({ action: z.literal("auto-open-all-batches"), year: z.number().int().min(2024).max(2100), month: z.number().int().min(1).max(12) });
const autoOpenWeekInput = z.object({ action: z.literal("auto-open-week"), courseId: z.string().uuid(), weekStart: z.string().date() });
const autoOpenAllWeekInput = z.object({ action: z.literal("auto-open-all-week"), weekStart: z.string().date() });
const enrollmentDeleteInput = z.object({ action: z.literal("enrollment-delete"), enrollmentId: z.string().uuid() });
const pruneNowInput = z.object({ action: z.literal("prune-enrollments-now") });

const batchUpdateInput = z.object({
  action: z.literal("batch-update"), batchId: z.string().uuid(),
  batchNumber: z.string().trim().min(1).max(60).optional(),
  instructorName: z.string().trim().max(160).optional().default(""), instructorEmail: z.string().trim().max(160).optional().default(""),
  roomName: z.string().trim().max(120).optional().default(""), venue: z.string().trim().max(160).optional().default(""),
  dailyStart: z.string().regex(/^\d{2}:\d{2}$/), dailyEnd: z.string().regex(/^\d{2}:\d{2}$/),
  mode: z.string().trim().min(2).max(80), enrollmentDeadline: z.string().datetime({ offset: true }), publish: z.boolean(),
});
const batchDeleteInput = z.object({ action: z.literal("batch-delete"), batchId: z.string().uuid() });

// Accounting › Configuration remove (8 Oct 2026): a fee, payment channel, partner or rebate. Used records stay; archive those instead.
const configRemoveInput = z.object({ action: z.literal("config-remove"), entity: z.enum(["charge", "channel", "partner", "rebate"]), id: z.string().uuid().optional(), agencyId: z.string().uuid().optional(), courseId: z.string().uuid().optional() });
const agencyRebateSetInput = z.object({ action: z.literal("agency-rebate-set"), agencyId: z.string().uuid(), courseId: z.string().uuid(), cents: z.number().int().min(0) });
const recordAgencyRebateInput = z.object({ action: z.literal("record-agency-rebate"), enrollmentId: z.string().uuid(), agencyId: z.string().uuid() });
const agencyRebateSettleInput = z.object({ action: z.literal("agency-rebate-settle"), id: z.string().uuid(), status: z.enum(["Pending", "Paid", "Cancelled"]) });

const paymentInput = z.object({
  action: z.literal("post-payment"), enrollmentId: z.string().uuid(), amountCentavos: z.number().int().positive(),
  method: z.string().trim().min(1).max(80), receivingAccount: z.string().trim().min(2).max(120),
  referenceNumber: z.string().trim().max(80).optional().default(""), proofId: z.string().uuid().nullable().optional(),
  receivedAt: z.string().datetime({ offset: true }), remarks: z.string().trim().max(500).optional().default(""),
});

const notificationInput = z.object({ action: z.literal("mark-notifications-read") });

// Accounting Setup CRUD (Slice 1). Admin / Accounting only; applied with the
// service-role admin client after an explicit role check.
const channelInput = z.object({ action: z.literal("channel-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(80), code: z.string().trim().max(40).optional(), requiresReference: z.boolean().default(false), allowsProof: z.boolean().default(true), kind: z.enum(["receivable", "payable"]).optional(), active: z.boolean().optional() });
const chargeInput = z.object({ action: z.literal("charge-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(80), defaultAmountCentavos: z.number().int().nonnegative().default(0), active: z.boolean().optional(), kind: z.enum(["item", "fee"]).optional() });
const expenseCategoryInput = z.object({ action: z.literal("expense-category-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(80), active: z.boolean().optional(), remove: z.boolean().optional() });
const inventoryItemInput = z.object({ action: z.literal("inventory-item-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(120), category: z.string().trim().max(80).optional(), unit: z.string().trim().min(1).max(24).default("pc"), unitValueCentavos: z.number().int().nonnegative().default(0), active: z.boolean().optional(), remove: z.boolean().optional() });
const inventoryMoveInput = z.object({ action: z.literal("inventory-move"), itemId: z.string().uuid(), movementType: z.enum(["in", "out"]), quantity: z.number().int().positive(), remarks: z.string().trim().max(240).optional() });
const agencyCodeInput = z.object({ action: z.literal("agency-code-regenerate"), id: z.string().uuid() });
const agencyInput = z.object({ action: z.literal("agency-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(120), kind: z.enum(["Agency", "Consultancy"]).optional(), rebateMode: z.enum(["Deducted", "No deduction"]).optional(), rebatePercent: z.number().gt(0).max(100).nullable().optional(), contactName: z.string().trim().max(120).optional(), email: z.string().email().optional().or(z.literal("")), mobile: z.string().trim().max(40).optional(), active: z.boolean().optional() });
const payableMarkPaidInput = z.object({ action: z.literal("payable-mark-paid"), id: z.string().uuid() });
const payableInput = z.object({ action: z.literal("payable-save"), id: z.string().uuid().nullable().optional(), description: z.string().trim().min(1).max(200), amountCentavos: z.number().int().positive().optional(), dueOn: z.string().date().nullable().optional(), remove: z.boolean().optional() });
const expenseCreateInput = z.object({ action: z.literal("expense-create"), payee: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(80), amountCentavos: z.number().int().positive(), purpose: z.string().trim().min(1).max(300), paymentChannel: z.string().trim().max(40).optional().default(""), referenceNumber: z.string().trim().max(80).optional().default(""),
  // Voucher lines (202610080019): particulars, quantity and unit cost; they must add up to the amount.
  lines: z.array(z.object({ description: z.string().trim().min(1).max(160), quantity: z.number().int().min(1).max(9999), unitCentavos: z.number().int().positive() })).max(10).optional().default([]),
  supportingDocument: z.string().trim().max(160).optional().default("") });
const expenseDecideInput = z.object({ action: z.literal("expense-decide"), id: z.string().uuid(), decision: z.enum(["Approved", "Rejected", "Paid"]), remarks: z.string().trim().max(300).optional() });
// The Cashier releases an approved voucher (cash or transfer) and marks it paid.
// Voucher print limit (202610080020): one print, more only after the Accounting Manager approves a reprint.
const expenseReprintRequestInput = z.object({ action: z.literal("expense-reprint-request"), id: z.string().uuid(), reason: z.string().trim().min(3).max(300) });
const expenseReprintDecideInput = z.object({ action: z.literal("expense-reprint-decide"), requestId: z.string().uuid(), decision: z.enum(["Approved", "Rejected"]), remarks: z.string().trim().max(300).optional() });
const expenseReleaseInput = z.object({ action: z.literal("expense-release"), id: z.string().uuid(), paymentChannel: z.string().trim().min(1).max(40), referenceNumber: z.string().trim().max(80).optional().default("") });
const cashierOpenInput = z.object({ action: z.literal("cashier-open"), openingCashCentavos: z.number().int().nonnegative(), remarks: z.string().trim().max(300).optional() });
const balanceSummaryInput = z.object({ action: z.literal("balance-summary-send") });
// The Accounting Manager marks a submitted cashier closing reviewed (8 Oct 2026).
const closingReviewInput = z.object({ action: z.literal("cashier-closing-review"), id: z.string().uuid(), remarks: z.string().trim().max(300).optional() });
const closingInput = z.object({ action: z.literal("cashier-close"), closingDate: z.string().date(), openingCashCentavos: z.number().int().nonnegative(), actualCashCentavos: z.number().int().nonnegative(), remarks: z.string().trim().max(500).optional().default("") });
// Other charges + agency rebates posted to an enrollment ledger (enrollment_charges).
// A charge adds to the amount due; a discount (rebate) subtracts. Both are append-only;
// corrections mark the row invalid rather than deleting it.
const enrollmentChargeInput = z.object({ action: z.literal("enrollment-charge"), enrollmentId: z.string().uuid(), chargeCatalogId: z.string().uuid().nullable().optional(), description: z.string().trim().min(1).max(200), amountCentavos: z.number().int().positive(), kind: z.enum(["charge", "discount"]).default("charge") });
const enrollmentChargeVoidInput = z.object({ action: z.literal("enrollment-charge-void"), id: z.string().uuid() });
const discountRequestInput = z.object({ action: z.literal("discount-request"), enrollmentId: z.string().uuid(), amountCentavos: z.number().int().positive(), description: z.string().trim().max(200).optional(), agencyId: z.string().uuid().nullable().optional() });
const discountDecideInput = z.object({ action: z.literal("discount-decide"), id: z.string().uuid(), approve: z.boolean() });
const chargeDecideInput = z.object({ action: z.literal("charge-decide"), id: z.string().uuid(), approve: z.boolean() });
const announcementPostInput = z.object({ action: z.literal("announcement-post"), title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(2000), audienceRoles: z.array(z.string()).optional(), expiresAt: z.string().datetime({ offset: true }).nullable().optional() });
const announcementDeleteInput = z.object({ action: z.literal("announcement-delete"), id: z.string().uuid() });
const certificateStatusInput = z.object({ action: z.literal("certificate-status"), enrollmentId: z.string().uuid(), status: z.enum(["Pending Attendance", "Ready to Print", "Printed", "Released", "Cancelled"]) });
const certificateIssueInput = z.object({ action: z.literal("certificate-issue"), enrollmentId: z.string().uuid(), certificateNumber: z.string().trim().max(80).optional(), overrides: z.record(z.string(), z.string()).optional() });
const certificatePrintInput = z.object({ action: z.literal("certificate-print"), enrollmentId: z.string().uuid(), reprint: z.boolean().optional() });
const certificateVoidInput = z.object({ action: z.literal("certificate-void"), enrollmentId: z.string().uuid(), reason: z.string().trim().max(300).optional() });
const certificateReleaseInput = z.object({ action: z.literal("certificate-release"), enrollmentId: z.string().uuid(), recipientName: z.string().trim().min(1).max(160), recipientIdType: z.string().trim().max(80).optional(), reason: z.string().trim().max(300).optional(), releaseMethod: z.enum(["Pickup", "Representative", "Courier"]).optional(), claimantRelationship: z.string().trim().max(80).optional(), idChecked: z.boolean().optional(), authorizationChecked: z.boolean().optional() });
// Release plan for a certificate: how it leaves the office, and courier details.
const certificateReleasePlanInput = z.object({ action: z.literal("certificate-release-plan"), enrollmentId: z.string().uuid(), releaseMethod: z.enum(["Pickup", "Representative", "Courier"]).optional(), expectedPickupOn: z.string().date().nullable().optional(), claimantName: z.string().trim().max(160).optional(), claimantRelationship: z.string().trim().max(80).optional(), courierName: z.string().trim().max(80).optional(), trackingNumber: z.string().trim().max(80).optional(), shippingFeeStatus: z.string().trim().max(40).optional(), shippingAddress: z.string().trim().max(300).optional(), courierStatus: z.enum(["For Booking", "Booked", "Shipped", "Delivered"]).optional() });
// Certificate correction workflow (wrong spelling, wrong date, reprint needed).
const certificateIssueInput2 = z.object({ action: z.literal("certificate-issue-report"), enrollmentId: z.string().uuid(), issueStatus: z.enum(["For Correction", "Resolved"]), note: z.string().trim().max(300).optional() });
const certificateOverrideInput = z.object({ action: z.literal("certificate-override"), enrollmentId: z.string().uuid(), certificateNumber: z.string().trim().max(80).optional(), overrides: z.record(z.string(), z.string()).optional() });
// Certificate controls (owner, 8 Oct 2026; migration 202610080030).
const certificateSeriesInput = z.object({ action: z.literal("certificate-series-save"), courseId: z.string().uuid(), prefix: z.string().trim().max(30), nextNumber: z.number().int().min(1).max(99999999), pad: z.number().int().min(1).max(10), batchPrefix: z.string().trim().max(30), nextBatch: z.number().int().min(1).max(999999) });
const certificateVoidRequestInput = z.object({ action: z.literal("certificate-void-request"), enrollmentId: z.string().uuid(), reason: z.string().trim().min(3).max(300) });
const certificateVoidDecideInput = z.object({ action: z.literal("certificate-void-decide"), enrollmentId: z.string().uuid(), approve: z.boolean(), remarks: z.string().trim().max(300).optional() });
const certificateTemplateLinkInput = z.object({ action: z.literal("certificate-template-link"), courseId: z.string().uuid(), driveLink: z.string().trim().min(10).max(500) });
const evaluationFormInput = z.object({ action: z.literal("course-evaluation-form-save"), courseId: z.string().uuid(), formLink: z.string().trim().max(500) });
const certificateSoftCopyInput = z.object({ action: z.literal("certificate-soft-copy"), enrollmentId: z.string().uuid() });
const certificateIssuanceToggleInput = z.object({ action: z.literal("certificate-issuance-toggle"), enabled: z.boolean() });
const feedbackSendEmailInput = z.object({ action: z.literal("feedback-send-email"), enrollmentId: z.string().uuid() });

// HR / payroll (Slice 1): attendance logging and leave / cash-advance filing + decisions.
const hm = /^\d{2}:\d{2}$/;
const hrAttendanceInput = z.object({ action: z.literal("hr-attendance-log"), employeeId: z.string().uuid(), attendanceDate: z.string().date(), scheduledIn: z.string().regex(hm).default("08:00"), scheduledOut: z.string().regex(hm).default("17:00"), timeIn: z.string().regex(hm).optional(), timeOut: z.string().regex(hm).optional(), remarks: z.string().trim().max(300).optional().default("") });
const leaveFileInput = z.object({ action: z.literal("leave-file"), employeeId: z.string().uuid(), leaveType: z.string().trim().min(1).max(60), startsOn: z.string().date(), endsOn: z.string().date(), reason: z.string().trim().min(1).max(300) });
const leaveDecideInput = z.object({ action: z.literal("leave-decide"), id: z.string().uuid(), decision: z.enum(["Approved", "Rejected"]) });
const advanceFileInput = z.object({ action: z.literal("advance-file"), employeeId: z.string().uuid(), amountCentavos: z.number().int().positive(), requestedOn: z.string().date() });
const leaveFileSelfInput = z.object({ action: z.literal("leave-file-self"), leaveType: z.string().trim().min(1).max(60), startsOn: z.string().date(), endsOn: z.string().date(), reason: z.string().trim().min(1).max(300) });
const advanceFileSelfInput = z.object({ action: z.literal("advance-file-self"), amountCentavos: z.number().int().positive(), reason: z.string().trim().max(300).optional().default("") });
const advanceDecideInput = z.object({ action: z.literal("advance-decide"), id: z.string().uuid(), decision: z.enum(["Approved", "Rejected"]) });
const employeeSaveInput = z.object({ action: z.literal("employee-save"), id: z.string().uuid().nullable().optional(), completeName: z.string().trim().min(2).max(160), position: z.string().trim().min(1).max(120), employmentStatus: z.string().trim().min(1).max(40).default("Active"), dateHired: z.string().date(), payType: z.enum(["Monthly", "Semi-Monthly", "Weekly", "Daily"]).default("Monthly"), baseRateCentavos: z.number().int().nonnegative().default(0), instructorDailyRateCentavos: z.number().int().nonnegative().nullable().optional(), workEmail: z.string().email().optional().or(z.literal("")), active: z.boolean().optional() });
const employeeSetActiveInput = z.object({ action: z.literal("employee-set-active"), id: z.string().uuid(), active: z.boolean() });
const payrollOpenInput = z.object({ action: z.literal("payroll-open"), startsOn: z.string().date(), endsOn: z.string().date(), payDate: z.string().date() });
const payrollReviewInput = z.object({ action: z.literal("payroll-review"), id: z.string().uuid() });
const payrollFinalizeInput = z.object({ action: z.literal("payroll-finalize"), id: z.string().uuid() });
// Employee salary charges: employee self-files (category + note, no amount); the Accounting
// Manager sets the amount (which activates it) or inputs a charge directly; auto-deducted from payroll.
const employeeChargeCategory = z.enum(["Rescheduling", "Cancellation", "Wrong Enrollment", "Reprinting", "Others"]);
const employeeChargeFileSelfInput = z.object({ action: z.literal("employee-charge-file-self"), category: employeeChargeCategory, note: z.string().trim().max(300).optional().default("") });
const employeeChargeSetAmountInput = z.object({ action: z.literal("employee-charge-set-amount"), id: z.string().uuid(), amountCentavos: z.number().int().positive() });
const employeeChargeInput = z.object({ action: z.literal("employee-charge-input"), employeeId: z.string().uuid(), category: employeeChargeCategory, amountCentavos: z.number().int().positive(), note: z.string().trim().max(300).optional().default("") });
const employeeChargeCancelInput = z.object({ action: z.literal("employee-charge-cancel"), id: z.string().uuid() });
// HR: government-benefit records + employment contracts (details only) + self clock-in/out.
const benefitSaveInput = z.object({ action: z.literal("benefit-save"), id: z.string().uuid().nullable().optional(), employeeId: z.string().uuid(), benefitType: z.string().trim().min(1).max(60), reference: z.string().trim().max(120).optional().default(""), amountCentavos: z.number().int().nonnegative().optional().default(0), effectiveFrom: z.string().date().nullable().optional(), effectiveTo: z.string().date().nullable().optional() });
const benefitRemoveInput = z.object({ action: z.literal("benefit-remove"), id: z.string().uuid() });
const contractSaveInput = z.object({ action: z.literal("contract-save"), id: z.string().uuid().nullable().optional(), employeeId: z.string().uuid(), contractType: z.string().trim().min(1).max(60), position: z.string().trim().max(120).optional().default(""), rateCentavos: z.number().int().nonnegative().optional().default(0), startsOn: z.string().date(), endsOn: z.string().date().nullable().optional(), status: z.string().trim().min(1).max(40).optional().default("Active"), notes: z.string().trim().max(500).optional().default("") });
const contractRemoveInput = z.object({ action: z.literal("contract-remove"), id: z.string().uuid() });
const attendanceCheckInSelfInput = z.object({ action: z.literal("attendance-check-in-self") });
const attendanceCheckOutSelfInput = z.object({ action: z.literal("attendance-check-out-self") });
// Training Operations: managed classrooms (name / venue / capacity).
const classroomSaveInput = z.object({ action: z.literal("classroom-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(120), venue: z.string().trim().min(1).max(160), capacity: z.number().int().positive().max(1000), active: z.boolean().optional() });
const classroomSetActiveInput = z.object({ action: z.literal("classroom-set-active"), id: z.string().uuid(), active: z.boolean() });
// Accounting-managed pricing: course pricelist + endorsed-offer rates/rebates.
const coursePriceInput = z.object({ action: z.literal("course-price-save"), courseId: z.string().uuid(), priceCentavos: z.number().int().nonnegative() });
const offerRateInput = z.object({ action: z.literal("offer-rate-save"), offerId: z.string().uuid(), trainingFeeCentavos: z.number().int().nonnegative(), rebateCentavos: z.number().int().nonnegative() });
const courseSaveInput = z.object({ action: z.literal("course-save"), id: z.string().uuid().nullable().optional(), code: z.string().trim().min(2).max(40), name: z.string().trim().min(2).max(240), categoryId: z.string().uuid(), deliveryType: z.enum(["In-House", "Partner or Endorsed"]), durationLabel: z.string().trim().min(1).max(60), durationDays: z.number().positive().max(365), mode: z.string().trim().min(2).max(80), priceCentavos: z.number().int().nonnegative() });
const centerSaveInput = z.object({ action: z.literal("center-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(2).max(160), email: z.string().email().optional().or(z.literal("")), mobile: z.string().trim().max(40).optional(), active: z.boolean().optional() });
// Cashier actions relocated into the Payments module.
// Miscellaneous items (Schedule of fees, kind "item") sold with a payment. Each becomes an
// enrollment charge that is approved because it is paid on the same receipt.
const paymentItemInput = z.object({ enrollmentId: z.string().uuid(), chargeCatalogId: z.string().uuid().nullable().optional(), description: z.string().trim().min(1).max(120), unitCentavos: z.number().int().positive(), quantity: z.number().int().min(1).max(50) });
const paymentSplitInput = z.object({ action: z.literal("payment-split"), allocations: z.array(z.object({ enrollmentId: z.string().uuid(), amountCentavos: z.number().int().positive() })).max(10).default([]), items: z.array(paymentItemInput).max(10).optional().default([]), proofId: z.string().uuid().nullable().optional(), method: z.string().trim().min(1).max(80), receivingAccount: z.string().trim().min(2).max(120), referenceNumber: z.string().trim().max(80).optional().default(""), receivedAt: z.string().datetime({ offset: true }), remarks: z.string().trim().max(500).optional().default("") });
const courseChangeInput = z.object({ action: z.literal("enrollment-course-change"), enrollmentId: z.string().uuid(), courseId: z.string().uuid(), partnerOfferId: z.string().uuid().nullable().optional() });
const rescheduleInput = z.object({ action: z.literal("enrollment-reschedule"), enrollmentId: z.string().uuid(), batchId: z.string().uuid().nullable() });
// Screening a website application (owner instruction, 7 Oct 2026): a staff
// checklist of three requirements, then enrollment once a verified payment exists.
// Required before hand-over (owner, 7 Oct 2026): valid ID, PEME medical, 2x2 photo,
// seaman's book / SRN. "other" is an optional noted extra; a legacy
// "medical_certificate" tick counts as the PEME medical (migration 202610070014).
const REQUIREMENT_CODES = ["valid_id", "medical_peme", "photo_2x2", "seamans_book"] as const;
const requirementCheckInput = z.object({ action: z.literal("requirement-check"), enrollmentId: z.string().uuid(), requirement: z.enum([...REQUIREMENT_CODES, "other"]), status: z.enum(["Verified", "Rejected"]), remarks: z.string().trim().max(500).optional() });
const applicationEnrollInput = z.object({ action: z.literal("application-enroll"), enrollmentId: z.string().uuid() });
// Registration edits a trainee's contact and work details from the profile.
// Name, SRN and birth date identify the person and are not edited here.
const optionalContact = z.string().trim().max(40).optional().refine((v) => !v || isPhContactNumber(v), VALIDATION_MESSAGES.contact);
const traineeUpdateInput = z.object({ action: z.literal("trainee-update"), traineeId: z.string().uuid(),
  mobile: z.string().trim().refine(isPhContactNumber, VALIDATION_MESSAGES.contact), email: z.string().trim().refine(isEmail, VALIDATION_MESSAGES.email),
  address: z.string().trim().min(8, "Enter the complete address.").max(500), placeOfBirth: z.string().trim().max(160).optional(),
  rank: z.string().trim().max(100).optional(), company: z.string().trim().max(160).optional(), suffix: z.string().trim().max(20).optional(),
  emergencyContactName: z.string().trim().max(160).optional(), emergencyContactMobile: optionalContact });
const admissionRecordInput = z.object({ action: z.literal("admission-record-issue"), traineeId: z.string().uuid() });
const applicationHandoverInput = z.object({ action: z.literal("application-handover"), enrollmentId: z.string().uuid() });
const requestChargeInput = z.object({ action: z.literal("request-charge"), id: z.string().uuid(), chargeCatalogId: z.string().uuid().nullable().optional(), description: z.string().trim().max(200).optional(), amountCentavos: z.number().int().min(0), remarks: z.string().trim().max(500).optional() });
// Course now, batch later (202610070005): the batch is optional.
const applicationAssignInput = z.object({ action: z.literal("application-assign"), traineeId: z.string().uuid(), courseId: z.string().uuid(), batchId: z.string().uuid().nullable().optional(), scheduledOn: z.string().date().nullable().optional() });
const applicationPlaceBatchInput = z.object({ action: z.literal("application-place-batch"), enrollmentId: z.string().uuid(), batchId: z.string().uuid() });
const sendInstructionsInput = z.object({ action: z.literal("send-instructions"), enrollmentId: z.string().uuid() });
const instructionTemplateSaveInput = z.object({ action: z.literal("instruction-template-save"), courseId: z.string().uuid(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(8000) });
const classroomLinkSaveInput = z.object({ action: z.literal("course-classroom-link-save"), courseId: z.string().uuid(), link: z.string().trim().max(500), code: z.string().trim().max(40).optional() });
const requestRaiseInput = z.object({ action: z.literal("request-raise"), enrollmentId: z.string().uuid(), requestType: z.enum(["Cancellation", "Refund", "Make-up Class", "Rescheduling", "Reprinting", "Change Course", "TAR reprint"]), reason: z.string().trim().min(1).max(500), batchId: z.string().uuid().nullable().optional(), amountCentavos: z.number().int().positive().optional(), paymentId: z.string().uuid().nullable().optional(), courseId: z.string().uuid().nullable().optional(), partnerOfferId: z.string().uuid().nullable().optional(), requestedOn: z.string().regex(/^d{4}-d{2}-d{2}$/).optional() });
const classroomClassesInput = z.object({ action: z.literal("classroom-classes") });
const classroomCourseLinkInput = z.object({ action: z.literal("classroom-course-link"), courseId: z.string().uuid(), classroomCourseId: z.string().trim().max(60).nullable() });
const classroomDisconnectInput = z.object({ action: z.literal("classroom-disconnect") });
const requestDecideInput = z.object({ action: z.literal("request-decide"), id: z.string().uuid(), approve: z.boolean(), remarks: z.string().trim().max(500).optional() });

const actionInput = z.discriminatedUnion("action", [configRemoveInput, closingReviewInput, agencyCodeInput, expenseReprintRequestInput, expenseReprintDecideInput, expenseReleaseInput, cashierOpenInput, balanceSummaryInput, classroomClassesInput, classroomCourseLinkInput, classroomDisconnectInput, requirementCheckInput, applicationEnrollInput, applicationAssignInput, applicationPlaceBatchInput, applicationHandoverInput, traineeUpdateInput, admissionRecordInput, requestChargeInput, batchInput, autoOpenBatchInput, autoOpenAllInput, enrollmentDeleteInput, batchUpdateInput, agencyRebateSetInput, recordAgencyRebateInput, agencyRebateSettleInput, expenseCategoryInput, inventoryItemInput, inventoryMoveInput, paymentInput, enrollmentInput, notificationInput, channelInput, chargeInput, agencyInput, payableInput, payableMarkPaidInput, expenseCreateInput, expenseDecideInput, closingInput, enrollmentChargeInput, enrollmentChargeVoidInput, hrAttendanceInput, leaveFileInput, leaveDecideInput, advanceFileInput, advanceDecideInput, employeeSaveInput, employeeSetActiveInput, payrollOpenInput, payrollReviewInput, payrollFinalizeInput, classroomSaveInput, classroomSetActiveInput, coursePriceInput, offerRateInput, courseSaveInput, centerSaveInput, paymentSplitInput, courseChangeInput, rescheduleInput, sendInstructionsInput, instructionTemplateSaveInput, classroomLinkSaveInput, leaveFileSelfInput, advanceFileSelfInput, requestRaiseInput, requestDecideInput, discountRequestInput, discountDecideInput, chargeDecideInput, announcementPostInput, announcementDeleteInput, certificateStatusInput, certificateIssueInput, certificatePrintInput, certificateVoidInput, certificateReleaseInput, certificateReleasePlanInput, certificateIssueInput2, certificateOverrideInput, certificateIssuanceToggleInput, certificateSeriesInput, certificateVoidRequestInput, certificateVoidDecideInput, certificateTemplateLinkInput, evaluationFormInput, certificateSoftCopyInput, feedbackSendEmailInput, pruneNowInput, employeeChargeFileSelfInput, employeeChargeSetAmountInput, employeeChargeInput, employeeChargeCancelInput, batchDeleteInput, benefitSaveInput, benefitRemoveInput, contractSaveInput, contractRemoveInput, attendanceCheckInSelfInput, attendanceCheckOutSelfInput, autoOpenWeekInput, autoOpenAllWeekInput]);
const canCashier = (roles: string[]) => roles.some((role) => ["admin", "cashier", "accounting"].includes(role));

const canRegister = (roles: string[]) => roles.some((role) => ["admin", "registration"].includes(role));
const canManageAccounting = (roles: string[]) => roles.some((role) => ["admin", "accounting"].includes(role));
const canManageHr = (roles: string[]) => roles.some((role) => ["admin", "hr"].includes(role));
// Employee-charge management: the Accounting Manager owns it; admin + HR (who run payroll) included.
const canManageEmployeeCharges = (roles: string[]) => roles.some((role) => ["admin", "accounting", "hr"].includes(role));
const canManageTraining = (roles: string[]) => roles.some((role) => ["admin", "training_operations"].includes(role));
const canRelease = (roles: string[]) => roles.some((role) => ["admin", "releasing_officer"].includes(role));
const isAdminRole = (roles: string[]) => roles.some((role) => ["admin", "super_admin"].includes(role));
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const minutesOfDay = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// After a payment posts, auto-send training instructions for in-house, scheduled, enrolled
// enrollments that have not yet been sent. Best-effort — never blocks the payment.
async function autoSendInstructions(admin: ReturnType<typeof createSupabaseAdminClient>, enrollmentIds: string[]) {
  for (const eid of enrollmentIds) {
    try {
      const { data: e } = await admin.from("enrollments").select("id,enrollment_number,batch_id,enrollment_status,instructions_sent_at,trainees(profile_id),courses(name,delivery_type,google_classroom_link)").eq("id", eid).maybeSingle();
      if (!e) continue;
      const course = Array.isArray(e.courses) ? e.courses[0] : e.courses;
      if (course?.delivery_type !== "In-House" || !e.batch_id || e.enrollment_status !== "Enrolled" || e.instructions_sent_at) continue;
      await admin.from("enrollments").update({ instructions_sent_at: new Date().toISOString() }).eq("id", eid);
      const trainee = Array.isArray(e.trainees) ? e.trainees[0] : e.trainees;
      if (trainee?.profile_id) {
        const link = course?.google_classroom_link ? ` Google Classroom: ${course.google_classroom_link}` : "";
        await admin.from("notifications").insert({ recipient_id: trainee.profile_id, notification_type: "training_instructions", title: "Your training instructions are ready", body: `Reporting instructions for ${course?.name ?? "your training"} (${e.enrollment_number}) have been sent. Please review your portal for reporting details.${link}`, related_record_type: "enrollment", related_record_id: eid });
      }
    } catch (err) { console.error("auto-send instructions failed:", err instanceof Error ? err.message : err); }
  }
}

// A paid application counts as enrolled (owner rule, 7 Oct 2026): once the
// requirements are verified, a batch is set and a verified payment exists, the
// database enrolls it. Called after every step that can complete those rules;
// "not ready yet" errors are expected and ignored. Returns the enrolled ids.
async function tryAutoEnroll(admin: ReturnType<typeof createSupabaseAdminClient>, enrollmentIds: string[], actor: string) {
  const enrolled: string[] = [];
  const { data: pending } = await admin.from("enrollments").select("id").in("id", enrollmentIds).eq("enrollment_status", "Pending");
  for (const row of pending ?? []) {
    const { error } = await admin.rpc("enroll_screened_application", { target_enrollment: row.id, actor });
    if (!error) enrolled.push(row.id);
  }
  return enrolled;
}

// Charge-bearing requests (Change Course, Rescheduling, Make-up Class,
// Cancellation, Reprinting, TAR reprint) are approved only after their fee is
// paid to the Cashier (owner, 7 Oct 2026). Their charge is payable as soon as the
// Cashier sets it; the Accounting Manager approves once it is collected.
const PAY_FIRST_REQUESTS = ["Change Course", "Rescheduling", "Make-up Class", "Cancellation", "Reprinting", "TAR reprint"];
/** How much of a request's charge has been collected: verified payments on the enrollment made after the charge was set. */
async function chargeCollection(admin: ReturnType<typeof createSupabaseAdminClient>, enrollmentId: string, chargeId: string) {
  const { data: charge } = await admin.from("enrollment_charges").select("amount_centavos,created_at").eq("id", chargeId).maybeSingle();
  if (!charge) return { amount: 0, collected: 0, paid: true };
  const { data: allocations } = await admin.from("payment_allocations").select("amount_centavos,payments!inner(valid,verification_state,created_at)")
    .eq("enrollment_id", enrollmentId).eq("payments.valid", true).eq("payments.verification_state", "Verified").gte("payments.created_at", charge.created_at);
  const collected = (allocations ?? []).reduce((sum, a) => sum + Number(a.amount_centavos), 0);
  const amount = Number(charge.amount_centavos);
  return { amount, collected, paid: collected >= amount };
}


class RequestNotApplicable extends Error {}
type ApprovableRequest = { id: string; enrollment_id: string; request_type: string; requested_values: unknown };
/** Apply an approved change request to the enrollment (shared by Accounting approval and automatic approval once paid). */
async function applyApprovedRequest(admin: ReturnType<typeof createSupabaseAdminClient>, req: ApprovableRequest, actor: string, remarks: string | null) {
    const rv = (req.requested_values ?? {}) as { batchId?: string; amountCentavos?: number; paymentId?: string; courseId?: string; partnerOfferId?: string };
    if (req.request_type === "Rescheduling") {
      await applyReschedule(admin, req.enrollment_id, rv.batchId ?? null);
    } else if (req.request_type === "Change Course") {
      await applyCourseChange(admin, req.enrollment_id, rv.courseId ?? "", rv.partnerOfferId ?? null);
    } else if (req.request_type === "Cancellation") {
      const { error } = await admin.from("enrollments").update({ enrollment_status: "Cancelled", cancelled_at: new Date().toISOString() }).eq("id", req.enrollment_id);
      if (error) throw error;
    } else if (req.request_type === "Refund") {
      const { error } = await admin.from("refunds_and_reversals").insert({ enrollment_id: req.enrollment_id, payment_id: rv.paymentId ?? null, event_type: "refund", amount_centavos: rv.amountCentavos ?? 0, reason: remarks ?? "Approved refund request", approved_request_id: req.id, created_by: actor });
      if (error) throw error;
    } else if (req.request_type === "Make-up Class") {
      // Requires migration 202608020003 (nullable original_attendance_record_id). Best-effort so
      // approval still records before the column is nullable; Training Ops completes the assignment.
      const { error } = await admin.from("make_up_assignments").insert({ enrollment_id: req.enrollment_id, status: "Pending", assigned_by: actor });
      if (error) console.error("Make-up assignment insert failed (apply migration 202608020003):", error.message);
    } else if (req.request_type === "Reprinting") {
      // A paid Reprinting request allows one more print of the same certificate (owner, 8 Oct 2026).
      const { data: cert } = await admin.from("certificates").select("id,reprint_count").eq("enrollment_id", req.enrollment_id).maybeSingle();
      if (!cert) throw new RequestNotApplicable("No certificate has been printed for this enrollment yet.");
      const { data: allowed } = await admin.from("certificates").select("reprints_allowed").eq("id", cert.id).maybeSingle();
      const patch: Record<string, unknown> = { reprint_count: Number(cert.reprint_count ?? 0) + 1 };
      if (allowed) patch.reprints_allowed = Number((allowed as { reprints_allowed?: number }).reprints_allowed ?? 0) + 1;
      const { error: reprintError } = await admin.from("certificates").update(patch).eq("id", cert.id);
      if (reprintError) throw reprintError;
      await admin.from("certificate_release_events").insert({ certificate_id: cert.id, event_type: "reprint", released_by: actor, reason: "Paid reprinting request" });
    } else if (req.request_type === "TAR reprint") {
      // One more print of the newest admission record that covers this enrollment.
      const { data: record, error: recordError } = await admin.from("admission_records").select("id,reprints_approved").contains("enrollment_ids", [req.enrollment_id]).order("issued_at", { ascending: false }).limit(1).maybeSingle();
      if (recordError) throw recordError;
      if (!record) throw new RequestNotApplicable("No admission record has been printed for this enrollment yet.");
      const { error } = await admin.from("admission_records").update({ reprints_approved: Number(record.reprints_approved ?? 0) + 1 }).eq("id", record.id);
      if (error) throw error;
    }
}

/**
 * Once paid, implement automatically (owner, 7 Oct 2026): a pay-first request
 * whose fee is fully collected is applied and marked approved straight away,
 * without waiting for the Accounting Manager. Requests with no fee still go to
 * Accounting. Failures (for example a full batch) leave the request pending.
 */
/** Give an agency a fresh, unique referral code (letters of its name + 6 digits). Null before migration 023. */
async function assignReferralCode(admin: ReturnType<typeof createSupabaseAdminClient>, id: string, name: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = suggestReferralCode(name);
    const { error } = await admin.from("marketing_agencies").update({ referral_code: code }).eq("id", id);
    if (!error) return code;
    if (!/duplicate|unique/i.test(error.message)) return null;
  }
  return null;
}

/**
 * Set a request's fee and send it on (owner, 8 Oct 2026). Rescheduling and
 * cancellation fees come from the policy (lib/request-fees), worked out from the
 * request date and the training start. The request is applied automatically
 * once the fee is paid (autoImplementPaidRequests); with no fee it is applied now.
 */
async function chargeRequest(admin: ReturnType<typeof createSupabaseAdminClient>, req: ApprovableRequest, actor: string, opts: { amountCentavos: number; description?: string; chargeCatalogId?: string | null; remarks?: string | null }) {
  let amountCentavos = opts.amountCentavos, description = opts.description, feeRule: string | null = null;
  if ((RULED_REQUESTS as readonly string[]).includes(req.request_type)) {
    const { data: en } = await admin.from("enrollments").select("selling_price_centavos,scheduled_on,batches(starts_on)").eq("id", req.enrollment_id).single();
    const { data: dated } = await admin.from("enrollment_requests").select("requested_on").eq("id", req.id).maybeSingle();
    const { data: made } = await admin.from("enrollment_requests").select("created_at").eq("id", req.id).single();
    const e = en as { selling_price_centavos: number; scheduled_on?: string | null; batches?: { starts_on?: string | null } | { starts_on?: string | null }[] | null };
    const batch = Array.isArray(e.batches) ? e.batches[0] : e.batches;
    const fee = requestFee({ type: req.request_type, trainingFeeCentavos: Number(e.selling_price_centavos), startDate: batch?.starts_on ?? e.scheduled_on ?? null, requestedOn: (dated as { requested_on?: string | null } | null)?.requested_on ?? manilaDate(new Date((made as { created_at: string }).created_at)) });
    if (fee) { amountCentavos = fee.amountCentavos; feeRule = fee.rule; description = `${req.request_type} fee (${fee.rule})`.slice(0, 200); }
  }
  const payFirst = PAY_FIRST_REQUESTS.includes(req.request_type);
  let chargeId: string | null = null;
  if (amountCentavos > 0) {
    // Payable right away (valid) for pay-first requests, so the Cashier can collect it.
    const { data: charge, error: chargeError } = await admin.from("enrollment_charges").insert({ enrollment_id: req.enrollment_id, charge_catalog_id: opts.chargeCatalogId ?? null, description: description || `${req.request_type} fee`, amount_centavos: amountCentavos, event_type: "charge", valid: payFirst, approval_status: "Pending", created_by: actor }).select("id").single();
    if (chargeError) throw chargeError;
    chargeId = charge.id;
  }
  const at = new Date().toISOString();
  const { error } = await admin.from("enrollment_requests").update({ stage: "For approval", charge_id: chargeId, charged_by: actor, charged_at: at, updated_at: at }).eq("id", req.id);
  if (error) throw error;
  if (feeRule) await admin.from("enrollment_requests").update({ fee_rule: feeRule }).eq("id", req.id); // 202610080022; ignored before it
  await admin.from("request_events").insert({ request_id: req.id, actor_id: actor, event_type: "charged", new_values: { charge_id: chargeId, amount_centavos: amountCentavos, fee_rule: feeRule }, remarks: opts.remarks ?? null });
  // Nothing to pay: a pay-first request is applied at once.
  let applied = false;
  if (!chargeId && payFirst) {
    await applyApprovedRequest(admin, req, actor, "Applied (no fee)");
    await admin.from("enrollment_requests").update({ status: "Approved", decided_at: at, decision_remarks: "Applied (no fee)", assigned_approver_id: actor }).eq("id", req.id);
    await admin.from("request_events").insert({ request_id: req.id, actor_id: actor, event_type: "approved", remarks: "Applied (no fee)" });
    applied = true;
  }
  return { chargeId, amountCentavos, feeRule, applied };
}

async function autoImplementPaidRequests(admin: ReturnType<typeof createSupabaseAdminClient>, enrollmentIds: string[], actor: string) {
  if (!enrollmentIds.length) return [] as string[];
  const { data, error } = await admin.from("enrollment_requests").select("id,enrollment_id,request_type,requested_values,status,stage,charge_id").in("enrollment_id", enrollmentIds).eq("status", "Pending").not("charge_id", "is", null);
  if (error) return [];
  const implemented: string[] = [];
  for (const req of (data ?? []) as (ApprovableRequest & { stage?: string; charge_id: string })[]) {
    if (req.stage === "With cashier" || !PAY_FIRST_REQUESTS.includes(req.request_type)) continue;
    const due = await chargeCollection(admin, req.enrollment_id, req.charge_id);
    if (!due.paid) continue;
    try {
      await applyApprovedRequest(admin, req, actor, "Implemented automatically once paid");
      await admin.from("enrollment_charges").update({ valid: true, approval_status: "Approved", decided_by: actor, decided_at: new Date().toISOString() }).eq("id", req.charge_id).eq("approval_status", "Pending");
      await admin.from("enrollment_requests").update({ status: "Approved", decided_at: new Date().toISOString(), decision_remarks: "Implemented automatically once paid", assigned_approver_id: actor }).eq("id", req.id);
      await admin.from("request_events").insert({ request_id: req.id, actor_id: actor, event_type: "approved", remarks: "Implemented automatically once paid" });
      implemented.push(req.id);
    } catch (e) {
      console.error("Automatic request implementation failed:", req.id, e instanceof Error ? e.message : e);
    }
  }
  return implemented;
}

/**
 * Invite the trainee's email to the course's Google Classroom class, when New
 * Wave has connected Classroom and linked the course to a class. Best-effort:
 * the result is recorded and shown, and never blocks generating instructions.
 */
async function inviteToClassroom(admin: ReturnType<typeof createSupabaseAdminClient>, enrollmentId: string, actor: string) {
  if (!googleConfigured()) return null;
  const connection = await activeConnection(admin).catch(() => null);
  if (!connection) return null;
  const { data: row } = await admin.from("enrollments").select("course_id,trainees(email)").eq("id", enrollmentId).maybeSingle();
  const email = first(row?.trainees as { email: string } | { email: string }[] | null)?.email;
  if (!row || !email) return null;
  const { data: course } = await admin.from("courses").select("google_classroom_course_id").eq("id", row.course_id).maybeSingle();
  const classroomCourseId = (course as { google_classroom_course_id?: string | null } | null)?.google_classroom_course_id;
  if (!classroomCourseId) return null;
  const result = await inviteStudent(admin, classroomCourseId, email).catch((err: unknown) => ({ state: "Failed" as const, invitationId: null, error: err instanceof Error ? err.message : "Could not reach Google Classroom." }));
  await admin.from("classroom_invitations").insert({ enrollment_id: enrollmentId, classroom_course_id: classroomCourseId, email, state: result.state, invitation_id: result.invitationId, error: result.error, created_by: actor });
  return { state: result.state, email, error: result.error };
}

/**
 * The mode of payment must be one of New Wave's active modes (Cash, GCash,
 * PSBank, UnionBank); every mode that requires it needs a reference number.
 * Returns an error message, or null when the payment may be posted.
 */
async function paymentModeProblem(admin: ReturnType<typeof createSupabaseAdminClient>, method: string, reference: string | null | undefined) {
  const { data: modes } = await admin.from("payment_methods").select("name,requires_reference,active");
  const mode = (modes ?? []).find((m) => m.name === method);
  if (!mode || !mode.active) return `Choose one of the modes of payment: ${(modes ?? []).filter((m) => m.active).map((m) => m.name).join(", ") || "Cash"}.`;
  if (mode.requires_reference && !(reference ?? "").trim()) return `Enter the ${method} reference number.`;
  return null;
}

/** Queue and immediately try to send the training instructions email for one enrollment. */
async function queueInstructionEmail(admin: ReturnType<typeof createSupabaseAdminClient>, enrollmentId: string, generation: number, origin: string) {
  const details = await loadInstructionDetails(admin, enrollmentId);
  const to = details?.traineeEmail ?? null;
  if (!details || !to) return { state: "No email", to };
  if (!emailConfigured()) return { state: "Not configured", to };
  const blocks = classroomEmailBlocks(details.join);
  const { data: job, error } = await admin.from("email_jobs").insert({
    idempotency_key: `instructions:${enrollmentId}:${generation}`, template_code: "training.instructions", recipient: to,
    variables: { enrollment_id: enrollmentId, attach_instructions_for: enrollmentId, trainee_name: details.traineeName, course_name: details.courseName, dates: details.dates, time: details.time, classroom: details.classroom, enrollment_number: details.enrollmentNumber, classroom_join_url: details.join.url ?? "", class_code: details.join.code ?? "", classroom_block_html: blocks.html, classroom_block_text: blocks.text },
  }).select("id").single();
  if (error || !job) return { state: "Failed", to, error: error?.message ?? "Could not queue the email." };
  try {
    const { results } = await processEmailJobs(admin, { ids: [job.id], origin });
    const result = results[0];
    return { state: result?.state ?? "Queued", to, error: result?.error };
  } catch (err) {
    return { state: "Queued", to, error: err instanceof Error ? err.message : "Will retry" };
  }
}

// Registration may generate a trainee's training instructions at most twice.
const INSTRUCTION_LIMIT = 2;
// The Training Admission Record may be printed twice; further reprints need an
// approved "TAR reprint" request (migration 202610070007).
const TAR_FREE_PRINTS = 2;

// Move an enrollment to a new batch (or to "no batch"), keeping confirmed_count and
// Open/Full status correct on both batches. Shared by the direct reschedule action and
// the approval side-effect of a Rescheduling request.
async function applyReschedule(admin: ReturnType<typeof createSupabaseAdminClient>, enrollmentId: string, newBatchId: string | null) {
  const { data: enrollment } = await admin.from("enrollments").select("id,batch_id").eq("id", enrollmentId).maybeSingle();
  if (!enrollment) throw new Error("Enrollment not found.");
  const oldBatch = enrollment.batch_id as string | null;
  if (newBatchId && newBatchId !== oldBatch) {
    const { data: nb } = await admin.from("batches").select("capacity,confirmed_count").eq("id", newBatchId).maybeSingle();
    if (!nb) throw new Error("Schedule not found.");
    if (Number(nb.confirmed_count) >= Number(nb.capacity)) throw new Error("That schedule is already full.");
  }
  const { error } = await admin.from("enrollments").update({ batch_id: newBatchId }).eq("id", enrollmentId);
  if (error) throw error;
  if (oldBatch && oldBatch !== newBatchId) {
    const { data: ob } = await admin.from("batches").select("confirmed_count,capacity,status").eq("id", oldBatch).maybeSingle();
    if (ob) { const next = Math.max(0, Number(ob.confirmed_count) - 1); await admin.from("batches").update({ confirmed_count: next, status: ob.status === "Full" && next < Number(ob.capacity) ? "Open" : ob.status }).eq("id", oldBatch); }
  }
  if (newBatchId && newBatchId !== oldBatch) {
    const { data: nb2 } = await admin.from("batches").select("confirmed_count,capacity,status").eq("id", newBatchId).maybeSingle();
    if (nb2) { const next = Number(nb2.confirmed_count) + 1; await admin.from("batches").update({ confirmed_count: next, status: next >= Number(nb2.capacity) ? "Full" : nb2.status }).eq("id", newBatchId); }
  }
}
async function applyCourseChange(admin: ReturnType<typeof createSupabaseAdminClient>, enrollmentId: string, courseId: string, partnerOfferId: string | null) {
  const { data: enrollment } = await admin.from("enrollments").select("id").eq("id", enrollmentId).maybeSingle();
  if (!enrollment) throw new Error("Enrollment not found.");
  let price = 0;
  if (partnerOfferId) {
    const { data: offer } = await admin.from("partner_course_offers").select("training_fee_centavos").eq("id", partnerOfferId).maybeSingle();
    if (!offer) throw new Error("Endorsed offer not found."); price = Number(offer.training_fee_centavos);
  } else {
    const { data: course } = await admin.from("courses").select("standard_price_centavos").eq("id", courseId).maybeSingle();
    if (!course) throw new Error("Course not found."); price = Number(course.standard_price_centavos);
  }
  const { data: allocs } = await admin.from("payment_allocations").select("amount_centavos,payments!inner(valid)").eq("enrollment_id", enrollmentId).eq("payments.valid", true);
  const paid = (allocs ?? []).reduce((s, r) => s + Number(r.amount_centavos), 0);
  const { data: chgs } = await admin.from("enrollment_charges").select("amount_centavos,event_type").eq("enrollment_id", enrollmentId).eq("valid", true);
  const charge = (chgs ?? []).filter((r) => r.event_type !== "discount").reduce((s, r) => s + Number(r.amount_centavos), 0);
  const discount = (chgs ?? []).filter((r) => r.event_type === "discount").reduce((s, r) => s + Number(r.amount_centavos), 0);
  if (paid > price + charge - discount) throw new Error("The new course price is lower than the amount already paid on this enrollment.");
  const { error } = await admin.from("enrollments").update({ course_id: courseId, partner_offer_id: partnerOfferId ?? null, selling_price_centavos: price }).eq("id", enrollmentId);
  if (error) throw error;
}
const stampManila = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

/**
 * The workspace payload is large, so the ceiling is generous — but the real
 * guard is that every independent dataset below is gathered concurrently.
 * This handler used to run ~25 sequential round trips and would exhaust the
 * platform timeout (returning a 504) as the data grew.
 */
export const maxDuration = 60;

/** Enrollment columns that arrive with later migrations; absent before they run. */
type EnrollmentExtra = { id: string; scheduled_on?: string | null; instructions_sent_at?: string | null; feedback_token?: string | null };

const EMPTY_HR: Record<string, unknown[]> = { employees: [], employeeAttendance: [], leaveRequests: [], cashAdvances: [], payrollPeriods: [], payrollItems: [], benefitRecords: [], employmentContracts: [] };

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  // One service-role client for the whole handler.
  const db = createSupabaseAdminClient();

  // HR datasets are sensitive (salaries, government IDs) — only HR and Admin receive them.
  const isHr = canManageHr(staff.roleCodes);
  // Certificates carry trainee identity — Training Operations, Releasing Officer, Admin.
  const seesCertificates = canManageTraining(staff.roleCodes) || canRelease(staff.roleCodes);
  const seesPendingCharges = canManageAccounting(staff.roleCodes) || canCashier(staff.roleCodes);
  const seesRequests = canCashier(staff.roleCodes) || staff.roleCodes.includes("registration");
  const seesEmployeeCharges = canManageEmployeeCharges(staff.roleCodes);
  const staffEmail = staff.user.email;

  // Every unit below is started now and awaited later, so they overlap with the
  // core batch instead of queueing behind it. Each is independently tolerant of
  // a pre-migration schema: a failure yields empty data, never a 500.

  // enrollments gained scheduled_on / instructions_sent_at / feedback_token over
  // three migrations. Read them in one query; if any column is missing the whole
  // select errors, so fall back to reading each on its own and omit what is absent.
  const enrollmentExtrasUnit = (async (): Promise<EnrollmentExtra[]> => {
    // Ordered the same way as the main enrollments query, so these 250 rows are
    // the same 250 rows; unordered, the extras could belong to a different set.
    const merged = await db.from("enrollments").select("id,scheduled_on,instructions_sent_at,feedback_token").order("created_at", { ascending: false }).limit(250);
    if (!merged.error) return (merged.data ?? []) as EnrollmentExtra[];
    const parts = await Promise.all([
      db.from("enrollments").select("id,scheduled_on").order("created_at", { ascending: false }).limit(250),
      db.from("enrollments").select("id,instructions_sent_at").order("created_at", { ascending: false }).limit(250),
      db.from("enrollments").select("id,feedback_token").order("created_at", { ascending: false }).limit(250),
    ]);
    const byId = new Map<string, EnrollmentExtra>();
    for (const part of parts) {
      if (part.error) continue;
      for (const row of (part.data ?? []) as EnrollmentExtra[]) byId.set(row.id, { ...(byId.get(row.id) ?? { id: row.id }), ...row });
    }
    return [...byId.values()];
  })();

  const feedbackUnit = (async () => {
    const { data } = await db.from("training_feedback").select("enrollment_id").limit(500);
    return new Set((data ?? []).map((row) => (row as { enrollment_id: string }).enrollment_id));
  })();

  const hrUnit = (async (): Promise<Record<string, unknown[]>> => {
    if (!isHr) return { ...EMPTY_HR };
    const r = await Promise.all([
      db.from("employees").select("id,employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,instructor_daily_rate_centavos,work_email,active").order("complete_name"),
      db.from("employee_attendance").select("id,employee_id,attendance_date,checked_in_at,checked_out_at,minutes_late,minutes_undertime,status,remarks").order("attendance_date", { ascending: false }).limit(300),
      db.from("leave_requests").select("id,employee_id,leave_type,starts_on,ends_on,reason,status,created_at").order("created_at", { ascending: false }).limit(200),
      db.from("cash_advances").select("id,employee_id,amount_centavos,requested_on,balance_centavos,status").order("requested_on", { ascending: false }).limit(200),
      db.from("payroll_periods").select("id,period_number,starts_on,ends_on,pay_date,status,finalized_at").order("starts_on", { ascending: false }).limit(60),
      db.from("payroll_items").select("id,payroll_period_id,employee_id,gross_centavos,deduction_centavos,net_centavos,breakdown").limit(600),
      // Tolerant: benefit_records.created_at + employment_contracts arrive with migration 202608090001.
      db.from("benefit_records").select("id,employee_id,benefit_type,reference,amount_centavos,effective_from,effective_to").order("created_at", { ascending: false }).limit(400),
      db.from("employment_contracts").select("id,employee_id,contract_type,position,rate_centavos,starts_on,ends_on,status,notes").order("created_at", { ascending: false }).limit(400),
    ]);
    return { employees: r[0].data ?? [], employeeAttendance: r[1].data ?? [], leaveRequests: r[2].data ?? [], cashAdvances: r[3].data ?? [], payrollPeriods: r[4].data ?? [], payrollItems: r[5].data ?? [], benefitRecords: r[6].data ?? [], employmentContracts: r[7].data ?? [] };
  })();

  const certificateUnit = (async () => {
    const empty = { certificates: [] as unknown[], templates: [] as unknown[], releases: [] as unknown[], issuanceEnabled: false, series: [] as unknown[], evaluationForms: {} as Record<string, string>, feedbackAt: {} as Record<string, string> };
    if (!seesCertificates) return empty;
    const [base, extra, tpls, rel, settings] = await Promise.all([
      db.from("certificates").select("id,enrollment_id,status,printed_at,printed_by,reprint_count,snapshot,number_pool_id,template_id,created_at,enrollments(enrollment_number,trainees(legal_first_name,legal_last_name),courses(name,code))").order("created_at", { ascending: false }).limit(300),
      // Release/courier/correction fields ship in a later migration — merge tolerantly
      // so a pre-migration database returns the base certificate rows instead of 500ing.
      // The limit matches the base query so the merge cannot miss a loaded row.
      db.from("certificates").select("id,release_method,expected_pickup_on,claimant_name,claimant_relationship,id_checked,authorization_checked,courier_name,tracking_number,shipping_fee_status,shipping_address,courier_status,issue_status,issue_note,issue_reported_on").order("created_at", { ascending: false }).limit(300),
      db.from("certificate_templates").select("id,course_id,version,storage_path,active,fields,approved_at,courses(name,code)").order("created_at", { ascending: false }).limit(200),
      // Released-list report source (tolerant: table exists but may be empty).
      db.from("certificate_release_events").select("id,certificate_id,event_type,recipient_name,recipient_id_type,reason,created_at,certificates(enrollment_id,snapshot,enrollments(enrollment_number,trainees(legal_first_name,legal_last_name),courses(name,code)))").order("created_at", { ascending: false }).limit(400),
      // Certificate issuance safety flag (admin-toggleable; read via service role).
      db.from("organization_settings").select("certificate_issuance_enabled").maybeSingle(),
    ]);
    // Certificate controls (migration 202610080030): numbering, print counts, voids, Drive templates and
    // Google Forms evaluations. Each read is separate so a database without the update still loads.
    const [controls, series, tplLinks, forms, fbDates] = await Promise.all([
      db.from("certificates").select("id,certificate_number,batch_label,print_count,reprints_allowed,soft_copy_sent_at,void_status,void_reason,void_requested_at,void_remarks").order("created_at", { ascending: false }).limit(300),
      db.from("certificate_series").select("course_id,prefix,next_number,pad,batch_prefix,next_batch,set_at,profiles:set_by(complete_name)"),
      db.from("certificate_templates").select("id,drive_link").order("created_at", { ascending: false }).limit(200),
      db.from("courses").select("id,evaluation_form_id").not("evaluation_form_id", "is", null),
      db.from("training_feedback").select("enrollment_id,submitted_at").order("submitted_at", { ascending: false }).limit(2000),
    ]);
    let certificates = (base.data ?? []) as { id: string }[];
    for (const merge of [extra.data, controls.data]) {
      if (!merge?.length) continue;
      const byId = new Map((merge as { id: string }[]).map((r) => [r.id, r]));
      certificates = certificates.map((c) => ({ ...c, ...(byId.get(c.id) ?? {}) }));
    }
    const linkById = new Map(((tplLinks.data ?? []) as { id: string; drive_link: string | null }[]).map((r) => [r.id, r.drive_link]));
    const templates = ((tpls.data ?? []) as { id: string }[]).map((t) => ({ ...t, drive_link: linkById.get(t.id) ?? null }));
    const evaluationForms = Object.fromEntries(((forms.data ?? []) as { id: string; evaluation_form_id: string }[]).map((r) => [r.id, r.evaluation_form_id]));
    const feedbackAt = Object.fromEntries(((fbDates.data ?? []) as { enrollment_id: string; submitted_at: string }[]).map((r) => [r.enrollment_id, r.submitted_at]));
    return { certificates: certificates as unknown[], templates, releases: rel.data ?? [], issuanceEnabled: Boolean(settings.data?.certificate_issuance_enabled), series: series.data ?? [], evaluationForms, feedbackAt };
  })();

  // Non-discount charges awaiting the Accounting Manager approval queue.
  const pendingChargesUnit = (async (): Promise<unknown[]> => {
    if (!seesPendingCharges) return [];
    const { data } = await db.from("enrollment_charges").select("id,enrollment_id,description,amount_centavos,created_at,enrollments(enrollment_number,trainees(legal_first_name,legal_last_name),courses(name))").eq("event_type", "charge").eq("approval_status", "Pending").order("created_at", { ascending: false }).limit(200);
    return data ?? [];
  })();

  // Cashier to Accounting requests (Cancellation/Refund/Make-up/Rescheduling).
  // enrollment_requests is RLS-protected, so read via service role; expose only
  // to cashier/accounting/admin.
  const requestsUnit = (async (): Promise<unknown[]> => {
    if (!seesRequests) return [];
    const base = "id,request_number,request_type,requested_values,reason,status,decision_remarks,created_at,decided_at,trainees(legal_first_name,legal_last_name),enrollments(id,enrollment_number,trainee_id,courses(name))";
    const types = ["Cancellation", "Refund", "Make-up Class", "Rescheduling", "Reprinting", "Change Course", "TAR reprint"];
    // stage / charge_id come from migration 202610070004; without it, fall back.
    const routed = await db.from("enrollment_requests").select(`${base},stage,charge_id,enrollment_charges!enrollment_requests_charge_id_fkey(amount_centavos,description,approval_status)`).in("request_type", types).order("created_at", { ascending: false }).limit(200);
    if (!routed.error) {
      const list = (routed.data ?? []) as { id: string }[];
      // Request date and fee rule (202610080022); ignored before it.
      const { data: dated } = list.length ? await db.from("enrollment_requests").select("id,requested_on,fee_rule").in("id", list.map((r) => r.id)) : { data: [] };
      const byId = new Map((dated ?? []).map((r) => [(r as { id: string }).id, r]));
      return list.map((r) => ({ ...r, ...(byId.get(r.id) ?? {}) }));
    }
    const { data } = await db.from("enrollment_requests").select(base).in("request_type", types).order("created_at", { ascending: false }).limit(200);
    return data ?? [];
  })();

  // Per-course training instruction templates (subject/body) for the Instructions editor + PDF.
  const instructionTemplatesUnit = (async (): Promise<unknown[]> => {
    const { data } = await db.from("training_instruction_templates").select("course_id,subject,body,active").eq("active", true).order("version", { ascending: false }).limit(500);
    return data ?? [];
  })();

  // Instructor + room per batch, for the Schedule Officer workspace. Assignments are
  // per training date; the first assignment found represents the batch. Tolerant:
  // any failure yields an empty list rather than a 500.
  const batchStaffingUnit = (async (): Promise<{ batch_id: string; instructor_name: string | null; room_name: string | null }[]> => {
    const [dates, assigns, emps, rooms] = await Promise.all([
      db.from("batch_training_dates").select("id,batch_id").limit(5000),
      db.from("resource_assignments").select("batch_training_date_id,instructor_id,classroom_id").limit(5000),
      db.from("employees").select("id,complete_name").limit(1000),
      db.from("classrooms").select("id,name").limit(500),
    ]);
    const dateToBatch = new Map((dates.data ?? []).map((d) => [d.id, d.batch_id]));
    const empName = new Map((emps.data ?? []).map((e) => [e.id, e.complete_name]));
    const roomName = new Map((rooms.data ?? []).map((r) => [r.id, r.name]));
    const seen = new Map<string, { batch_id: string; instructor_name: string | null; room_name: string | null }>();
    for (const a of assigns.data ?? []) {
      const batchId = dateToBatch.get(a.batch_training_date_id);
      if (!batchId || seen.has(batchId)) continue;
      seen.set(batchId, { batch_id: batchId, instructor_name: empName.get(a.instructor_id) ?? null, room_name: roomName.get(a.classroom_id) ?? null });
    }
    return [...seen.values()];
  })();

  // Merge the payment-channel kind (receivable/payable) tolerantly — the column may not
  // be migrated yet, in which case every channel is treated as receivable.
  // Schedule of fees kind (item | fee), 202610070016. A missing column makes every entry a fee.
  const chargeKindUnit = (async () => {
    const kinds = new Map<string, string>();
    const { error, data } = await db.from("charge_catalog").select("id,kind");
    if (!error) for (const r of data ?? []) kinds.set(r.id as string, (r as { kind?: string }).kind ?? "fee");
    return kinds;
  })();
  const methodKindUnit = (async () => {
    const kindByMethod = new Map<string, string>();
    const { error, data } = await db.from("payment_methods").select("id,kind");
    if (!error) for (const r of data ?? []) kindByMethod.set(r.id as string, (r as { kind?: string }).kind ?? "receivable");
    return kindByMethod;
  })();

  // MyHr self-service: the signed-in staff member's OWN employee record plus leave and
  // cash-advance history, matched by login email to employees.work_email. Read via
  // service role, self only.
  const myHrUnit = (async (): Promise<{ employee: unknown; leave: unknown[]; advances: unknown[]; charges: unknown[]; attendance: unknown[] } | null> => {
    if (!staffEmail) return null;
    const { data: emp } = await db.from("employees").select("id,employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,work_email,active").ilike("work_email", staffEmail).maybeSingle();
    if (!emp) return null;
    const [leave, adv, chg, att] = await Promise.all([
      db.from("leave_requests").select("id,leave_type,starts_on,ends_on,reason,status,created_at").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(50),
      db.from("cash_advances").select("id,amount_centavos,requested_on,balance_centavos,status").eq("employee_id", emp.id).order("requested_on", { ascending: false }).limit(50),
      // Tolerant: the employee_charges category/note/balance columns may not be migrated yet.
      db.from("employee_charges").select("id,category,note,amount_centavos,balance_centavos,status,effective_on,activated_at").eq("employee_id", emp.id).order("effective_on", { ascending: false }).limit(50),
      db.from("employee_attendance").select("id,attendance_date,checked_in_at,checked_out_at,minutes_late,minutes_undertime,status").eq("employee_id", emp.id).order("attendance_date", { ascending: false }).limit(30),
    ]);
    return { employee: emp, leave: leave.data ?? [], advances: adv.data ?? [], charges: chg.data ?? [], attendance: att.data ?? [] };
  })();

  // Tolerant merge of expense payment channel + reference (migration 202608100001).
  // Kept out of the main select so a pre-migration schema does not empty the expenses list.
  const expenseExtrasUnit = (async () => {
    const { data: ex } = await db.from("expenses").select("id,payment_channel,reference_number,purpose,requested_by").order("created_at", { ascending: false }).limit(250);
    if (!ex) return { rows: [] as { id: string }[], names: new Map<string, string>() };
    // Voucher flow fields (202610070018).
    const { data: flow } = await db.from("expenses").select("id,request_number,voucher_number,approved_at,decision_remarks,released_at,drive_link,paid_at").in("id", ex.map((r) => (r as { id: string }).id));
    const flowById = new Map((flow ?? []).map((r) => [(r as { id: string }).id, r]));
    // Print counts (202610080020); ignored before it.
    const { data: prints } = await db.from("expenses").select("id,print_count,reprints_approved").in("id", ex.map((r) => (r as { id: string }).id));
    const printsById = new Map((prints ?? []).map((r) => [(r as { id: string }).id, r]));
    // Voucher lines and supporting document (202610080019); who approved and released (202610070018). Ignored before them.
    const { data: lines } = await db.from("expenses").select("id,line_items,supporting_document").in("id", ex.map((r) => (r as { id: string }).id));
    const linesById = new Map((lines ?? []).map((r) => [(r as { id: string }).id, r]));
    const { data: people2 } = await db.from("expenses").select("id,approved_by,released_by").in("id", ex.map((r) => (r as { id: string }).id));
    const peopleById = new Map((people2 ?? []).map((r) => [(r as { id: string }).id, r]));
    const rows = ex.map((r) => ({ ...r, ...(flowById.get((r as { id: string }).id) ?? {}), ...(printsById.get((r as { id: string }).id) ?? {}), ...(linesById.get((r as { id: string }).id) ?? {}), ...(peopleById.get((r as { id: string }).id) ?? {}) })) as { id: string }[];
    // Display names for who raised, approved and released each voucher.
    const ids = [...new Set(rows.flatMap((r) => { const x = r as { requested_by?: string; approved_by?: string; released_by?: string }; return [x.requested_by, x.approved_by, x.released_by]; }).filter(Boolean))] as string[];
    if (!ids.length) return { rows, names: new Map<string, string>() };
    const { data: people } = await db.from("profiles").select("id,complete_name").in("id", ids);
    return { rows, names: new Map((people ?? []).map((p) => [p.id as string, p.complete_name as string])) };
  })();

  // Employee-charge management for the Accounting Manager (admin / accounting / hr): the charge list
  // plus a minimal employee roster to file against (accounting does not receive the full HR dataset).
  const employeeChargeUnit = (async () => {
    if (!seesEmployeeCharges) return { charges: [] as unknown[], employees: [] as unknown[] };
    const [list, roster] = await Promise.all([
      db.from("employee_charges").select("id,employee_id,category,note,amount_centavos,balance_centavos,status,effective_on,activated_at,employees(complete_name,employee_number)").order("effective_on", { ascending: false }).limit(400),
      db.from("employees").select("id,complete_name,employee_number,active").eq("active", true).order("complete_name"),
    ]);
    return { charges: list.data ?? [], employees: roster.data ?? [] };
  })();

  const results = await Promise.all([
    db.from("profiles").select("complete_name,email").eq("id", staff.user.id).maybeSingle(),
    db.from("courses").select("id,code,name,delivery_type,duration_label,duration_days,training_mode,category_id,standard_price_centavos,google_classroom_link,active,updated_at,course_categories(name)").eq("active", true).order("name"),
    db.from("partner_course_offers").select("id,course_id,duration_label,training_fee_centavos,rebate_centavos,partner_payable_centavos,updated_at,partner_centers(name,contact_details)").eq("active", true).order("training_fee_centavos"),
    db.from("trainees").select("id,trainee_number,legal_first_name,legal_middle_name,legal_last_name,suffix,birthdate,sex,nationality,address,place_of_birth,rank,company,emergency_contact,email,mobile,srn,account_state,registered_at").neq("account_state", "Deactivated").order("created_at", { ascending: false }).limit(250),
    db.from("batches").select("id,batch_number,course_id,partner_offer_id,starts_on,ends_on,daily_start,daily_end,mode,venue,capacity,confirmed_count,enrollment_deadline,status,published_at,courses(name,code),partner_course_offers(partner_centers(name))").eq("active", true).order("starts_on", { ascending: true }).limit(250),
    db.from("enrollments").select("id,enrollment_number,trainee_id,course_id,partner_offer_id,batch_id,enrollment_status,instructions_status,source,selling_price_centavos,rebate_centavos,partner_payable_centavos,created_at,trainees(trainee_number,legal_first_name,legal_middle_name,legal_last_name,email,mobile),courses(name,code),batches(batch_number,starts_on,ends_on,mode,venue),partner_course_offers(partner_centers(name))").order("created_at", { ascending: false }).limit(250),
    db.from("payments").select("id,payment_number,trainee_id,amount_centavos,method,receiving_account,reference_number,proof_id,received_at,verification_state,remarks,valid,trainees(legal_first_name,legal_last_name)").eq("valid", true).order("received_at", { ascending: false }).limit(250),
    db.from("notifications").select("id,title,body,deep_link,read_at,created_at").eq("recipient_id", staff.user.id).order("created_at", { ascending: false }).limit(20),
    // Accounting datasets (Slice 1): channels, charges, agencies, expenses, payables.
    db.from("payment_methods").select("id,code,name,requires_reference,allows_proof,active,sort_order").order("sort_order"),
    db.from("charge_catalog").select("id,name,default_amount_centavos,active,used_count").order("name"),
    db.from("marketing_agencies").select("*").order("name"),
    db.from("expenses").select("id,expense_number,payee,category,amount_centavos,purpose,status,created_at").order("created_at", { ascending: false }).limit(250),
    db.from("payables").select("id,description,amount_centavos,due_on,status,paid_at,partner_center_id,enrollment_id,created_at").order("created_at", { ascending: false }).limit(250),
    db.from("cashier_closings").select("id,closing_date,opening_cash_centavos,cash_collections_centavos,online_collections_centavos,refunds_centavos,expenses_centavos,expected_cash_centavos,actual_cash_centavos,variance_centavos,status,submitted_at").order("closing_date", { ascending: false }).limit(60),
    db.from("enrollment_charges").select("id,enrollment_id,charge_catalog_id,description,amount_centavos,event_type,created_at").eq("valid", true).order("created_at", { ascending: false }).limit(500),
    db.from("classrooms").select("id,name,venue,capacity,active").order("name"),
    db.from("course_categories").select("id,name").eq("active", true).order("sort_order"),
    db.from("partner_centers").select("id,name,active").order("name"),
    db.from("agency_course_rebates").select("id,agency_id,course_id,rebate_centavos,updated_at").limit(2000),
    db.from("agency_rebates").select("id,agency_id,enrollment_id,course_id,rebate_centavos,status,created_at,marketing_agencies(name),courses(name),trainees(legal_first_name,legal_last_name)").order("created_at", { ascending: false }).limit(300),
    db.from("expense_categories").select("id,name,active").order("name"),
    db.from("inventory_items").select("id,name,category,unit,quantity_on_hand,unit_value_centavos,active").order("name"),
    db.from("inventory_movements").select("id,item_id,movement_type,quantity,remarks,created_at,inventory_items(name)").order("created_at", { ascending: false }).limit(200),
    db.from("enrollment_charges").select("id,enrollment_id,description,amount_centavos,agency_id,created_at,enrollments(enrollment_number,trainees(legal_first_name,legal_last_name),courses(name)),marketing_agencies(name)").eq("event_type", "discount").eq("approval_status", "Pending").order("created_at", { ascending: false }).limit(200),
    db.from("announcements").select("id,title,body,audience_roles,published_at,expires_at").order("published_at", { ascending: false, nullsFirst: false }).limit(30),
  ]);
  const error = results.find((item) => item.error)?.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const [profile, courses, offers, trainees, batches, enrollmentsResult, payments, notifications,
    paymentMethods, charges, agencies, expenses, payables, cashierClosings, enrollmentCharges, classrooms, courseCategories, partnerCenters, agencyCourseRebates, agencyRebates, expenseCategories, inventoryItems, inventoryMovements, pendingDiscounts, announcements] = results;

  // Collect the concurrent units started before the core batch.
  const [enrollmentExtras, feedbackByEnrollment, hr, certs, pendingCharges, requests, instructionTemplates, batchStaffing, kindByMethod, myHr, expenseExtras, employeeChargeData, chargeKinds] = await Promise.all([
    enrollmentExtrasUnit, feedbackUnit, hrUnit, certificateUnit, pendingChargesUnit, requestsUnit,
    instructionTemplatesUnit, batchStaffingUnit, methodKindUnit, myHrUnit, expenseExtrasUnit, employeeChargeUnit, chargeKindUnit,
  ]);

  // Collection status of pending Change Course / Rescheduling fees, shown to the
  // Cashier and the Accounting Manager (approval waits for payment).
  const chargeCollected: Record<string, { amount: number; collected: number; paid: boolean }> = {};
  {
    const admin = createSupabaseAdminClient();
    const pendingPayFirst = (requests as { id: string; status: string; request_type: string; charge_id?: string | null; enrollments?: { id: string } | { id: string }[] | null }[])
      .filter((r) => r.status === "Pending" && r.charge_id && PAY_FIRST_REQUESTS.includes(r.request_type));
    await Promise.all(pendingPayFirst.map(async (r) => { const e = first(r.enrollments); if (e?.id && r.charge_id) chargeCollected[r.id] = await chargeCollection(admin, e.id, r.charge_id); }));
  }

  const enrollmentRows = (enrollmentsResult.data ?? []) as { id: string }[];

  // Website applications still waiting for Registration to assign a course.
  // A missing column (migration 202610070002 not yet applied) yields none.
  const { data: awaitingRows } = await db.from("trainees").select("id").eq("awaiting_course", true).limit(500);
  const awaitingCourseIds = (awaitingRows ?? []).map((row: { id: string }) => row.id);
  // Website enrollment numbers (NWMTACI-0000001), keyed by trainee: what the
  // applicant quotes on Facebook. A missing column (migration 202610070003 not
  // yet applied) yields none.
  const { data: numberRows } = await db.from("trainees").select("id,application_number").not("application_number", "is", null).limit(5000);
  // Applicants Registration has handed to the Cashier for payment (202610070004).
  const { data: handedRows } = await db.from("enrollments").select("id,handed_to_cashier_at").not("handed_to_cashier_at", "is", null).eq("enrollment_status", "Pending").limit(1000);
  const handedToCashier = Object.fromEntries((handedRows ?? []).map((row: { id: string; handed_to_cashier_at: string }) => [row.id, row.handed_to_cashier_at]));
  const applicationNumbers = Object.fromEntries((numberRows ?? []).map((row: { id: string; application_number: string }) => [row.id, row.application_number]));
  // How many times instructions were generated per enrollment, and the printed
  // admission records (202610070007). Missing columns yield none.
  // Google Classroom connection status (no tokens leave the server), linked
  // class per course, and the latest invite per enrollment (migration 202610070013).
  const classroom = { configured: googleConfigured(), connected: false, accountEmail: null as string | null, connectedAt: null as string | null, driveReady: false };
  const classroomCourseIds: Record<string, string> = {};
  const classroomInvites: Record<string, { state: string; email: string; error: string | null; created_at: string }> = {};
  {
    const admin = createSupabaseAdminClient();
    const connection = await activeConnection(admin).catch(() => null);
    if (connection) Object.assign(classroom, { connected: true, accountEmail: connection.account_email, connectedAt: connection.connected_at, driveReady: hasDriveScope(connection.scopes) });
    const { data: linkRows } = await db.from("courses").select("id,google_classroom_course_id").not("google_classroom_course_id", "is", null).limit(1000);
    for (const r of (linkRows ?? []) as { id: string; google_classroom_course_id: string }[]) classroomCourseIds[r.id] = r.google_classroom_course_id;
    const { data: inviteRows } = await admin.from("classroom_invitations").select("enrollment_id,state,email,error,created_at").order("created_at", { ascending: false }).limit(1000);
    for (const r of (inviteRows ?? []) as { enrollment_id: string; state: string; email: string; error: string | null; created_at: string }[]) if (!classroomInvites[r.enrollment_id]) classroomInvites[r.enrollment_id] = r;
  }
  // Google Classroom class codes per course (migration 202610070012; none without it).
  const { data: codeRows } = await db.from("courses").select("id,google_classroom_code").not("google_classroom_code", "is", null).limit(1000);
  const classroomCodes = Object.fromEntries(((codeRows ?? []) as { id: string; google_classroom_code: string }[]).map((r) => [r.id, r.google_classroom_code]));
  // Latest training-instructions email per enrollment (who it went to, and whether it was sent).
  const instructionEmails: Record<string, { state: string; to: string; sent_at: string | null; last_error: string | null; created_at: string }> = {};
  {
    const admin = createSupabaseAdminClient();
    const { data: emailRows } = await admin.from("email_jobs").select("recipient,state,sent_at,last_error,created_at,variables").eq("template_code", "training.instructions").order("created_at", { ascending: false }).limit(1000);
    for (const row of emailRows ?? []) {
      const id = String((row.variables as { enrollment_id?: string } | null)?.enrollment_id ?? "");
      if (id && !instructionEmails[id]) instructionEmails[id] = { state: row.state, to: row.recipient, sent_at: row.sent_at, last_error: row.last_error, created_at: row.created_at };
    }
  }
  const { data: instructionRows } = await db.from("enrollments").select("id,instructions_generated_count").gt("instructions_generated_count", 0).limit(5000);
  const instructionsCount = Object.fromEntries((instructionRows ?? []).map((row: { id: string; instructions_generated_count: number }) => [row.id, Number(row.instructions_generated_count)]));
  let admissionRecords: unknown[] = [];
  if (canCashier(staff.roleCodes)) {
    const admin = createSupabaseAdminClient();
    const { data: recordRows } = await admin.from("admission_records").select("id,ar_number,trainee_id,enrollment_ids,print_count,reprints_approved,issued_at,last_printed_at").order("issued_at", { ascending: false }).limit(2000);
    admissionRecords = recordRows ?? [];
  }

  // Allocations drive paid_centavos, so they must cover every loaded enrollment
  // exactly. Scope them by id instead of capping with a limit: a cap would
  // silently understate what a trainee has paid. Chunked to keep each request
  // URL short.
  const paidByEnrollment = new Map<string, number>();
  const ALLOCATION_CHUNK = 100;
  const idChunks: string[][] = [];
  for (let i = 0; i < enrollmentRows.length; i += ALLOCATION_CHUNK) idChunks.push(enrollmentRows.slice(i, i + ALLOCATION_CHUNK).map((row) => row.id));
  // verified_paid_centavos counts only Verified, valid payments: the screening
  // rule for enrolling a website application.
  const verifiedPaidByEnrollment = new Map<string, number>();
  type AllocationPayment = { verification_state: string; valid: boolean };
  const allocationChunks = await Promise.all(idChunks.map((ids) => db.from("payment_allocations").select("enrollment_id,amount_centavos,payments(verification_state,valid)").in("enrollment_id", ids)));
  for (const chunk of allocationChunks) {
    for (const allocation of chunk.data ?? []) {
      paidByEnrollment.set(allocation.enrollment_id, (paidByEnrollment.get(allocation.enrollment_id) ?? 0) + Number(allocation.amount_centavos));
      const payment = first(allocation.payments as AllocationPayment | AllocationPayment[] | null);
      if (payment?.verification_state === "Verified" && payment.valid) verifiedPaidByEnrollment.set(allocation.enrollment_id, (verifiedPaidByEnrollment.get(allocation.enrollment_id) ?? 0) + Number(allocation.amount_centavos));
    }
  }

  // Latest requirement check per (enrollment, requirement). A missing table
  // (migration 202610070001 not yet applied) just yields no checks.
  const requirementChecks: { enrollment_id: string; requirement: string; status: string; remarks: string | null; checked_at: string; checked_by_name: string | null }[] = [];
  const checkChunks = await Promise.all(idChunks.map((ids) => db.from("enrollment_requirement_checks").select("enrollment_id,requirement,status,remarks,checked_at,profiles(complete_name)").in("enrollment_id", ids).order("checked_at", { ascending: false })));
  const seenChecks = new Set<string>();
  for (const chunk of checkChunks) {
    for (const check of chunk.data ?? []) {
      const key = `${check.enrollment_id}|${check.requirement}`;
      if (seenChecks.has(key)) continue;
      seenChecks.add(key);
      requirementChecks.push({ enrollment_id: check.enrollment_id, requirement: check.requirement, status: check.status, remarks: check.remarks, checked_at: check.checked_at, checked_by_name: first(check.profiles as { complete_name: string } | { complete_name: string }[] | null)?.complete_name ?? null });
    }
  }

  const chargesByEnrollment = new Map<string, number>();
  const discountsByEnrollment = new Map<string, number>();
  for (const row of enrollmentCharges.data ?? []) {
    const target = row.event_type === "discount" ? discountsByEnrollment : chargesByEnrollment;
    target.set(row.enrollment_id, (target.get(row.enrollment_id) ?? 0) + Number(row.amount_centavos));
  }

  // Cashier start-of-day openings (migration 202610070015; empty without it).
  let cashierOpenings: unknown[] = [];
  if (canCashier(staff.roleCodes)) {
    const { data: openingRows } = await createSupabaseAdminClient().from("cashier_openings").select("id,opening_date,opening_cash_centavos,remarks,created_at").eq("cashier_id", staff.user.id).order("opening_date", { ascending: false }).limit(31);
    cashierOpenings = openingRows ?? [];
  }
  // When each enrollment became Enrolled (migration 202610070014; empty without it).
  const { data: enrolledRows } = await db.from("enrollments").select("id,enrolled_at").not("enrolled_at", "is", null).order("enrolled_at", { ascending: false }).limit(5000);
  const enrolledAt = new Map(((enrolledRows ?? []) as { id: string; enrolled_at: string }[]).map((r) => [r.id, r.enrolled_at]));

  const extrasByEnrollment = new Map(enrollmentExtras.map((row) => [row.id, row]));
  const enrollments = (enrollmentsResult.data ?? []).map((row) => {
    const extra = extrasByEnrollment.get(row.id);
    return { ...row,
      scheduled_on: extra?.scheduled_on ?? null,
      instructions_sent_at: extra?.instructions_sent_at ?? null,
      enrolled_at: enrolledAt.get(row.id) ?? null,
      paid_centavos: paidByEnrollment.get(row.id) ?? 0,
      verified_paid_centavos: verifiedPaidByEnrollment.get(row.id) ?? 0,
      charges_centavos: chargesByEnrollment.get(row.id) ?? 0,
      discounts_centavos: discountsByEnrollment.get(row.id) ?? 0,
      feedback_token: extra?.feedback_token ?? null,
      feedback_submitted: feedbackByEnrollment.has(row.id) };
  });

  const paymentMethodsWithKind = (paymentMethods.data ?? []).map((m) => ({ ...m, kind: kindByMethod.get((m as { id: string }).id) ?? "receivable" }));

  const expenseExtraById = new Map(expenseExtras.rows.map((row) => [row.id, row]));
  const expensesMerged = ((expenses.data ?? []) as Record<string, unknown>[]).map((e) => {
    const id = (e as { id: string }).id;
    const merged = { ...e, ...(expenseExtraById.get(id) ?? {}) } as Record<string, unknown> & { requested_by?: string };
    const m = merged as typeof merged & { approved_by?: string; released_by?: string };
    return { ...merged, requested_by_name: expenseExtras.names.get(merged.requested_by ?? "") ?? null, approved_by_name: expenseExtras.names.get(m.approved_by ?? "") ?? null, released_by_name: expenseExtras.names.get(m.released_by ?? "") ?? null };
  });

  // Receipt prints per payment (202610080026); {} before it.
  const receiptPrints: Record<string, number> = {};
  { const { data: rp } = await db.from("receipts").select("payment_id,print_count").gt("print_count", 0).order("issued_at", { ascending: false }).limit(2000); for (const r of (rp ?? []) as { payment_id: string; print_count: number }[]) receiptPrints[r.payment_id] = r.print_count; }

  // Referral agency per enrollment (202610080023); {} before it.
  const referralByEnrollment: Record<string, string> = {};
  { const { data: refs } = await db.from("enrollments").select("id,referral_agency_id").not("referral_agency_id", "is", null).order("created_at", { ascending: false }).limit(1000); for (const r of (refs ?? []) as { id: string; referral_agency_id: string }[]) referralByEnrollment[r.id] = r.referral_agency_id; }

  // Voucher reprint requests (202610080020), newest first; [] before it.
  let expenseReprints: { id: string; expense_id: string; reason: string; status: string; requested_by_name: string | null; requested_at: string; decision_remarks: string | null }[] = [];
  if (staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) {
    const { data: rr } = await db.from("expense_reprint_requests").select("id,expense_id,reason,status,requested_by,requested_at,decision_remarks").order("requested_at", { ascending: false }).limit(100);
    if (rr?.length) {
      const ids = [...new Set(rr.map((r) => r.requested_by).filter(Boolean))] as string[];
      const { data: people } = ids.length ? await db.from("profiles").select("id,complete_name").in("id", ids) : { data: [] };
      const names = new Map((people ?? []).map((p) => [p.id as string, p.complete_name as string]));
      expenseReprints = rr.map((r) => ({ id: r.id, expense_id: r.expense_id, reason: r.reason, status: r.status, requested_by_name: names.get(r.requested_by ?? "") ?? null, requested_at: r.requested_at, decision_remarks: r.decision_remarks }));
    }
  }

  return NextResponse.json({ profile: profile.data ?? { complete_name: staff.user.email?.split("@")[0] ?? "Staff", email: staff.user.email }, roles: staff.roleCodes, myHr,
    courses: courses.data ?? [], offers: offers.data ?? [], trainees: trainees.data ?? [], batches: batches.data ?? [], enrollments,
    payments: payments.data ?? [], notifications: notifications.data ?? [],
    paymentMethods: paymentMethodsWithKind, charges: (charges.data ?? []).map((c) => ({ ...c, kind: chargeKinds.get((c as { id: string }).id) ?? "fee" })), agencies: agencies.data ?? [],
    expenses: expensesMerged, payables: payables.data ?? [], cashierClosings: cashierClosings.data ?? [], enrollmentCharges: enrollmentCharges.data ?? [],
    employees: hr.employees, employeeAttendance: hr.employeeAttendance, leaveRequests: hr.leaveRequests, cashAdvances: hr.cashAdvances, payrollPeriods: hr.payrollPeriods, payrollItems: hr.payrollItems, benefitRecords: hr.benefitRecords, employmentContracts: hr.employmentContracts,
    classrooms: classrooms.data ?? [], certificates: certs.certificates, certificateTemplates: certs.templates, certificateReleases: certs.releases, certificateIssuanceEnabled: certs.issuanceEnabled, certificateSeries: certs.series, evaluationForms: certs.evaluationForms, feedbackAt: certs.feedbackAt, courseCategories: courseCategories.data ?? [], partnerCenters: partnerCenters.data ?? [],
    agencyCourseRebates: agencyCourseRebates.data ?? [], agencyRebates: agencyRebates.data ?? [], expenseCategories: expenseCategories.data ?? [], inventoryItems: inventoryItems.data ?? [], inventoryMovements: inventoryMovements.data ?? [], pendingDiscounts: pendingDiscounts.data ?? [], announcements: announcements.data ?? [], requests, pendingCharges, employeeCharges: employeeChargeData.charges, chargeEmployees: employeeChargeData.employees, instructionTemplates, batchStaffing, requirementChecks, awaitingCourseIds, applicationNumbers, handedToCashier, instructionsCount, admissionRecords, chargeCollected, instructionEmails, classroomCodes, classroom, classroomCourseIds, classroomInvites, cashierOpenings, expenseReprints, referralByEnrollment, receiptPrints }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const input = actionInput.parse(await request.json());
    const db = await createSupabaseServerClient();
    if (input.action === "mark-notifications-read") {
      const { error } = await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", staff.user.id).is("read_at", null);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "config-remove") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Only the Accounting Manager can change the configuration." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const result = input.entity === "rebate"
        ? (input.agencyId && input.courseId ? await admin.from("agency_course_rebates").delete().eq("agency_id", input.agencyId).eq("course_id", input.courseId) : { error: { message: "Choose the partner and course.", code: "" } })
        : input.id ? await admin.from(input.entity === "charge" ? "charge_catalog" : input.entity === "channel" ? "payment_methods" : "marketing_agencies").delete().eq("id", input.id) : { error: { message: "Nothing to remove.", code: "" } };
      if (result.error) {
        const used = (result.error as { code?: string }).code === "23503" || /foreign key|violates/i.test(result.error.message);
        return NextResponse.json({ error: used ? "This is already used in records, so it cannot be removed. Archive it instead." : result.error.message }, { status: 400 });
      }
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "accounting", action: `configuration.${input.entity}_removed`, record_type: input.entity, record_id: input.id ?? `${input.agencyId}:${input.courseId}`, new_values: {} });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "channel-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage payment channels." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, code: (input.code || input.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40), requires_reference: input.requiresReference, allows_proof: input.allowsProof, ...(input.kind ? { kind: input.kind } : {}), ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("payment_methods").update(row).eq("id", input.id) : await admin.from("payment_methods").insert(row);
      if (error && /duplicate|unique/i.test(error.message)) return NextResponse.json({ error: "A channel with this name already exists. The same channels are used for training payments and expenses." }, { status: 400 });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "charge-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, default_amount_centavos: input.defaultAmountCentavos, ...(input.active !== undefined ? { active: input.active } : {}), ...(input.kind ? { kind: input.kind } : {}) };
      const { error } = input.id ? await admin.from("charge_catalog").update(row).eq("id", input.id) : await admin.from("charge_catalog").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "expense-category-save") {
      if (!staff.roleCodes.includes("accounting")) return NextResponse.json({ error: "Only the Accounting Manager can add, edit or remove expense categories." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      if (input.remove && input.id) { const { error } = await admin.from("expense_categories").delete().eq("id", input.id); if (error) throw error; return NextResponse.json({ ok: true }); }
      const row = { name: input.name, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("expense_categories").update(row).eq("id", input.id) : await admin.from("expense_categories").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "inventory-item-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage inventory." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      if (input.remove && input.id) { const { error } = await admin.from("inventory_items").delete().eq("id", input.id); if (error) throw error; return NextResponse.json({ ok: true }); }
      const row = { name: input.name, category: input.category ?? null, unit: input.unit, unit_value_centavos: input.unitValueCentavos, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("inventory_items").update(row).eq("id", input.id) : await admin.from("inventory_items").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "inventory-move") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage inventory." }, { status: 403 });
      const { data, error } = await db.rpc("record_inventory_movement", { target_item: input.itemId, target_type: input.movementType, target_quantity: input.quantity, target_remarks: input.remarks ?? null });
      if (error) throw error;
      return NextResponse.json({ ok: true, item: data });
    }
    if (input.action === "agency-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage agencies." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, contact_name: input.contactName || null, email: input.email || null, mobile: input.mobile || null, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { data: saved, error } = input.id ? await admin.from("marketing_agencies").update(row).eq("id", input.id).select("id").single() : await admin.from("marketing_agencies").insert(row).select("id").single();
      if (error) throw error;
      // Agency or consultancy (202610080021); ignored before it.
      if (input.kind) await admin.from("marketing_agencies").update({ kind: input.kind }).eq("id", saved.id);
      // Deducted or No deduction (202610080024); ignored before it.
      if (input.rebateMode) await admin.from("marketing_agencies").update({ rebate_mode: input.rebateMode }).eq("id", saved.id);
      // Rebate as % of the training fee (202610080025); null clears it. Ignored before it.
      if (input.rebatePercent !== undefined) await admin.from("marketing_agencies").update({ rebate_percent: input.rebatePercent }).eq("id", saved.id);
      // A new agency gets its referral code automatically (202610080023).
      if (!input.id) await assignReferralCode(admin, saved.id, input.name);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "agency-code-regenerate") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage agencies." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: agency } = await admin.from("marketing_agencies").select("id,name").eq("id", input.id).maybeSingle();
      if (!agency) return NextResponse.json({ error: "Agency not found." }, { status: 404 });
      const code = await assignReferralCode(admin, agency.id, agency.name);
      if (!code) return NextResponse.json({ error: "Apply database update 202610080023 first." }, { status: 400 });
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "accounting", action: "agency.referral_code_changed", record_type: "marketing_agency", record_id: agency.id, new_values: { changed: true } });
      return NextResponse.json({ ok: true, code });
    }
    if (input.action === "payable-mark-paid") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage payables." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: row, error } = await admin.from("payables").update({ status: "Paid", paid_at: new Date().toISOString() }).eq("id", input.id).neq("status", "Paid").select("id,description,amount_centavos").maybeSingle();
      if (error) throw error;
      if (!row) return NextResponse.json({ error: "This payable is already paid." }, { status: 400 });
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "accounting", action: "payable.paid", record_type: "payable", record_id: row.id, new_values: { status: "Paid", amount_centavos: row.amount_centavos } });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "payable-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage payables." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      if (input.remove && input.id) {
        const { error } = await admin.from("payables").delete().eq("id", input.id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      if (!input.amountCentavos) return NextResponse.json({ error: "Amount is required." }, { status: 400 });
      const row = { description: input.description, amount_centavos: input.amountCentavos, due_on: input.dueOn || null };
      const { error } = input.id ? await admin.from("payables").update(row).eq("id", input.id) : await admin.from("payables").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "expense-create") {
      if (!staff.roleCodes.some((role) => ["admin", "accounting", "cashier"].includes(role))) return NextResponse.json({ error: "Your account cannot raise expense vouchers." }, { status: 403 });
      if (input.lines.length && input.lines.reduce((sum, line) => sum + line.quantity * line.unitCentavos, 0) !== input.amountCentavos) return NextResponse.json({ error: "The lines do not add up to the total amount." }, { status: 400 });
      const admin = createSupabaseAdminClient();
      // A request number now; the voucher number (CV) is issued when the Accounting Manager approves.
      const { data: expenseNumber, error: numberError } = await admin.rpc("next_reference", { prefix: "ER", requested_year: Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric" }).format(new Date())) });
      if (numberError || !expenseNumber) throw numberError ?? new Error("Could not number the expense request.");
      const { data: created, error } = await admin.from("expenses").insert({ expense_number: expenseNumber, payee: input.payee, category: input.category, amount_centavos: input.amountCentavos, purpose: input.purpose, status: "Pending", requested_by: staff.user.id }).select("id").single();
      if (error) throw error;
      // Deploy-safe: payment_channel/reference_number arrive with migration 202608100001.
      // Set them separately and ignore a pre-migration "column does not exist" error.
      if (input.paymentChannel || input.referenceNumber) {
        await admin.from("expenses").update({ payment_channel: input.paymentChannel || null, reference_number: input.referenceNumber || null }).eq("id", created.id);
      }
      await admin.from("expenses").update({ request_number: expenseNumber }).eq("id", created.id); // 202610070018; ignored before it
      if (input.lines.length || input.supportingDocument) await admin.from("expenses").update({ line_items: input.lines, supporting_document: input.supportingDocument || null }).eq("id", created.id); // 202610080019; ignored before it
      return NextResponse.json({ ok: true, number: expenseNumber });
    }
    if (input.action === "expense-decide") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot decide expenses." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      if (input.decision === "Paid") return NextResponse.json({ error: "The Cashier releases approved vouchers and marks them paid." }, { status: 400 });
      if (input.decision === "Approved") {
        const { data: voucherNumber, error } = await admin.rpc("approve_expense", { target: input.id, actor: staff.user.id, remarks: input.remarks ?? null });
        if (error) return NextResponse.json({ error: /approve_expense/i.test(error.message) ? "Apply database update 202610070018 first." : error.message }, { status: 400 });
        const drive = await fileVoucherInDrive(admin, input.id);
        return NextResponse.json({ ok: true, voucherNumber, drive });
      }
      const { error } = await admin.rpc("reject_expense", { target: input.id, actor: staff.user.id, remarks: input.remarks ?? null });
      if (error) return NextResponse.json({ error: /reject_expense/i.test(error.message) ? "Apply database update 202610070018 first." : error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "expense-reprint-request") {
      if (!staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Your account cannot request voucher reprints." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: row, error: rowError } = await admin.from("expenses").select("id,status,print_count,reprints_approved").eq("id", input.id).maybeSingle();
      if (rowError) return NextResponse.json({ error: /print_count|reprints_approved/i.test(rowError.message) ? "Apply database update 202610080020 first." : rowError.message }, { status: 400 });
      if (!row) return NextResponse.json({ error: "Voucher not found." }, { status: 404 });
      const r = row as { status: string; print_count: number; reprints_approved: number };
      if (r.status !== "Approved" && r.status !== "Paid") return NextResponse.json({ error: "Only an approved voucher can be reprinted." }, { status: 400 });
      if (r.print_count < 1 + r.reprints_approved) return NextResponse.json({ error: "This voucher can still be printed. No request is needed." }, { status: 400 });
      const { data: created, error } = await admin.from("expense_reprint_requests").insert({ expense_id: input.id, reason: input.reason, requested_by: staff.user.id }).select("id").single();
      if (error) return NextResponse.json({ error: /duplicate|expense_reprint_one_pending/i.test(error.message) ? "A reprint request for this voucher is already waiting for the Accounting Manager." : error.message }, { status: 400 });
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes.includes("cashier") ? "cashier" : staff.roleCodes[0] ?? null, action: "expense_voucher.reprint_requested", record_type: "expense", record_id: input.id, new_values: { request_id: created.id }, reason: input.reason });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "expense-reprint-decide") {
      if (!staff.roleCodes.includes("accounting")) return NextResponse.json({ error: "Only the Accounting Manager can approve voucher reprints." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: req } = await admin.from("expense_reprint_requests").select("id,expense_id,status").eq("id", input.requestId).maybeSingle();
      if (!req) return NextResponse.json({ error: "Request not found." }, { status: 404 });
      if (req.status !== "Pending") return NextResponse.json({ error: "This request was already decided." }, { status: 400 });
      const now = new Date().toISOString();
      const { data: decided, error } = await admin.from("expense_reprint_requests").update({ status: input.decision, decided_by: staff.user.id, decided_at: now, decision_remarks: input.remarks || null }).eq("id", input.requestId).eq("status", "Pending").select("id");
      if (error) throw error;
      if (!decided?.length) return NextResponse.json({ error: "This request was already decided." }, { status: 400 });
      if (input.decision === "Approved") {
        const { data: ex } = await admin.from("expenses").select("reprints_approved").eq("id", req.expense_id).single();
        await admin.from("expenses").update({ reprints_approved: Number((ex as { reprints_approved: number }).reprints_approved) + 1 }).eq("id", req.expense_id);
      }
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "accounting", action: input.decision === "Approved" ? "expense_voucher.reprint_approved" : "expense_voucher.reprint_rejected", record_type: "expense", record_id: req.expense_id, new_values: { request_id: req.id }, reason: input.remarks || null });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "expense-release") {
      if (!staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Your account cannot release vouchers." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: row } = await admin.from("expenses").select("id,status").eq("id", input.id).maybeSingle();
      if (!row) return NextResponse.json({ error: "Expense not found." }, { status: 404 });
      if (row.status !== "Approved") return NextResponse.json({ error: row.status === "Paid" ? "This voucher is already released." : "Only an approved voucher can be released." }, { status: 400 });
      const { data: channel } = await admin.from("payment_methods").select("name,requires_reference").eq("name", input.paymentChannel).maybeSingle();
      if (channel?.requires_reference && !input.referenceNumber.trim()) return NextResponse.json({ error: `Enter the ${channel.name} reference number.` }, { status: 400 });
      const now = new Date().toISOString();
      const { error } = await admin.from("expenses").update({ status: "Paid", paid_at: now }).eq("id", input.id).eq("status", "Approved");
      if (error) throw error;
      await admin.from("expenses").update({ payment_channel: input.paymentChannel, reference_number: input.referenceNumber || null, released_by: staff.user.id, released_at: now }).eq("id", input.id);
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "cashier", action: "expense.released", record_type: "expense", record_id: input.id, new_values: { channel: input.paymentChannel, reference: input.referenceNumber || null } });
      const drive = await fileVoucherInDrive(admin, input.id);
      return NextResponse.json({ ok: true, drive });
    }
    if (input.action === "cashier-open") {
      if (!canCashier(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot record a cashier opening." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
      const { error } = await admin.from("cashier_openings").insert({ cashier_id: staff.user.id, opening_date: today, opening_cash_centavos: input.openingCashCentavos, remarks: input.remarks ?? null });
      if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? "Today's opening is already recorded." : /cashier_openings/i.test(error.message) ? "Apply database update 202610070015 first." : error.message }, { status: 400 });
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "cashier", action: "cashier.opened", record_type: "cashier_opening", record_id: today, new_values: { opening_cash_centavos: input.openingCashCentavos } });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "balance-summary-send") {
      if (!canCashier(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot send the balance summary." }, { status: 403 });
      const result = await sendBalanceSummary(createSupabaseAdminClient(), { origin: new URL(request.url).origin, manual: true });
      if (!result.configured) return NextResponse.json({ error: "Email is not set up yet (RESEND_API_KEY and EMAIL_FROM)." }, { status: 400 });
      return NextResponse.json({ ok: true, ...result });
    }
    if (input.action === "cashier-closing-review") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Only the Accounting Manager can review closings." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const now = new Date().toISOString();
      const { data: done, error } = await admin.from("cashier_closings").update({ status: "Reviewed", reviewed_by: staff.user.id, reviewed_at: now }).eq("id", input.id).eq("status", "Submitted").select("id");
      if (error) throw error;
      if (!done?.length) return NextResponse.json({ error: "This closing was already reviewed or is not submitted yet." }, { status: 400 });
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "accounting", action: "cashier_closing.reviewed", record_type: "cashier_closing", record_id: input.id, new_values: { reviewed_at: now }, reason: input.remarks || null });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "cashier-close") {
      if (!staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Your account cannot submit a cashier closing." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const start = `${input.closingDate}T00:00:00+08:00`;
      const end = `${input.closingDate}T23:59:59.999+08:00`;
      const { data: dayPayments } = await admin.from("payments").select("amount_centavos,method").eq("valid", true).gte("received_at", start).lte("received_at", end);
      const cash = (dayPayments ?? []).filter((p) => p.method === "Cash").reduce((s, p) => s + Number(p.amount_centavos), 0);
      const online = (dayPayments ?? []).filter((p) => p.method !== "Cash").reduce((s, p) => s + Number(p.amount_centavos), 0);
      const { data: dayExpenses } = await admin.from("expenses").select("amount_centavos").eq("status", "Paid").gte("paid_at", start).lte("paid_at", end);
      const expensesTotal = (dayExpenses ?? []).reduce((s, e) => s + Number(e.amount_centavos), 0);
      const refunds = 0;
      const expected = input.openingCashCentavos + cash - expensesTotal - refunds;
      const variance = input.actualCashCentavos - expected;
      const { error } = await admin.from("cashier_closings").insert({ cashier_id: staff.user.id, closing_date: input.closingDate, opening_cash_centavos: input.openingCashCentavos, cash_collections_centavos: cash, online_collections_centavos: online, refunds_centavos: refunds, expenses_centavos: expensesTotal, expected_cash_centavos: expected, actual_cash_centavos: input.actualCashCentavos, variance_centavos: variance, status: "Submitted", submitted_at: new Date().toISOString(), remarks: input.remarks || null });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "enrollment-charge") {
      const isDiscount = input.kind === "discount";
      // Charges may be added by any cashier/accounting/admin; discounts (rebates)
      // are sensitive and restricted to Accounting/Admin.
      const allowed = isDiscount ? canManageAccounting(staff.roleCodes) : staff.roleCodes.some((role) => ["admin", "cashier", "accounting", "registration"].includes(role));
      if (!allowed) return NextResponse.json({ error: isDiscount ? "Only Accounting or Admin can post a rebate." : "Your account cannot post charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      // Charges raised by cashier/registration wait for the Accounting Manager's approval
      // (Pending + invalid, so they do not hit the trainee balance yet). Accounting/Admin post immediately.
      const pendingCharge = !isDiscount && !canManageAccounting(staff.roleCodes);
      const { error } = await admin.from("enrollment_charges").insert({ enrollment_id: input.enrollmentId, charge_catalog_id: input.chargeCatalogId ?? null, description: input.description, amount_centavos: input.amountCentavos, event_type: isDiscount ? "discount" : "charge", ...(isDiscount ? {} : { valid: !pendingCharge, approval_status: pendingCharge ? "Pending" : "Approved" }), created_by: staff.user.id });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "enrollment-charge-void") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Only Accounting or Admin can void a charge or rebate." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("enrollment_charges").update({ valid: false }).eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "discount-request") {
      if (!staff.roleCodes.some((r) => ["admin", "accounting", "cashier"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
      const { data, error } = await db.rpc("request_enrollment_discount", { target_enrollment: input.enrollmentId, target_amount: input.amountCentavos, target_description: input.description ?? "Discount", target_agency: input.agencyId ?? null });
      if (error) throw error;
      return NextResponse.json({ ok: true, charge: data });
    }
    if (input.action === "discount-decide") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Only Accounting or Admin can decide discounts." }, { status: 403 });
      const { data, error } = await db.rpc("decide_enrollment_discount", { target_charge: input.id, target_approve: input.approve });
      if (error) throw error;
      return NextResponse.json({ ok: true, charge: data });
    }
    if (input.action === "charge-decide") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Only Accounting or Admin can decide charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("enrollment_charges").update({ valid: input.approve, approval_status: input.approve ? "Approved" : "Rejected", decided_by: staff.user.id, decided_at: new Date().toISOString() }).eq("id", input.id).eq("event_type", "charge").eq("approval_status", "Pending");
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "request-raise") {
      if (!staff.roleCodes.some((r) => ["admin", "cashier", "accounting", "registration"].includes(r))) return NextResponse.json({ error: "Your account cannot raise requests." }, { status: 403 });
      if (input.requestType === "Rescheduling" && !input.batchId) return NextResponse.json({ error: "Choose the new schedule for the reschedule request." }, { status: 400 });
      if (input.requestType === "Refund" && !input.amountCentavos) return NextResponse.json({ error: "Enter the refund amount." }, { status: 400 });
      if (input.requestType === "Change Course" && !input.courseId) return NextResponse.json({ error: "Choose the course to change to." }, { status: 400 });
      if (input.requestedOn && input.requestedOn > manilaDate()) return NextResponse.json({ error: "The request date cannot be in the future." }, { status: 400 });
      if (input.requestType === "TAR reprint" && !canCashier(staff.roleCodes)) return NextResponse.json({ error: "Only the Cashier can request a TAR reprint." }, { status: 403 });
      if (input.requestType === "TAR reprint") {
        const pendingReprint = await createSupabaseAdminClient().from("enrollment_requests").select("id").eq("enrollment_id", input.enrollmentId).eq("request_type", "TAR reprint").eq("status", "Pending").limit(1);
        if (pendingReprint.data?.length) return NextResponse.json({ error: "A TAR reprint request is already waiting for approval." }, { status: 400 });
      }
      const admin = createSupabaseAdminClient();
      const { data: enrollment, error: findError } = await admin.from("enrollments").select("id,trainee_id").eq("id", input.enrollmentId).maybeSingle();
      if (findError || !enrollment) throw findError ?? new Error("Enrollment not found.");
      const requested: Record<string, unknown> = {};
      if (input.batchId) requested.batchId = input.batchId;
      if (input.amountCentavos) requested.amountCentavos = input.amountCentavos;
      if (input.paymentId) requested.paymentId = input.paymentId;
      if (input.courseId) requested.courseId = input.courseId;
      if (input.partnerOfferId) requested.partnerOfferId = input.partnerOfferId;
      const { data: reference, error: refError } = await db.rpc("next_reference", { prefix: "REQ" });
      if (refError) throw refError;
      // Requests go to the Cashier for charges first, then to Accounting; a request
      // raised by Accounting/Admin goes straight to approval. Without migration
      // 202610070004 (no stage column) it falls back to the old direct routing.
      const row = { request_number: reference, trainee_id: enrollment.trainee_id, enrollment_id: input.enrollmentId, request_type: input.requestType, requested_values: requested, reason: input.reason, requester_id: staff.user.id, status: "Pending" };
      let inserted = await admin.from("enrollment_requests").insert({ ...row, stage: canManageAccounting(staff.roleCodes) ? "For approval" : "With cashier" }).select("id").single();
      if (inserted.error && /stage/i.test(inserted.error.message)) inserted = await admin.from("enrollment_requests").insert(row).select("id").single();
      const { data: created, error: insertError } = inserted;
      if (insertError || !created) throw insertError ?? new Error("Could not raise the request.");
      await admin.from("request_events").insert({ request_id: created.id, actor_id: staff.user.id, event_type: "raised", new_values: requested, remarks: input.reason });
      // The date the trainee asked (202610080022); ignored before it.
      await admin.from("enrollment_requests").update({ requested_on: input.requestedOn ?? manilaDate() }).eq("id", created.id);
      // Rescheduling and cancellation: the policy fee is attached now, so the request goes straight to the Cashier to collect it.
      if ((RULED_REQUESTS as readonly string[]).includes(input.requestType)) {
        const charged = await chargeRequest(admin, { id: created.id, enrollment_id: input.enrollmentId, request_type: input.requestType, requested_values: requested }, staff.user.id, { amountCentavos: 0 });
        return NextResponse.json({ ok: true, feeCentavos: charged.amountCentavos, feeRule: charged.feeRule });
      }
      return NextResponse.json({ ok: true });
    }
    if (input.action === "request-decide") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Only Accounting or Admin can decide requests." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      let found = await admin.from("enrollment_requests").select("id,enrollment_id,request_type,requested_values,status,stage,charge_id").eq("id", input.id).maybeSingle();
      if (found.error && /stage|charge_id/i.test(found.error.message)) found = await admin.from("enrollment_requests").select("id,enrollment_id,request_type,requested_values,status").eq("id", input.id).maybeSingle() as typeof found;
      const req = found.data as { id: string; enrollment_id: string; request_type: string; requested_values: unknown; status: string; stage?: string; charge_id?: string | null } | null;
      if (found.error || !req) throw found.error ?? new Error("Request not found.");
      if (req.status !== "Pending") return NextResponse.json({ error: "This request has already been decided." }, { status: 400 });
      if (req.stage === "With cashier") return NextResponse.json({ error: "Waiting for the Cashier to add charges." }, { status: 400 });
      if (input.approve && req.charge_id && PAY_FIRST_REQUESTS.includes(req.request_type)) {
        const due = await chargeCollection(admin, req.enrollment_id, req.charge_id);
        if (!due.paid) return NextResponse.json({ error: `The ${req.request_type === "Rescheduling" ? "reschedule" : "change of course"} fee is not paid yet (₱${(due.collected / 100).toFixed(2)} of ₱${(due.amount / 100).toFixed(2)} collected). Approve it once the trainee pays the Cashier.` }, { status: 400 });
      }
      if (input.approve) {
        try { await applyApprovedRequest(admin, req, staff.user.id, input.remarks ?? null); }
        catch (e) { if (e instanceof RequestNotApplicable) return NextResponse.json({ error: e.message }, { status: 400 }); throw e; }
      }
      if (req.charge_id) {
        const { error: chargeError } = await admin.from("enrollment_charges").update({ valid: input.approve, approval_status: input.approve ? "Approved" : "Rejected", decided_by: staff.user.id, decided_at: new Date().toISOString() }).eq("id", req.charge_id).eq("approval_status", "Pending");
        if (chargeError) throw chargeError;
      }
      const { error: updateError } = await admin.from("enrollment_requests").update({ status: input.approve ? "Approved" : "Rejected", decided_at: new Date().toISOString(), decision_remarks: input.remarks ?? null, assigned_approver_id: staff.user.id }).eq("id", req.id);
      if (updateError) throw updateError;
      await admin.from("request_events").insert({ request_id: req.id, actor_id: staff.user.id, event_type: input.approve ? "approved" : "rejected", remarks: input.remarks ?? null });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "instruction-template-save") {
      if (!staff.roleCodes.some((r) => ["admin", "registration", "training_operations"].includes(r))) return NextResponse.json({ error: "Your account cannot edit instruction templates." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: course } = await admin.from("courses").select("id,delivery_type").eq("id", input.courseId).maybeSingle();
      if (!course) throw new Error("Course not found.");
      if (course.delivery_type !== "In-House") return NextResponse.json({ error: "Instruction templates are for New Wave in-house courses only." }, { status: 400 });
      const { data: maxRow } = await admin.from("training_instruction_templates").select("version").eq("course_id", input.courseId).order("version", { ascending: false }).limit(1).maybeSingle();
      const nextVersion = Number(maxRow?.version ?? 0) + 1;
      await admin.from("training_instruction_templates").update({ active: false }).eq("course_id", input.courseId);
      const { error } = await admin.from("training_instruction_templates").insert({ course_id: input.courseId, version: nextVersion, subject: input.subject, body: { text: input.body }, active: true, approved_by: staff.user.id, approved_at: new Date().toISOString() });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "classroom-classes" || input.action === "classroom-course-link" || input.action === "classroom-disconnect") {
      if (!staff.roleCodes.some((r) => ["admin", "registration"].includes(r))) return NextResponse.json({ error: "Your account cannot manage Google Classroom." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      if (input.action === "classroom-disconnect") {
        await revokeConnection(admin);
        await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "registration", action: "google_classroom.disconnected", record_type: "google_connection", record_id: "classroom", new_values: {} });
        return NextResponse.json({ ok: true });
      }
      if (input.action === "classroom-classes") return NextResponse.json({ ok: true, classes: await listClasses(admin) });
      // Link a New Wave course to one of the connected account's classes; the
      // class link and code are copied so the email's join button matches.
      if (!input.classroomCourseId) {
        const { error } = await admin.from("courses").update({ google_classroom_course_id: null }).eq("id", input.courseId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      const chosen = (await listClasses(admin)).find((c) => c.id === input.classroomCourseId);
      if (!chosen) return NextResponse.json({ error: "That class was not found in the connected Google Classroom account." }, { status: 400 });
      const { error } = await admin.from("courses").update({ google_classroom_course_id: chosen.id, google_classroom_link: chosen.alternateLink ?? null, google_classroom_code: chosen.enrollmentCode ?? null }).eq("id", input.courseId);
      if (error) return NextResponse.json({ error: /google_classroom_(course_id|code)/i.test(error.message) ? "Apply database updates 202610070012 and 202610070013 first." : error.message }, { status: 400 });
      return NextResponse.json({ ok: true, class: chosen });
    }
    if (input.action === "course-classroom-link-save") {
      if (!staff.roleCodes.some((r) => ["admin", "registration", "training_operations"].includes(r))) return NextResponse.json({ error: "Your account cannot set the Google Classroom link." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("courses").update({ google_classroom_link: input.link || null }).eq("id", input.courseId);
      // The class code (migration 202610070012) is saved separately so a missing column never blocks the link.
      if (!error && input.code !== undefined) {
        const { error: codeError } = await admin.from("courses").update({ google_classroom_code: input.code || null }).eq("id", input.courseId);
        if (codeError) return NextResponse.json({ error: /google_classroom_code/i.test(codeError.message) ? "Link saved. Apply database update 202610070012 to save the class code." : codeError.message }, { status: 400 });
      }
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "requirement-check") {
      if (!canRegister(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot screen applications." }, { status: 403 });
      if (input.status === "Rejected" && !input.remarks) return NextResponse.json({ error: "Enter the reason for rejecting this requirement." }, { status: 400 });
      if (input.requirement === "other" && input.status === "Verified" && !input.remarks) return NextResponse.json({ error: "Describe the other requirement (for example: COP for BT-PSSR)." }, { status: 400 });
      const admin = createSupabaseAdminClient();
      const { data: enrollment, error: findError } = await admin.from("enrollments").select("id,enrollment_status").eq("id", input.enrollmentId).maybeSingle();
      if (findError) throw findError;
      if (!enrollment) return NextResponse.json({ error: "Application not found." }, { status: 404 });
      if (enrollment.enrollment_status !== "Pending") return NextResponse.json({ error: "Only a Pending application can be screened." }, { status: 400 });
      const row = { enrollment_id: input.enrollmentId, requirement: input.requirement, status: input.status, remarks: input.remarks || null, checked_by: staff.user.id };
      const { data: check, error } = await admin.from("enrollment_requirement_checks").insert(row).select("id,checked_at").single();
      if (error) throw error;
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "registration", action: "application.requirement_checked", record_type: "enrollment", record_id: input.enrollmentId, new_values: { ...row, id: check.id, checked_at: check.checked_at } });
      const enrolled = input.status === "Verified" ? await tryAutoEnroll(admin, [input.enrollmentId], staff.user.id) : [];
      return NextResponse.json({ ok: true, enrolled });
    }
    if (input.action === "admission-record-issue") {
      // The Cashier prints the TAR (it is the acknowledgement receipt); Registration does not.
      if (!staff.roleCodes.some((r) => ["admin", "cashier"].includes(r))) return NextResponse.json({ error: "Only the Cashier prints the Training Admission Record." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      // The record covers the trainee's paid enrollments (Enrolled / Open
      // Schedule); printing the same set again keeps the same AR number, up to the
      // print limit (migrations 202610070006 and 202610070007).
      const { data: rows, error: findError } = await admin.from("enrollments").select("id").eq("trainee_id", input.traineeId).in("enrollment_status", ["Enrolled", "Open Schedule"]);
      if (findError) throw findError;
      const ids = (rows ?? []).map((row: { id: string }) => row.id);
      if (!ids.length) return NextResponse.json({ error: "This trainee has no paid enrollment yet. The TAR prints once a course is paid." }, { status: 400 });
      const { data, error } = await admin.rpc("issue_admission_record", { target_trainee: input.traineeId, target_enrollments: ids, actor: staff.user.id });
      if (error) return NextResponse.json({ error: /function public.issue_admission_record/i.test(error.message) ? "Apply database update 202610070006 to print admission records." : error.message }, { status: 400 });
      const record = data as { id: string; ar_number: string; print_count: number; reprints_approved?: number };
      const printsLeft = Math.max(0, TAR_FREE_PRINTS + Number(record.reprints_approved ?? 0) - Number(record.print_count));
      return NextResponse.json({ ok: true, id: record.id, arNumber: record.ar_number, printCount: record.print_count, printsLeft });
    }
    if (input.action === "trainee-update") {
      if (!canRegister(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot edit trainee details." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: prior, error: findError } = await admin.from("trainees").select("id,mobile,email,address,place_of_birth,rank,company,suffix,emergency_contact").eq("id", input.traineeId).maybeSingle();
      if (findError) throw findError;
      if (!prior) return NextResponse.json({ error: "Trainee not found." }, { status: 404 });
      const next = {
        mobile: normalizePhContactNumber(input.mobile), email: normalizeEmail(input.email), address: input.address,
        place_of_birth: input.placeOfBirth || null, rank: input.rank || null, company: input.company || null, suffix: input.suffix || null,
        emergency_contact: input.emergencyContactName ? { name: input.emergencyContactName, mobile: input.emergencyContactMobile ? normalizePhContactNumber(input.emergencyContactMobile) : null } : {},
      };
      const { error } = await admin.from("trainees").update(next).eq("id", input.traineeId);
      if (error) throw error;
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "registration", action: "trainee.updated", record_type: "trainee", record_id: input.traineeId, prior_values: prior, new_values: next });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "application-handover") {
      if (!canRegister(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot hand applications to the Cashier." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: enrollment, error: findError } = await admin.from("enrollments").select("id,enrollment_status,batch_id,handed_to_cashier_at").eq("id", input.enrollmentId).maybeSingle();
      if (findError) throw findError;
      if (!enrollment) return NextResponse.json({ error: "Application not found." }, { status: 404 });
      if (enrollment.enrollment_status !== "Pending") return NextResponse.json({ error: "Only a Pending application can be handed to the Cashier." }, { status: 400 });
      if (enrollment.handed_to_cashier_at) return NextResponse.json({ ok: true });
      const { data: checks, error: checkError } = await admin.from("enrollment_requirement_checks").select("requirement,status,checked_at").eq("enrollment_id", input.enrollmentId).order("checked_at", { ascending: false });
      if (checkError) throw checkError;
      const latest = new Map<string, string>();
      for (const c of checks ?? []) { const code = c.requirement === "medical_certificate" ? "medical_peme" : c.requirement; if (!latest.has(code)) latest.set(code, c.status); }
      if (!REQUIREMENT_CODES.every((code) => latest.get(code) === "Verified")) return NextResponse.json({ error: "Tick all four requirements (valid ID, PEME medical, 2x2 photo, seaman's book / SRN) before handing to the Cashier." }, { status: 400 });
      const at = new Date().toISOString();
      const { error } = await admin.from("enrollments").update({ handed_to_cashier_at: at, handed_to_cashier_by: staff.user.id }).eq("id", input.enrollmentId).is("handed_to_cashier_at", null);
      if (error) throw error;
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "registration", action: "application.handed_to_cashier", record_type: "enrollment", record_id: input.enrollmentId, new_values: { handed_to_cashier_at: at } });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "request-charge") {
      if (!canCashier(staff.roleCodes)) return NextResponse.json({ error: "Only the Cashier can add charges to a request." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: req, error: findError } = await admin.from("enrollment_requests").select("id,enrollment_id,request_type,requested_values,status,stage").eq("id", input.id).maybeSingle();
      if (findError) throw findError;
      if (!req) return NextResponse.json({ error: "Request not found." }, { status: 404 });
      if (req.status !== "Pending" || req.stage !== "With cashier") return NextResponse.json({ error: "This request is not waiting for charges." }, { status: 400 });
      const result = await chargeRequest(admin, req as ApprovableRequest & { requested_values?: unknown }, staff.user.id, { amountCentavos: input.amountCentavos, description: input.description, chargeCatalogId: input.chargeCatalogId ?? null, remarks: input.remarks ?? null });
      return NextResponse.json({ ok: true, applied: result.applied });
    }
    if (input.action === "application-assign") {
      if (!canRegister(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot assign courses to applications." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      // The database checks the schedule is still bookable and holds the seat.
      const { data, error } = await admin.rpc("assign_application_course", { target_trainee: input.traineeId, target_course: input.courseId, target_batch: input.batchId ?? null, actor: staff.user.id });
      if (error) return NextResponse.json({ error: /function public.assign_application_course/i.test(error.message) ? "Apply database update 202610070005 to assign a course without a batch." : error.message }, { status: 400 });
      // A non-STCW in-house course may run on a picked start date instead of a batch.
      // A referred trainee's new course carries the referral, and its rebate comes off the fee (202610080023).
      if (data) {
        const enrollmentId = (data as { id: string }).id;
        const { data: tr } = await admin.from("trainees").select("marketing_agency_id").eq("id", input.traineeId).maybeSingle();
        if (tr?.marketing_agency_id) { await admin.from("enrollments").update({ referral_agency_id: tr.marketing_agency_id }).eq("id", enrollmentId); await applyReferralRebates(admin, [enrollmentId], staff.user.id); }
      }
      if (input.scheduledOn && !input.batchId && data) {
        const { error: dateError } = await admin.from("enrollments").update({ scheduled_on: input.scheduledOn }).eq("id", (data as { id: string }).id);
        if (dateError) throw dateError;
      }
      return NextResponse.json({ ok: true, enrollment: data });
    }
    if (input.action === "application-place-batch") {
      if (!canRegister(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot place applications on a batch." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc("place_application_batch", { target_enrollment: input.enrollmentId, target_batch: input.batchId, actor: staff.user.id });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const enrolled = await tryAutoEnroll(admin, [input.enrollmentId], staff.user.id);
      return NextResponse.json({ ok: true, enrollment: data, enrolled });
    }
    if (input.action === "application-enroll") {
      if (!canRegister(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot enroll applications." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      // The database re-checks every rule (requirements verified, a verified payment).
      const { data, error } = await admin.rpc("enroll_screened_application", { target_enrollment: input.enrollmentId, actor: staff.user.id });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, enrollment: data });
    }
    if (input.action === "send-instructions") {
      if (!staff.roleCodes.some((r) => ["admin", "registration", "training_operations"].includes(r))) return NextResponse.json({ error: "Your account cannot send training instructions." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: enrollment, error: findError } = await admin.from("enrollments")
        .select("id,enrollment_number,trainee_id,enrollment_status,trainees(profile_id,legal_first_name),courses(name)")
        .eq("id", input.enrollmentId).maybeSingle();
      if (findError || !enrollment) throw findError ?? new Error("Enrollment not found.");
      if (!["Enrolled", "Open Schedule"].includes(enrollment.enrollment_status)) return NextResponse.json({ error: "Instructions are generated once the trainee is paid and enrolled." }, { status: 400 });
      // Count the generation; Registration is limited to two (202610070007).
      // Without the migration, fall back to stamping instructions_sent_at.
      const limited = !staff.roleCodes.some((r) => ["admin", "training_operations"].includes(r));
      const { data: generation, error: countError } = await admin.rpc("record_instructions_generated", { target_enrollment: input.enrollmentId, actor: staff.user.id, max_count: limited ? INSTRUCTION_LIMIT : null });
      if (countError && /function public.record_instructions_generated/i.test(countError.message)) {
        const { error: sentError } = await admin.from("enrollments").update({ instructions_sent_at: new Date().toISOString() }).eq("id", input.enrollmentId);
        if (sentError) console.error("Could not set instructions_sent_at:", sentError.message);
      } else if (countError) {
        return NextResponse.json({ error: /already generated/i.test(countError.message) ? "Instructions were already generated twice for this enrollment." : countError.message }, { status: 400 });
      }
      // Best-effort in-app notification to the trainee (only if they have a portal account).
      const trainee = Array.isArray(enrollment.trainees) ? enrollment.trainees[0] : enrollment.trainees;
      const course = Array.isArray(enrollment.courses) ? enrollment.courses[0] : enrollment.courses;
      if (trainee?.profile_id) {
        await admin.from("notifications").insert({ recipient_id: trainee.profile_id, notification_type: "training_instructions",
          title: "Your training instructions are ready", body: `Reporting instructions for ${course?.name ?? "your training"} (${enrollment.enrollment_number}) have been sent. Please review your portal for reporting details.`,
          related_record_type: "enrollment", related_record_id: input.enrollmentId }).then(({ error }) => { if (error) console.error("Instruction notification failed:", error.message); });
      }
      // Email the instructions (PDF attached, Google Classroom join link) to the
      // trainee's registered address, then send it right away; anything not sent
      // now is retried by the daily email job. A failed email never undoes the generation.
      const email = await queueInstructionEmail(admin, input.enrollmentId, Number(generation ?? Date.now()), new URL(request.url).origin);
      const classroom = await inviteToClassroom(admin, input.enrollmentId, staff.user.id);
      return NextResponse.json({ ok: true, email, classroom });
    }
    if (input.action === "announcement-post") {
      if (!staff.roleCodes.some((r) => ["admin", "accounting"].includes(r))) return NextResponse.json({ error: "Only Admin or Accounting can post announcements." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("announcements").insert({ title: input.title, body: input.body, audience_roles: input.audienceRoles ?? [], published_at: new Date().toISOString(), expires_at: input.expiresAt ?? null, created_by: staff.user.id });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "announcement-delete") {
      if (!staff.roleCodes.some((r) => ["admin", "accounting"].includes(r))) return NextResponse.json({ error: "Only Admin or Accounting can delete announcements." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("announcements").delete().eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-status") {
      if (!staff.roleCodes.some((r) => ["admin", "training_operations", "releasing_officer"].includes(r))) return NextResponse.json({ error: "Only Admin, Training Operations, or the Releasing Officer can manage certificates." }, { status: 403 });
      // Printing and release must go through the gated certificate-print / certificate-release
      // actions (feedback + issuance checks); this action cannot flip a cert to Printed/Released.
      if (input.status === "Printed" || input.status === "Released") return NextResponse.json({ error: "Use the Print or Release action in the certificates module." }, { status: 400 });
      const { data, error } = await db.rpc("set_certificate_status", { target_enrollment: input.enrollmentId, target_status: input.status });
      if (error) throw error;
      return NextResponse.json({ ok: true, certificate: data });
    }
    if (input.action === "certificate-issue") {
      // Numbers come only from the Admin's series; the PDF route also assigns one at the first preview.
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only Admin or the Releasing Officer can issue certificates." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const ctx = await certificateContext(admin, input.enrollmentId);
      if (!ctx) throw new Error("Enrollment not found.");
      if (!["Due", "Printed", "Released"].includes(ctx.view.state)) return NextResponse.json({ error: `Not yet: ${ctx.view.state.toLowerCase()}.` }, { status: 400 });
      const certId = await ensureCertificate(admin, ctx);
      const certificateNumber = ctx.cert?.certificate_number ?? await claimCertificateNumber(admin, certId, staff.user.id);
      return NextResponse.json({ ok: true, certificateNumber });
    }
    if (input.action === "certificate-print") {
      // Printing goes through the certificate PDF (/api/documents/certificate/[id]), which counts each print.
      return NextResponse.json({ error: "Use Print in the certificate log. Each print is counted there." }, { status: 400 });
    }
    if (input.action === "certificate-void") {
      // A direct void (cancel the certificate) is for the Admin; the Releasing Officer requests one.
      if (!isAdminRole(staff.roleCodes)) return NextResponse.json({ error: "Only the Admin can void a certificate. Use Request void." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: cert } = await admin.from("certificates").select("id,number_pool_id").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (!cert) return NextResponse.json({ error: "No certificate to void." }, { status: 400 });
      const { error } = await db.rpc("set_certificate_status", { target_enrollment: input.enrollmentId, target_status: "Cancelled" });
      if (error) throw error;
      if (cert.number_pool_id) await admin.from("certificate_number_pool").update({ state: "Voided", voided_at: new Date().toISOString() }).eq("id", cert.number_pool_id);
      await admin.from("certificate_release_events").insert({ certificate_id: cert.id, event_type: "void", released_by: staff.user.id, reason: input.reason ?? "Voided" });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-void-request") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only the Releasing Officer or Admin can request a void." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: cert, error: certError } = await admin.from("certificates").select("id,print_count,void_status").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (certError) return NextResponse.json({ error: "Apply database update 202610080030 first." }, { status: 400 });
      if (!cert || !Number(cert.print_count)) return NextResponse.json({ error: "Only a printed certificate can be voided for reprinting." }, { status: 400 });
      if (cert.void_status === "Requested") return NextResponse.json({ error: "A void request is already waiting for the Admin." }, { status: 400 });
      const { error } = await admin.from("certificates").update({ void_status: "Requested", void_reason: input.reason, void_requested_by: staff.user.id, void_requested_at: new Date().toISOString(), void_decided_by: null, void_decided_at: null, void_remarks: null }).eq("id", cert.id);
      if (error) throw error;
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "releasing_officer", action: "certificate.void_requested", record_type: "certificate", record_id: cert.id, new_values: { reason: input.reason } });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-void-decide") {
      if (!isAdminRole(staff.roleCodes)) return NextResponse.json({ error: "Only the Admin can decide void requests." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: cert } = await admin.from("certificates").select("id,void_status,reprints_allowed,certificate_number").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (!cert || cert.void_status !== "Requested") return NextResponse.json({ error: "No void request is waiting." }, { status: 400 });
      if (!input.approve && !input.remarks) return NextResponse.json({ error: "Add a reason for rejecting." }, { status: 400 });
      const patch: Record<string, unknown> = { void_status: input.approve ? "Approved" : "Rejected", void_decided_by: staff.user.id, void_decided_at: new Date().toISOString(), void_remarks: input.remarks ?? null };
      if (input.approve) patch.reprints_allowed = Number(cert.reprints_allowed ?? 0) + 1;
      const { error } = await admin.from("certificates").update(patch).eq("id", cert.id);
      if (error) throw error;
      if (input.approve) await admin.from("certificate_release_events").insert({ certificate_id: cert.id, event_type: "void", released_by: staff.user.id, reason: "Void approved by the Admin; one more print allowed" });
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "admin", action: input.approve ? "certificate.void_approved" : "certificate.void_rejected", record_type: "certificate", record_id: cert.id, new_values: { certificate_number: cert.certificate_number, remarks: input.remarks ?? null } });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-series-save") {
      if (!isAdminRole(staff.roleCodes)) return NextResponse.json({ error: "Only the Admin sets certificate numbering." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { course_id: input.courseId, prefix: input.prefix, next_number: input.nextNumber, pad: input.pad, batch_prefix: input.batchPrefix, next_batch: input.nextBatch, set_by: staff.user.id, set_at: new Date().toISOString() };
      const { data: prior } = await admin.from("certificate_series").select("*").eq("course_id", input.courseId).maybeSingle();
      const { error } = await admin.from("certificate_series").upsert(row, { onConflict: "course_id" });
      if (error) return NextResponse.json({ error: error.code === "42P01" ? "Apply database update 202610080030 first." : error.message }, { status: 400 });
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "admin", action: "certificate.series_set", record_type: "course", record_id: input.courseId, prior_values: prior ?? null, new_values: row });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-template-link") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only the Releasing Officer or Admin can set templates." }, { status: 403 });
      const fileId = driveFileId(input.driveLink);
      if (!fileId) return NextResponse.json({ error: "Paste the Google Drive link of the template file." }, { status: 400 });
      try { await downloadDriveFile(fileId); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "The Drive file could not be read." }, { status: 400 }); }
      const admin = createSupabaseAdminClient();
      const { data: last } = await admin.from("certificate_templates").select("version").eq("course_id", input.courseId).order("version", { ascending: false }).limit(1).maybeSingle();
      // Insert the new version first, then make it the only active one, so a failed insert never leaves the course without a template.
      const { data: inserted, error } = await admin.from("certificate_templates").insert({ course_id: input.courseId, version: Number(last?.version ?? 0) + 1, storage_path: null, drive_link: input.driveLink, drive_file_id: fileId, active: false, approved_by: staff.user.id, approved_at: new Date().toISOString() }).select("id").single();
      if (!error && inserted) {
        await admin.from("certificate_templates").update({ active: false }).eq("course_id", input.courseId).neq("id", inserted.id);
        await admin.from("certificate_templates").update({ active: true }).eq("id", inserted.id);
      }
      if (error) return NextResponse.json({ error: error.message.includes("drive_link") || error.message.includes("storage_path") ? "Apply database update 202610080030 first." : error.message }, { status: 400 });
      await admin.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "releasing_officer", action: "certificate.template_linked", record_type: "course", record_id: input.courseId, new_values: { drive_file_id: fileId } });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "course-evaluation-form-save") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only the Releasing Officer or Admin can set evaluation forms." }, { status: 403 });
      const formId = input.formLink ? googleFormId(input.formLink) : null;
      if (input.formLink && !formId) return NextResponse.json({ error: "Paste the Google Form's edit link (docs.google.com/forms/d/…)." }, { status: 400 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("courses").update({ evaluation_form_id: formId }).eq("id", input.courseId);
      if (error) return NextResponse.json({ error: "Apply database update 202610080030 first." }, { status: 400 });
      return NextResponse.json({ ok: true, formId });
    }
    if (input.action === "certificate-soft-copy") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only the Releasing Officer or Admin can email soft copies." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const soft = await trySendSoftCopy(admin, input.enrollmentId, { force: true, actor: staff.user.id });
      if (soft.state === "Failed") return NextResponse.json({ error: soft.error }, { status: 400 });
      if (soft.state !== "Queued") return NextResponse.json({ error: "The certificate is not ready, printing is turned off, or the trainee has no email." }, { status: 400 });
      if (soft.jobId) await processEmailJobs(admin, { ids: [soft.jobId], origin: new URL(request.url).origin }).catch(() => undefined);
      return NextResponse.json({ ok: true, to: soft.to });
    }
    if (input.action === "certificate-release-plan") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only Admin or the Releasing Officer can plan a release." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: cert } = await admin.from("certificates").select("id").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (!cert) return NextResponse.json({ error: "No certificate for this enrollment yet." }, { status: 400 });
      const patch: Record<string, unknown> = {};
      for (const [key, column] of [["releaseMethod", "release_method"], ["expectedPickupOn", "expected_pickup_on"], ["claimantName", "claimant_name"], ["claimantRelationship", "claimant_relationship"], ["courierName", "courier_name"], ["trackingNumber", "tracking_number"], ["shippingFeeStatus", "shipping_fee_status"], ["shippingAddress", "shipping_address"], ["courierStatus", "courier_status"]] as const) {
        const value = (input as Record<string, unknown>)[key];
        if (value !== undefined) patch[column] = value === "" ? null : value;
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
      const { error } = await admin.from("certificates").update(patch).eq("id", cert.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-issue-report") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only Admin or the Releasing Officer can flag a certificate issue." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: cert } = await admin.from("certificates").select("id").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (!cert) return NextResponse.json({ error: "No certificate for this enrollment yet." }, { status: 400 });
      const { error } = await admin.from("certificates").update({ issue_status: input.issueStatus, issue_note: input.note ?? null, issue_reported_on: input.issueStatus === "For Correction" ? new Date().toISOString().slice(0, 10) : null }).eq("id", cert.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-release") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only Admin or the Releasing Officer can release certificates." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: cert } = await admin.from("certificates").select("id,status").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (!cert) return NextResponse.json({ error: "No certificate to release." }, { status: 400 });
      if (cert.status !== "Printed") return NextResponse.json({ error: "Print the certificate before releasing it." }, { status: 400 });
      await admin.from("certificates").update({ release_method: input.releaseMethod ?? null, claimant_name: input.recipientName, claimant_relationship: input.claimantRelationship ?? null, id_checked: Boolean(input.idChecked), authorization_checked: Boolean(input.authorizationChecked) }).eq("id", cert.id);
      const { error } = await db.rpc("set_certificate_status", { target_enrollment: input.enrollmentId, target_status: "Released" });
      if (error) throw error;
      const { error: relErr } = await admin.from("certificate_release_events").insert({ certificate_id: cert.id, event_type: "release", recipient_name: input.recipientName, recipient_id_type: input.recipientIdType ?? null, released_by: staff.user.id, reason: input.reason ?? null });
      if (relErr) throw relErr;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-override") {
      if (!staff.roleCodes.includes("admin")) return NextResponse.json({ error: "Only Admin can override certificate details." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      // Override edits an already-issued certificate — it never creates one (that would bypass the
      // issuance-enabled + approved-template guards on certificate-issue).
      const { data: cert } = await admin.from("certificates").select("id,snapshot").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (!cert) return NextResponse.json({ error: "Issue the certificate (assign a number) before editing its details." }, { status: 400 });
      const prevSnap = (cert.snapshot ?? {}) as Record<string, unknown>;
      const overrides = { ...((prevSnap.overrides as Record<string, string>) ?? {}), ...(input.overrides ?? {}) };
      const snapshot = { ...prevSnap, overrides, ...(input.certificateNumber ? { certificate_number: input.certificateNumber } : {}) };
      const { error } = await admin.from("certificates").update({ snapshot }).eq("id", cert.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-issuance-toggle") {
      if (!staff.roleCodes.includes("admin")) return NextResponse.json({ error: "Only Admin can change the certificate issuance setting." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: s } = await admin.from("organization_settings").select("id").maybeSingle();
      if (!s) return NextResponse.json({ error: "Organization settings not found." }, { status: 400 });
      const { error } = await admin.from("organization_settings").update({ certificate_issuance_enabled: input.enabled }).eq("id", s.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "feedback-send-email") {
      if (!(canRelease(staff.roleCodes) || staff.roleCodes.includes("registration"))) return NextResponse.json({ error: "Your account cannot send the feedback form." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: enr } = await admin.from("enrollments").select("id,feedback_token,trainees(legal_first_name,legal_last_name,email),courses(name)").eq("id", input.enrollmentId).maybeSingle();
      if (!enr) throw new Error("Enrollment not found.");
      const t = first(enr.trainees) as { legal_first_name?: string; legal_last_name?: string; email?: string } | null;
      if (!t?.email) return NextResponse.json({ error: "This trainee has no email address on file." }, { status: 400 });
      if (!(enr as { feedback_token?: string }).feedback_token) return NextResponse.json({ error: "No feedback link yet — apply the training-feedback migration first." }, { status: 400 });
      const base = process.env.APP_BASE_URL ?? new URL(request.url).origin;
      const url = `${base}/feedback/${(enr as { feedback_token: string }).feedback_token}`;
      const name = `${t.legal_first_name ?? ""} ${t.legal_last_name ?? ""}`.trim() || "Trainee";
      // Hour-bucketed key: a duplicate within the hour is deduped (unique constraint), so repeated
      // clicks don't spam the trainee, while a genuine resend later still goes out.
      const bucket = Math.floor(Date.now() / 3_600_000);
      const { error } = await admin.from("email_jobs").insert({ idempotency_key: `feedback:${input.enrollmentId}:${bucket}`, template_code: "training.feedback", recipient: t.email, variables: { trainee_name: name, course_name: (first(enr.courses) as { name?: string } | null)?.name ?? "your training", feedback_url: url } });
      if (error && error.code !== "23505") throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "hr-attendance-log") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot record HR attendance." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const minutesLate = input.timeIn ? Math.max(0, minutesOfDay(input.timeIn) - minutesOfDay(input.scheduledIn)) : 0;
      const minutesUndertime = input.timeOut ? Math.max(0, minutesOfDay(input.scheduledOut) - minutesOfDay(input.timeOut)) : 0;
      const status = !input.timeIn ? "Absent" : minutesLate > 0 ? "Late" : "Present";
      const row = {
        employee_id: input.employeeId, attendance_date: input.attendanceDate,
        checked_in_at: input.timeIn ? stampManila(input.attendanceDate, input.timeIn) : null,
        checked_out_at: input.timeOut ? stampManila(input.attendanceDate, input.timeOut) : null,
        minutes_late: minutesLate, minutes_undertime: minutesUndertime, status, remarks: input.remarks || null,
      };
      const { data: existing } = await admin.from("employee_attendance").select("id").eq("employee_id", input.employeeId).eq("attendance_date", input.attendanceDate).maybeSingle();
      const { error } = existing ? await admin.from("employee_attendance").update(row).eq("id", existing.id) : await admin.from("employee_attendance").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "leave-file") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot file leave." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("leave_requests").insert({ employee_id: input.employeeId, leave_type: input.leaveType, starts_on: input.startsOn, ends_on: input.endsOn, reason: input.reason, status: "Pending" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "leave-decide") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot decide leave." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("leave_requests").update({ status: input.decision, approved_by: staff.user.id }).eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "advance-file") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot file cash advances." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("cash_advances").insert({ employee_id: input.employeeId, amount_centavos: input.amountCentavos, balance_centavos: input.amountCentavos, requested_on: input.requestedOn, status: "Pending" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "advance-decide") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot decide cash advances." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("cash_advances").update({ status: input.decision, approved_by: staff.user.id }).eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "leave-file-self" || input.action === "advance-file-self") {
      // Any signed-in employee files for themselves; HR decides. Resolve the employee by login email.
      const admin = createSupabaseAdminClient();
      const { data: emp } = await admin.from("employees").select("id").ilike("work_email", staff.user.email ?? "___none___").maybeSingle();
      if (!emp) return NextResponse.json({ error: "No employee record is linked to your account. Ask HR to add you." }, { status: 400 });
      if (input.action === "leave-file-self") {
        const { error } = await admin.from("leave_requests").insert({ employee_id: emp.id, leave_type: input.leaveType, starts_on: input.startsOn, ends_on: input.endsOn, reason: input.reason, status: "Pending" });
        if (error) throw error;
      } else {
        const requestedOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
        const { error } = await admin.from("cash_advances").insert({ employee_id: emp.id, amount_centavos: input.amountCentavos, balance_centavos: input.amountCentavos, requested_on: requestedOn, status: "Pending" });
        if (error) throw error;
      }
      return NextResponse.json({ ok: true });
    }
    if (input.action === "employee-charge-file-self") {
      // Any signed-in employee files a charge against themselves (category + note, no amount).
      // It stays Pending until the Accounting Manager sets the amount. Resolve employee by login email.
      const admin = createSupabaseAdminClient();
      const { data: emp } = await admin.from("employees").select("id").ilike("work_email", staff.user.email ?? "___none___").maybeSingle();
      if (!emp) return NextResponse.json({ error: "No employee record is linked to your account. Ask HR to add you." }, { status: 400 });
      const effectiveOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
      const { error } = await admin.from("employee_charges").insert({ employee_id: emp.id, category: input.category, description: input.category, note: input.note || null, amount_centavos: 0, balance_centavos: 0, effective_on: effectiveOn, status: "Pending", filed_by: staff.user.id });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "employee-charge-set-amount") {
      // The Accounting Manager entering the amount IS the approval — it activates the charge.
      if (!canManageEmployeeCharges(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage employee charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: updated, error } = await admin.from("employee_charges").update({ amount_centavos: input.amountCentavos, balance_centavos: input.amountCentavos, status: "Active", activated_at: new Date().toISOString(), amount_set_by: staff.user.id }).eq("id", input.id).eq("status", "Pending").select("id");
      if (error) throw error;
      if (!updated?.length) return NextResponse.json({ error: "That charge is no longer awaiting an amount." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "employee-charge-input") {
      // The Accounting Manager inputs a charge directly for an employee — created already Active.
      if (!canManageEmployeeCharges(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage employee charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const effectiveOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
      const { error } = await admin.from("employee_charges").insert({ employee_id: input.employeeId, category: input.category, description: input.category, note: input.note || null, amount_centavos: input.amountCentavos, balance_centavos: input.amountCentavos, effective_on: effectiveOn, status: "Active", activated_at: new Date().toISOString(), filed_by: staff.user.id, amount_set_by: staff.user.id });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "employee-charge-cancel") {
      // Void a wrong charge. A charge that has already been (partly) deducted cannot be cancelled.
      if (!canManageEmployeeCharges(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage employee charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: updated, error } = await admin.from("employee_charges").update({ status: "Cancelled", balance_centavos: 0 }).eq("id", input.id).in("status", ["Pending", "Active"]).select("id");
      if (error) throw error;
      if (!updated?.length) return NextResponse.json({ error: "Only a Pending or Active charge can be cancelled." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "employee-save") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage employees." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const base = { complete_name: input.completeName, position: input.position, employment_status: input.employmentStatus, date_hired: input.dateHired, pay_type: input.payType, base_rate_centavos: input.baseRateCentavos, instructor_daily_rate_centavos: input.instructorDailyRateCentavos ?? null, work_email: input.workEmail || null };
      if (input.id) {
        const { error } = await admin.from("employees").update({ ...base, ...(input.active !== undefined ? { active: input.active } : {}) }).eq("id", input.id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      const { data: employeeNumber, error: numberError } = await db.rpc("next_reference", { prefix: "EMP", requested_year: new Date().getFullYear() });
      if (numberError) throw numberError;
      const { error } = await admin.from("employees").insert({ ...base, employee_number: employeeNumber, government_ids: {}, payroll_account: {}, emergency_contact: {}, leave_balances: {}, active: true });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "employee-set-active") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage employees." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("employees").update({ active: input.active }).eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "benefit-save") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage benefits." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const base = { employee_id: input.employeeId, benefit_type: input.benefitType, reference: input.reference || null, amount_centavos: input.amountCentavos ?? 0, effective_from: input.effectiveFrom ?? null, effective_to: input.effectiveTo ?? null };
      const { error } = input.id ? await admin.from("benefit_records").update(base).eq("id", input.id) : await admin.from("benefit_records").insert(base);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "benefit-remove") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage benefits." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("benefit_records").delete().eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "contract-save") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage contracts." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const base = { employee_id: input.employeeId, contract_type: input.contractType, position: input.position || null, rate_centavos: input.rateCentavos ?? 0, starts_on: input.startsOn, ends_on: input.endsOn ?? null, status: input.status ?? "Active", notes: input.notes || null };
      const { error } = input.id ? await admin.from("employment_contracts").update(base).eq("id", input.id) : await admin.from("employment_contracts").insert(base);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "contract-remove") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage contracts." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("employment_contracts").delete().eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "attendance-check-in-self" || input.action === "attendance-check-out-self") {
      // Any signed-in employee clocks themselves in/out for today. Resolve by login email.
      const admin = createSupabaseAdminClient();
      const { data: emp } = await admin.from("employees").select("id").ilike("work_email", staff.user.email ?? "___none___").maybeSingle();
      if (!emp) return NextResponse.json({ error: "No employee record is linked to your account. Ask HR to add you." }, { status: 400 });
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
      const nowHm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
      const mins = minutesOfDay(nowHm);
      const nowIso = new Date().toISOString();
      const { data: existing } = await admin.from("employee_attendance").select("id,checked_in_at,checked_out_at").eq("employee_id", emp.id).eq("attendance_date", today).maybeSingle();
      if (input.action === "attendance-check-in-self") {
        if (existing?.checked_in_at) return NextResponse.json({ error: "You already clocked in today." }, { status: 409 });
        const late = Math.max(0, mins - minutesOfDay("08:00"));
        const status = late > 0 ? "Late" : "Present";
        const { error } = existing
          ? await admin.from("employee_attendance").update({ checked_in_at: nowIso, minutes_late: late, status }).eq("id", existing.id)
          : await admin.from("employee_attendance").insert({ employee_id: emp.id, attendance_date: today, checked_in_at: nowIso, minutes_late: late, minutes_undertime: 0, status });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      if (!existing?.checked_in_at) return NextResponse.json({ error: "Clock in first before clocking out." }, { status: 409 });
      if (existing.checked_out_at) return NextResponse.json({ error: "You already clocked out today." }, { status: 409 });
      const under = Math.max(0, minutesOfDay("17:00") - mins);
      const { error } = await admin.from("employee_attendance").update({ checked_out_at: nowIso, minutes_undertime: under }).eq("id", existing.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "payroll-open") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot open payroll." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: dupe } = await admin.from("payroll_periods").select("id").eq("pay_date", input.payDate).maybeSingle();
      if (dupe) throw new Error("A payroll period for this pay date already exists.");
      const { data: period, error: periodError } = await admin.from("payroll_periods").insert({ period_number: `PR-${input.payDate}`, starts_on: input.startsOn, ends_on: input.endsOn, pay_date: input.payDate, status: "Draft" }).select("id").single();
      if (periodError) throw periodError;
      const { data: emps } = await admin.from("employees").select("id,pay_type,base_rate_centavos,instructor_daily_rate_centavos").eq("active", true);
      const { data: att } = await admin.from("employee_attendance").select("employee_id,status").gte("attendance_date", input.startsOn).lte("attendance_date", input.endsOn);
      const presentDays = new Map<string, number>();
      for (const a of att ?? []) if (a.status !== "Absent") presentDays.set(a.employee_id, (presentDays.get(a.employee_id) ?? 0) + 1);
      // Approved, still-outstanding cash advances are amortised (FIFO) against this run.
      const { data: advs } = await admin.from("cash_advances").select("id,employee_id,balance_centavos").eq("status", "Approved").gt("balance_centavos", 0).order("requested_on");
      const advByEmp = new Map<string, { id: string; balance: number }[]>();
      for (const a of advs ?? []) { const list = advByEmp.get(a.employee_id) ?? []; list.push({ id: a.id, balance: Number(a.balance_centavos) }); advByEmp.set(a.employee_id, list); }
      // Active employee charges are deducted as the "Others" line (FIFO), after advances. Tolerant:
      // if the table is pre-migration, this yields no rows and payroll behaves as before.
      const { data: chgs } = await admin.from("employee_charges").select("id,employee_id,balance_centavos").eq("status", "Active").gt("balance_centavos", 0).order("effective_on");
      const chgByEmp = new Map<string, { id: string; balance: number }[]>();
      for (const c of chgs ?? []) { const list = chgByEmp.get(c.employee_id) ?? []; list.push({ id: c.id, balance: Number(c.balance_centavos) }); chgByEmp.set(c.employee_id, list); }
      const items = [] as Record<string, unknown>[];
      const advanceUpdates = [] as { id: string; balance: number; settled: boolean }[];
      const chargeUpdates = [] as { id: string; balance: number; settled: boolean }[];
      // Draw a FIFO amount from a list of {id,balance}, capped at `cap`; records updates, returns total drawn.
      const drawDown = (list: { id: string; balance: number }[], cap: number, updates: { id: string; balance: number; settled: boolean }[]) => {
        let remaining = Math.min(cap, list.reduce((s, x) => s + x.balance, 0));
        const drawn = remaining;
        for (const row of list) { if (remaining <= 0) break; const applied = Math.min(remaining, row.balance); remaining -= applied; updates.push({ id: row.id, balance: row.balance - applied, settled: row.balance - applied <= 0 }); }
        return drawn;
      };
      for (const e of emps ?? []) {
        const days = presentDays.get(e.id) ?? 0;
        const gross = e.pay_type === "Monthly" ? Math.round(Number(e.base_rate_centavos) / 2)
          : e.pay_type === "Daily" ? Number(e.instructor_daily_rate_centavos ?? e.base_rate_centavos) * days
          : Number(e.base_rate_centavos);
        const advanceDeducted = drawDown(advByEmp.get(e.id) ?? [], gross, advanceUpdates);
        const otherDeducted = drawDown(chgByEmp.get(e.id) ?? [], gross - advanceDeducted, chargeUpdates);
        const deduction = advanceDeducted + otherDeducted;
        items.push({ payroll_period_id: period.id, employee_id: e.id, gross_centavos: gross, deduction_centavos: deduction, net_centavos: Math.max(0, gross - deduction), breakdown: { basic_centavos: gross, present_days: days, pay_type: e.pay_type, advance_deducted_centavos: advanceDeducted, other_deducted_centavos: otherDeducted } });
      }
      if (items.length) { const { error } = await admin.from("payroll_items").insert(items); if (error) throw error; }
      for (const update of advanceUpdates) await admin.from("cash_advances").update({ balance_centavos: update.balance, ...(update.settled ? { status: "Settled" } : {}) }).eq("id", update.id);
      for (const update of chargeUpdates) await admin.from("employee_charges").update({ balance_centavos: update.balance, ...(update.settled ? { status: "Settled" } : {}) }).eq("id", update.id);
      return NextResponse.json({ ok: true, period: period.id, employees: items.length });
    }
    if (input.action === "payroll-review") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot review payroll." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: anyItem } = await admin.from("payroll_items").select("id").eq("payroll_period_id", input.id).limit(1);
      if (!anyItem?.length) throw new Error("This period has no payroll items to review.");
      const { error } = await admin.from("payroll_periods").update({ status: "Reviewed", reviewed_by: staff.user.id }).eq("id", input.id).eq("status", "Draft");
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "payroll-finalize") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot finalize payroll." }, { status: 403 });
      const { data: period, error: finalizeError } = await db.rpc("finalize_payroll", { target_period: input.id });
      if (finalizeError) throw finalizeError;
      // Mirror the finalized net total into Accounting as a Paid "Payroll" voucher.
      const admin = createSupabaseAdminClient();
      const { data: sums } = await admin.from("payroll_items").select("net_centavos").eq("payroll_period_id", input.id);
      const net = (sums ?? []).reduce((sum, i) => sum + Number(i.net_centavos), 0);
      if (net > 0) {
        const { count } = await admin.from("expenses").select("id", { count: "exact", head: true });
        const expenseNumber = `CV-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(6, "0")}`;
        const periodNumber = (period as { period_number?: string } | null)?.period_number ?? "payroll";
        await admin.from("expenses").insert({ expense_number: expenseNumber, payee: "Payroll", category: "Payroll", amount_centavos: net, purpose: `Net payroll for ${periodNumber}`, status: "Paid", paid_at: new Date().toISOString(), requested_by: staff.user.id, approved_by: staff.user.id });
      }
      return NextResponse.json({ ok: true });
    }
    if (input.action === "course-price-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot edit the pricelist." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("courses").update({ standard_price_centavos: input.priceCentavos }).eq("id", input.courseId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "offer-rate-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot edit endorsement rates." }, { status: 403 });
      if (input.rebateCentavos > input.trainingFeeCentavos) throw new Error("Rebate cannot exceed the training fee.");
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("partner_course_offers").update({ training_fee_centavos: input.trainingFeeCentavos, rebate_centavos: input.rebateCentavos, partner_payable_centavos: input.trainingFeeCentavos - input.rebateCentavos }).eq("id", input.offerId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "payment-split") {
      if (!canCashier(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot post payments." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const splitModeProblem = await paymentModeProblem(admin, input.method, input.referenceNumber);
      if (splitModeProblem) return NextResponse.json({ error: splitModeProblem }, { status: 400 });
      // Referral rebates come off the fee before any payment, partial or full.
      await applyReferralRebates(admin, [...new Set([...input.allocations.map((a) => a.enrollmentId), ...(input.items ?? []).map((i) => i.enrollmentId)])], staff.user.id);
      if (!input.allocations.length && !input.items.length) return NextResponse.json({ error: "Apply the payment to at least one course or charge." }, { status: 400 });
      const ids = [...new Set([...input.allocations.map((a) => a.enrollmentId), ...input.items.map((i) => i.enrollmentId)])];
      const { data: enrs } = await admin.from("enrollments").select("id,trainee_id,selling_price_centavos,enrollment_status").in("id", ids);
      if (!enrs || enrs.length !== new Set(ids).size) throw new Error("One or more enrollments were not found.");
      const traineeId = enrs[0].trainee_id;
      if (enrs.some((e) => e.trainee_id !== traineeId)) throw new Error("A split payment must be for a single trainee.");
      if (enrs.some((e) => e.enrollment_status === "Cancelled" && input.items.some((i) => i.enrollmentId === e.id))) return NextResponse.json({ error: "Charges cannot be added to a cancelled enrollment." }, { status: 400 });
      const { data: allocs } = await admin.from("payment_allocations").select("enrollment_id,amount_centavos,payments!inner(valid)").in("enrollment_id", ids).eq("payments.valid", true);
      const { data: chgs } = await admin.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", ids).eq("valid", true);
      for (const a of input.allocations) {
        const e = enrs.find((row) => row.id === a.enrollmentId)!;
        const paid = (allocs ?? []).filter((r) => r.enrollment_id === a.enrollmentId).reduce((s, r) => s + Number(r.amount_centavos), 0);
        const charge = (chgs ?? []).filter((r) => r.enrollment_id === a.enrollmentId && r.event_type !== "discount").reduce((s, r) => s + Number(r.amount_centavos), 0);
        const discount = (chgs ?? []).filter((r) => r.enrollment_id === a.enrollmentId && r.event_type === "discount").reduce((s, r) => s + Number(r.amount_centavos), 0);
        const balance = Number(e.selling_price_centavos) + charge - discount - paid;
        if (a.amountCentavos > balance) throw new Error(`A split amount exceeds the remaining balance on ${a.enrollmentId}.`);
      }
      // Items are written as Pending and approved only after the payment posts, so a
      // failed payment never leaves an unpaid charge on the balance.
      const itemCharges: string[] = [];
      for (const item of input.items) {
        const description = item.quantity > 1 ? `${item.description} x ${item.quantity}` : item.description;
        const { data: row, error: itemError } = await admin.from("enrollment_charges").insert({ enrollment_id: item.enrollmentId, charge_catalog_id: item.chargeCatalogId ?? null, description, amount_centavos: item.unitCentavos * item.quantity, event_type: "charge", valid: false, approval_status: "Pending", created_by: staff.user.id }).select("id").single();
        if (itemError) throw itemError;
        itemCharges.push(row.id as string);
      }
      const byEnrollment = new Map<string, number>();
      for (const a of input.allocations) byEnrollment.set(a.enrollmentId, (byEnrollment.get(a.enrollmentId) ?? 0) + a.amountCentavos);
      for (const i of input.items) byEnrollment.set(i.enrollmentId, (byEnrollment.get(i.enrollmentId) ?? 0) + i.unitCentavos * i.quantity);
      const allocations = [...byEnrollment].map(([enrollment_id, amount_centavos]) => ({ enrollment_id, amount_centavos }));
      const total = allocations.reduce((sum, a) => sum + a.amount_centavos, 0);
      const { data: posted, error } = await db.rpc("post_payment", { target_trainee: traineeId, target_amount_centavos: total, target_method: input.method, target_receiving_account: input.receivingAccount, target_reference: input.referenceNumber || null, target_received_at: input.receivedAt, target_proof: input.proofId ?? null, target_allocations: allocations, target_remarks: input.remarks || null });
      if (error) {
        if (itemCharges.length) await admin.from("enrollment_charges").update({ approval_status: "Rejected" }).in("id", itemCharges);
        throw error;
      }
      if (itemCharges.length) {
        const { error: approveError } = await admin.from("enrollment_charges").update({ valid: true, approval_status: "Approved" }).in("id", itemCharges);
        if (approveError) throw approveError;
      }
      await autoSendInstructions(admin, ids);
      const enrolled = await tryAutoEnroll(admin, ids, staff.user.id);
      const implemented = await autoImplementPaidRequests(admin, ids, staff.user.id);
      await applyReferralRebates(admin, ids, staff.user.id, { paid: true }); // "No deduction" agencies: rebate owed once paid
      return NextResponse.json({ ok: true, enrolled, implemented, payment: posted });
    }
    if (input.action === "enrollment-delete") {
      if (!staff.roleCodes.includes("admin")) return NextResponse.json({ error: "Only Admin can delete enrollments." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: allocs } = await admin.from("payment_allocations").select("payment_id").eq("enrollment_id", input.enrollmentId).limit(1);
      if (allocs && allocs.length) return NextResponse.json({ error: "This enrollment has posted payments and cannot be deleted. Cancel it instead." }, { status: 400 });
      const { data: enr } = await admin.from("enrollments").select("id").eq("id", input.enrollmentId).maybeSingle();
      if (!enr) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
      await hardDeleteEnrollment(admin, input.enrollmentId);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "prune-enrollments-now") {
      if (!staff.roleCodes.includes("admin")) return NextResponse.json({ error: "Only Admin can run the pending-enrollment cleanup." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const removed = await pruneUnpaidEnrollments(admin);
      const batchesRemoved = await deletePastEmptyBatches(admin);
      return NextResponse.json({ ok: true, removed, batchesRemoved });
    }
    if (input.action === "enrollment-course-change") {
      if (!canCashier(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot change a course." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      await applyCourseChange(admin, input.enrollmentId, input.courseId, input.partnerOfferId ?? null);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "enrollment-reschedule") {
      if (!canCashier(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot reschedule." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: enrollment } = await admin.from("enrollments").select("id,batch_id").eq("id", input.enrollmentId).maybeSingle();
      if (!enrollment) throw new Error("Enrollment not found.");
      const oldBatch = enrollment.batch_id as string | null;
      if (input.batchId && input.batchId !== oldBatch) {
        const { data: nb } = await admin.from("batches").select("capacity,confirmed_count").eq("id", input.batchId).maybeSingle();
        if (!nb) throw new Error("Schedule not found.");
        if (Number(nb.confirmed_count) >= Number(nb.capacity)) throw new Error("That schedule is already full.");
      }
      const { error } = await admin.from("enrollments").update({ batch_id: input.batchId }).eq("id", input.enrollmentId);
      if (error) throw error;
      // confirmed_count is maintained by app code (no trigger); mirror the enrollment RPCs.
      if (oldBatch && oldBatch !== input.batchId) {
        const { data: ob } = await admin.from("batches").select("confirmed_count,capacity,status").eq("id", oldBatch).maybeSingle();
        if (ob) { const next = Math.max(0, Number(ob.confirmed_count) - 1); await admin.from("batches").update({ confirmed_count: next, status: ob.status === "Full" && next < Number(ob.capacity) ? "Open" : ob.status }).eq("id", oldBatch); }
      }
      if (input.batchId && input.batchId !== oldBatch) {
        const { data: nb2 } = await admin.from("batches").select("confirmed_count,capacity,status").eq("id", input.batchId).maybeSingle();
        if (nb2) { const next = Number(nb2.confirmed_count) + 1; await admin.from("batches").update({ confirmed_count: next, status: next >= Number(nb2.capacity) ? "Full" : nb2.status }).eq("id", input.batchId); }
      }
      return NextResponse.json({ ok: true });
    }
    if (input.action === "course-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage courses." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const payload = { code: input.code.toUpperCase(), name: input.name, category_id: input.categoryId, delivery_type: input.deliveryType, duration_label: input.durationLabel, duration_days: input.durationDays, training_mode: input.mode, standard_price_centavos: input.priceCentavos, public_visible: input.deliveryType === "In-House", active: true };
      const { error } = input.id ? await admin.from("courses").update(payload).eq("id", input.id) : await admin.from("courses").insert(payload);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "center-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage training centers." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, contact_details: { email: input.email || null, mobile: input.mobile || null }, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("partner_centers").update(row).eq("id", input.id) : await admin.from("partner_centers").insert({ ...row, active: true });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "classroom-save") {
      if (!canManageTraining(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage classrooms." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, venue: input.venue, capacity: input.capacity, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("classrooms").update(row).eq("id", input.id) : await admin.from("classrooms").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "classroom-set-active") {
      if (!canManageTraining(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage classrooms." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("classrooms").update({ active: input.active }).eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "create-batch") {
      if (!staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot create schedules." }, { status: 403 });
      const { data, error } = await db.rpc("create_training_batch", { target_course: input.courseId, target_partner_offer: input.partnerOfferId ?? null,
        target_instructor_name: input.instructorName, target_instructor_email: input.instructorEmail, target_room_name: input.roomName,
        target_starts_on: input.startsOn, target_ends_on: input.endsOn, target_daily_start: input.dailyStart, target_daily_end: input.dailyEnd,
        target_mode: input.mode, target_venue: input.venue, target_capacity: input.capacity, target_enrollment_deadline: input.enrollmentDeadline, target_publish: input.publish });
      if (error) throw error;
      return NextResponse.json({ ok: true, batch: data });
    }
    if (input.action === "auto-open-batches") {
      if (!staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot create schedules." }, { status: 403 });
      const { data, error } = await db.rpc("auto_open_training_batches", { target_course: input.courseId, target_year: input.year, target_month: input.month });
      if (error) throw error;
      return NextResponse.json({ ok: true, created: data });
    }
    if (input.action === "auto-open-all-batches") {
      if (!staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot create schedules." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: courses } = await admin.from("courses").select("id,name").eq("active", true).eq("delivery_type", "In-House");
      const ids = (courses ?? []).map((c) => c.id as string);
      let created = 0; const failed: string[] = [];
      for (const c of courses ?? []) {
        const { data, error } = await db.rpc("auto_open_training_batches", { target_course: c.id, target_year: input.year, target_month: input.month });
        if (error) failed.push(c.name as string); else created += Number(data ?? 0);
      }
      // Publish the freshly-opened batches for the month so the public registration form can see them.
      let published = 0;
      if (ids.length) {
        const mm = String(input.month).padStart(2, "0");
        const eom = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
        const { data: pub } = await admin.from("batches").update({ published_at: new Date().toISOString() }).in("course_id", ids).is("published_at", null).eq("status", "Open").gte("starts_on", `${input.year}-${mm}-01`).lte("starts_on", `${input.year}-${mm}-${eom}`).select("id");
        published = (pub ?? []).length;
      }
      return NextResponse.json({ ok: true, created, published, courses: (courses ?? []).length, failed });
    }
    if (input.action === "auto-open-week" || input.action === "auto-open-all-week") {
      if (!staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot create schedules." }, { status: 403 });
      // range_end = weekStart + 6 days (plain-date math, no timezone drift). The range RPC
      // publishes the batches it creates, so they are immediately publicly bookable.
      const [wy, wm, wd] = input.weekStart.split("-").map(Number);
      const we = new Date(Date.UTC(wy, wm - 1, wd + 6));
      const weekEnd = `${we.getUTCFullYear()}-${String(we.getUTCMonth() + 1).padStart(2, "0")}-${String(we.getUTCDate()).padStart(2, "0")}`;
      if (input.action === "auto-open-week") {
        const { data, error } = await db.rpc("auto_open_training_batches_range", { target_course: input.courseId, range_start: input.weekStart, range_end: weekEnd });
        if (error) throw error;
        return NextResponse.json({ ok: true, created: data });
      }
      const admin = createSupabaseAdminClient();
      const { data: courses } = await admin.from("courses").select("id,name").eq("active", true).eq("delivery_type", "In-House");
      let created = 0; const failed: string[] = [];
      for (const c of courses ?? []) {
        const { data, error } = await db.rpc("auto_open_training_batches_range", { target_course: c.id, range_start: input.weekStart, range_end: weekEnd });
        if (error) failed.push(c.name as string); else created += Number(data ?? 0);
      }
      return NextResponse.json({ ok: true, created, published: created, courses: (courses ?? []).length, failed });
    }
    if (input.action === "batch-update") {
      if (!staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot edit schedules." }, { status: 403 });
      const { data, error } = await db.rpc("update_training_batch", { target_batch: input.batchId,
        target_instructor_name: input.instructorName, target_instructor_email: input.instructorEmail, target_room_name: input.roomName, target_venue: input.venue,
        target_daily_start: input.dailyStart, target_daily_end: input.dailyEnd, target_mode: input.mode, target_enrollment_deadline: input.enrollmentDeadline, target_publish: input.publish });
      if (error) throw error;
      // Renaming the batch number is Admin-only (it's a unique identifier). Applied separately from the RPC.
      if (input.batchNumber && staff.roleCodes.includes("admin")) {
        const admin = createSupabaseAdminClient();
        const { error: renameError } = await admin.from("batches").update({ batch_number: input.batchNumber }).eq("id", input.batchId);
        if (renameError) return NextResponse.json({ error: renameError.code === "23505" ? "That batch number is already used by another schedule." : renameError.message }, { status: 409 });
      }
      return NextResponse.json({ ok: true, batch: data });
    }
    if (input.action === "batch-delete") {
      if (!staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot remove schedules." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: batch } = await admin.from("batches").select("id,batch_number").eq("id", input.batchId).maybeSingle();
      if (!batch) return NextResponse.json({ error: "That schedule no longer exists." }, { status: 404 });
      // A schedule with any enrollment (paid, pending, or cancelled) is history — it cannot be
      // removed. Reschedule or cancel those enrollments first.
      const { count } = await admin.from("enrollments").select("id", { count: "exact", head: true }).eq("batch_id", input.batchId);
      if ((count ?? 0) > 0) return NextResponse.json({ error: "This schedule has enrollments. Reschedule or cancel them before removing it." }, { status: 409 });
      // Clear non-cascading references, then delete. batch_training_dates / resource_assignments /
      // attendance cascade automatically from the batches row.
      await admin.from("incidents").delete().eq("batch_id", input.batchId);
      const { error } = await admin.from("batches").delete().eq("id", input.batchId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "agency-rebate-set") {
      if (!staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Only Accounting can set rebates." }, { status: 403 });
      const { data, error } = await db.rpc("set_agency_course_rebate", { target_agency: input.agencyId, target_course: input.courseId, target_cents: input.cents });
      if (error) throw error;
      return NextResponse.json({ ok: true, rebate: data });
    }
    if (input.action === "record-agency-rebate") {
      if (!staff.roleCodes.some((role) => ["admin", "accounting", "cashier"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
      const { data, error } = await db.rpc("record_agency_rebate", { target_enrollment: input.enrollmentId, target_agency: input.agencyId });
      if (error) throw error;
      return NextResponse.json({ ok: true, rebate: data });
    }
    if (input.action === "agency-rebate-settle") {
      if (!staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Only Accounting can settle rebates." }, { status: 403 });
      const { data, error } = await db.rpc("settle_agency_rebate", { target_entry: input.id, target_status: input.status });
      if (error) throw error;
      return NextResponse.json({ ok: true, rebate: data });
    }
    if (input.action === "create-enrollment") {
      if (!staff.roleCodes.some((role) => ["admin", "registration", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot create enrollments." }, { status: 403 });
      if (!input.existingTraineeId && (!input.birthDate || !input.email || !input.mobile || input.firstName.length < 2 || input.lastName.length < 2)) {
        return NextResponse.json({ error: "Complete the trainee's name, birth date, email, and mobile number." }, { status: 400 });
      }
      const { data, error } = await db.rpc("create_staff_enrollment", { target_existing_trainee: input.existingTraineeId ?? null,
        target_first_name: input.firstName, target_middle_name: input.middleName, target_last_name: input.lastName, target_birthdate: input.birthDate ?? "1900-01-01",
        target_email: input.email ?? "", target_mobile: input.mobile ?? "", target_course: input.courseId, target_partner_offer: input.partnerOfferId ?? null,
        target_batch: input.batchId ?? null, target_source: "Staff-assisted registration" });
      if (error) throw error;
      // Endorsed/partner enrollments carry a free training date (no New Wave batch).
      // Persist it separately so the create RPC stays unchanged. Tolerate a missing
      // column (pre-migration) so enrollment creation never fails on this step.
      if (input.scheduledOn && data?.id) {
        const admin = createSupabaseAdminClient();
        const { error: dateError } = await admin.from("enrollments").update({ scheduled_on: input.scheduledOn }).eq("id", data.id);
        if (dateError) console.error("Could not save enrollment scheduled_on:", dateError.message);
      }
      // A newly created trainee gets the rest of the public-form fields. Master
      // record only (no money, no status); a failure is logged, never fatal.
      const newTraineeId = !input.existingTraineeId ? (data as { trainee_id?: string } | null)?.trainee_id : null;
      if (newTraineeId && (input.srn || input.presentAddress || input.placeOfBirth || input.rank || input.company || input.suffix || input.emergencyContactName)) {
        const admin = createSupabaseAdminClient();
        const { error: profileError } = await admin.from("trainees").update({
          suffix: input.suffix || null, srn: input.srn ? normalizeSrn(input.srn) : null, address: input.presentAddress || null,
          place_of_birth: input.placeOfBirth || null, rank: input.rank || null, company: input.company || null,
          // Column is jsonb NOT NULL (default {}), so an absent contact writes {} rather than null.
          emergency_contact: input.emergencyContactName ? { name: input.emergencyContactName, mobile: input.emergencyContactMobile ? normalizePhContactNumber(input.emergencyContactMobile) : null } : {},
        }).eq("id", newTraineeId);
        if (profileError) console.error("Could not save trainee profile fields:", profileError.message);
      }
      return NextResponse.json({ ok: true, enrollment: data });
    }
    if (!staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Your account cannot post payments." }, { status: 403 });
    const admin = createSupabaseAdminClient();
    const modeProblem = await paymentModeProblem(admin, input.method, input.referenceNumber);
    if (modeProblem) return NextResponse.json({ error: modeProblem }, { status: 400 });
    // Referral rebate comes off the fee before any payment, partial or full.
    await applyReferralRebates(admin, [input.enrollmentId], staff.user.id);
    const { data: enrollment, error: enrollmentError } = await admin.from("enrollments").select("id,trainee_id,selling_price_centavos").eq("id", input.enrollmentId).maybeSingle();
    if (enrollmentError || !enrollment) throw enrollmentError ?? new Error("Enrollment not found.");
    const { data: existingAllocations } = await admin.from("payment_allocations").select("amount_centavos,payments!inner(valid)").eq("enrollment_id", input.enrollmentId).eq("payments.valid", true);
    const paid = (existingAllocations ?? []).reduce((sum, item) => sum + Number(item.amount_centavos), 0);
    // Amount due = base selling price + other charges − rebates/discounts (valid rows only).
    const { data: chargeRows } = await admin.from("enrollment_charges").select("amount_centavos,event_type").eq("enrollment_id", input.enrollmentId).eq("valid", true);
    const chargeTotal = (chargeRows ?? []).filter((r) => r.event_type !== "discount").reduce((sum, r) => sum + Number(r.amount_centavos), 0);
    const discountTotal = (chargeRows ?? []).filter((r) => r.event_type === "discount").reduce((sum, r) => sum + Number(r.amount_centavos), 0);
    const due = Number(enrollment.selling_price_centavos) + chargeTotal - discountTotal;
    if (input.amountCentavos > due - paid) throw new Error("Payment exceeds the remaining enrollment balance.");
    if (input.proofId) {
      const { data: proof } = await admin.from("payment_proofs").select("id").eq("id", input.proofId).eq("verified_by", staff.user.id).maybeSingle();
      if (!proof) throw new Error("The uploaded proof is invalid or belongs to another cashier session.");
    }
    const { data, error } = await db.rpc("post_payment", { target_trainee: enrollment.trainee_id, target_amount_centavos: input.amountCentavos,
      target_method: input.method, target_receiving_account: input.receivingAccount, target_reference: input.referenceNumber || null,
      target_received_at: input.receivedAt, target_proof: input.proofId ?? null, target_allocations: [{ enrollment_id: input.enrollmentId, amount_centavos: input.amountCentavos }], target_remarks: input.remarks || null });
    if (error) throw error;
    await autoSendInstructions(admin, [input.enrollmentId]);
    const enrolled = await tryAutoEnroll(admin, [input.enrollmentId], staff.user.id);
    const implemented = await autoImplementPaidRequests(admin, [input.enrollmentId], staff.user.id);
    await applyReferralRebates(admin, [input.enrollmentId], staff.user.id, { paid: true }); // "No deduction" agencies: rebate owed once paid
    return NextResponse.json({ ok: true, payment: data, enrolled, implemented });
  } catch (error) {
    // Zod validation errors: report the specific field problems, not the raw JSON dump.
    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => { const field = issue.path.filter((p) => p !== "action").join("."); return field ? `${field}: ${issue.message}` : issue.message; }).join("; ");
      return NextResponse.json({ error: message || "Please check the submitted values." }, { status: 400 });
    }
    // Supabase/Postgres errors are plain objects (not Error instances); surface their
    // message so staff see the real reason (e.g. duplicate trainee) instead of a generic one.
    const message = error instanceof Error
      ? error.message
      : (error && typeof error === "object" && "message" in error && (error as { message?: unknown }).message)
        ? String((error as { message: unknown }).message)
        : "The operation could not be completed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
