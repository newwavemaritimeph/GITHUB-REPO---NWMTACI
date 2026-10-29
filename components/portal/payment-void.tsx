"use client";

import type { PortalData } from "../portal-live-app";
import { askText } from "./dialogs";
import { Badge } from "./shared-ui";

/**
 * Payment voids (owner, 29 Oct 2026): the Cashier requests a void with a reason, Accounting approves or
 * rejects it. A voided payment stays listed as VOID with its reason.
 */
export type VoidablePayment = { id: string; payment_number: string; amount_centavos: number; method: string; valid?: boolean | null; void_reason?: string | null };

export function voidStateOf(data: PortalData, p: VoidablePayment) {
  if (p.valid === false) return { state: "Void" as const, note: p.void_reason ?? "" };
  const reqs = (data.paymentVoids ?? []).filter((r) => r.payment_id === p.id);
  const pending = reqs.find((r) => r.status === "Pending");
  if (pending) return { state: "Requested" as const, note: pending.reason };
  const rejected = reqs.find((r) => r.status === "Rejected");
  return { state: "Valid" as const, note: rejected ? `Void rejected: ${rejected.decision_remarks ?? ""}` : "" };
}

/** Status chip and, for the Cashier, the Request Void button. */
export function PaymentVoidCell({ data, payment, canRequest, busy, post }: { data: PortalData; payment: VoidablePayment; canRequest: boolean; busy: boolean; post: (body: Record<string, unknown>, successText?: string) => Promise<unknown> }) {
  const s = voidStateOf(data, payment);
  async function request() {
    const reason = await askText(`Void ${payment.payment_number} (${payment.method}, ₱${(Number(payment.amount_centavos) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })})? Accounting approves it. Reason:`, "", { title: "Request Void", okLabel: "Send to Accounting" });
    if (!reason || reason.trim().length < 5) return;
    await post({ action: "payment-void-request", paymentId: payment.id, reason: reason.trim() }, "Void request sent to Accounting.").catch(() => undefined);
  }
  return <span className="pv-cell">
    {s.state === "Void" ? <Badge tone="cancelled">VOID</Badge> : s.state === "Requested" ? <Badge tone="orange">Void Requested</Badge> : <Badge tone="active">Valid</Badge>}
    {s.note && <small>{s.note}</small>}
    {canRequest && s.state === "Valid" && <button type="button" className="ghost-button" disabled={busy} onClick={() => void request()}>Request Void</button>}
  </span>;
}
