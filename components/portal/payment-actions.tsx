"use client";

import { useState } from "react";
import type { PortalData, Enrollment } from "../portal-live-app";
import { first, pesos } from "@/lib/portal-format";
import { Message, Modal, fmtDate } from "./shared-ui";

/**
 * Actions that sit next to a payment or an enrollment: raising a request for
 * the Accounting Manager, and (from Phase 2) the payment hub and its tabs.
 * Shared by the Registration, Cashier and Accounting workspaces.
 */

export type RequestType = "Cancellation" | "Refund" | "Make-up Class" | "Rescheduling" | "Reprinting" | "Change Course";

/**
 * Raise a request against an enrollment. The server records it as Pending and
 * the Accounting Manager decides it; approved changes are applied there, never
 * here. `allow` narrows the type picker for roles that may raise only some.
 */
export function RequestActionModal({ data, enrollment, reqType, onClose, post, embedded }: { data: PortalData; enrollment: Enrollment; reqType: RequestType; onClose: () => void; post: (body: Record<string, unknown>) => Promise<unknown>; embedded?: boolean }) {
  const [batchId, setBatchId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [courseId, setCourseId] = useState(enrollment.course_id);
  const [offerId, setOfferId] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const batches = data.batches.filter((b) => b.course_id === enrollment.course_id && b.id !== enrollment.batch_id && b.status === "Open" && b.confirmed_count < b.capacity);
  const newCourse = data.courses.find((c) => c.id === courseId);
  const offers = data.offers.filter((o) => o.course_id === courseId);
  async function send() {
    if (!reason.trim()) { setErr("Enter a reason for the request."); return; }
    if (reqType === "Rescheduling" && !batchId) { setErr("Choose the new schedule."); return; }
    if (reqType === "Change Course") {
      if (!courseId) { setErr("Pick the new course."); return; }
      if (newCourse?.delivery_type === "Partner or Endorsed" && !offerId) { setErr("Pick an endorsed program."); return; }
    }
    const amt = Math.round(Number(amount) * 100);
    if (reqType === "Refund" && (!Number.isFinite(amt) || amt <= 0)) { setErr("Enter a valid refund amount."); return; }
    setBusy(true); setErr("");
    try {
      await post({ action: "request-raise", enrollmentId: enrollment.id, requestType: reqType, reason: reason.trim(),
        batchId: reqType === "Rescheduling" ? (batchId || null) : null,
        amountCentavos: reqType === "Refund" ? amt : undefined,
        courseId: reqType === "Change Course" ? courseId : undefined,
        partnerOfferId: reqType === "Change Course" ? (offerId || null) : undefined });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }
  const inner = <div className="portal-form">
    {err && <Message kind="error" text={err} />}
    <p className="portal-form-note full">Sent to the Accounting Manager for approval. On approval the change is applied automatically.</p>
    {reqType === "Rescheduling" && <label className="full">New schedule<select value={batchId} onChange={(e) => setBatchId(e.target.value)}><option value="">Select a schedule</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.batch_number} · {fmtDate(b.starts_on)}–{fmtDate(b.ends_on)} · {b.capacity - b.confirmed_count} slots</option>)}</select></label>}
    {reqType === "Change Course" && <>
      <label className="full">New course<select value={courseId} onChange={(e) => { setCourseId(e.target.value); setOfferId(""); }}>{data.courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
      {newCourse?.delivery_type === "Partner or Endorsed" && <label className="full">Endorsed program<select value={offerId} onChange={(e) => setOfferId(e.target.value)}><option value="">Select rate</option>{offers.map((o) => <option key={o.id} value={o.id}>{first(o.partner_centers)?.name} · {o.duration_label} · {pesos(o.training_fee_centavos)}</option>)}</select></label>}
    </>}
    {reqType === "Refund" && <label className="full">Refund amount (PHP)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
    <label className="full">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being requested?" /></label>
    <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Request approval"}</button></div>
  </div>;
  return embedded ? inner : <Modal title={`Request: ${reqType}`} onClose={onClose}>{inner}</Modal>;
}
