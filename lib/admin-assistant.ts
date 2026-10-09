/**
 * Admin Assistant rules (owner, 9 Oct 2026), shared by the portal screens and tests.
 */

export type RequisitionLine = { description: string; quantity: number; unitCentavos: number };
export type RequisitionState = "For Approval" | "Approved" | "Released" | "Rejected" | "Voided";

export const requisitionTotal = (lines: RequisitionLine[]) => lines.reduce((sum, l) => sum + Math.max(0, l.quantity) * Math.max(0, l.unitCentavos), 0);

/** Approved requisitions become expense vouchers; once the Cashier releases it (Paid), the requisition reads Released. */
export function requisitionState(r: { status: string; expense_status?: string | null }): RequisitionState {
  if (r.status === "Rejected") return "Rejected";
  // Its voucher voided by the Admin (202610090038).
  if (r.status === "Approved" && r.expense_status === "Void") return "Voided";
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

/** Whether two inclusive date ranges (YYYY-MM-DD) share a day. */
export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;

export type PlanBatch = { id: string; batchNumber: string; courseId: string; courseCode: string; courseName: string; startsOn: string; endsOn: string; students: number; capacity: number; classroomId: string | null; instructorId: string | null };
export type PlanRoom = { id: string; name: string; capacity: number };
export type PlanInstructor = { id: string; complete_name: string };
export type PlanRow = PlanBatch & { room: PlanRoom | null; instructor: PlanInstructor | null; issues: string[]; roomClash: PlanBatch | null; instructorClash: PlanBatch | null };

/**
 * Resource plan rows (owner, 9 Oct 2026, design 3): each batch with its room,
 * instructor and every problem — missing room or instructor, too many students
 * for the room, instructor not accredited or expired, and a room or instructor
 * booked for another batch on the same days. Shared by the screen and the PDF.
 */
export function planRows(batches: PlanBatch[], rooms: PlanRoom[], instructors: PlanInstructor[], accreditations: Accreditation[]): PlanRow[] {
  const roomById = new Map(rooms.map((r) => [r.id, r])), insById = new Map(instructors.map((i) => [i.id, i]));
  return batches.map((b) => {
    const room = b.classroomId ? roomById.get(b.classroomId) ?? null : null;
    const instructor = b.instructorId ? insById.get(b.instructorId) ?? null : null;
    const issues = planIssues({ students: b.students, startsOn: b.startsOn, courseId: b.courseId, classroom: room, instructorId: b.instructorId, accreditations });
    const others = batches.filter((o) => o.id !== b.id && rangesOverlap(o.startsOn, o.endsOn, b.startsOn, b.endsOn));
    const roomClash = b.classroomId ? others.find((o) => o.classroomId === b.classroomId) ?? null : null;
    const instructorClash = b.instructorId ? others.find((o) => o.instructorId === b.instructorId) ?? null : null;
    if (roomClash) issues.push(`${room?.name ?? "Room"} also booked for ${roomClash.courseCode} ${roomClash.batchNumber}`);
    if (instructorClash) issues.push(`${instructor?.complete_name ?? "Instructor"} also teaching ${instructorClash.courseCode} ${instructorClash.batchNumber}`);
    return { ...b, room, instructor, issues, roomClash, instructorClash };
  });
}

/** Problems that block the class (shown red) versus things still to fill in (orange). */
export const isBlocking = (issue: string) => /also booked|also teaching|exceed|not accredited|expired/i.test(issue);
