import { describe, expect, it } from "vitest";
import { normaliseReferralCode, rebateFor, suggestReferralCode } from "@/lib/referral";

describe("referral codes", () => {
  it("normalises what the applicant types", () => {
    expect(normaliseReferralCode(" qmcs-050698 ")).toBe("QMCS050698");
    expect(normaliseReferralCode("123 456 789")).toBe("123456789");
    expect(normaliseReferralCode("ab1")).toBeNull();
    expect(normaliseReferralCode("A".repeat(21))).toBeNull();
    expect(normaliseReferralCode(undefined)).toBeNull();
  });
  it("suggests a code from the agency name and six digits", () => {
    expect(suggestReferralCode("Qapla Maritime", () => 0.482913)).toBe("QAPLA482913");
    expect(suggestReferralCode("Costa", () => 0.000042)).toBe("COSTA000042");
    expect(suggestReferralCode("123", () => 0.5)).toBe("NW500000");
  });
  it("finds the rebate for the agency and course", () => {
    const matrix = [{ agency_id: "a", course_id: "c1", rebate_centavos: 30000 }, { agency_id: "b", course_id: "c1", rebate_centavos: 50000 }];
    expect(rebateFor("a", "c1", matrix)).toBe(30000);
    expect(rebateFor("a", "c2", matrix)).toBe(0);
  });
});

import { referralAction } from "@/lib/referral";

describe("rebate handling per agency", () => {
  it("deducts at any time, or owes the agency once paid", () => {
    expect(referralAction("Deducted", false)).toBe("discount");
    expect(referralAction(undefined, true)).toBe("discount");
    expect(referralAction("No deduction", false)).toBe("skip");
    expect(referralAction("No deduction", true)).toBe("payable");
  });
});

import { referralRebate } from "@/lib/referral";

describe("rebate as a percentage of the training fee", () => {
  it("uses 50% of the actual fee on in-house courses, else the peso table", () => {
    expect(referralRebate({ percent: 50, inHouse: true, feeCentavos: 130000, matrixCentavos: 30000 })).toBe(65000);
    expect(referralRebate({ percent: 50, inHouse: true, feeCentavos: 180001, matrixCentavos: 0 })).toBe(90001);
    expect(referralRebate({ percent: 50, inHouse: false, feeCentavos: 130000, matrixCentavos: 30000 })).toBe(30000);
    expect(referralRebate({ percent: null, inHouse: true, feeCentavos: 130000, matrixCentavos: 30000 })).toBe(30000);
  });
});

import { rebateRowsProblem, isStcwRebateCourse } from "@/lib/rebates";
describe("Rebates per Agency, Design 3", () => {
  it("uses the fixed peso amount for the five STCW courses, the percentage for other In-House courses", () => {
    expect(referralRebate({ percent: 50, inHouse: true, feeCentavos: 180000, matrixCentavos: 30000, courseCode: "UBT-PSSR" })).toBe(30000);
    expect(referralRebate({ percent: 50, inHouse: true, feeCentavos: 250000, matrixCentavos: 0, courseCode: "ccmd" })).toBe(0);
    expect(referralRebate({ percent: 20, inHouse: true, feeCentavos: 150000, matrixCentavos: 30000, courseCode: "HPT" })).toBe(30000);
    expect(isStcwRebateCourse("PSCMHBT")).toBe(true);
    expect(isStcwRebateCourse("SFA")).toBe(false);
  });
  it("refuses a percentage outside 1–100 and an STCW rebate above the fee", () => {
    const stcw = [{ courseId: "c", label: "BT-PSSR", feeCentavos: 180000, cents: 30000 }];
    expect(rebateRowsProblem([{ name: "A", percent: 25, stcw }])).toBeNull();
    expect(rebateRowsProblem([{ name: "A", percent: null, stcw }])).toBeNull();
    expect(rebateRowsProblem([{ name: "A", percent: 120, stcw }])).toMatch(/1 to 100/);
    expect(rebateRowsProblem([{ name: "A", percent: 10, stcw: [{ ...stcw[0], cents: 200000 }] }])).toMatch(/more than its training fee/);
  });
});
