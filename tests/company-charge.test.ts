import { describe, expect, it } from "vitest";
import { sourceLabel, splitStatementPayment } from "@/lib/company-charge";
import { referralAction } from "@/lib/referral";

describe("company payment for a Billing Statement", () => {
  const rows = [{ enrollmentId: "a", balanceCentavos: 130000 }, { enrollmentId: "b", balanceCentavos: 90000 }, { enrollmentId: "c", balanceCentavos: 0 }];
  it("fills the trainees in order, capped at each balance", () => {
    expect(splitStatementPayment(220000, rows).allocations).toEqual([{ enrollmentId: "a", amountCentavos: 130000 }, { enrollmentId: "b", amountCentavos: 90000 }]);
    expect(splitStatementPayment(150000, rows).allocations).toEqual([{ enrollmentId: "a", amountCentavos: 130000 }, { enrollmentId: "b", amountCentavos: 20000 }]);
  });
  it("refuses paying more than the statement still owes", () => {
    expect(splitStatementPayment(230000, rows).error).toMatch(/only has/);
    expect(splitStatementPayment(0, rows).error).toMatch(/amount/);
  });
});

describe("Company Charge partners", () => {
  it("get no rebate", () => {
    expect(referralAction("Company Charge", true, true)).toBe("skip");
  });
  it("show the source chip", () => {
    expect(sourceLabel("Agency", { name: "Marine Force", kind: "Consultancy" })).toBe("Consultancy · Marine Force");
    expect(sourceLabel("Agency", { name: "Costa Maritime", kind: "Agency" })).toBe("Agency · Costa Maritime");
    expect(sourceLabel("Meta", null)).toBe("Meta");
    expect(sourceLabel("Walk-in", null)).toBe("Walk-In");
    expect(sourceLabel("Public registration", null)).toBe("Online");
  });
});
