"use client";

import type { PortalData } from "../portal-live-app";
import { askReason } from "./dialogs";
import { REASONS } from "./reject-inline";

/**
 * Payment voids (owner, 29 Oct 2026): the Cashier requests a void with a reason, Accounting approves or
 * rejects it. A voided payment stays listed as VOID with its reason.
 */
export type VoidablePayment = { id: string; payment_number: string; amount_centavos: number; method: string; valid?: boolean | null; void_reason?: string | null };

export function voidStateOf(data: Pick<PortalData, "paymentVoids">, p: Pick<VoidablePayment, "id" | "valid" | "void_reason">) {
  if (p.valid === false) return { state: "Void" as const, note: p.void_reason ?? "" };
  const reqs = (data.paymentVoids ?? []).filter((r) => r.payment_id === p.id);
  const pending = reqs.find((r) => r.status === "Pending");
  if (pending) return { state: "Requested" as const, note: pending.reason };
  const rejected = reqs.find((r) => r.status === "Rejected");
  return { state: "Valid" as const, note: rejected ? `Void rejected: ${rejected.decision_remarks ?? ""}` : "" };
}

type Post = (body: Record<string, unknown>, successText?: string) => Promise<unknown>;

/** The one status a payment shows (owner, 5 Nov 2026): any payment that is not void is valid, so Valid no longer shows on its own. */
export function paymentStatus(data: Pick<PortalData, "paymentVoids">, payment: Pick<VoidablePayment, "id" | "valid" | "void_reason"> & { verification_state?: string | null }) {
  const s = voidStateOf(data, payment);
  if (s.state === "Void") return { label: "VOID", tone: "cancelled", note: s.note, canVoid: false };
  if (s.state === "Requested") return { label: "Void Requested", tone: "orange", note: s.note, canVoid: false };
  const v = payment.verification_state ?? "Verified";
  return { label: v === "Duplicate Review" ? "Duplicate Reference" : v, tone: v === "Verified" ? "active" : "orange", note: s.note, canVoid: true };
}

async function askVoid(payment: VoidablePayment, post: Post) {
  const reason = await askReason(`Void ${payment.payment_number} (${payment.method}, ₱${(Number(payment.amount_centavos) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })})? Accounting approves it.`, REASONS.paymentVoid, { title: "Request Void", okLabel: "Send to Accounting" });
  if (!reason || reason.trim().length < 5) return;
  await post({ action: "payment-void-request", paymentId: payment.id, reason: reason.trim() }, "Void request sent to Accounting.").catch(() => undefined);
}

/** The printer on a payment row's print or reprint icon. */
export const PrintGlyph = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></svg>;

/** The crossed circle on a payment row's void icon. */
export const VoidGlyph = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></svg>;

/** The line above each day of a payment list (Payment Row 6 + 9): how many that day and their valid total, over the Amount column. */
export const PaymentDayRow = ({ day, count, total, span }: { day: string; count: number; total: string; span: number }) => <tr className="pv-dayrow"><td data-l="" colSpan={span}>{day} · {count} Payment{count === 1 ? "" : "s"}</td><td data-l="" className="r cx-amt">{total}</td><td data-l="" /></tr>;

/** Request Void as a small icon, named on hover. */
export function RequestVoidIcon({ payment, busy, post }: { payment: VoidablePayment; busy: boolean; post: Post }) {
  return <button type="button" className="pv-icon d" title="Request Void" aria-label={`Request Void ${payment.payment_number}`} disabled={busy} onClick={() => void askVoid(payment, post)}><VoidGlyph /></button>;
}
