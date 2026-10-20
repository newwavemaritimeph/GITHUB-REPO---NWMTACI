import { describe, expect, it } from "vitest";
import { htmlTableToLines, matchClassroomLine, matchCourse, parseClassroomLines, parseLastCertificateNo, readNumberRows, sheetCsvUrl } from "../lib/admin-imports";

const courses = [
  { id: "dwk", code: "DWK", name: "Deck Watchkeeping" },
  { id: "abc", code: "ABC", name: "Awareness on Basic Computer" },
  { id: "ccmd", code: "CCMD", name: "Crowd and Crisis Management Domestic" },
  { id: "ilo1", code: "ILO", name: "Food Hygiene" },
  { id: "ilo2", code: "ILO", name: "Galley Hygiene" },
];

describe("certificate number import", () => {
  it("reads the last number with or without a prefix", () => {
    expect(parseLastCertificateNo("HPT-00149")).toEqual({ prefix: "HPT-", number: 149, pad: 5 });
    expect(parseLastCertificateNo("149")).toEqual({ prefix: "", number: 149, pad: 3 });
    expect(parseLastCertificateNo("none")).toBeNull();
  });
  it("finds the columns by their headers", () => {
    expect(readNumberRows([["Course Name", "Course Code", "Last Certificate No."], ["Deck Watchkeeping", "DWK", "DWK-00012"], ["", "", ""]])).toEqual([{ code: "DWK", name: "Deck Watchkeeping", last: "DWK-00012" }]);
  });
  it("turns a sheet link into its CSV export", () => {
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/AbC_1/edit#gid=42")).toBe("https://docs.google.com/spreadsheets/d/AbC_1/export?format=csv&gid=42");
    expect(sheetCsvUrl("https://example.com/x")).toBeNull();
  });
  it("matches by code, and the ILO courses by name", () => {
    expect(matchCourse(courses, "dwk", "")?.id).toBe("dwk");
    expect(matchCourse(courses, "ILO", "Galley Hygiene")?.id).toBe("ilo2");
  });
});

describe("Classroom links import", () => {
  it("reads a pasted row with the link, code and class code", () => {
    const [r] = parseClassroomLines("15\tDeck Watchkeeping\tDWK\thttps://classroom.google.com/c/ODI0ODIzMTYxNDM4\tiqsghbil");
    expect(r).toMatchObject({ code: "DWK", name: "Deck Watchkeeping", link: "https://classroom.google.com/c/ODI0ODIzMTYxNDM4", classCode: "iqsghbil" });
    expect(matchClassroomLine(r, courses, []).course?.id).toBe("dwk");
  });
  it("keeps the link behind Open when the table is copied from a page", () => {
    const html = `<table><tr><td>17</td><td>Enclosed Space Entry Awareness</td><td>ESEA</td><td><a href="https://classroom.google.com/c/ODA0Mzk1ODk4MTAy">Open</a></td><td>u56xwr5j</td></tr></table>`;
    expect(parseClassroomLines(htmlTableToLines(html))[0]).toMatchObject({ link: "https://classroom.google.com/c/ODA0Mzk1ODk4MTAy", classCode: "u56xwr5j" });
  });
  it("sends a per-batch class to the batch starting on that date", () => {
    const [r] = parseClassroomLines("CCMD0081 (Oct 19-21, 2026)\thttps://classroom.google.com/c/ODU2NDQ1NTYwMTM0\tab12cd3");
    expect(r.startsOn).toBe("2026-10-19");
    expect(matchClassroomLine(r, courses, [{ id: "b81", course_id: "ccmd", starts_on: "2026-10-19" }]).batch?.id).toBe("b81");
  });
});

describe("Releasing Officer report ranges", () => {
  it("covers a day, a Monday-to-Sunday week and a month", async () => {
    const { reportRange } = await import("../components/portal/releasing-home");
    expect(reportRange("Daily", "2026-10-20")).toMatchObject({ from: "2026-10-20", to: "2026-10-20" });
    expect(reportRange("Weekly", "2026-10-22")).toMatchObject({ from: "2026-10-19", to: "2026-10-25" });
    expect(reportRange("Monthly", "2026-02-10")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });
});
