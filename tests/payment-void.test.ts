import { describe, expect, it } from "vitest";
import type { PortalData } from "@/components/portal-live-app";
import { paymentStatus, voidStateOf } from "@/components/portal/payment-void";
import { voidReasons } from "@/lib/payment-void-reasons";

describe("reasons for voided payments", () => {
  const db = (result: { data: unknown; error: unknown }) => ({ from: () => ({ select: () => ({ in: async () => result }) }) }) as never;
  it("gives each voided payment's reason", async () => {
    const reasons = await voidReasons(db({ data: [{ id: "p1", void_reason: "Wrong amount" }, { id: "p2", void_reason: null }], error: null }), ["p1", "p2"]);
    expect([...reasons]).toEqual([["p1", "Wrong amount"]]);
  });
  it("leaves the list standing on a database without the column (live, 6 Nov 2026)", async () => {
    const reasons = await voidReasons(db({ data: null, error: { message: "column payments.void_reason does not exist" } }), ["p1"]);
    expect(reasons.size).toBe(0);
  });
});

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
  it("shows one status per payment: VOID, then Void Requested, then the reference check", () => {
    expect(paymentStatus(data([]), { ...pay, verification_state: "Verified" })).toMatchObject({ label: "Verified", tone: "active", canVoid: true });
    expect(paymentStatus(data([]), { ...pay, verification_state: "Duplicate Review" })).toMatchObject({ label: "Duplicate Reference", tone: "orange", canVoid: true });
    expect(paymentStatus(data([{ status: "Pending" }]), { ...pay, verification_state: "Verified" })).toMatchObject({ label: "Void Requested", note: "Recorded twice", canVoid: false });
    expect(paymentStatus(data([]), { ...pay, valid: false, void_reason: "Recorded twice", verification_state: "Verified" })).toMatchObject({ label: "VOID", note: "Recorded twice", canVoid: false });
  });
});
