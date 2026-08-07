import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hardDeleteEnrollment, pruneUnpaidEnrollments, deletePastEmptyBatches } from "@/lib/enrollments";

const enrollmentInput = z.object({
  action: z.literal("create-enrollment"), existingTraineeId: z.string().uuid().nullable().optional(),
  firstName: z.string().trim().max(80).optional().default(""), middleName: z.string().trim().max(80).optional().default(""), lastName: z.string().trim().max(80).optional().default(""),
  birthDate: z.string().date().optional(), email: z.string().email().optional(), mobile: z.string().trim().min(7).max(30).optional(),
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
const chargeInput = z.object({ action: z.literal("charge-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(80), defaultAmountCentavos: z.number().int().nonnegative().default(0), active: z.boolean().optional() });
const expenseCategoryInput = z.object({ action: z.literal("expense-category-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(80), active: z.boolean().optional(), remove: z.boolean().optional() });
const inventoryItemInput = z.object({ action: z.literal("inventory-item-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(120), category: z.string().trim().max(80).optional(), unit: z.string().trim().min(1).max(24).default("pc"), unitValueCentavos: z.number().int().nonnegative().default(0), active: z.boolean().optional(), remove: z.boolean().optional() });
const inventoryMoveInput = z.object({ action: z.literal("inventory-move"), itemId: z.string().uuid(), movementType: z.enum(["in", "out"]), quantity: z.number().int().positive(), remarks: z.string().trim().max(240).optional() });
const agencyInput = z.object({ action: z.literal("agency-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(120), contactName: z.string().trim().max(120).optional(), email: z.string().email().optional().or(z.literal("")), mobile: z.string().trim().max(40).optional(), active: z.boolean().optional() });
const payableInput = z.object({ action: z.literal("payable-save"), id: z.string().uuid().nullable().optional(), description: z.string().trim().min(1).max(200), amountCentavos: z.number().int().positive().optional(), dueOn: z.string().date().nullable().optional(), remove: z.boolean().optional() });
const expenseCreateInput = z.object({ action: z.literal("expense-create"), payee: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(80), amountCentavos: z.number().int().positive(), purpose: z.string().trim().min(1).max(300), paymentChannel: z.string().trim().max(40).optional().default(""), referenceNumber: z.string().trim().max(80).optional().default("") });
const expenseDecideInput = z.object({ action: z.literal("expense-decide"), id: z.string().uuid(), decision: z.enum(["Approved", "Rejected", "Paid"]) });
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
const paymentSplitInput = z.object({ action: z.literal("payment-split"), allocations: z.array(z.object({ enrollmentId: z.string().uuid(), amountCentavos: z.number().int().positive() })).min(1).max(10), method: z.string().trim().min(1).max(80), receivingAccount: z.string().trim().min(2).max(120), referenceNumber: z.string().trim().max(80).optional().default(""), receivedAt: z.string().datetime({ offset: true }), remarks: z.string().trim().max(500).optional().default("") });
const courseChangeInput = z.object({ action: z.literal("enrollment-course-change"), enrollmentId: z.string().uuid(), courseId: z.string().uuid(), partnerOfferId: z.string().uuid().nullable().optional() });
const rescheduleInput = z.object({ action: z.literal("enrollment-reschedule"), enrollmentId: z.string().uuid(), batchId: z.string().uuid().nullable() });
const sendInstructionsInput = z.object({ action: z.literal("send-instructions"), enrollmentId: z.string().uuid() });
const instructionTemplateSaveInput = z.object({ action: z.literal("instruction-template-save"), courseId: z.string().uuid(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(8000) });
const classroomLinkSaveInput = z.object({ action: z.literal("course-classroom-link-save"), courseId: z.string().uuid(), link: z.string().trim().max(500) });
const requestRaiseInput = z.object({ action: z.literal("request-raise"), enrollmentId: z.string().uuid(), requestType: z.enum(["Cancellation", "Refund", "Make-up Class", "Rescheduling", "Reprinting", "Change Course"]), reason: z.string().trim().min(1).max(500), batchId: z.string().uuid().nullable().optional(), amountCentavos: z.number().int().positive().optional(), paymentId: z.string().uuid().nullable().optional(), courseId: z.string().uuid().nullable().optional(), partnerOfferId: z.string().uuid().nullable().optional() });
const requestDecideInput = z.object({ action: z.literal("request-decide"), id: z.string().uuid(), approve: z.boolean(), remarks: z.string().trim().max(500).optional() });

const actionInput = z.discriminatedUnion("action", [batchInput, autoOpenBatchInput, autoOpenAllInput, enrollmentDeleteInput, batchUpdateInput, agencyRebateSetInput, recordAgencyRebateInput, agencyRebateSettleInput, expenseCategoryInput, inventoryItemInput, inventoryMoveInput, paymentInput, enrollmentInput, notificationInput, channelInput, chargeInput, agencyInput, payableInput, expenseCreateInput, expenseDecideInput, closingInput, enrollmentChargeInput, enrollmentChargeVoidInput, hrAttendanceInput, leaveFileInput, leaveDecideInput, advanceFileInput, advanceDecideInput, employeeSaveInput, employeeSetActiveInput, payrollOpenInput, payrollReviewInput, payrollFinalizeInput, classroomSaveInput, classroomSetActiveInput, coursePriceInput, offerRateInput, courseSaveInput, centerSaveInput, paymentSplitInput, courseChangeInput, rescheduleInput, sendInstructionsInput, instructionTemplateSaveInput, classroomLinkSaveInput, leaveFileSelfInput, advanceFileSelfInput, requestRaiseInput, requestDecideInput, discountRequestInput, discountDecideInput, chargeDecideInput, announcementPostInput, announcementDeleteInput, certificateStatusInput, certificateIssueInput, certificatePrintInput, certificateVoidInput, certificateReleaseInput, certificateReleasePlanInput, certificateIssueInput2, certificateOverrideInput, certificateIssuanceToggleInput, feedbackSendEmailInput, pruneNowInput, employeeChargeFileSelfInput, employeeChargeSetAmountInput, employeeChargeInput, employeeChargeCancelInput, batchDeleteInput, benefitSaveInput, benefitRemoveInput, contractSaveInput, contractRemoveInput, attendanceCheckInSelfInput, attendanceCheckOutSelfInput, autoOpenWeekInput, autoOpenAllWeekInput]);
const canCashier = (roles: string[]) => roles.some((role) => ["admin", "cashier", "accounting"].includes(role));

const canManageAccounting = (roles: string[]) => roles.some((role) => ["admin", "accounting"].includes(role));
const canManageHr = (roles: string[]) => roles.some((role) => ["admin", "hr"].includes(role));
// Employee-charge management: the Accounting Manager owns it; admin + HR (who run payroll) included.
const canManageEmployeeCharges = (roles: string[]) => roles.some((role) => ["admin", "accounting", "hr"].includes(role));
const canManageTraining = (roles: string[]) => roles.some((role) => ["admin", "training_operations"].includes(role));
const canRelease = (roles: string[]) => roles.some((role) => ["admin", "releasing_officer"].includes(role));
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

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const db = createSupabaseAdminClient();
  const results = await Promise.all([
    db.from("profiles").select("complete_name,email").eq("id", staff.user.id).maybeSingle(),
    db.from("courses").select("id,code,name,delivery_type,duration_label,duration_days,training_mode,category_id,standard_price_centavos,google_classroom_link,active,updated_at,course_categories(name)").eq("active", true).order("name"),
    db.from("partner_course_offers").select("id,course_id,duration_label,training_fee_centavos,rebate_centavos,partner_payable_centavos,updated_at,partner_centers(name,contact_details)").eq("active", true).order("training_fee_centavos"),
    db.from("trainees").select("id,trainee_number,legal_first_name,legal_middle_name,legal_last_name,birthdate,sex,nationality,address,email,mobile,srn,account_state,registered_at").neq("account_state", "Deactivated").order("created_at", { ascending: false }).limit(250),
    db.from("batches").select("id,batch_number,course_id,partner_offer_id,starts_on,ends_on,daily_start,daily_end,mode,venue,capacity,confirmed_count,enrollment_deadline,status,published_at,courses(name,code),partner_course_offers(partner_centers(name))").eq("active", true).order("starts_on", { ascending: true }).limit(250),
    db.from("enrollments").select("id,enrollment_number,trainee_id,course_id,partner_offer_id,batch_id,enrollment_status,instructions_status,selling_price_centavos,rebate_centavos,partner_payable_centavos,created_at,trainees(trainee_number,legal_first_name,legal_middle_name,legal_last_name,email,mobile),courses(name,code),batches(batch_number,starts_on,ends_on,mode,venue),partner_course_offers(partner_centers(name))").order("created_at", { ascending: false }).limit(250),
    db.from("payments").select("id,payment_number,trainee_id,amount_centavos,method,receiving_account,reference_number,proof_id,received_at,verification_state,remarks,valid,trainees(legal_first_name,legal_last_name)").eq("valid", true).order("received_at", { ascending: false }).limit(250),
    db.from("payment_allocations").select("payment_id,enrollment_id,amount_centavos"),
    db.from("notifications").select("id,title,body,deep_link,read_at,created_at").eq("recipient_id", staff.user.id).order("created_at", { ascending: false }).limit(20),
    // Accounting datasets (Slice 1): channels, charges, agencies, expenses, payables.
    db.from("payment_methods").select("id,code,name,requires_reference,allows_proof,active,sort_order").order("sort_order"),
    db.from("charge_catalog").select("id,name,default_amount_centavos,active,used_count").order("name"),
    db.from("marketing_agencies").select("id,name,contact_name,email,mobile,active").order("name"),
    db.from("expenses").select("id,expense_number,payee,category,amount_centavos,purpose,status,created_at").order("created_at", { ascending: false }).limit(250),
    db.from("payables").select("id,description,amount_centavos,due_on,status,partner_center_id,enrollment_id,created_at").order("created_at", { ascending: false }).limit(250),
    db.from("cashier_closings").select("id,closing_date,opening_cash_centavos,cash_collections_centavos,online_collections_centavos,refunds_centavos,expenses_centavos,expected_cash_centavos,actual_cash_centavos,variance_centavos,status,submitted_at").order("closing_date", { ascending: false }).limit(60),
    db.from("enrollment_charges").select("id,enrollment_id,charge_catalog_id,description,amount_centavos,event_type,created_at").eq("valid", true).order("created_at", { ascending: false }).limit(500),
    db.from("classrooms").select("id,name,venue,capacity,active").order("name"),
    db.from("course_categories").select("id,name").eq("active", true).order("sort_order"),
    db.from("partner_centers").select("id,name,active").order("name"),
    db.from("agency_course_rebates").select("id,agency_id,course_id,rebate_centavos,updated_at"),
    db.from("agency_rebates").select("id,agency_id,enrollment_id,course_id,rebate_centavos,status,created_at,marketing_agencies(name),courses(name),trainees(legal_first_name,legal_last_name)").order("created_at", { ascending: false }).limit(300),
    db.from("expense_categories").select("id,name,active").order("name"),
    db.from("inventory_items").select("id,name,category,unit,quantity_on_hand,unit_value_centavos,active").order("name"),
    db.from("inventory_movements").select("id,item_id,movement_type,quantity,remarks,created_at,inventory_items(name)").order("created_at", { ascending: false }).limit(200),
    db.from("enrollment_charges").select("id,enrollment_id,description,amount_centavos,agency_id,created_at,enrollments(enrollment_number,trainees(legal_first_name,legal_last_name),courses(name)),marketing_agencies(name)").eq("event_type", "discount").eq("approval_status", "Pending").order("created_at", { ascending: false }).limit(200),
    db.from("announcements").select("id,title,body,audience_roles,published_at,expires_at").order("published_at", { ascending: false, nullsFirst: false }).limit(30),
  ]);
  const error = results.find((item) => item.error)?.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const [profile, courses, offers, trainees, batches, enrollmentsResult, payments, allocations, notifications,
    paymentMethods, charges, agencies, expenses, payables, cashierClosings, enrollmentCharges, classrooms, courseCategories, partnerCenters, agencyCourseRebates, agencyRebates, expenseCategories, inventoryItems, inventoryMovements, pendingDiscounts, announcements] = results;
  const paidByEnrollment = new Map<string, number>();
  for (const allocation of allocations.data ?? []) paidByEnrollment.set(allocation.enrollment_id, (paidByEnrollment.get(allocation.enrollment_id) ?? 0) + Number(allocation.amount_centavos));
  const chargesByEnrollment = new Map<string, number>();
  const discountsByEnrollment = new Map<string, number>();
  for (const row of enrollmentCharges.data ?? []) {
    const target = row.event_type === "discount" ? discountsByEnrollment : chargesByEnrollment;
    target.set(row.enrollment_id, (target.get(row.enrollment_id) ?? 0) + Number(row.amount_centavos));
  }
  // scheduled_on is fetched separately and tolerantly: if the column has not been
  // migrated yet, the query errors in isolation and we simply omit the date rather
  // than failing the whole workspace load.
  const scheduledByEnrollment = new Map<string, string | null>();
  const sentByEnrollment = new Map<string, string | null>();
  const scheduledResult = await db.from("enrollments").select("id,scheduled_on").limit(250);
  if (!scheduledResult.error) for (const row of scheduledResult.data ?? []) scheduledByEnrollment.set(row.id, (row as { scheduled_on?: string | null }).scheduled_on ?? null);
  const sentResult = await db.from("enrollments").select("id,instructions_sent_at").limit(250);
  if (!sentResult.error) for (const row of sentResult.data ?? []) sentByEnrollment.set(row.id, (row as { instructions_sent_at?: string | null }).instructions_sent_at ?? null);
  // Feedback token (share link) + submitted set — both tolerant of the pre-migration state.
  const tokenByEnrollment = new Map<string, string | null>();
  const feedbackByEnrollment = new Set<string>();
  const tokenResult = await db.from("enrollments").select("id,feedback_token").limit(250);
  if (!tokenResult.error) for (const row of tokenResult.data ?? []) tokenByEnrollment.set(row.id, (row as { feedback_token?: string | null }).feedback_token ?? null);
  const feedbackResult = await db.from("training_feedback").select("enrollment_id").limit(500);
  if (!feedbackResult.error) for (const row of feedbackResult.data ?? []) feedbackByEnrollment.add((row as { enrollment_id: string }).enrollment_id);
  const enrollments = (enrollmentsResult.data ?? []).map((row) => ({ ...row, scheduled_on: scheduledByEnrollment.get(row.id) ?? null, instructions_sent_at: sentByEnrollment.get(row.id) ?? null, paid_centavos: paidByEnrollment.get(row.id) ?? 0, charges_centavos: chargesByEnrollment.get(row.id) ?? 0, discounts_centavos: discountsByEnrollment.get(row.id) ?? 0, feedback_token: tokenByEnrollment.get(row.id) ?? null, feedback_submitted: feedbackByEnrollment.has(row.id) }));
  // HR datasets are sensitive (salaries, government IDs) — only HR and Admin receive them.
  const isHr = canManageHr(staff.roleCodes);
  let hr: Record<string, unknown[]> = { employees: [], employeeAttendance: [], leaveRequests: [], cashAdvances: [], payrollPeriods: [], payrollItems: [], benefitRecords: [], employmentContracts: [] };
  if (isHr) {
    const hrResults = await Promise.all([
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
    hr = { employees: hrResults[0].data ?? [], employeeAttendance: hrResults[1].data ?? [], leaveRequests: hrResults[2].data ?? [], cashAdvances: hrResults[3].data ?? [], payrollPeriods: hrResults[4].data ?? [], payrollItems: hrResults[5].data ?? [], benefitRecords: hrResults[6].data ?? [], employmentContracts: hrResults[7].data ?? [] };
  }
  // Certificates carry trainee identity — only Training Operations, Releasing Officer, and Admin receive them.
  let certificates: unknown[] = [];
  let certificateTemplates: unknown[] = [];
  let certificateReleases: unknown[] = [];
  if (canManageTraining(staff.roleCodes) || canRelease(staff.roleCodes)) {
    const { data } = await db.from("certificates").select("id,enrollment_id,status,printed_at,printed_by,reprint_count,snapshot,number_pool_id,template_id,created_at,enrollments(enrollment_number,trainees(legal_first_name,legal_last_name),courses(name,code))").order("created_at", { ascending: false }).limit(300);
    certificates = data ?? [];
    // Release/courier/correction fields ship in a later migration — merge tolerantly
    // so a pre-migration database returns the base certificate rows instead of 500ing.
    const { data: extra } = await db.from("certificates").select("id,release_method,expected_pickup_on,claimant_name,claimant_relationship,id_checked,authorization_checked,courier_name,tracking_number,shipping_fee_status,shipping_address,courier_status,issue_status,issue_note,issue_reported_on");
    if (extra?.length) {
      const byId = new Map(extra.map((r) => [r.id, r]));
      certificates = (certificates as { id: string }[]).map((c) => ({ ...c, ...(byId.get(c.id) ?? {}) }));
    }
    const { data: tpls } = await db.from("certificate_templates").select("id,course_id,version,storage_path,active,fields,approved_at,courses(name,code)").order("created_at", { ascending: false }).limit(200);
    certificateTemplates = tpls ?? [];
    // Released-list report source (tolerant: table exists but may be empty).
    const { data: rel } = await db.from("certificate_release_events").select("id,certificate_id,event_type,recipient_name,recipient_id_type,reason,created_at,certificates(enrollment_id,snapshot,enrollments(enrollment_number,trainees(legal_first_name,legal_last_name),courses(name,code)))").order("created_at", { ascending: false }).limit(400);
    certificateReleases = rel ?? [];
  }
  // Certificate issuance safety flag (admin-toggleable; read via service role).
  let certificateIssuanceEnabled = false;
  if (canManageTraining(staff.roleCodes) || canRelease(staff.roleCodes)) {
    const admin = createSupabaseAdminClient();
    const { data: s } = await admin.from("organization_settings").select("certificate_issuance_enabled").maybeSingle();
    certificateIssuanceEnabled = Boolean(s?.certificate_issuance_enabled);
  }
  // Cashier→Accounting requests (Cancellation/Refund/Make-up/Rescheduling). enrollment_requests is
  // RLS-protected, so read via service role; expose only to cashier/accounting/admin.
  let requests: unknown[] = [];
  // Non-discount charges awaiting the Accounting Manager's approval.
  let pendingCharges: unknown[] = [];
  if (canManageAccounting(staff.roleCodes) || canCashier(staff.roleCodes)) {
    const { data } = await db.from("enrollment_charges").select("id,enrollment_id,description,amount_centavos,created_at,enrollments(enrollment_number,trainees(legal_first_name,legal_last_name),courses(name))").eq("event_type", "charge").eq("approval_status", "Pending").order("created_at", { ascending: false }).limit(200);
    pendingCharges = data ?? [];
  }
  if (canCashier(staff.roleCodes) || staff.roleCodes.includes("registration")) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("enrollment_requests").select("id,request_number,request_type,requested_values,reason,status,decision_remarks,created_at,decided_at,trainees(legal_first_name,legal_last_name),enrollments(enrollment_number,courses(name))").in("request_type", ["Cancellation", "Refund", "Make-up Class", "Rescheduling", "Reprinting", "Change Course"]).order("created_at", { ascending: false }).limit(200);
    requests = data ?? [];
  }
  // Per-course training instruction templates (subject/body) for the Instructions editor + PDF.
  let instructionTemplates: unknown[] = [];
  {
    const { data } = await db.from("training_instruction_templates").select("course_id,subject,body,active").eq("active", true).order("version", { ascending: false }).limit(500);
    instructionTemplates = data ?? [];
  }
  // Instructor + room per batch, for the Schedule Officer workspace. Assignments are
  // per training date; the first assignment found represents the batch. Tolerant:
  // any failure yields an empty list rather than a 500.
  let batchStaffing: { batch_id: string; instructor_name: string | null; room_name: string | null }[] = [];
  {
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
    batchStaffing = [...seen.values()];
  }
  // Merge the payment-channel kind (receivable/payable) tolerantly — the column may not
  // be migrated yet, in which case every channel is treated as receivable.
  const kindByMethod = new Map<string, string>();
  {
    const { error, data } = await db.from("payment_methods").select("id,kind");
    if (!error) for (const r of data ?? []) kindByMethod.set(r.id as string, (r as { kind?: string }).kind ?? "receivable");
  }
  const paymentMethodsWithKind = (paymentMethods.data ?? []).map((m) => ({ ...m, kind: kindByMethod.get((m as { id: string }).id) ?? "receivable" }));
  // MyHr self-service: the signed-in staff's OWN employee record + leave / cash-advance history,
  // matched by login email → employees.work_email. Read via service role, self only.
  let myHr: { employee: unknown; leave: unknown[]; advances: unknown[]; charges: unknown[]; attendance: unknown[] } | null = null;
  if (staff.user.email) {
    const admin = createSupabaseAdminClient();
    const { data: emp } = await admin.from("employees").select("id,employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,work_email,active").ilike("work_email", staff.user.email).maybeSingle();
    if (emp) {
      const { data: leave } = await admin.from("leave_requests").select("id,leave_type,starts_on,ends_on,reason,status,created_at").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(50);
      const { data: adv } = await admin.from("cash_advances").select("id,amount_centavos,requested_on,balance_centavos,status").eq("employee_id", emp.id).order("requested_on", { ascending: false }).limit(50);
      // Tolerant: the employee_charges category/note/balance columns may not be migrated yet.
      const { data: chg } = await admin.from("employee_charges").select("id,category,note,amount_centavos,balance_centavos,status,effective_on,activated_at").eq("employee_id", emp.id).order("effective_on", { ascending: false }).limit(50);
      const { data: att } = await admin.from("employee_attendance").select("id,attendance_date,checked_in_at,checked_out_at,minutes_late,minutes_undertime,status").eq("employee_id", emp.id).order("attendance_date", { ascending: false }).limit(30);
      myHr = { employee: emp, leave: leave ?? [], advances: adv ?? [], charges: chg ?? [], attendance: att ?? [] };
    }
  }
  // Tolerant merge of expense payment channel + reference (migration 202608100001).
  // Kept out of the main select so a pre-migration schema doesn't empty the expenses list.
  let expensesMerged = (expenses.data ?? []) as Record<string, unknown>[];
  {
    const { data: ex } = await db.from("expenses").select("id,payment_channel,reference_number").order("created_at", { ascending: false }).limit(250);
    if (ex) { const m = new Map(ex.map((r) => [(r as { id: string }).id, r])); expensesMerged = expensesMerged.map((e) => ({ ...e, ...(m.get((e as { id: string }).id) ?? {}) })); }
  }
  // Employee-charge management for the Accounting Manager (admin / accounting / hr): the charge list
  // plus a minimal employee roster to file against (accounting does not receive the full HR dataset).
  // Separate tolerant queries so a pre-migration schema yields [] instead of 500-ing the GET.
  let employeeCharges: unknown[] = [];
  let chargeEmployees: unknown[] = [];
  if (canManageEmployeeCharges(staff.roleCodes)) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("employee_charges").select("id,employee_id,category,note,amount_centavos,balance_centavos,status,effective_on,activated_at,employees(complete_name,employee_number)").order("effective_on", { ascending: false }).limit(400);
    employeeCharges = data ?? [];
    const { data: roster } = await admin.from("employees").select("id,complete_name,employee_number,active").eq("active", true).order("complete_name");
    chargeEmployees = roster ?? [];
  }
  return NextResponse.json({ profile: profile.data ?? { complete_name: staff.user.email?.split("@")[0] ?? "Staff", email: staff.user.email }, roles: staff.roleCodes, myHr,
    courses: courses.data ?? [], offers: offers.data ?? [], trainees: trainees.data ?? [], batches: batches.data ?? [], enrollments,
    payments: payments.data ?? [], notifications: notifications.data ?? [],
    paymentMethods: paymentMethodsWithKind, charges: charges.data ?? [], agencies: agencies.data ?? [],
    expenses: expensesMerged, payables: payables.data ?? [], cashierClosings: cashierClosings.data ?? [], enrollmentCharges: enrollmentCharges.data ?? [],
    employees: hr.employees, employeeAttendance: hr.employeeAttendance, leaveRequests: hr.leaveRequests, cashAdvances: hr.cashAdvances, payrollPeriods: hr.payrollPeriods, payrollItems: hr.payrollItems, benefitRecords: hr.benefitRecords, employmentContracts: hr.employmentContracts,
    classrooms: classrooms.data ?? [], certificates, certificateTemplates, certificateReleases, certificateIssuanceEnabled, courseCategories: courseCategories.data ?? [], partnerCenters: partnerCenters.data ?? [],
    agencyCourseRebates: agencyCourseRebates.data ?? [], agencyRebates: agencyRebates.data ?? [], expenseCategories: expenseCategories.data ?? [], inventoryItems: inventoryItems.data ?? [], inventoryMovements: inventoryMovements.data ?? [], pendingDiscounts: pendingDiscounts.data ?? [], announcements: announcements.data ?? [], requests, pendingCharges, employeeCharges, chargeEmployees, instructionTemplates, batchStaffing }, { headers: { "Cache-Control": "no-store" } });
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
    if (input.action === "channel-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage payment channels." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, code: (input.code || input.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40), requires_reference: input.requiresReference, allows_proof: input.allowsProof, ...(input.kind ? { kind: input.kind } : {}), ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("payment_methods").update(row).eq("id", input.id) : await admin.from("payment_methods").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "charge-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, default_amount_centavos: input.defaultAmountCentavos, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("charge_catalog").update(row).eq("id", input.id) : await admin.from("charge_catalog").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "expense-category-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage expense categories." }, { status: 403 });
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
      const { error } = input.id ? await admin.from("marketing_agencies").update(row).eq("id", input.id) : await admin.from("marketing_agencies").insert(row);
      if (error) throw error;
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
      const admin = createSupabaseAdminClient();
      const { count } = await admin.from("expenses").select("id", { count: "exact", head: true });
      const expenseNumber = `CV-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(6, "0")}`;
      const { data: created, error } = await admin.from("expenses").insert({ expense_number: expenseNumber, payee: input.payee, category: input.category, amount_centavos: input.amountCentavos, purpose: input.purpose, status: "Pending", requested_by: staff.user.id }).select("id").single();
      if (error) throw error;
      // Deploy-safe: payment_channel/reference_number arrive with migration 202608100001.
      // Set them separately and ignore a pre-migration "column does not exist" error.
      if (input.paymentChannel || input.referenceNumber) {
        await admin.from("expenses").update({ payment_channel: input.paymentChannel || null, reference_number: input.referenceNumber || null }).eq("id", created.id);
      }
      return NextResponse.json({ ok: true });
    }
    if (input.action === "expense-decide") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot decide expenses." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const patch = input.decision === "Paid"
        ? { status: "Paid", paid_at: new Date().toISOString(), approved_by: staff.user.id }
        : { status: input.decision, approved_by: staff.user.id };
      const { error } = await admin.from("expenses").update(patch).eq("id", input.id);
      if (error) throw error;
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
      const { data: created, error: insertError } = await admin.from("enrollment_requests").insert({ request_number: reference, trainee_id: enrollment.trainee_id, enrollment_id: input.enrollmentId, request_type: input.requestType, requested_values: requested, reason: input.reason, requester_id: staff.user.id, status: "Pending" }).select("id").single();
      if (insertError) throw insertError;
      await admin.from("request_events").insert({ request_id: created.id, actor_id: staff.user.id, event_type: "raised", new_values: requested, remarks: input.reason });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "request-decide") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Only Accounting or Admin can decide requests." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: req, error: findError } = await admin.from("enrollment_requests").select("id,enrollment_id,request_type,requested_values,status").eq("id", input.id).maybeSingle();
      if (findError || !req) throw findError ?? new Error("Request not found.");
      if (req.status !== "Pending") return NextResponse.json({ error: "This request has already been decided." }, { status: 400 });
      if (input.approve) {
        const rv = (req.requested_values ?? {}) as { batchId?: string; amountCentavos?: number; paymentId?: string; courseId?: string; partnerOfferId?: string };
        if (req.request_type === "Rescheduling") {
          await applyReschedule(admin, req.enrollment_id, rv.batchId ?? null);
        } else if (req.request_type === "Change Course") {
          await applyCourseChange(admin, req.enrollment_id, rv.courseId ?? "", rv.partnerOfferId ?? null);
        } else if (req.request_type === "Cancellation") {
          const { error } = await admin.from("enrollments").update({ enrollment_status: "Cancelled", cancelled_at: new Date().toISOString() }).eq("id", req.enrollment_id);
          if (error) throw error;
        } else if (req.request_type === "Refund") {
          const { error } = await admin.from("refunds_and_reversals").insert({ enrollment_id: req.enrollment_id, payment_id: rv.paymentId ?? null, event_type: "refund", amount_centavos: rv.amountCentavos ?? 0, reason: input.remarks ?? "Approved refund request", approved_request_id: req.id, created_by: staff.user.id });
          if (error) throw error;
        } else if (req.request_type === "Make-up Class") {
          // Requires migration 202608020003 (nullable original_attendance_record_id). Best-effort so
          // approval still records before the column is nullable; Training Ops completes the assignment.
          const { error } = await admin.from("make_up_assignments").insert({ enrollment_id: req.enrollment_id, status: "Pending", assigned_by: staff.user.id });
          if (error) console.error("Make-up assignment insert failed (apply migration 202608020003):", error.message);
        } else if (req.request_type === "Reprinting") {
          // Bump the certificate's reprint count so the reprint is tracked; best-effort (no cert yet is fine).
          const { data: cert } = await admin.from("certificates").select("id,reprint_count").eq("enrollment_id", req.enrollment_id).maybeSingle();
          if (cert) await admin.from("certificates").update({ reprint_count: Number(cert.reprint_count ?? 0) + 1, status: "Printed" }).eq("id", cert.id);
        }
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
    if (input.action === "course-classroom-link-save") {
      if (!staff.roleCodes.some((r) => ["admin", "registration", "training_operations"].includes(r))) return NextResponse.json({ error: "Your account cannot set the Google Classroom link." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("courses").update({ google_classroom_link: input.link || null }).eq("id", input.courseId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "send-instructions") {
      if (!staff.roleCodes.some((r) => ["admin", "registration", "training_operations"].includes(r))) return NextResponse.json({ error: "Your account cannot send training instructions." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: enrollment, error: findError } = await admin.from("enrollments")
        .select("id,enrollment_number,trainee_id,trainees(profile_id,legal_first_name),courses(name)")
        .eq("id", input.enrollmentId).maybeSingle();
      if (findError || !enrollment) throw findError ?? new Error("Enrollment not found.");
      // Mark instructions as sent. Tolerate a not-yet-migrated column so the action
      // never hard-fails; the column exists once 202608020002 is applied.
      const { error: sentError } = await admin.from("enrollments").update({ instructions_sent_at: new Date().toISOString() }).eq("id", input.enrollmentId);
      if (sentError) console.error("Could not set instructions_sent_at:", sentError.message);
      // Best-effort in-app notification to the trainee (only if they have a portal account).
      const trainee = Array.isArray(enrollment.trainees) ? enrollment.trainees[0] : enrollment.trainees;
      const course = Array.isArray(enrollment.courses) ? enrollment.courses[0] : enrollment.courses;
      if (trainee?.profile_id) {
        await admin.from("notifications").insert({ recipient_id: trainee.profile_id, notification_type: "training_instructions",
          title: "Your training instructions are ready", body: `Reporting instructions for ${course?.name ?? "your training"} (${enrollment.enrollment_number}) have been sent. Please review your portal for reporting details.`,
          related_record_type: "enrollment", related_record_id: input.enrollmentId }).then(({ error }) => { if (error) console.error("Instruction notification failed:", error.message); });
      }
      return NextResponse.json({ ok: true });
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
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only Admin or the Releasing Officer can issue certificates." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: enrollment } = await admin.from("enrollments").select("id,course_id,courses(name,code,delivery_type),trainees(legal_first_name,legal_middle_name,legal_last_name)").eq("id", input.enrollmentId).maybeSingle();
      if (!enrollment) throw new Error("Enrollment not found.");
      const course = first(enrollment.courses) as { name?: string; code?: string; delivery_type?: string } | null;
      if (course?.delivery_type !== "In-House") return NextResponse.json({ error: "Certificates are issued for In-House courses only." }, { status: 400 });
      const { data: settings } = await admin.from("organization_settings").select("certificate_issuance_enabled").maybeSingle();
      if (!settings?.certificate_issuance_enabled) return NextResponse.json({ error: "Certificate issuance is disabled. An admin must enable it in organization settings before certificates can be issued." }, { status: 400 });
      const { data: tpl } = await admin.from("certificate_templates").select("id").eq("course_id", enrollment.course_id).eq("active", true).not("approved_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
      if (!tpl) return NextResponse.json({ error: "Upload and approve an active certificate template for this course first." }, { status: 400 });
      let certNumber = input.certificateNumber?.trim();
      if (!certNumber) { const { data: ref, error: refErr } = await db.rpc("next_reference", { prefix: "CERT" }); if (refErr) throw refErr; certNumber = String(ref); }
      const t = first(enrollment.trainees) as { legal_first_name?: string; legal_middle_name?: string | null; legal_last_name?: string } | null;
      const defaultName = t ? [t.legal_first_name, t.legal_middle_name, t.legal_last_name].filter(Boolean).join(" ") : "";
      const overrides = { name: defaultName, course_title: course?.name ?? "", ...(input.overrides ?? {}) };
      const { data: existing } = await admin.from("certificates").select("id,snapshot").eq("enrollment_id", input.enrollmentId).maybeSingle();
      const snapshot = { ...((existing?.snapshot as Record<string, unknown>) ?? {}), certificate_number: certNumber, overrides, template_id: tpl.id, issued_at: new Date().toISOString() };
      if (existing) { const { error } = await admin.from("certificates").update({ template_id: tpl.id, snapshot, status: "Ready to Print" }).eq("id", existing.id); if (error) throw error; }
      else { const { error } = await admin.from("certificates").insert({ enrollment_id: input.enrollmentId, template_id: tpl.id, snapshot, status: "Ready to Print" }); if (error) throw error; }
      return NextResponse.json({ ok: true, certificateNumber: certNumber });
    }
    if (input.action === "certificate-print") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only Admin or the Releasing Officer can print certificates." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: cert } = await admin.from("certificates").select("id,status,reprint_count").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (!cert) return NextResponse.json({ error: "Issue the certificate (assign a number) before printing." }, { status: 400 });
      // Reprint path: already printed once — logged, no feedback re-check (feedback was required at first print).
      if (cert.status === "Printed" || cert.status === "Released") {
        if (!input.reprint) return NextResponse.json({ error: "This certificate was already printed. Choose Reprint (logged) or Void to re-issue." }, { status: 400 });
        const { error } = await admin.from("certificates").update({ reprint_count: Number(cert.reprint_count ?? 0) + 1 }).eq("id", cert.id);
        if (error) throw error;
        await admin.from("certificate_release_events").insert({ certificate_id: cert.id, event_type: "reprint", released_by: staff.user.id, reason: "Reprint" });
        return NextResponse.json({ ok: true, reprint: true });
      }
      // First print: issuance must be enabled, and In-House requires the trainee's submitted feedback.
      const { data: settings } = await admin.from("organization_settings").select("certificate_issuance_enabled").maybeSingle();
      if (!settings?.certificate_issuance_enabled) return NextResponse.json({ error: "Certificate issuance is disabled. An admin must enable it before certificates can be printed." }, { status: 400 });
      const { data: enr } = await admin.from("enrollments").select("id,courses(delivery_type)").eq("id", input.enrollmentId).maybeSingle();
      if ((first(enr?.courses) as { delivery_type?: string } | null)?.delivery_type === "In-House") {
        // Tolerant of the pre-migration state: only enforce when the training_feedback table exists.
        const { data: fb, error: fbErr } = await admin.from("training_feedback").select("id").eq("enrollment_id", input.enrollmentId).maybeSingle();
        if (!fbErr && !fb) return NextResponse.json({ error: "The trainee must submit the feedback form (online-training attendance) before this certificate can be printed." }, { status: 400 });
      }
      const { error } = await db.rpc("set_certificate_status", { target_enrollment: input.enrollmentId, target_status: "Printed" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "certificate-void") {
      if (!canRelease(staff.roleCodes)) return NextResponse.json({ error: "Only Admin or the Releasing Officer can void certificates." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { data: cert } = await admin.from("certificates").select("id,number_pool_id").eq("enrollment_id", input.enrollmentId).maybeSingle();
      if (!cert) return NextResponse.json({ error: "No certificate to void." }, { status: 400 });
      const { error } = await db.rpc("set_certificate_status", { target_enrollment: input.enrollmentId, target_status: "Cancelled" });
      if (error) throw error;
      if (cert.number_pool_id) await admin.from("certificate_number_pool").update({ state: "Voided", voided_at: new Date().toISOString() }).eq("id", cert.number_pool_id);
      await admin.from("certificate_release_events").insert({ certificate_id: cert.id, event_type: "void", released_by: staff.user.id, reason: input.reason ?? "Voided" });
      return NextResponse.json({ ok: true });
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
      const ids = input.allocations.map((a) => a.enrollmentId);
      const { data: enrs } = await admin.from("enrollments").select("id,trainee_id,selling_price_centavos").in("id", ids);
      if (!enrs || enrs.length !== new Set(ids).size) throw new Error("One or more enrollments were not found.");
      const traineeId = enrs[0].trainee_id;
      if (enrs.some((e) => e.trainee_id !== traineeId)) throw new Error("A split payment must be for a single trainee.");
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
      const total = input.allocations.reduce((s, a) => s + a.amountCentavos, 0);
      const { error } = await db.rpc("post_payment", { target_trainee: traineeId, target_amount_centavos: total, target_method: input.method, target_receiving_account: input.receivingAccount, target_reference: input.referenceNumber || null, target_received_at: input.receivedAt, target_proof: null, target_allocations: input.allocations.map((a) => ({ enrollment_id: a.enrollmentId, amount_centavos: a.amountCentavos })), target_remarks: input.remarks || null });
      if (error) throw error;
      await autoSendInstructions(admin, ids);
      return NextResponse.json({ ok: true });
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
      return NextResponse.json({ ok: true, enrollment: data });
    }
    if (!staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Your account cannot post payments." }, { status: 403 });
    if (["GCash", "Bank transfer"].includes(input.method) && !input.referenceNumber) return NextResponse.json({ error: "A transaction reference is required for GCash and bank transfers." }, { status: 400 });
    const admin = createSupabaseAdminClient();
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
    return NextResponse.json({ ok: true, payment: data });
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
