import { describe, expect, it } from "vitest";
import { paymentState, sortRoster, type RosterRow } from "@/lib/batch-roster";

describe("batch trainee list", () => {
  it("shows Paid, Balance, Not Paid Yet, and Company Charge (never unpaid)", () => {
    expect(paymentState(130000, 130000, false)).toEqual({ payment: "Paid", balanceCentavos: 0 });
    expect(paymentState(130000, 65000, false)).toEqual({ payment: "Balance", balanceCentavos: 65000 });
    expect(paymentState(130000, 0, false)).toEqual({ payment: "Not Paid Yet", balanceCentavos: 130000 });
    expect(paymentState(130000, 0, true).payment).toBe("Company Charge");
  });
  it("lists Enrolled first, then Pending, by name", () => {
    const r = (name: string, status: string) => ({ enrollmentId: name, name, status } as RosterRow);
    expect(sortRoster([r("ZAMORA", "Pending"), r("REYES", "Enrolled"), r("ABAD", "Pending"), r("CRUZ", "Enrolled")]).map((x) => x.name)).toEqual(["CRUZ", "REYES", "ABAD", "ZAMORA"]);
  });
});
