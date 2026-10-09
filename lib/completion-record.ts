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
export type CompletionTrainee = { enrollmentId: string; name: string; birthdate: string | null; placeOfBirth: string | null; rank: string | null };

export const PASS_MARK = 75;
export const SHEET_LINES = 24;

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
