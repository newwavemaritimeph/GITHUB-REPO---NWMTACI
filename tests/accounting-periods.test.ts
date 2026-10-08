import { describe, expect, it } from "vitest";
import { percentChange, periodBuckets, periodStart, periodTitle } from "@/lib/accounting-periods";

describe("accounting report periods", () => {
  it("finds the start of each period", () => {
    expect(periodStart("Weekly", "2026-10-08")).toBe("2026-10-05"); // Monday
    expect(periodStart("Weekly", "2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the same week
    expect(periodStart("Monthly", "2026-10-08")).toBe("2026-10-01");
    expect(periodStart("Quarterly", "2026-11-20")).toBe("2026-10-01");
    expect(periodStart("Annually", "2026-10-08")).toBe("2026-01-01");
  });
  it("builds buckets oldest first, the last one to date", () => {
    const m = periodBuckets("Monthly", "2026-10-08", 3);
    expect(m).toEqual([{ label: "Aug 26", from: "2026-08-01", to: "2026-08-31" }, { label: "Sep 26", from: "2026-09-01", to: "2026-09-30" }, { label: "Oct 26", from: "2026-10-01", to: "2026-10-08" }]);
    const q = periodBuckets("Quarterly", "2026-10-08", 2);
    expect(q.map((b) => `${b.label}:${b.from}:${b.to}`)).toEqual(["Q3 26:2026-07-01:2026-09-30", "Q4 26:2026-10-01:2026-10-08"]);
    expect(periodBuckets("Daily", "2026-10-08", 2).map((b) => b.from)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(periodBuckets("Annually", "2026-10-08", 2).map((b) => b.label)).toEqual(["2025", "2026"]);
  });
  it("titles and compares", () => {
    expect(periodTitle("Monthly", "2026-10-08")).toBe("October 2026 (to date)");
    expect(periodTitle("Monthly", "2026-10-31")).toBe("October 2026");
    expect(periodTitle("Daily", "2026-10-08")).toBe("October 8, 2026");
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(5, 0)).toBeNull();
  });
});
