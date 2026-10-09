import { describe, expect, it } from "vitest";
import { completionProblems, emptyResult, fitResult, numberSeries, remarkOf, resultOf, type CompletionFields } from "@/lib/completion-record";

const fields: CompletionFields = { classNo: "26-609-118", resitClassNo: "", resitDuration: "", writtenPlace: "TR 103", practicalPlace: "TR 103", assessor: "Assessor", coaValidity: "06 January 2031", assessedOn: "2026-10-08", director: "Director", directorOn: "2026-10-08" };

describe("Training Completion Record", () => {
  it("passes at 75% and is Competent only when every task is performed", () => {
    expect(remarkOf(75)).toBe("P");
    expect(remarkOf(74)).toBe("F");
    expect(remarkOf(null)).toBe("");
    expect(resultOf({ pct: 90, ticks: [true, true], cert: "" }, 2)).toBe("C");
    expect(resultOf({ pct: 70, ticks: [true, true], cert: "" }, 2)).toBe("NYC");
    expect(resultOf({ pct: 90, ticks: [true, false], cert: "" }, 2)).toBe("NYC");
    expect(resultOf({ pct: 90, ticks: [true, null], cert: "" }, 2)).toBe("");
  });
  it("numbers certificates consecutively, keeping the zero padding", () => {
    expect(numberSeries("MTI-094-609-26-002382", 3)).toEqual(["MTI-094-609-26-002382", "MTI-094-609-26-002383", "MTI-094-609-26-002384"]);
    expect(numberSeries("MTI-ABC", 2)).toBeNull();
  });
  it("lists what is missing before printing", () => {
    const trainees = [{ enrollmentId: "a", name: "A", birthdate: null, placeOfBirth: null, rank: null }, { enrollmentId: "b", name: "B", birthdate: null, placeOfBirth: null, rank: null }];
    const done = { a: { pct: 90, ticks: [true], cert: "MTI-1" }, b: { pct: 60, ticks: [true], cert: "" } };
    expect(completionProblems(fields, trainees, done, 1)).toEqual([]);
    const p = completionProblems({ ...fields, classNo: "" }, trainees, { a: { pct: 90, ticks: [true], cert: "" }, b: emptyResult(1) }, 1);
    expect(p).toEqual(["Class No.", "Written % for 1 trainee", "Practical checklist", "MTI certificate number for 1 competent trainee"]);
  });
  it("fits stored results to the course's current tasks", () => {
    expect(fitResult({ pct: 101.4, ticks: [true, false, true], cert: " X " }, 2)).toEqual({ pct: 100, ticks: [true, false], cert: "X" });
    expect(fitResult(undefined, 2)).toEqual({ pct: null, ticks: [null, null], cert: "" });
  });
});

import { completionNaming } from "@/lib/completion-drive";
describe("TCROA filing in Google Drive", () => {
  it("files by course and month, named by date, batch and class", () => {
    expect(completionNaming({ courseCode: "UBT-PSSR", endsOn: "2026-10-08", batchNumber: "BCH-2026-002475", classNo: "26-609-118" }))
      .toEqual({ folders: [{ key: "tcroa/UBT-PSSR", name: "UBT-PSSR" }, { key: "tcroa/UBT-PSSR/2026-10", name: "2026-10 October" }], base: "2026-10-08 BCH-2026-002475 Class 26-609-118" });
    expect(completionNaming({ courseCode: "ccmd", endsOn: "2026-11-30", batchNumber: "BCH/1", classNo: "" }).base).toBe("2026-11-30 BCH 1");
  });
});
