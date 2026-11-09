import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MismoCell, mismoInWindow } from "@/components/portal/batch-window";
import { TrainingReports, batchStats, courseGroups } from "@/components/portal/mismo-home";
import type { MismoBatch, MismoTrainee } from "@/lib/mismo";
import { addDays, manilaToday } from "@/lib/portal-format";

const t = (id: string, extra: Partial<MismoTrainee> = {}): MismoTrainee => ({ enrollmentId: id, lastName: id.toUpperCase(), firstName: "Juan", middleName: null, birthdate: "1990-01-01", srn: "SRN-1", rank: "AB", dueCentavos: 100, paidBy11: 100, paidBy16: 100, paidNow: 100, ...extra });
const owes = (id: string) => t(id, { paidBy11: 0, paidBy16: 0, paidNow: 0 });
const today = manilaToday();
const batch = (id: string, code: string, starts: string, ends: string, trainees: MismoTrainee[]): MismoBatch => ({ id, batchNumber: id, courseName: `${code} Course`, courseCode: code, startsOn: starts, endsOn: ends, room: null, instructor: null, trainees, submittedAt: null, submittedCount: null });
const cell = (x: MismoTrainee) => renderToStaticMarkup(createElement(MismoCell, { t: x, copied: false, busy: false, onCopy: () => undefined, onEncode: () => undefined, onUndo: () => undefined, onAdd: () => undefined }));

describe("Training Reports (owner, 9 Nov 2026)", () => {
  const inClass = batch("26-609-144", "UBT-PSSR", today, today, [t("paid"), t("done", { entryAt: `${today}T02:00:00Z` }), t("nosrn", { srn: null }), owes("owing")]);
  const next = batch("26-609-145", "UBT-PSSR", addDays(today, 3), addDays(today, 3), [t("abe")]);
  const later = batch("26-609-146", "UBT-PSSR", addDays(today, 10), addDays(today, 10), []);
  const pastLeft = batch("26-609-141", "UBT-PSSR", addDays(today, -6), addDays(today, -6), [t("late", { paidBy16: 0 })]);
  const pastDone = batch("26-609-140", "UBT-PSSR", addDays(today, -13), addDays(today, -13), [t("ok", { entryAt: "2026-11-01T02:00:00Z" })]);
  const crowd = batch("26-507-023", "PSCMT", addDays(today, 1), addDays(today, 2), [t("x")]);
  const all = [later, pastDone, crowd, inClass, pastLeft, next];

  it("counts a batch: paid of all, encoded of paid, still to encode, missing details", () => {
    expect(batchStats(inClass)).toEqual({ total: 4, listed: 3, encoded: 1, toEncode: 1, missing: 1 });
  });
  it("groups a course's batches: today, upcoming soonest first, then past with work left", () => {
    expect(courseGroups(all, "UBT-PSSR", today).map((g) => [g.label, g.batches.map((b) => b.id)])).toEqual([["Today", ["26-609-144"]], ["Upcoming", ["26-609-145", "26-609-146"]], ["Past · Work Left", ["26-609-141"]]]);
    expect(courseGroups(all, "UBT-PSSR", today, true).at(-1)).toMatchObject({ label: "Past", batches: [{ id: "26-609-141" }, { id: "26-609-140" }] });
    expect(courseGroups(all, "CCMD", today)).toEqual([]);
  });
  it("shows the five STCW course tabs with their counts, and the course's batches", () => {
    const html = renderToStaticMarkup(createElement(TrainingReports, { initial: { date: today, batches: all, now: "", removed: [] } }));
    expect(html).toContain("<h1>Training Reports</h1>");
    for (const code of ["UBT-PSSR", "STPPDSPPS", "PSCMT", "PSCMHBT", "CCMD"]) expect(html).toContain(`<b>${code}</b>`);
    expect(html).toContain("4 To Encode");
    expect(html).toContain("All Encoded");
    expect(html).toContain(">26-609-144</button>");
    expect(html).not.toContain(">26-609-140</button>");
    expect(html).toContain("Not Yet · 4:00 PM Today");
    expect(html).toMatch(/Final List PDF/);
  });
  it("gives each trainee one MARINA MISMO cell", () => {
    expect(cell(t("paid"))).toMatch(/>Copy<\/button>.*Encoded/);
    expect(cell(t("done", { entryAt: "2026-11-09T02:00:00Z" }))).toMatch(/Encoded · Nov 9.*>Undo</);
    expect(cell(t("nosrn", { srn: null }))).toMatch(/SRN.*Add Details/);
    expect(cell(owes("owing"))).toContain("Not Paid");
    expect(cell(t("late", { paidBy16: 0 }))).toContain("Paid Late");
    expect(cell(t("moved", { movedFrom: "26-609-140" }))).toContain("Moved · Was 26-609-140");
    expect(cell(t("billed", { companyCharge: true, paidNow: 0, paidBy16: 0, paidBy11: 0 }))).toContain(">Copy</button>");
  });
  it("shows the column in Schedules to the officer and the Admin, on STCW batches only", () => {
    expect(mismoInWindow("admin", "UBT-PSSR")).toBe(true);
    expect(mismoInWindow("mismo_officer", "CCMD")).toBe(true);
    expect(mismoInWindow("admin", "APA")).toBe(false);
    expect(mismoInWindow("admin_assistant", "UBT-PSSR")).toBe(false);
    expect(mismoInWindow(undefined, "UBT-PSSR")).toBe(false);
  });
});
