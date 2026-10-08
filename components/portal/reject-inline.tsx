"use client";

import { useState } from "react";

/**
 * Reject with a reason, inside the list (owner's choice, design 2, 8 Oct 2026).
 * Replaces the browser's "Reason for rejecting?" box: the row opens in place
 * with a reason list and a note for the Cashier. The reason is required.
 */
export const EXPENSE_REASONS = ["Missing or unclear receipt", "Amount does not match the receipt", "Wrong category", "Not an approved expense", "Duplicate request", "Other"];
export const REQUEST_REASONS = ["Not covered by the policy", "Missing documents", "Amount is incorrect", "Duplicate request", "Other"];

export function RejectInline({ reasons = REQUEST_REASONS, busy, onReject, onCancel }: { reasons?: string[]; busy?: boolean; onReject: (remarks: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const needsNote = reason === "Other" && !note.trim();
  const remarks = [reason === "Other" ? "" : reason, note.trim()].filter(Boolean).join(" — ");
  return <div className="rj" role="group" aria-label="Reject with a reason">
    <label>Reason<select value={reason} autoFocus onChange={(e) => setReason(e.target.value)}><option value="">Choose a Reason</option>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
    <label>Note for the Cashier<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "Other" ? "Required for Other" : "e.g. Attach the official receipt and resubmit"} /></label>
    <div className="rj-acts">
      {needsNote && <span className="rj-err">Add a note for Other.</span>}
      <button type="button" className="portal-secondary" onClick={onCancel}>Keep</button>
      <button type="button" className="rj-btn" disabled={busy || !reason || needsNote} onClick={() => onReject(remarks)}>Reject Request</button>
    </div>
  </div>;
}
