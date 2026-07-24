import { describe, expect, it } from "vitest";
import { monthlyBatchStarts, startWeekdaysForDuration, validBatchStart } from "../lib/scheduling";

// Reference weekdays in July 2026: Jul 27 = Mon, 28 = Tue, 29 = Wed, 30 = Thu,
// 31 = Fri; Aug 1 = Sat, Aug 2 = Sun.

describe("in-house start-weekday patterns", () => {
  it("maps each duration to New Wave's allowed start days", () => {
    expect(startWeekdaysForDuration("1 day")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(startWeekdaysForDuration("2 days")).toEqual([1, 3, 5]);
    expect(startWeekdaysForDuration("3 days")).toEqual([1, 4]);
    expect(startWeekdaysForDuration("4 days")).toEqual([1, 2, 3]);
    expect(startWeekdaysForDuration("5 days")).toEqual([1, 2]);
    expect(startWeekdaysForDuration("6 days")).toEqual([1]);
  });

  it("accepts four-day courses on Mon, Tue, or Wed but not Thursday", () => {
    expect(validBatchStart("GEN", "4 days", "2026-07-27")).toBe(true); // Mon
    expect(validBatchStart("GEN", "4 days", "2026-07-28")).toBe(true); // Tue
    expect(validBatchStart("GEN", "4 days", "2026-07-29")).toBe(true); // Wed
    expect(validBatchStart("GEN", "4 days", "2026-07-30")).toBe(false); // Thu
  });

  it("accepts five-day courses on Mon or Tue only", () => {
    expect(validBatchStart("GEN", "5 days", "2026-07-27")).toBe(true); // Mon
    expect(validBatchStart("GEN", "5 days", "2026-07-28")).toBe(true); // Tue
    expect(validBatchStart("GEN", "5 days", "2026-07-29")).toBe(false); // Wed
  });

  it("never starts any course on a Sunday", () => {
    expect(validBatchStart("GEN", "1 day", "2026-08-01")).toBe(true); // Sat
    expect(validBatchStart("GEN", "1 day", "2026-08-02")).toBe(false); // Sun
  });

  it("keeps MARINA STCW course overrides", () => {
    expect(validBatchStart("PSCMT", "2 days", "2026-07-28")).toBe(true); // Tue only
    expect(validBatchStart("PSCMT", "2 days", "2026-07-27")).toBe(false); // Mon rejected
  });
});

describe("monthly schedule generation", () => {
  it("lists every Mon/Wed/Fri in July 2026 for a two-day course", () => {
    const starts = monthlyBatchStarts("GEN", "2 days", 2026, 7);
    expect(starts).toContain("2026-07-01"); // Wed
    expect(starts).toContain("2026-07-31"); // Fri
    expect(starts).not.toContain("2026-07-07"); // Tue
    expect(starts).toHaveLength(14);
  });

  it("lists all non-Sunday days for a one-day course", () => {
    // July 2026 has four Sundays (5, 12, 19, 26), so 31 − 4 = 27 valid days.
    const starts = monthlyBatchStarts("GEN", "1 day", 2026, 7);
    expect(starts).toHaveLength(27);
    expect(starts).not.toContain("2026-07-05"); // Sun
  });

  it("handles a month boundary", () => {
    const starts = monthlyBatchStarts("GEN", "5 days", 2026, 2); // Feb 2026
    starts.forEach((iso) => expect([1, 2]).toContain(new Date(`${iso}T00:00:00Z`).getUTCDay()));
  });
});
