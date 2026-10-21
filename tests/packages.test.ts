import { describe, expect, it } from "vitest";
import { isPackageCourse, packageWeeks } from "@/lib/packages";

describe("CCI Package weeks", () => {
  const b = (code: string, startsOn: string, full = false) => ({ code, startsOn, full });
  it("needs Safety on Monday, Crowd on Tuesday and Crisis on Thursday of the same week", () => {
    const weeks = packageWeeks([b("STPPDSPPS", "2026-10-26"), b("PSCMT", "2026-10-27"), b("PSCMHBT", "2026-10-29"), b("STPPDSPPS", "2026-11-02"), b("PSCMT", "2026-11-03")]);
    expect(weeks).toEqual([{ monday: "2026-10-26", ends: "2026-10-31", full: false }]);
  });
  it("is full when any part is full", () => {
    expect(packageWeeks([b("STPPDSPPS", "2026-10-26"), b("PSCMT", "2026-10-27", true), b("PSCMHBT", "2026-10-29")])[0].full).toBe(true);
  });
  it("knows the package code", () => { expect(isPackageCourse("cci")).toBe(true); expect(isPackageCourse("PSCMT")).toBe(false); });
});
