import { describe, expect, it } from "vitest";
import { addMonths, dueLabel, dueOf, hrDueItems, HR_DEFAULTS, needsAction } from "@/lib/hr-due";

describe("six-month HR checks", () => {
  it("adds months and clamps to the month's last day", () => {
    expect(addMonths("2026-06-02", 6)).toBe("2026-12-02");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-11-10", 6)).toBe("2027-05-10");
  });

  it("is Due Soon 30 days before, Overdue after, Missing with nothing on file", () => {
    expect(dueOf("2026-06-02", 6, 30, "2026-11-10")).toMatchObject({ due: "2026-12-02", days: 22, state: "Due Soon" });
    expect(dueOf("2026-05-04", 6, 30, "2026-11-10")).toMatchObject({ due: "2026-11-04", days: -6, state: "Overdue" });
    expect(dueOf("2026-09-01", 6, 30, "2026-11-10").state).toBe("Current");
    expect(dueOf(null, 6, 30, "2026-11-10").state).toBe("Missing");
    // A biodata confirmation timestamp counts by its Manila date (00:30 Manila on May 11 is May 10, 16:30 UTC).
    expect(dueOf("2026-05-10T16:30:00Z", 6, 30, "2026-11-10")).toMatchObject({ last: "2026-05-11", due: "2026-11-11", state: "Due Soon" });
  });

  it("lists active employees only, most urgent first, with a waiting upload as For Checking", () => {
    const items = hrDueItems([
      { id: "a", employee_number: "1", complete_name: "Sample A", active: true, fit_to_work_on: "2026-05-04", biodata_confirmed_at: "2026-09-01" },
      { id: "b", employee_number: "2", complete_name: "Sample B", active: true, fit_to_work_on: "2026-06-02", fit_to_work_pending_on: "2026-11-09", biodata_confirmed_at: null },
      { id: "c", employee_number: "3", complete_name: "Sample C", active: false, fit_to_work_on: null },
    ], HR_DEFAULTS, "2026-11-10");
    expect(items).toHaveLength(4);
    expect(items.map((i) => `${i.name}:${i.kind}:${i.state}`)).toEqual(["Sample A:fit:Overdue", "Sample B:biodata:Missing", "Sample B:fit:For Checking", "Sample A:biodata:Current"]);
    expect(needsAction(items)).toHaveLength(3);
  });

  it("labels the countdown", () => {
    expect(dueLabel({ state: "Overdue", days: -1 })).toBe("Overdue 1 Day");
    expect(dueLabel({ state: "Due Soon", days: 0 })).toBe("Due Today");
    expect(dueLabel({ state: "Due Soon", days: 22 })).toBe("Due in 22 Days");
  });
});
