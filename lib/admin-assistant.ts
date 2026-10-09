/**
 * Admin Assistant rules (owner, 9 Oct 2026), shared by the portal screens and tests.
 */

export type RequisitionLine = { description: string; quantity: number; unitCentavos: number };
export type RequisitionState = "For Approval" | "Approved" | "Released" | "Rejected";

export const requisitionTotal = (lines: RequisitionLine[]) => lines.reduce((sum, l) => sum + Math.max(0, l.quantity) * Math.max(0, l.unitCentavos), 0);

/** Approved requisitions become expense vouchers; once the Cashier releases it (Paid), the requisition reads Released. */
export function requisitionState(r: { status: string; expense_status?: string | null }): RequisitionState {
  if (r.status === "Rejected") return "Rejected";
  if (r.status === "Approved") return r.expense_status === "Paid" ? "Released" : "Approved";
  return "For Approval";
}

export type Accreditation = { instructor_id: string; course_id: string; accreditation_number?: string | null; valid_until?: string | null };

/** "ok" | "expired" | "none" for an instructor teaching a course on a day (YYYY-MM-DD). */
export function accreditationFor(accreditations: Accreditation[], instructorId: string, courseId: string, onDay: string): "ok" | "expired" | "none" {
  const a = accreditations.find((x) => x.instructor_id === instructorId && x.course_id === courseId);
  if (!a) return "none";
  return a.valid_until && a.valid_until < onDay ? "expired" : "ok";
}

/** Planning warnings for one batch. */
export function planIssues(input: { students: number; startsOn: string; courseId: string; classroom?: { capacity: number } | null; instructorId?: string | null; accreditations: Accreditation[] }): string[] {
  const out: string[] = [];
  if (!input.classroom) out.push("No classroom");
  else if (input.students > input.classroom.capacity) out.push(`Students exceed room capacity (${input.classroom.capacity})`);
  if (!input.instructorId) out.push("No instructor");
  else {
    const state = accreditationFor(input.accreditations, input.instructorId, input.courseId, input.startsOn);
    if (state === "none") out.push("Instructor not accredited for this course");
    if (state === "expired") out.push("Accreditation expired");
  }
  return out;
}
