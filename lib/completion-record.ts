/**
 * Training Completion and Record of Assessment Report rules (owner, 9 Oct 2026),
 * shared by the MISMO screen, the print page, the API and tests.
 * Written: Pass at 75% and above. Practical: every assessment task performed.
 * Competent [C] when both; Not yet competent [NYC] otherwise.
 */

export type AssessmentTask = { title: string; criteria: string };
/** A task box: true = Performed (✓), false = Not performed (X), null = not checked yet. */
export type TraineeResult = { pct: number | null; ticks: (boolean | null)[]; cert: string };
export type CompletionFields = {
  classNo: string; resitClassNo: string; resitDuration: string; writtenPlace: string; practicalPlace: string;
  assessor: string; coaValidity: string; assessedOn: string; director: string; directorOn: string;
};
export type CompletionTrainee = { enrollmentId: string; name: string; birthdate: string | null; placeOfBirth: string | null; rank: string | null; srn?: string | null };

export const PASS_MARK = 75;
export const SHEET_LINES = 24;
/** Crisis has 10 assessment tasks (owner's Assessment Performance Sheet, 9 Nov 2026). */
export const MAX_TASKS = 12;

/** Neighbouring tasks with the same title print under one heading: Safety's "Communication with passengers during emergency" has three criteria. */
export function taskGroups(tasks: AssessmentTask[]): { title: string; from: number; to: number }[] {
  const out: { title: string; from: number; to: number }[] = [];
  tasks.forEach((t, i) => { const last = out[out.length - 1]; if (last && last.title === t.title) last.to = i; else out.push({ title: t.title, from: i, to: i }); });
  return out;
}
/** One task on the Assessment Performance Sheet: ✓ when every criterion is performed, X when any is not, null while unchecked. */
export function groupTick(r: TraineeResult, g: { from: number; to: number }): boolean | null {
  const v = r.ticks.slice(g.from, g.to + 1);
  if (v.some((x) => x === false)) return false;
  return v.length > 0 && v.every((x) => x === true) ? true : null;
}

/**
 * New Wave's own forms per STCW course (owner, 9 Nov 2026): TCROA paper, the Assessment Performance Sheet's written
 * column and task labels, the Exercise Performance Sheet's EP columns (their Word grid in twips: number, name, each EP,
 * signature, remarks), and whether the Attendance Sheet puts every day on one sheet (CCMD) or prints one per day.
 */
export type CourseForm = { paper: "A4" | "Legal"; writtenOnSheet: boolean; apCount: number; apLabel: (i: number) => string; eps: { prefix: string; widths: number[] }; attendanceAllDays: boolean };
const EPS_4 = [562, 4253, 1134, 1134, 1417, 1417, 2127, 2977];
export function courseForm(code: string): CourseForm {
  const ap = (i: number) => `AP ${i + 1}`;
  const base = { attendanceAllDays: false, eps: { prefix: "EP ", widths: EPS_4 } };
  switch (code.toUpperCase()) {
    case "UBT-PSSR": return { ...base, paper: "A4", writtenOnSheet: false, apCount: 4, apLabel: (i) => `AP A6.${i + 1}`, eps: { prefix: "EP A6.", widths: EPS_4 } };
    case "STPPDSPPS": return { ...base, paper: "Legal", writtenOnSheet: true, apCount: 2, apLabel: ap, eps: { prefix: "EP A7.", widths: EPS_4 } };
    case "PSCMT": return { ...base, paper: "Legal", writtenOnSheet: true, apCount: 7, apLabel: ap, eps: { prefix: "EP A8.", widths: [442, 4656, 699, 699, 699, 699, 699, 691, 681, 681, 681, 1814, 2320] } };
    case "PSCMHBT": return { ...base, paper: "Legal", writtenOnSheet: true, apCount: 10, apLabel: ap, eps: { prefix: "EP A4.", widths: [367, 4595, 513, 512, 512, 512, 525, 512, 512, 512, 512, 590, 590, 590, 590, 604, 590, 1322, 1375] } };
    case "CCMD": return { ...base, paper: "Legal", writtenOnSheet: false, apCount: 4, apLabel: ap, eps: { prefix: "EP ", widths: [367, 5047, 722, 720, 720, 720, 2338, 2250] }, attendanceAllDays: true };
    default: return { ...base, paper: "A4", writtenOnSheet: true, apCount: 4, apLabel: ap };
  }
}
/** Page size in points, landscape. */
export const paperSize = (paper: CourseForm["paper"]): [number, number] => (paper === "Legal" ? [1008, 612] : [841.89, 595.28]);

export const remarkOf = (pct: number | null) => (pct === null ? "" : pct >= PASS_MARK ? "P" : "F");
export const practicalDone = (r: TraineeResult, taskCount: number) => taskCount > 0 && r.ticks.length >= taskCount && r.ticks.slice(0, taskCount).every((t) => t !== null);
export const practicalOk = (r: TraineeResult, taskCount: number) => practicalDone(r, taskCount) && r.ticks.slice(0, taskCount).every((t) => t === true);
/** "C", "NYC" or "" while the written % or a task box is still empty. */
export function resultOf(r: TraineeResult, taskCount: number): "C" | "NYC" | "" {
  if (r.pct === null || !practicalDone(r, taskCount)) return "";
  return r.pct >= PASS_MARK && practicalOk(r, taskCount) ? "C" : "NYC";
}

export const emptyResult = (taskCount: number): TraineeResult => ({ pct: null, ticks: Array.from({ length: taskCount }, () => null), cert: "" });
/** A stored result fitted to the course's current number of tasks. */
export function fitResult(r: Partial<TraineeResult> | null | undefined, taskCount: number): TraineeResult {
  const ticks = Array.from({ length: taskCount }, (_, i) => (r?.ticks?.[i] === true ? true : r?.ticks?.[i] === false ? false : null));
  const pct = typeof r?.pct === "number" && Number.isFinite(r.pct) ? Math.max(0, Math.min(100, Math.round(r.pct))) : null;
  return { pct, ticks, cert: String(r?.cert ?? "").trim().slice(0, 60) };
}

/** What is still missing before the record can be printed (empty = ready). */
export function completionProblems(f: CompletionFields, trainees: CompletionTrainee[], results: Record<string, TraineeResult>, taskCount: number): string[] {
  const out: string[] = [];
  const rs = trainees.map((t) => results[t.enrollmentId] ?? emptyResult(taskCount));
  if (!trainees.length) out.push("No enrolled trainees in this batch");
  if (!taskCount) out.push("Assessment tasks for this course");
  if (!f.classNo.trim()) out.push("Class No.");
  const noPct = rs.filter((r) => r.pct === null).length;
  if (noPct) out.push(`Written % for ${noPct} trainee${noPct === 1 ? "" : "s"}`);
  if (taskCount && rs.some((r) => !practicalDone(r, taskCount))) out.push("Practical checklist");
  const noCert = rs.filter((r) => resultOf(r, taskCount) === "C" && !r.cert.trim()).length;
  if (noCert) out.push(`MTI certificate number for ${noCert} competent trainee${noCert === 1 ? "" : "s"}`);
  if (!f.assessor.trim() || !f.assessedOn) out.push("Assessor and date");
  if (!f.director.trim() || !f.directorOn) out.push("Training Director and date");
  return out;
}

/** Consecutive numbers from the first one typed, keeping its zero padding: MTI-…-002382 → …-002383. Null when it does not end in digits. */
export function numberSeries(first: string, count: number): string[] | null {
  const m = first.trim().match(/^(.*?)(\d+)$/);
  if (!m) return null;
  return Array.from({ length: count }, (_, i) => `${m[1]}${String(Number(m[2]) + i).padStart(m[2].length, "0")}`);
}

const long = (d: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
/** "October 08, 2026" or "October 06, 2026 – October 07, 2026". */
export const durationText = (start: string, end: string) => (start === end ? long(start) : `${long(start)} – ${long(end)}`);
/** mm/dd/yyyy, as on the form. */
export const formDate = (iso: string | null | undefined) => { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-"); return `${m}/${d}/${y}`; };
