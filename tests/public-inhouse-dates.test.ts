import { describe, expect, it } from "vitest";
import { automaticEndDate, fitsInWeek, lastStartWeekday, PUBLIC_STCW_CODES, validBatchStart } from "@/lib/scheduling";

// 2026-10-12 is a Monday.
describe("In-House start dates on the public Courses page", () => {
  it("runs a 3-day course on consecutive days within one week", () => {
    expect(fitsInWeek("2026-10-15", "3 days")).toBe(true); // Thursday → Saturday
    expect(automaticEndDate("2026-10-15", "3 days")).toBe("2026-10-17");
    expect(fitsInWeek("2026-10-16", "3 days")).toBe(false); // Friday would cross Sunday
    expect(lastStartWeekday("3 days")).toBe(4);
  });
  it("never starts on a Sunday, and allows a 1-day course on Saturday", () => {
    expect(fitsInWeek("2026-10-18", "1 day")).toBe(false);
    expect(fitsInWeek("2026-10-17", "1 day")).toBe(true);
  });
  it("starts courses of six or more days on Monday", () => {
    expect(fitsInWeek("2026-10-12", "5.5 days")).toBe(true);
    expect(fitsInWeek("2026-10-13", "6 days")).toBe(false);
  });
  it("publishes the five STCW courses, with CCM Domestic on Mondays", () => {
    expect([...PUBLIC_STCW_CODES]).toEqual(["UBT-PSSR", "STPPDSPPS", "PSCMT", "PSCMHBT", "CCMD"]);
    expect(validBatchStart("CCMD", "3 days", "2026-10-12")).toBe(true);
    expect(validBatchStart("CCMD", "3 days", "2026-10-15")).toBe(false);
  });
});
