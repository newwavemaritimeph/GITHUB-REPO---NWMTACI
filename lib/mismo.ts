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
  /** Encoded under another batch or start date: the tick no longer counts, and this names what it was under. */
  movedFrom?: string | null;
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
/** CSV of the rows on screen, in their order. */
export function mismoRowsCsv(rows: MismoRow[]) {
  return [CSV_HEAD, ...rows.map(({ b, t }) => csvRow(t, b))].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
/** One trainee, tab separated, for pasting. */
export const mismoCopyText = (t: MismoTrainee, b: MismoBatch) => csvRow(t, b).join("\t");

/** For Encoding looks this far back, so nothing is missed, and this far ahead, for upcoming batches (owner, 5 Nov 2026). */
export const MISMO_BACK_DAYS = 180, MISMO_AHEAD_DAYS = 180;

export type MismoRow = { b: MismoBatch; t: MismoTrainee };
/** The officer's to-do list: fully paid or on Company Charge, and not yet encoded. */
export const mismoWork = (batches: MismoBatch[]) => batches.map((b) => ({ ...b, trainees: b.trainees.filter((t) => mismoListed(t) && !t.entryAt) })).filter((b) => b.trainees.length);

/** What a tick is worth once the trainee has moved: the old batch, or the old start date when the same batch moved. Null when it still holds. */
export function entryMovedFrom(entry: { batchNumber?: string | null; classStart?: string | null }, current: { batchNumber: string; startsOn: string }) {
  if (!entry.batchNumber) return null;
  if (entry.batchNumber !== current.batchNumber) return entry.batchNumber;
  if (!entry.classStart || entry.classStart === current.startsOn) return null;
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${entry.classStart}T00:00:00Z`));
}

/** Which encoded trainees a voided payment takes off MISMO: those who now owe. Company Charge stays, and so does a trainee whose other payments still cover the fee. */
export function ticksToClear(enrollments: { id: string; selling_price_centavos: number; company_charge_agency_id?: string | null }[], charges: { enrollment_id: string; amount_centavos: number; event_type: string }[], allocations: { enrollment_id: string; amount_centavos: number; valid: boolean }[]) {
  return enrollments.filter((e) => {
    if (e.company_charge_agency_id) return false;
    const due = charges.filter((c) => c.enrollment_id === e.id).reduce((n, c) => n + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos), Number(e.selling_price_centavos ?? 0));
    const paid = allocations.filter((a) => a.enrollment_id === e.id && a.valid).reduce((n, a) => n + Number(a.amount_centavos), 0);
    return due - paid > 0;
  }).map((e) => e.id);
}

/** A trainee a void took off MISMO, shown until the officer has corrected MARINA (owner, 5 Nov 2026). */
export type MismoRemoved = { id: string; enrollmentId: string; name: string; srn: string | null; code: string | null; batchNumber: string | null; classStart: string | null; reason: string; at: string };

/** A trainee already encoded, for the Encoded tab. */
export type MismoEntry = { enrollmentId: string; lastName: string; firstName: string; middleName: string | null; srn: string | null; batchNumber: string; code: string; startsOn: string; endsOn: string; doneAt: string; by: string; cancelled: boolean };

export const MISMO_WHENS = ["All Dates", "Past Classes", "Today", "Upcoming"] as const;
export type MismoWhen = (typeof MISMO_WHENS)[number];
/** A class by today's date. A class in session counts as Today. */
export const whenOf = (startsOn: string, endsOn: string, today: string): Exclude<MismoWhen, "All Dates"> => (endsOn < today ? "Past Classes" : startsOn > today ? "Upcoming" : "Today");

export type MismoSort = "date" | "batch" | "course" | "name" | "at";
export type MismoFilter = { q: string; course: string; batch: string; when: MismoWhen };
export const NO_FILTER: MismoFilter = { q: "", course: "", batch: "", when: "All Dates" };
/** What the tool bar works on. `at` is the time the Sort's last choice uses: paid on, or encoded on. */
export type MismoLine = { name: string; srn: string; code: string; batchNumber: string; startsOn: string; endsOn: string; at: string };
const fullName = (x: { lastName: string; firstName: string; middleName: string | null }) => `${x.lastName}, ${x.firstName}${x.middleName ? ` ${x.middleName}` : ""}`;
export const lineOfRow = ({ b, t }: MismoRow): MismoLine => ({ name: fullName(t), srn: t.srn ?? "", code: b.courseCode, batchNumber: b.batchNumber, startsOn: b.startsOn, endsOn: b.endsOn, at: t.lastPaidAt ?? "" });
export const lineOfEntry = (e: MismoEntry): MismoLine => ({ name: fullName(e), srn: e.srn ?? "", code: e.code, batchNumber: e.batchNumber, startsOn: e.startsOn, endsOn: e.endsOn, at: e.doneAt });

export const mismoSearched = (l: MismoLine, q: string) => { const term = q.trim().toLowerCase(); return !term || `${l.name} ${l.srn} ${l.code} ${l.batchNumber}`.toLowerCase().includes(term); };
/** The rows the search, course, batch and class date let through. `ignoreWhen` gives the counts inside the Class Date dropdown. */
export const mismoFiltered = <T,>(rows: T[], lineOf: (row: T) => MismoLine, f: MismoFilter, today: string, ignoreWhen = false) => rows.filter((row) => {
  const l = lineOf(row);
  return mismoSearched(l, f.q) && (!f.course || l.code === f.course) && (!f.batch || l.batchNumber === f.batch) && (ignoreWhen || f.when === "All Dates" || whenOf(l.startsOn, l.endsOn, today) === f.when);
});
/** Class date runs oldest first: missed classes, then today, then upcoming. Ties go by batch, then name. */
export function mismoSorted<T>(rows: T[], sort: MismoSort, lineOf: (row: T) => MismoLine) {
  const main = (a: MismoLine, z: MismoLine) => (sort === "date" ? a.startsOn.localeCompare(z.startsOn) : sort === "batch" ? a.batchNumber.localeCompare(z.batchNumber) : sort === "course" ? a.code.localeCompare(z.code) : sort === "name" ? a.name.localeCompare(z.name) : z.at.localeCompare(a.at));
  return rows.map((row) => ({ row, l: lineOf(row) })).sort((a, z) => main(a.l, z.l) || a.l.batchNumber.localeCompare(z.l.batchNumber) || a.l.name.localeCompare(z.l.name)).map((x) => x.row);
}
