import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { readTemplateLines } from "@/lib/certificate-autolayout";
import { sheetUrl, trainingDays } from "@/lib/training-sheets";
import { courseForm, groupTick, paperSize, taskGroups, type AssessmentTask } from "@/lib/completion-record";
import { ccmdSchedule, createTrainingSheetPdf, formDay, scheduleText, type TrainingSheetInput } from "@/lib/print/training-sheets";
import { createCompletionRecordPdf } from "@/lib/print/completion-record";
import { PAY_FIRST_REQUESTS, firstStage } from "@/lib/request-fees";
import { SheetsRow } from "@/components/portal/batch-window";

// The Safety course's tasks as on New Wave's TCROA file: three criteria under one task, then one more.
const safety: AssessmentTask[] = [
  { title: "Communication with passengers during emergency", criteria: "Information given is clear" },
  { title: "Communication with passengers during emergency", criteria: "Use Elementary English" },
  { title: "Communication with passengers during emergency", criteria: "Hand signals and safety signs" },
  { title: "Demonstration on the use of personal life-saving appliances", criteria: "Donning of life jackets" },
];
const emblem = new Uint8Array(readFileSync("public/new-wave-emblem.png")), logo = new Uint8Array(readFileSync("public/new-wave-logo.png"));
const base: TrainingSheetInput = {
  kind: "assessment", control: { formNo: "NW-TRNG-09-26", revisionNo: "", revisionDate: "", issuedDate: "05/25/2026" },
  courseCode: "STPPDSPPS", courseName: "Safety Training for Personnel Providing Direct Service to Passengers in Passenger Spaces", classNo: "26-506-002",
  startsOn: "2026-11-09", endsOn: "2026-11-09", instructor: "Sample Instructor", days: [], allDays: ["2026-11-09"],
  trainees: [{ enrollmentId: "a", name: "SANTOS, ANA REYES", rank: "Able Seafarer Deck" }, { enrollmentId: "b", name: "CRUZ, BEN LIM", rank: null }],
  tasks: safety, results: { a: { pct: 90, ticks: [true, true, true, true], cert: "" }, b: { pct: 60, ticks: [true, false, true, null], cert: "" } }, assessor: "Sample Assessor",
};
const textOf = async (bytes: Uint8Array) => (await readTemplateLines(bytes)).lines.map((l) => l.text).join("\n");
const size = async (bytes: Uint8Array) => { const p = (await PDFDocument.load(bytes)).getPage(0).getSize(); return [Math.round(p.width), Math.round(p.height)]; };
/** The fill opacities set on the first page (the watermark's is 0.16). */
const opacities = async (bytes: Uint8Array) => {
  const pdf = await PDFDocument.load(bytes), gs = pdf.getPage(0).node.Resources()?.lookup(PDFName.of("ExtGState"), PDFDict);
  return gs ? gs.entries().map(([, v]) => String(pdf.context.lookup(v, PDFDict).get(PDFName.of("ca")))) : [];
};
const days3 = ["2026-11-09", "2026-11-10", "2026-11-11"];

describe("Training Reports sheets", () => {
  it("lists training days without Sundays", () => {
    expect(trainingDays("2026-11-07", "2026-11-10")).toEqual(["2026-11-07", "2026-11-09", "2026-11-10"]);
    expect(trainingDays("2026-11-09", "2026-11-09")).toEqual(["2026-11-09"]);
    expect(sheetUrl("x", "attendance", "2026-11-09")).toBe("/api/documents/training-sheet/x?sheet=attendance&day=2026-11-09");
  });
  it("prints the form's dates", () => {
    expect(formDay("2026-05-26")).toBe("26 MAY 2026");
    expect(scheduleText("2026-05-26", "2026-05-26")).toBe("26 MAY 2026 – 26 MAY 2026");
    expect(ccmdSchedule("2026-01-05", "2026-01-07", "08:00:00", "17:00:00")).toBe("JAN 05-07, 2026 (08:00-17:00)");
    expect(ccmdSchedule("2026-01-30", "2026-02-02")).toBe("JAN 30 - FEB 02, 2026");
  });
  it("groups criteria that share a task title, as on the Safety form", () => {
    expect(taskGroups(safety)).toEqual([{ title: safety[0].title, from: 0, to: 2 }, { title: safety[3].title, from: 3, to: 3 }]);
    expect(groupTick({ pct: 90, ticks: [true, true, true, null], cert: "" }, { from: 0, to: 2 })).toBe(true);
    expect(groupTick({ pct: 90, ticks: [true, false, null, null], cert: "" }, { from: 0, to: 2 })).toBe(false);
    expect(groupTick({ pct: 90, ticks: [true, null, true, null], cert: "" }, { from: 0, to: 2 })).toBeNull();
  });
  it("follows each course's own forms", () => {
    expect(courseForm("UBT-PSSR")).toMatchObject({ paper: "A4", writtenOnSheet: false, apCount: 4, attendanceAllDays: false });
    expect(courseForm("ubt-pssr").apLabel(0)).toBe("AP A6.1");
    expect(courseForm("PSCMHBT")).toMatchObject({ paper: "Legal", writtenOnSheet: true, apCount: 10 });
    expect(courseForm("PSCMHBT").eps.widths.length - 4).toBe(15);
    expect(courseForm("PSCMT").eps.widths.length - 4).toBe(9);
    expect(courseForm("CCMD")).toMatchObject({ writtenOnSheet: false, apCount: 4, attendanceAllDays: true });
    expect(paperSize("Legal")).toEqual([1008, 612]);
  });
  it("draws the Assessment Performance Sheet like the Safety form, with the watermark", async () => {
    const bytes = await createTrainingSheetPdf({ ...base, emblem });
    const text = await textOf(bytes);
    for (const s of ["ASSESSMENT PERFORMANCE SHEET", "Form No.: NW-TRNG-09-26", "Class No.:", "26-506-002", "09 NOV 2026 – 09 NOV 2026", "Written", "Grade in %", "AP 1", "AP 2", "SANTOS, ANA REYES", "90", "-Nothing Follows-", "Certified correct by:", "Sample Assessor"]) expect(text).toContain(s);
    expect(text).not.toContain("AP 3");
    expect(await size(bytes)).toEqual([842, 595]);
    expect(await opacities(bytes)).toContain("0.16");
  });
  it("leaves out the written column for UBT-PSSR and labels its tasks A6.1 to A6.4", async () => {
    const text = await textOf(await createTrainingSheetPdf({ ...base, courseCode: "UBT-PSSR", tasks: [] }));
    expect(text).toContain("AP A6.4");
    expect(text).not.toContain("Written Assessment Grade");
  });
  it("prints the Attendance Sheet on A4 portrait, one sheet per training day, like New Wave's form", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ enrollmentId: `t${i}`, name: `TRAINEE ${i}`, rank: null }));
    const all = await createTrainingSheetPdf({ ...base, kind: "attendance", courseCode: "PSCMHBT", trainees: many, days: days3, allDays: days3, logo, emblem });
    expect((await PDFDocument.load(all)).getPageCount()).toBe(6);
    expect(await size(all)).toEqual([595, 842]);
    const one = await createTrainingSheetPdf({ ...base, kind: "attendance", courseCode: "PSCMHBT", control: { formNo: "NW-TRNG-06-25", revisionNo: "", revisionDate: "", issuedDate: "10/08/2025" }, days: [days3[1]], allDays: days3 });
    const text = await textOf(one);
    for (const s of ["ATTENDANCE SHEET", "Form No.: NW-TRNG-06-25", "NAME OF TRAINEES", "RANK/ POSITION", "SIGNATURE DAY 2", "AM SESSION", "PM SESSION", "Able Seafarer Deck", "Training Course:", "Class Schedule:", "Checked and Verified by:", "Instructor", "Maritime Excellence"]) expect(text).toContain(s);
    expect(text).toContain("24.");
    expect(text).not.toContain("Room:");
  });
  it("heads a one-day class's Attendance Sheet Signature, without a day", async () => {
    const text = await textOf(await createTrainingSheetPdf({ ...base, kind: "attendance", courseCode: "UBT-PSSR", days: ["2026-11-09"] }));
    expect(text).toContain("SIGNATURE");
    expect(text).not.toContain("SIGNATURE DAY");
  });
  it("puts every CCMD day on one Attendance Sheet of 30 lines", async () => {
    const bytes = await createTrainingSheetPdf({ ...base, kind: "attendance", courseCode: "CCMD", classNo: "CCMD001", startsOn: days3[0], endsOn: days3[2], dailyStart: "08:00:00", dailyEnd: "17:00:00", days: days3, allDays: days3 });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const text = await textOf(bytes);
    for (const s of ["Course:", "Course Batch:", "CCMD001", "Schedule:", "NOV 09-11, 2026 (08:00-17:00)", "DAY 1", "DAY 3", "30."]) expect(text).toContain(s);
  });
  it("prints each course's EP columns on the Exercise Performance Sheet", async () => {
    const crowd = await textOf(await createTrainingSheetPdf({ ...base, kind: "exercise", courseCode: "PSCMT", control: { formNo: "NW-TRNG-08-26", revisionNo: "", revisionDate: "", issuedDate: "05/25/2026" } }));
    for (const s of ["EXERCISE PERFORMANCE SHEET", "Form No.: NW-TRNG-08-26", "TRAINEE'S NAME", "EP A8.1", "EP A8.9", "Signature", "Remarks", "Instructor's printed name over signature", "Sample Instructor", "Not Performed"]) expect(crowd).toContain(s);
    expect(crowd).not.toContain("A8.10");
    const crisis = await createTrainingSheetPdf({ ...base, kind: "exercise", courseCode: "PSCMHBT" });
    expect(await textOf(crisis)).toContain("A4.15");
    expect(await size(crisis)).toEqual([842, 595]);
    expect(await textOf(await createTrainingSheetPdf({ ...base, kind: "exercise", courseCode: "CCMD" }))).toContain("EP 4");
  });
  it("prints the TCROA on Legal for Safety with one heading over its three criteria, and the watermark", async () => {
    const fields = { classNo: "26-506-002", resitClassNo: "", resitDuration: "", writtenPlace: "TR 304", practicalPlace: "TR 304", assessor: "Sample Assessor", coaValidity: "06 February 2031", assessedOn: "2026-11-09", director: "Sample Director", directorOn: "2026-11-09" };
    const trainees = [{ enrollmentId: "a", name: "SANTOS, ANA REYES", birthdate: "1990-01-02", placeOfBirth: "Manila", rank: "Able Seafarer Deck" }];
    const bytes = await createCompletionRecordPdf({ courseCode: "STPPDSPPS", courseName: base.courseName, startsOn: "2026-11-09", endsOn: "2026-11-09", tasks: safety, trainees, results: { a: base.results.a }, fields, logo: emblem });
    expect(await size(bytes)).toEqual([1008, 612]);
    expect(await opacities(bytes)).toContain("0.16");
    const text = await textOf(bytes);
    expect(text.split("Communication with passengers").length - 1).toBe(1);
    const pssr = await createCompletionRecordPdf({ courseCode: "UBT-PSSR", courseName: "PSSR", startsOn: "2026-11-09", endsOn: "2026-11-09", tasks: safety, trainees, results: {}, fields });
    expect((await size(pssr))[0]).toBe(842);
  });
  it("shows CCMD one Attendance Sheet button and other courses a button per day", () => {
    const row = (courseCode: string) => renderToStaticMarkup(createElement(SheetsRow, { batchId: "b", courseCode, startsOn: days3[0], endsOn: days3[2], record: false, onRecord: () => undefined }));
    expect(row("CCMD")).not.toContain("Day 1");
    expect(row("CCMD")).toContain("sheet=attendance\"");
    expect(row("PSCMHBT")).toContain("Day 3");
    expect(row("PSCMHBT")).toContain("All Days");
    expect(row("PSCMHBT")).not.toContain("Exercise Titles");
  });
});

describe("TAR reprint requests", () => {
  it("go straight to Accounting and never approve themselves once paid", () => {
    expect(PAY_FIRST_REQUESTS).not.toContain("TAR reprint");
    expect(PAY_FIRST_REQUESTS).toContain("Reprinting");
    expect(firstStage("TAR reprint", false)).toBe("For approval");
    expect(firstStage("Rescheduling", false)).toBe("With cashier");
    expect(firstStage("Rescheduling", true)).toBe("For approval");
  });
});
