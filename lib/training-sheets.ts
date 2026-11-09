import type { FormCode } from "@/lib/document-controls";

/**
 * Training Reports sheets (owner, 9 Nov 2026; design/training-sheets-prototype.html): the Attendance Sheet (one per
 * training day), the Exercise Performance Sheet and the Assessment Performance Sheet, printed per batch beside the TCROA.
 */
export const SHEETS = ["attendance", "exercise", "assessment"] as const;
export type SheetKind = (typeof SHEETS)[number];
export const isSheetKind = (v: string | null): v is SheetKind => !!v && (SHEETS as readonly string[]).includes(v);
export const SHEET_TITLES: Record<SheetKind, string> = { attendance: "Attendance Sheet", exercise: "Exercise Performance Sheet", assessment: "Assessment Performance Sheet" };
export const SHEET_FORMS: Record<SheetKind, FormCode> = { attendance: "attendance_sheet", exercise: "exercise_sheet", assessment: "assessment_sheet" };

/** A batch's training days: every day from start to end, Sundays left out (no class on Sunday). At most 31 days. */
export function trainingDays(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  const d = new Date(`${startsOn}T00:00:00Z`), end = new Date(`${(endsOn || startsOn)}T00:00:00Z`);
  while (d <= end && out.length < 31) {
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out.length ? out : [startsOn];
}

/** The PDF of one sheet; `day` is a training day or "all" (Attendance Sheet only; CCMD always prints every day on one sheet). */
export const sheetUrl = (batchId: string, kind: SheetKind, day?: string) => `/api/documents/training-sheet/${batchId}?sheet=${kind}${day ? `&day=${day}` : ""}`;
