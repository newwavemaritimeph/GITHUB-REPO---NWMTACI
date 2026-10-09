import { describe, expect, it } from "vitest";
import { groupNotices, holidayReminders, holidaysInMonth, totalsByChannel, voidReasonProblem, type HolidayDay, type Notice } from "@/lib/admin-dashboard";
import { requisitionState } from "@/lib/admin-assistant";

const n = (category: Notice["category"], severity: Notice["severity"], title: string): Notice => ({ category, severity, title, detail: "" });

describe("Admin notifications per category", () => {
  it("puts categories with urgent items first, urgent items first inside each", () => {
    const groups = groupNotices([
      n("Holidays and MARINA Requests", "reminder", "holiday"),
      n("Certificates", "reminder", "due today"),
      n("Certificates", "urgent", "overdue"),
      n("Payments and Reconciliation", "reminder", "gcash"),
      n("Classes and Rooms", "urgent", "no room"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["Classes and Rooms", "Certificates", "Payments and Reconciliation", "Holidays and MARINA Requests"]);
    expect(groups[1].notices.map((x) => x.title)).toEqual(["overdue", "due today"]);
    expect(groups[1].urgent).toBe(1);
  });
  it("leaves out empty categories", () => {
    expect(groupNotices([])).toEqual([]);
  });
});

describe("Holidays on training days", () => {
  const h = (date: string, batches: number, marinaStatus: HolidayDay["marinaStatus"] = "Not Sent"): HolidayDay => ({ date, name: "Holiday", kind: "Regular", marinaStatus, batches: Array.from({ length: batches }, (_, i) => ({ batchNumber: `B${i}`, courseCode: "UBT-PSSR", students: 10 })) });
  it("reminds only for upcoming holidays with classes and no MARINA request sent", () => {
    const list = [h("2026-10-09", 2), h("2026-11-01", 0), h("2026-11-30", 3), h("2026-12-08", 2, "Sent"), h("2027-01-01", 1)];
    expect(holidayReminders(list, "2026-10-09").map((x) => x.date)).toEqual(["2026-11-30"]);
    expect(holidayReminders(list, "2026-10-09", 90).map((x) => x.date)).toEqual(["2026-11-30", "2027-01-01"]);
  });
  it("lists a month's holidays in date order", () => {
    expect(holidaysInMonth([h("2026-12-25", 0), h("2026-11-30", 1), h("2026-12-08", 0)], "2026-12").map((x) => x.date)).toEqual(["2026-12-08", "2026-12-25"]);
  });
});

describe("Admin voids", () => {
  it("needs a reason of at least 5 characters", () => {
    expect(voidReasonProblem("  ok ")).toMatch(/reason/);
    expect(voidReasonProblem("Duplicate receipt")).toBeNull();
  });
  it("shows a requisition whose voucher was voided as Voided", () => {
    expect(requisitionState({ status: "Approved", expense_status: "Void" })).toBe("Voided");
    expect(requisitionState({ status: "Approved", expense_status: "Paid" })).toBe("Released");
  });
  it("totals collections per channel", () => {
    expect(totalsByChannel([{ channel: "GCash", amount: 100 }, { channel: "gcash", amount: 50 }, { channel: "Union Bank", amount: 20 }, { channel: "Check", amount: 5 }], ["Cash", "GCash", "PSBank", "UnionBank"]))
      .toEqual({ Cash: 0, GCash: 150, PSBank: 0, UnionBank: 20, Other: 5 });
  });
});
