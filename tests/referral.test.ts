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
