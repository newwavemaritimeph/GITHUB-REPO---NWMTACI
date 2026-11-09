import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readTemplateLines } from "@/lib/certificate-autolayout";
import { cleanExercises, sheetUrl, trainingDays } from "@/lib/training-sheets";
import { courseForm, groupTick, paperSize, taskGroups, type AssessmentTask } from "@/lib/completion-record";
import { createTrainingSheetPdf, formDay, scheduleText, type TrainingSheetInput } from "@/lib/print/training-sheets";
import { createCompletionRecordPdf } from "@/lib/print/completion-record";

// The Safety course's tasks as on New Wave's TCROA file: three criteria under one task, then one more.
const safety: AssessmentTask[] = [
  { title: "Communication with passengers during emergency", criteria: "Information given is clear" },
  { title: "Communication with passengers during emergency", criteria: "Use Elementary English" },
  { title: "Communication with passengers during emergency", criteria: "Hand signals and safety signs" },
  { title: "Demonstration on the use of personal life-saving appliances", criteria: "Donning of life jackets" },
];
const base: TrainingSheetInput = {
  kind: "assessment", control: { formNo: "NW-TRNG-09-26", revisionNo: "", revisionDate: "", issuedDate: "05/25/2026" },
  courseCode: "STPPDSPPS", courseName: "Safety Training for Personnel Providing Direct Service to Passengers in Passenger Spaces", classNo: "26-506-002",
  startsOn: "2026-11-09", endsOn: "2026-11-09", room: "TR 304", instructor: "Sample Instructor", days: [], allDays: ["2026-11-09"],
  trainees: [{ enrollmentId: "a", name: "SANTOS, ANA REYES", srn: "SRN-1" }, { enrollmentId: "b", name: "CRUZ, BEN LIM", srn: null }],
  tasks: safety, results: { a: { pct: 90, ticks: [true, true, true, true], cert: "" }, b: { pct: 60, ticks: [true, false, true, null], cert: "" } }, exercises: [], assessor: "Sample Assessor",
};
const textOf = async (bytes: Uint8Array) => (await readTemplateLines(bytes)).lines.map((l) => l.text).join("\n");

describe("Training Reports sheets", () => {
  it("lists training days without Sundays", () => {
    expect(trainingDays("2026-11-07", "2026-11-10")).toEqual(["2026-11-07", "2026-11-09", "2026-11-10"]);
    expect(trainingDays("2026-11-09", "2026-11-09")).toEqual(["2026-11-09"]);
    expect(sheetUrl("x", "attendance", "2026-11-09")).toBe("/api/documents/training-sheet/x?sheet=attendance&day=2026-11-09");
  });
  it("keeps up to 10 exercise titles", () => {
    expect(cleanExercises([" Muster drill ", "", 3, ...Array.from({ length: 12 }, (_, i) => `Ex ${i}`)])).toHaveLength(10);
    expect(cleanExercises("x")).toEqual([]);
  });
  it("prints the form's dates", () => {
    expect(formDay("2026-05-26")).toBe("26 MAY 2026");
    expect(scheduleText("2026-05-26", "2026-05-26")).toBe("26 MAY 2026 – 26 MAY 2026");
  });
  it("groups criteria that share a task title, as on the Safety form", () => {
    expect(taskGroups(safety)).toEqual([{ title: safety[0].title, from: 0, to: 2 }, { title: safety[3].title, from: 3, to: 3 }]);
    expect(groupTick({ pct: 90, ticks: [true, true, true, null], cert: "" }, { from: 0, to: 2 })).toBe(true);
    expect(groupTick({ pct: 90, ticks: [true, false, null, null], cert: "" }, { from: 0, to: 2 })).toBe(false);
    expect(groupTick({ pct: 90, ticks: [true, null, true, null], cert: "" }, { from: 0, to: 2 })).toBeNull();
  });
  it("follows each course's own sheet", () => {
    expect(courseForm("UBT-PSSR")).toMatchObject({ paper: "A4", writtenOnSheet: false, apCount: 4 });
    expect(courseForm("ubt-pssr").apLabel(0)).toBe("AP A6.1");
    expect(courseForm("PSCMHBT")).toMatchObject({ paper: "Legal", writtenOnSheet: true, apCount: 10 });
    expect(courseForm("CCMD")).toMatchObject({ writtenOnSheet: false, apCount: 4 });
    expect(paperSize("Legal")).toEqual([1008, 612]);
  });
  it("draws the Assessment Performance Sheet like the Safety form", async () => {
    const text = await textOf(await createTrainingSheetPdf(base));
    for (const s of ["ASSESSMENT PERFORMANCE SHEET", "Form No.: NW-TRNG-09-26", "Class No.:", "26-506-002", "09 NOV 2026 – 09 NOV 2026", "Written", "Grade in %", "AP 1", "AP 2", "SANTOS, ANA REYES", "90", "-Nothing Follows-", "Certified correct by:", "Sample Assessor"]) expect(text).toContain(s);
    expect(text).not.toContain("AP 3");
  });
  it("leaves out the written column for UBT-PSSR and labels its tasks A6.1 to A6.4", async () => {
    const text = await textOf(await createTrainingSheetPdf({ ...base, courseCode: "UBT-PSSR", tasks: [] }));
    expect(text).toContain("AP A6.4");
    expect(text).not.toContain("Written Assessment Grade");
  });
  it("prints one Attendance Sheet per training day, and pages past 24 trainees", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ enrollmentId: `t${i}`, name: `TRAINEE ${i}`, srn: null }));
    const days = ["2026-11-09", "2026-11-10", "2026-11-11"];
    const pdf = await PDFDocument.load(await createTrainingSheetPdf({ ...base, kind: "attendance", trainees: many, days, allDays: days }));
    expect(pdf.getPageCount()).toBe(6);
    const one = await createTrainingSheetPdf({ ...base, kind: "attendance", days: [days[1]], allDays: days });
    const text = await textOf(one);
    expect(text).toContain("Day 2 of 3 – 10 NOV 2026");
    expect(text).toContain("SRN-1");
  });
  it("puts exercise titles on the Exercise Performance Sheet", async () => {
    const text = await textOf(await createTrainingSheetPdf({ ...base, kind: "exercise", exercises: ["Muster drill", "Donning of life jacket"] }));
    for (const s of ["EXERCISE PERFORMANCE SHEET", "Ex. 1", "Ex. 2", "Muster drill", "Instructor's printed name over signature", "Sample Instructor"]) expect(text).toContain(s);
  });
  it("prints the TCROA on Legal for Safety with one heading over its three criteria", async () => {
    const logo = new Uint8Array(readFileSync("public/new-wave-emblem.png"));
    const fields = { classNo: "26-506-002", resitClassNo: "", resitDuration: "", writtenPlace: "TR 304", practicalPlace: "TR 304", assessor: "Sample Assessor", coaValidity: "06 February 2031", assessedOn: "2026-11-09", director: "Sample Director", directorOn: "2026-11-09" };
    const trainees = [{ enrollmentId: "a", name: "SANTOS, ANA REYES", birthdate: "1990-01-02", placeOfBirth: "Manila", rank: "Able Seafarer Deck" }];
    const bytes = await createCompletionRecordPdf({ courseCode: "STPPDSPPS", courseName: base.courseName, startsOn: "2026-11-09", endsOn: "2026-11-09", tasks: safety, trainees, results: { a: base.results.a }, fields, logo });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 1008, height: 612 });
    const text = await textOf(bytes);
    expect(text.split("Communication with passengers").length - 1).toBe(1);
    const pssr = await PDFDocument.load(await createCompletionRecordPdf({ courseCode: "UBT-PSSR", courseName: "PSSR", startsOn: "2026-11-09", endsOn: "2026-11-09", tasks: safety, trainees, results: {}, fields }));
    expect(Math.round(pssr.getPage(0).getSize().width)).toBe(842);
  });
});
