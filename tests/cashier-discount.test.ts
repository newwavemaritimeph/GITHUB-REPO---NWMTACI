import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscountStatus } from "@/components/portal-live-app";

// Discount Request · Design 2 (owner, 10 Nov 2026): the Cashier asks from the Trainee Account and sees Accounting's answer.
const data = {
  pendingDiscounts: [{ id: "d1", enrollment_id: "e1", description: "Promo", amount_centavos: 20000, created_at: "2026-11-10T01:00:00Z", requested_by_name: "Sample Cashier" }],
  rejectedDiscounts: [{ id: "d2", enrollment_id: "e3", amount_centavos: 50000, decided_at: "2026-11-09T02:00:00Z", reason: "Not Covered by the Policy" }],
};
const status = (id: string, discounts = 0) => renderToStaticMarkup(createElement(DiscountStatus, { data, e: { id, discounts_centavos: discounts } }));

describe("Cashier discount requests to Accounting", () => {
  it("shows a course's discount as waiting, approved or rejected with the reason", () => {
    expect(status("e1")).toContain("Waiting for Accounting");
    expect(status("e2", 30000)).toContain("Approved");
    expect(status("e2", 30000)).toContain("300");
    expect(status("e3")).toContain("Rejected · Not Covered by the Policy");
    expect(status("e4")).toBe("");
  });
  it("gives the Cashier Request ▾ › Discount in the Trainee Account, and tells Accounting who asked", () => {
    const app = readFileSync("components/portal-live-app.tsx", "utf8");
    expect(app).toContain('const canDiscount=!!reload&&role==="cashier"');
    expect(app).toContain("setDiscounting(true)}}>Discount</button>");
    expect(app).toContain('action:"discount-request"');
    expect(readFileSync("components/portal/accounting-home.tsx", "utf8")).toContain("requested_by_name ?? \"Cashier\"");
    const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
    expect(route).toContain('action: "discount.requested"');
    expect(route).toContain("rejectedDiscounts");
  });
  it("still keeps discount requests away from Registration's screens", () => {
    expect(readFileSync("components/portal/live-registration.tsx", "utf8")).not.toContain("discount-request");
  });
});
