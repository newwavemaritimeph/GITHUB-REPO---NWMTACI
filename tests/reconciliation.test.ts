import { describe, expect, it } from "vitest";
import { isGcash, manilaDay, manilaDayBounds, recentDays, summarizeDays } from "@/lib/reconciliation";

describe("GCash reconciliation", () => {
  it("uses Manila days", () => {
    expect(manilaDay("2026-10-08T16:30:00Z")).toBe("2026-10-09");
    expect(manilaDayBounds("2026-10-09")).toEqual({ start: "2026-10-08T16:00:00.000Z", end: "2026-10-09T15:59:59.999Z" });
    expect(recentDays("2026-10-09", 3)).toEqual(["2026-10-09", "2026-10-08", "2026-10-07"]);
  });
  it("summarises each day", () => {
    const s = summarizeDays([
      { amount_centavos: 180000, received_at: "2026-10-09T01:00:00Z", status: "Reconciled" },
      { amount_centavos: 90000, received_at: "2026-10-09T02:00:00Z", status: null },
      { amount_centavos: 50000, received_at: "2026-10-08T02:00:00Z", status: "Not in History" },
      { amount_centavos: 10000, received_at: "2026-09-01T02:00:00Z", status: null },
    ], ["2026-10-09", "2026-10-08"]);
    expect(s[0]).toEqual({ day: "2026-10-09", count: 2, total: 270000, reconciled: 1, reconciledTotal: 180000, missing: 0, toCheck: 1 });
    expect(s[1]).toMatchObject({ count: 1, missing: 1, toCheck: 0 });
  });
  it("recognises GCash however it is typed", () => {
    expect(isGcash("GCash")).toBe(true);
    expect(isGcash("G Cash")).toBe(true);
    expect(isGcash("PSBank")).toBe(false);
  });
});
