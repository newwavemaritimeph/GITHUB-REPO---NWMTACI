import { describe, expect, it } from "vitest";
import { ALL_DATES, periodRange } from "@/components/portal/shared-ui";

// Every list opens on the month (owner, 3 Nov 2026); the range must cover the whole month.
describe("periodRange Monthly", () => {
  it("covers the first to the last day of the month", () => {
    expect(periodRange("Monthly", "2026-11-04")).toMatchObject({ from: "2026-11-01", to: "2026-11-30", label: "November 2026" });
    expect(periodRange("Monthly", "2026-12-31")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("handles February", () => {
    expect(periodRange("Monthly", "2027-02-15")).toMatchObject({ from: "2027-02-01", to: "2027-02-28" });
    expect(periodRange("Monthly", "2028-02-15")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("All Dates reaches past the search floor", () => {
    expect(periodRange("All Dates", "2026-11-04").from < ALL_DATES).toBe(true);
  });
});
