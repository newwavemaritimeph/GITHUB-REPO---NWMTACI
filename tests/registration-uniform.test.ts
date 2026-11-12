import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itemLines } from "@/components/portal/live-cashier";

// Uniform in Registration · Design 2 (owner, 10 Nov 2026): Registration ticks the items at the hand-over; the Cashier collects them.
const data = {
  enrollments: [
    { id: "e1", trainee_id: "t1", enrollment_status: "Pending" },
    { id: "e2", trainee_id: "t1", enrollment_status: "Cancelled" },
    { id: "e3", trainee_id: "t2", enrollment_status: "Pending" },
  ],
  pendingItems: [
    { id: "i1", enrollment_id: "e1", charge_catalog_id: "u", description: "Uniform x 2", amount_centavos: 30000, created_at: "2026-11-10T01:00:00Z" },
    { id: "i2", enrollment_id: "e2", charge_catalog_id: "u", description: "Uniform", amount_centavos: 15000, created_at: "2026-11-10T01:00:00Z" },
    { id: "i3", enrollment_id: "e3", charge_catalog_id: "u", description: "Uniform", amount_centavos: 15000, created_at: "2026-11-10T01:00:00Z" },
  ],
} as unknown as Parameters<typeof itemLines>[0];

describe("Items Registration adds at the hand-over", () => {
  it("open in the Cashier's Record Payment as lines tied to the charge, for that trainee's live courses only", () => {
    const lines = itemLines(data, "t1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ chargeId: "i1", description: "Uniform x 2", unit: 30000, quantity: 1, enrollmentId: "e1", kind: "item" });
    expect(itemLines(data, "nobody")).toEqual([]);
  });
  it("are ticked at Registration's hand-over and sent with it", () => {
    const reg = readFileSync("components/portal/live-registration.tsx", "utf8");
    expect(reg).toContain("Items to Collect");
    expect(reg).toContain('action: "application-handover", enrollmentId: e.id, ...(chosen.length ? { items: chosen } : {})');
  });
  it("leave the Cashier without its own Add Miscellaneous Charge", () => {
    const cashier = readFileSync("components/portal/live-cashier.tsx", "utf8");
    expect(cashier).not.toContain("Add Miscellaneous Charge");
    expect(cashier).toContain("...(x.chargeId ? { chargeId: x.chargeId } : {})");
  });
  it("are written as unpaid charges and settled as written, never approved by Accounting", () => {
    const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
    const handover = route.slice(route.indexOf('if (input.action === "application-handover")'), route.indexOf('if (input.action === "application-enroll-charge")'));
    expect(handover).toContain('c.kind === "item"');
    expect(handover).toContain('action: "item.added"');
    expect(route).toContain("if (item.chargeId) {");
    expect(route).toContain("keep: true");
    expect(route).toContain(".filter((x) => !x.keep)");
    expect(route).toContain("return (data ?? []).filter((c) => (!c.charge_catalog_id || !items.has(c.charge_catalog_id as string)) && !isSpecialCharge(c as { description: string }));");
  });
});
