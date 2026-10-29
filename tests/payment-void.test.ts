import { describe, expect, it } from "vitest";
import type { PortalData } from "@/components/portal-live-app";
import { voidStateOf } from "@/components/portal/payment-void";

const pay = { id: "p1", payment_number: "PAY-2026-000004", amount_centavos: 30000, method: "Cash" };
const data = (voids: { status: string; reason?: string; decision_remarks?: string | null }[]) => ({ paymentVoids: voids.map((v, i) => ({ id: `r${i}`, payment_id: "p1", reason: v.reason ?? "Recorded twice", status: v.status, requested_at: "2026-10-29T08:00:00Z", requested_by_name: "Cashier", decided_at: null, decision_remarks: v.decision_remarks ?? null })) }) as unknown as PortalData;

describe("payment void status", () => {
  it("is Valid with no request, Void Requested while Accounting decides, and VOID once voided", () => {
    expect(voidStateOf(data([]), pay).state).toBe("Valid");
    expect(voidStateOf(data([{ status: "Pending" }]), pay)).toEqual({ state: "Requested", note: "Recorded twice" });
    expect(voidStateOf(data([{ status: "Approved" }]), { ...pay, valid: false, void_reason: "Recorded twice" })).toEqual({ state: "Void", note: "Recorded twice" });
  });
  it("shows why a void was rejected and lets the Cashier ask again", () => {
    expect(voidStateOf(data([{ status: "Rejected", decision_remarks: "Separate fee" }]), pay)).toEqual({ state: "Valid", note: "Void rejected: Separate fee" });
  });
});
