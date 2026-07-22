import { describe, expect, it } from "vitest";
import { calculateOffer, derivePaymentStatus, generateReference, isCertificateEligible, suggestAttendanceStatus } from "../lib/domain";

describe("financial domain", () => {
  it("derives split payment states from immutable events", () => {
    expect(derivePaymentStatus([{ type: "charge", amountCentavos: 500_000 }])).toBe("Unpaid");
    expect(derivePaymentStatus([{ type: "charge", amountCentavos: 500_000 }, { type: "payment", amountCentavos: 200_000 }])).toBe("Partially Paid");
    expect(derivePaymentStatus([{ type: "charge", amountCentavos: 500_000 }, { type: "payment", amountCentavos: 500_000 }])).toBe("Paid");
    expect(derivePaymentStatus([], true)).toBe("Cancelled");
  });

  it("calculates partner payable and validates impossible rebates", () => {
    expect(calculateOffer(550_000, 130_000)).toEqual({ trainingFeeCentavos: 550_000, rebateCentavos: 130_000, partnerPayableCentavos: 420_000 });
    expect(() => calculateOffer(100, 101)).toThrow();
  });
});

describe("training domain", () => {
  it("uses attendance duration and late threshold", () => {
    const starts = new Date("2026-07-23T00:00:00Z");
    expect(suggestAttendanceStatus({ sessionStartsAt: starts, checkedInAt: new Date("2026-07-23T00:05:00Z"), checkedOutAt: new Date("2026-07-23T08:05:00Z"), lateThresholdMinutes: 15, minimumRequiredMinutes: 420 })).toBe("Present");
    expect(suggestAttendanceStatus({ sessionStartsAt: starts, checkedInAt: new Date("2026-07-23T00:20:00Z"), checkedOutAt: new Date("2026-07-23T08:20:00Z"), lateThresholdMinutes: 15, minimumRequiredMinutes: 420 })).toBe("Late");
    expect(suggestAttendanceStatus({ sessionStartsAt: starts, checkedInAt: starts, checkedOutAt: new Date("2026-07-23T02:00:00Z"), lateThresholdMinutes: 15, minimumRequiredMinutes: 420 })).toBe("Incomplete");
  });

  it("blocks certificates until every eligibility gate passes", () => {
    const ready = { attendance: ["Present", "Late"] as const, instructorSubmitted: true, operationsVerified: true, templateActive: true, certificateNumberAvailable: true, legalNameConfirmed: true };
    expect(isCertificateEligible(ready)).toBe(true);
    expect(isCertificateEligible({ ...ready, templateActive: false })).toBe(false);
    expect(isCertificateEligible({ ...ready, attendance: ["Make-Up Required"] })).toBe(false);
  });

  it("generates stable operational references", () => expect(generateReference("ENR", 42, 2026)).toBe("ENR-2026-000042"));
});
