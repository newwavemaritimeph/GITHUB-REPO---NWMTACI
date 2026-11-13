import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noFeeSet } from "@/lib/portal-format";

const e = (over: Record<string, unknown>) => ({ selling_price_centavos: 0, charges_centavos: 0, discounts_centavos: 0, paid_centavos: 0, enrollment_status: "Pending", ...over }) as Parameters<typeof noFeeSet>[0];

describe("a ₱0 enrollment is No Fee Set, never Paid (13 Nov 2026)", () => {
  it("flags only a live ₱0 enrollment with nothing paid", () => {
    expect(noFeeSet(e({}))).toBe(true);
    expect(noFeeSet(e({ selling_price_centavos: 90_000 }))).toBe(false);
    expect(noFeeSet(e({ paid_centavos: 1 }))).toBe(false);
    expect(noFeeSet(e({ enrollment_status: "Cancelled" }))).toBe(false);
  });
  it("the Cashier status and Apply Fee use it; the server reprices only a ₱0, unpaid enrollment", () => {
    const cashier = readFileSync("components/portal/live-cashier.tsx", "utf8"), route = readFileSync("app/api/staff/operations/route.ts", "utf8");
    expect(cashier).toContain('noFeeSet(e) ? "No Fee Set" : balanceOf(e) === 0 ? "Paid"');
    expect(route).toContain('.eq("selling_price_centavos", 0).select("id")');
    expect(route).toContain('action: "enrollment.repriced"');
  });
});
