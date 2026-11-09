import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { directBatchChange } from "@/lib/scheduling";

describe("Registration's Change Schedule (owner, 9 Nov 2026)", () => {
  it("is offered only while the Cashier has recorded no payment, on a batch, not cancelled", () => {
    expect(directBatchChange({ batch_id: "b", enrollment_status: "Pending", paid_centavos: 0 })).toBe(true);
    expect(directBatchChange({ batch_id: "b", enrollment_status: "Enrolled", paid_centavos: "0" })).toBe(true);
    expect(directBatchChange({ batch_id: "b", enrollment_status: "Pending", paid_centavos: 50000 })).toBe(false);
    expect(directBatchChange({ batch_id: null, enrollment_status: "Pending", paid_centavos: 0 })).toBe(false);
    expect(directBatchChange({ batch_id: "b", enrollment_status: "Cancelled", paid_centavos: 0 })).toBe(false);
  });
  it("is checked again on the server against the Cashier's payments, and audited", () => {
    const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
    const handler = route.slice(route.indexOf('if (input.action === "registration-change-batch")'), route.indexOf('if (input.action === "application-enroll")'));
    expect(handler).toContain("canRegister(staff.roleCodes)");
    expect(handler).toContain('from("payment_allocations")');
    expect(handler).toContain("enrollment.batch_changed");
    expect(handler).toContain("applyReschedule(admin, en.id, nb.id)");
  });
});
