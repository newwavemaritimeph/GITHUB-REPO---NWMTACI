/**
 * MARINA MISMO list (owner, 8 Oct 2026). For the five STCW courses, trainees in
 * class on a given day who still owe at 11:00 AM go on the Compliance Officer's
 * dashboard (printed for the instructor); only trainees settled by 4:00 PM go on
 * the final list submitted to the MARINA MISMO Portal.
 */
export const MISMO_COURSE_CODES = ["UBT-PSSR", "STPPDSPPS", "PSCMT", "PSCMHBT", "CCMD"];

export type MismoTrainee = {
  enrollmentId: string; lastName: string; firstName: string; middleName: string | null; birthdate: string | null; srn: string | null; rank: string | null;
  dueCentavos: number; paidBy11: number; paidBy16: number; paidNow: number;
};
export type MismoBatch = { id: string; batchNumber: string; courseName: string; courseCode: string; startsOn: string; endsOn: string; room: string | null; instructor: string | null; trainees: MismoTrainee[]; submittedAt: string | null; submittedCount: number | null };
export type MismoDay = { date: string; batches: MismoBatch[] };

/** Manila wall-clock instant on a date, e.g. ("2026-10-08", 11) → 2026-10-08T03:00:00Z. */
export const manilaInstant = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`).toISOString();

export const owesAt = (t: MismoTrainee, when: "11" | "16" | "now") => t.dueCentavos - (when === "11" ? t.paidBy11 : when === "16" ? t.paidBy16 : t.paidNow) > 0;
export const balanceAt = (t: MismoTrainee, when: "11" | "16" | "now") => Math.max(0, t.dueCentavos - (when === "11" ? t.paidBy11 : when === "16" ? t.paidBy16 : t.paidNow));

/** Trainees still owing at 11:00 AM (the instructor's list). */
export const unsettledAt11 = (b: MismoBatch) => b.trainees.filter((t) => owesAt(t, "11"));
/** The final list for MARINA: settled by 4:00 PM. */
export const finalList = (b: MismoBatch) => b.trainees.filter((t) => !owesAt(t, "16"));
/** Left off the MARINA list: still owing at 4:00 PM. */
export const leftOff = (b: MismoBatch) => b.trainees.filter((t) => owesAt(t, "16"));

const csvCell = (v: string | null | undefined) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV for the MARINA MISMO Portal: one row per settled trainee. */
export function mismoCsv(b: MismoBatch) {
  const head = ["Last name", "First name", "Middle name", "Birth date", "SRN", "Rank", "Course", "Course code", "Batch", "Training start", "Training end"];
  const rows = finalList(b).map((t) => [t.lastName, t.firstName, t.middleName ?? "", t.birthdate ?? "", t.srn ?? "", t.rank ?? "", b.courseName, b.courseCode, b.batchNumber, b.startsOn, b.endsOn]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
