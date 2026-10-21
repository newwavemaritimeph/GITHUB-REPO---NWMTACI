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

export type Accreditation = { instructor_id: string; course_id: string; accreditation_number?: string | null; valid_until?: string | null; role?: string | null };
/** What a person does in a course (owner, 21 Oct 2026); rows saved before the roles count as Instructor. */
export type Duty = "Instructor" | "Assessor";
export const ROLES = ["Instructor", "Assessor", "Instructor and Assessor"] as const;
export const handles = (role: string | null | undefined, duty: Duty) => role === "Instructor and Assessor" || (role ?? "Instructor") === duty;

/** "ok" | "expired" | "none" for a person teaching (or assessing) a course on a day (YYYY-MM-DD). */
export function accreditationFor(accreditations: Accreditation[], instructorId: string, courseId: string, onDay: string, duty: Duty = "Instructor"): "ok" | "expired" | "none" {
  const a = accreditations.find((x) => x.instructor_id === instructorId && x.course_id === courseId && handles(x.role, duty));
  if (!a) return "none";
  return a.valid_until && a.valid_until < onDay ? "expired" : "ok";
}

/** Planning warnings for one batch. */
export function planIssues(input: { students: number; startsOn: string; courseId: string; classroom?: { capacity: number } | null; instructorId?: string | null; assessorId?: string | null; needsAssessor?: boolean; accreditations: Accreditation[] }): string[] {
  const out: string[] = [];
  if (!input.classroom) out.push("No classroom");
  else if (input.students > input.classroom.capacity) out.push(`Students exceed room capacity (${input.classroom.capacity})`);
  if (!input.instructorId) out.push("No instructor");
  else {
    const state = accreditationFor(input.accreditations, input.instructorId, input.courseId, input.startsOn);
    if (state === "none") out.push("Instructor not accredited for this course");
    if (state === "expired") out.push("Accreditation expired");
  }
  if (!input.assessorId) { if (input.needsAssessor) out.push("No assessor"); }
  else {
    const state = accreditationFor(input.accreditations, input.assessorId, input.courseId, input.startsOn, "Assessor");
    if (state === "none") out.push("Assessor not accredited for this course");
    if (state === "expired") out.push("Assessor accreditation expired");
    const both = input.accreditations.find((x) => x.instructor_id === input.assessorId && x.course_id === input.courseId)?.role === "Instructor and Assessor";
    if (input.assessorId === input.instructorId && !both) out.push("Same person as instructor and assessor");
  }
  return out;
}

/** Whether two inclusive date ranges (YYYY-MM-DD) share a day. */
export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;

export type PlanBatch = { id: string; batchNumber: string; courseId: string; courseCode: string; courseName: string; startsOn: string; endsOn: string; students: number; capacity: number; classroomId: string | null; instructorId: string | null; assessorId?: string | null; needsAssessor?: boolean };
export type PlanRoom = { id: string; name: string; capacity: number };
export type PlanInstructor = { id: string; complete_name: string };
export type PlanRow = PlanBatch & { room: PlanRoom | null; instructor: PlanInstructor | null; assessor: PlanInstructor | null; issues: string[]; roomClash: PlanBatch | null; instructorClash: PlanBatch | null };

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
    const assessor = b.assessorId ? insById.get(b.assessorId) ?? null : null;
    const issues = planIssues({ students: b.students, startsOn: b.startsOn, courseId: b.courseId, classroom: room, instructorId: b.instructorId, assessorId: b.assessorId, needsAssessor: b.needsAssessor, accreditations });
    const others = batches.filter((o) => o.id !== b.id && rangesOverlap(o.startsOn, o.endsOn, b.startsOn, b.endsOn));
    const roomClash = b.classroomId ? others.find((o) => o.classroomId === b.classroomId) ?? null : null;
    const instructorClash = b.instructorId ? others.find((o) => o.instructorId === b.instructorId) ?? null : null;
    if (roomClash) issues.push(`${room?.name ?? "Room"} also booked for ${roomClash.courseCode} ${roomClash.batchNumber}`);
    if (instructorClash) issues.push(`${instructor?.complete_name ?? "Instructor"} also teaching ${instructorClash.courseCode} ${instructorClash.batchNumber}`);
    const assessorClash = b.assessorId ? others.find((o) => o.assessorId === b.assessorId || o.instructorId === b.assessorId) ?? null : null;
    if (assessorClash) issues.push(`${assessor?.complete_name ?? "Assessor"} also booked for ${assessorClash.courseCode} ${assessorClash.batchNumber}`);
    return { ...b, room, instructor, assessor, issues, roomClash, instructorClash };
  });
}

/** Problems that block the class (shown red) versus things still to fill in (orange). */
export const isBlocking = (issue: string) => /also booked|also teaching|exceed|not accredited|expired|same person/i.test(issue);

/** Batches the trainees of `b` can all move to: same course, open, not started, enough seats. */
export function moveTargets<T extends { id: string; course_id: string; status: string; starts_on: string; capacity: number; confirmed_count: number }>(b: { id: string; course_id: string }, trainees: number, batches: T[], today: string) {
  return batches.filter((o) => o.id !== b.id && o.course_id === b.course_id && ["Open", "Full"].includes(o.status) && o.starts_on > today)
    .map((o) => ({ batch: o, left: Math.max(0, Number(o.capacity) - Number(o.confirmed_count)) }))
    .map((t) => ({ ...t, fits: t.left >= trainees }));
}
