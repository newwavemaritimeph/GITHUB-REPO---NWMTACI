import { describe, expect, it } from "vitest";
import { paidInFull, voucherChecks, type ReferralVoucherRow } from "@/lib/referral-voucher";

const row = (over: Partial<ReferralVoucherRow>): ReferralVoucherRow => ({ enrolledOn: "2026-11-03", trainee: "SAMPLE, A", courseCode: "BT", course: "Basic Training", rebateCentavos: 50_000, rebateId: "r1", feeCentavos: 550_000, paidCentavos: 550_000, ...over });

describe("detailed Referral Voucher (13 Nov 2026)", () => {
  it("calls a line paid in full only when the fee is known, above zero and fully paid", () => {
    expect(paidInFull(row({}))).toBe(true);
    expect(paidInFull(row({ paidCentavos: 100_000 }))).toBe(false);
    expect(paidInFull(row({ feeCentavos: 0, paidCentavos: 0 }))).toBe(false);
    expect(paidInFull({})).toBe(false);
  });
  it("checks unpaid lines, lines on another voucher, the payee and the total", () => {
    const rows = [row({}), row({ rebateId: "r2", trainee: "SAMPLE, B", paidCentavos: 0 })];
    const c = voucherChecks({ rows, totalCentavos: 100_000, mode: "Bank Transfer", payeeAccount: "" }, new Set(["r1"]));
    expect(c.map((x) => x.ok)).toEqual([false, false, false, true]);
    expect(c[0].text).toContain("SAMPLE, B");
    const ok = voucherChecks({ rows: [row({})], totalCentavos: 50_000, mode: "Offset at Payment" });
    expect(ok.every((x) => x.ok)).toBe(true);
  });
});
