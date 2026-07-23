import { describe, expect, it } from "vitest";
import { describeRange, filterByRange, resolveRange, withinRange } from "../lib/reporting";

const TODAY = "2026-07-23"; // a Thursday

describe("report date ranges", () => {
  it("resolves each preset against a fixed today", () => {
    expect(resolveRange("Today", TODAY)).toEqual({ from: "2026-07-23", to: "2026-07-23" });
    expect(resolveRange("Last 7 days", TODAY)).toEqual({ from: "2026-07-17", to: "2026-07-23" });
    expect(resolveRange("This month", TODAY)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(resolveRange("Last month", TODAY)).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(resolveRange("This year", TODAY)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("handles month and year boundaries", () => {
    expect(resolveRange("Last month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveRange("This month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveRange("This month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("accepts a custom range and repairs one entered backwards", () => {
    expect(resolveRange("Custom", TODAY, { from: "2026-07-01", to: "2026-07-10" })).toEqual({
      from: "2026-07-01",
      to: "2026-07-10",
    });
    expect(resolveRange("Custom", TODAY, { from: "2026-07-10", to: "2026-07-01" })).toEqual({
      from: "2026-07-01",
      to: "2026-07-10",
    });
  });
});

describe("range membership", () => {
  const range = { from: "2026-07-01", to: "2026-07-31" };

  it("includes both endpoints", () => {
    expect(withinRange("2026-07-01", range)).toBe(true);
    expect(withinRange("2026-07-31", range)).toBe(true);
  });

  it("keeps a late timestamp on the closing day inside the period", () => {
    expect(withinRange("2026-07-31T23:47:12.000Z", range)).toBe(true);
  });

  it("excludes dates outside and missing values", () => {
    expect(withinRange("2026-06-30", range)).toBe(false);
    expect(withinRange("2026-08-01", range)).toBe(false);
    expect(withinRange(undefined, range)).toBe(false);
    expect(withinRange("", range)).toBe(false);
  });

  it("filters rows by an extracted date", () => {
    const rows = [
      { ref: "PAY-1", at: "2026-06-30T10:00:00Z" },
      { ref: "PAY-2", at: "2026-07-15T10:00:00Z" },
      { ref: "PAY-3", at: "2026-07-31T22:00:00Z" },
      { ref: "PAY-4", at: "2026-08-01T01:00:00Z" },
    ];
    expect(filterByRange(rows, range, (row) => row.at).map((row) => row.ref)).toEqual(["PAY-2", "PAY-3"]);
  });
});

describe("range description", () => {
  it("collapses a single day", () => {
    expect(describeRange({ from: TODAY, to: TODAY })).toBe("Jul 23, 2026");
  });

  it("shows both ends of a period", () => {
    expect(describeRange({ from: "2026-07-01", to: "2026-07-31" })).toBe("Jul 1, 2026 – Jul 31, 2026");
  });
});
