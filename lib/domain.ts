export type EnrollmentStatus = "Pending" | "Open Schedule" | "Enrolled" | "Cancelled";
export type PaymentStatus = "Paid" | "Unpaid" | "Partially Paid" | "Cancelled";
export type AttendanceStatus = "Present" | "Late" | "Absent" | "Incomplete" | "Make-Up Required" | "Make-Up Completed";
export type CertificateStatus = "Pending Attendance" | "Ready to Print" | "Printed" | "Released" | "Cancelled";

export type LedgerEvent = {
  type: "charge" | "payment" | "refund" | "reversal" | "discount";
  amountCentavos: number;
  valid?: boolean;
};

export function derivePaymentStatus(events: readonly LedgerEvent[], cancelled = false): PaymentStatus {
  if (cancelled) return "Cancelled";
  const charges = events.filter((event) => event.valid !== false && event.type === "charge").reduce((sum, event) => sum + event.amountCentavos, 0);
  const discounts = events.filter((event) => event.valid !== false && event.type === "discount").reduce((sum, event) => sum + event.amountCentavos, 0);
  const payments = events.filter((event) => event.valid !== false && event.type === "payment").reduce((sum, event) => sum + event.amountCentavos, 0);
  const outflows = events.filter((event) => event.valid !== false && (event.type === "refund" || event.type === "reversal")).reduce((sum, event) => sum + event.amountCentavos, 0);
  const due = Math.max(0, charges - discounts);
  const paid = Math.max(0, payments - outflows);
  if (paid <= 0) return "Unpaid";
  return paid >= due ? "Paid" : "Partially Paid";
}

export function calculateOffer(trainingFeeCentavos: number, rebateCentavos: number) {
  if (trainingFeeCentavos < 0 || rebateCentavos < 0 || rebateCentavos > trainingFeeCentavos) {
    throw new Error("Offer values are invalid.");
  }
  return {
    trainingFeeCentavos,
    rebateCentavos,
    partnerPayableCentavos: trainingFeeCentavos - rebateCentavos,
  };
}

export function suggestAttendanceStatus(input: {
  checkedInAt: Date;
  checkedOutAt: Date;
  sessionStartsAt: Date;
  lateThresholdMinutes: number;
  minimumRequiredMinutes: number;
}): AttendanceStatus {
  const attendedMinutes = Math.max(0, Math.floor((input.checkedOutAt.getTime() - input.checkedInAt.getTime()) / 60_000));
  if (attendedMinutes < input.minimumRequiredMinutes) return "Incomplete";
  const lateAt = input.sessionStartsAt.getTime() + input.lateThresholdMinutes * 60_000;
  return input.checkedInAt.getTime() > lateAt ? "Late" : "Present";
}

/**
 * Courses New Wave delivers itself carry an extra completion step: the trainee
 * must either finish the feedback form or upload the required screenshot before
 * a certificate may be printed. Endorsed partner courses are not gated this way.
 */
export type CompletionRequirement = {
  isNewWaveCourse: boolean;
  feedbackFormCompleted: boolean;
  completionProofUploaded: boolean;
};

export function isCompletionRequirementMet(requirement: CompletionRequirement): boolean {
  if (!requirement.isNewWaveCourse) return true;
  return requirement.feedbackFormCompleted || requirement.completionProofUploaded;
}

export function isCertificateEligible(input: {
  attendance: readonly AttendanceStatus[];
  instructorSubmitted: boolean;
  operationsVerified: boolean;
  templateActive: boolean;
  certificateNumberAvailable: boolean;
  legalNameConfirmed: boolean;
  /** Omitted for records created before the completion step existed. */
  completion?: CompletionRequirement;
}): boolean {
  const complete = input.attendance.length > 0 && input.attendance.every((status) => ["Present", "Late", "Make-Up Completed"].includes(status));
  const completionMet = input.completion ? isCompletionRequirementMet(input.completion) : true;
  return complete && input.instructorSubmitted && input.operationsVerified && input.templateActive && input.certificateNumberAvailable && input.legalNameConfirmed && completionMet;
}

export function generateReference(prefix: string, sequence: number, year = new Date().getFullYear()) {
  if (!/^[A-Z]{2,5}$/.test(prefix) || sequence < 1) throw new Error("Invalid reference input.");
  return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
}
