/**
 * MARINA MISMO list (owner, 8 Oct 2026). For the five STCW courses, trainees in
 * class on a given day who still owe at 11:00 AM go on the Compliance Officer's
 * dashboard (printed for the instructor); only trainees settled by 4:00 PM go on
 * the final list submitted to the MARINA MISMO Portal. Since 5 Nov 2026 a trainee not
 * yet paid is off the officer's lists unless on Company Charge; only the instructor's
 * 11:00 AM printout still names them.
 */
export const MISMO_COURSE_CODES = ["UBT-PSSR", "STPPDSPPS", "PSCMT", "PSCMHBT", "CCMD"];

export type MismoTrainee = {
  enrollmentId: string; lastName: string; firstName: string; middleName: string | null; birthdate: string | null; srn: string | null; rank: string | null;
  dueCentavos: number; paidBy11: number; paidBy16: number; paidNow: number;
  /** Company Charge (29 Oct 2026): the partner pays on its Billing Statement, so the trainee counts as settled. */
  companyCharge?: boolean;
  /** When the officer ticked Encoded, and the last payment (5 Nov 2026). */
  entryAt?: string | null; lastPaidAt?: string | null;
};
export type MismoBatch = { id: string; batchNumber: string; courseName: string; courseCode: string; startsOn: string; endsOn: string; room: string | null; instructor: string | null; trainees: MismoTrainee[]; submittedAt: string | null; submittedCount: number | null;
  /** The day its 11:00 AM and 4:00 PM cut-offs are taken: its first class day in the period. */
  cutDate?: string };
export type MismoDay = { date: string; to?: string; batches: MismoBatch[] };

/** Manila wall-clock instant on a date, e.g. ("2026-10-08", 11) → 2026-10-08T03:00:00Z. */
export const manilaInstant = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`).toISOString();

export const owesAt = (t: MismoTrainee, when: "11" | "16" | "now") => !t.companyCharge && t.dueCentavos - (when === "11" ? t.paidBy11 : when === "16" ? t.paidBy16 : t.paidNow) > 0;
export const balanceAt = (t: MismoTrainee, when: "11" | "16" | "now") => t.companyCharge ? 0 : Math.max(0, t.dueCentavos - (when === "11" ? t.paidBy11 : when === "16" ? t.paidBy16 : t.paidNow));

/** Trainees still owing at 11:00 AM (the instructor's list). */
export const unsettledAt11 = (b: MismoBatch) => b.trainees.filter((t) => owesAt(t, "11"));
/** The final list for MARINA: settled by 4:00 PM. */
export const finalList = (b: MismoBatch) => b.trainees.filter((t) => !owesAt(t, "16"));
/** On the officer's lists: paid, or billed to the partner on Company Charge (owner, 5 Nov 2026). */
export const mismoListed = (t: MismoTrainee) => !owesAt(t, "now");

/** A batch's first class day in the period; for one day, that day. */
export const cutDateOf = (startsOn: string, from: string) => (startsOn > from ? startsOn : from);

/** Where a trainee stands for the officer's list (owner, 5 Nov 2026): only paid trainees with complete details can be input. */
export type MismoState = "For Encoding" | "Encoded" | "Unpaid" | "For Completion";
export const mismoMissing = (t: MismoTrainee) => [!t.srn && "SRN", !t.birthdate && "Birth Date"].filter(Boolean) as string[];
export const mismoState = (t: MismoTrainee): MismoState => (owesAt(t, "now") ? "Unpaid" : t.entryAt ? "Encoded" : mismoMissing(t).length ? "For Completion" : "For Encoding");
/** Settled, but after the 4:00 PM cut-off: off the final list, still to be input. */
export const paidLate = (t: MismoTrainee) => owesAt(t, "16") && !owesAt(t, "now");

const csvCell = (v: string | null | undefined) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const CSV_HEAD = ["Last name", "First name", "Middle name", "Birth date", "SRN", "Rank", "Course", "Course code", "Batch", "Training start", "Training end"];
const csvRow = (t: MismoTrainee, b: MismoBatch) => [t.lastName, t.firstName, t.middleName ?? "", t.birthdate ?? "", t.srn ?? "", t.rank ?? "", b.courseName, b.courseCode, b.batchNumber, b.startsOn, b.endsOn];
/** CSV for the MARINA MISMO Portal: one row per settled trainee. */
export function mismoCsv(b: MismoBatch) {
  return [CSV_HEAD, ...finalList(b).map((t) => csvRow(t, b))].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
/** CSV of every trainee paid so far, across the batches in the period. */
export function mismoPaidCsv(batches: MismoBatch[]) {
  return [CSV_HEAD, ...batches.flatMap((b) => b.trainees.filter((t) => !owesAt(t, "now")).map((t) => csvRow(t, b)))].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
/** One trainee, tab separated, for pasting. */
export const mismoCopyText = (t: MismoTrainee, b: MismoBatch) => csvRow(t, b).join("\t");

/** Encoded ticks counted per batch and Manila day, for Submissions. */
export type EntryRow = { doneAt: string; by: string; batchId: string; batchNumber: string; code: string };
export type EntryDay = { batchId: string; day: string; batchNumber: string; code: string; count: number; lastAt: string; by: string };
export function entryDays(rows: EntryRow[]): EntryDay[] {
  const days = new Map<string, EntryDay>();
  for (const r of rows) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(r.doneAt)), key = `${r.batchId}|${day}`, cur = days.get(key);
    if (!cur) days.set(key, { batchId: r.batchId, day, batchNumber: r.batchNumber, code: r.code, count: 1, lastAt: r.doneAt, by: r.by });
    else { cur.count += 1; if (r.doneAt > cur.lastAt) { cur.lastAt = r.doneAt; cur.by = r.by; } }
  }
  return [...days.values()];
}
