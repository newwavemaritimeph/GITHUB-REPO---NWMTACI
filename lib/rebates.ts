/**
 * Partner rebate settings (owner, 9 Oct 2026; Configuration › Rebates per Agency,
 * Design 3). In-House courses take a percentage of the actual training fee —
 * 10%, 20%, 30% or 50%, or another typed by Accounting or the Admin. The five
 * STCW courses take a fixed peso amount per partner, encoded by hand; a course
 * left blank gives no rebate.
 */

export const REBATE_PRESETS = [10, 20, 30, 50] as const;

/** The five STCW courses with a fixed rebate, with the short names staff use. */
export const STCW_REBATE_COURSES: readonly (readonly [code: string, label: string])[] = [
  ["UBT-PSSR", "BT-PSSR"], ["STPPDSPPS", "Safety"], ["PSCMT", "Crowd"], ["PSCMHBT", "Crisis"], ["CCMD", "CCM Domestic"],
];

export const isStcwRebateCourse = (code: string | null | undefined) => STCW_REBATE_COURSES.some(([c]) => c === String(code ?? "").trim().toUpperCase());

export type RebateRow = { name: string; percent: number | null; stcw: { courseId: string; label: string; feeCentavos: number; cents: number }[] };

/** The first problem with a set of edited rows, or null when they can be saved. */
export function rebateRowsProblem(rows: RebateRow[]): string | null {
  for (const r of rows) {
    if (r.percent !== null && !(Number.isFinite(r.percent) && r.percent > 0 && r.percent <= 100)) return `Enter a percentage from 1 to 100 for ${r.name}.`;
    for (const s of r.stcw) {
      if (!Number.isFinite(s.cents) || s.cents < 0) return `Enter a valid amount for ${r.name} · ${s.label}.`;
      if (s.feeCentavos > 0 && s.cents > s.feeCentavos) return `The ${s.label} rebate for ${r.name} cannot be more than its training fee.`;
    }
  }
  return null;
}
