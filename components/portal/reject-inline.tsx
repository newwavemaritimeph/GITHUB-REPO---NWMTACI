"use client";

import { useState } from "react";

/**
 * Reject with a reason, inside the list (owner's choice, design 2, 8 Oct 2026).
 * Replaces the browser's "Reason for rejecting?" box: the row opens in place
 * with a reason list and a note for the Cashier. The reason is required.
 */
const OTHER = "Other";
export const EXPENSE_REASONS = ["Missing or Unclear Receipt", "Amount Does Not Match the Receipt", "Wrong Category", "Not an Approved Expense", "Duplicate Request", OTHER];
export const REQUEST_REASONS = ["Not Covered by the Policy", "Missing Documents", "Amount Is Incorrect", "Duplicate Request", OTHER];

/** Why a request is raised (owner, 4 Nov 2026: "Include drop down for reasoning"). The note is optional, and required for Other. */
export const REASONS = {
  Rescheduling: ["Trainee's Request", "Joining a Vessel", "Medical Reason", "Family Emergency", "Batch Moved or Cancelled", OTHER],
  "Change Course": ["Wrong Course Selected", "Company or Agency Requirement", "Trainee's Request", "Course Not Available", OTHER],
  "Make-up Class": ["Missed Class · Medical", "Missed Class · Family Emergency", "Missed Class · Joining a Vessel", "Late Arrival", OTHER],
  Cancellation: ["Trainee's Request", "Joining a Vessel", "Medical Reason", "Family Emergency", "Requirements Not Met", OTHER],
  Refund: ["Trainee Cancelled", "Course Cancelled by New Wave", "Overpayment", "Duplicate Payment", OTHER],
  Reprinting: ["Misprint", "Wrong Name or Details", "Lost by the Trainee", "Damaged", OTHER],
  "TAR reprint": ["Misprint", "Lost by the Trainee", "Damaged", OTHER],
  voucherReprint: ["Misprint", "Lost", "Damaged", OTHER],
  voucherVoid: ["Wrong Payee", "Wrong Amount", "Duplicate Voucher", "Expense Cancelled", OTHER],
  paymentVoid: ["Wrong Amount Entered", "Wrong Trainee", "Wrong Mode or Reference", "Duplicate Entry", "Payment Did Not Push Through", OTHER],
  discount: ["Agency Rebate", "Company Arrangement", "Promo", "Approved by Management", OTHER],
  proofNotValid: ["Reference Not Found", "Amount Does Not Match", "Unclear Proof", "Duplicate Proof", OTHER],
  billingVoid: ["Wrong Amounts", "Wrong Coverage Dates", "Wrong Partner", OTHER],
  incomeVoid: ["Wrong Amount", "Wrong Source", "Duplicate Entry", OTHER],
  certificateVoid: ["Misprint", "Wrong Name or Details", "Damaged While Printing", OTHER],
  cancelEnrollment: ["Trainee's Request", "Duplicate Enrollment", "Requirements Not Met", OTHER],
};

/** Why a request is rejected, per type. */
export const REJECT_REASONS = {
  expense: EXPENSE_REASONS,
  request: REQUEST_REASONS,
  voucherReprint: ["Reason Not Valid", "Already Reprinted", "Original Still Available", "Duplicate Request", OTHER],
  refund: ["Not Covered by the Policy", "Amount Is Incorrect", "Missing Documents", "Duplicate Request", OTHER],
  discount: ["Not Covered by the Policy", "Amount Is Incorrect", "No Approval on File", "Duplicate Request", OTHER],
  paymentVoid: ["Payment Is Correct", "Reason Not Valid", "Missing Proof", "Duplicate Request", OTHER],
  certificateVoid: ["Certificate Is Correct", "Reason Not Valid", "Duplicate Request", OTHER],
};

export type ReasonValue = { reason: string; note: string };
export const NO_REASON: ReasonValue = { reason: "", note: "" };
/** Stored as text, "Reason — Note", in the same fields as before. */
export const reasonText = (v: ReasonValue) => [v.reason === OTHER ? "" : v.reason, v.note.trim()].filter(Boolean).join(" — ");
export const reasonReady = (v: ReasonValue) => !!v.reason && (v.reason !== OTHER || !!v.note.trim());

export function ReasonField({ reasons, value, onChange, label = "Reason", noteLabel = "Note", notePlaceholder, autoFocus }: { reasons: string[]; value: ReasonValue; onChange: (v: ReasonValue) => void; label?: string; noteLabel?: string; notePlaceholder?: string; autoFocus?: boolean }) {
  return <>
    <label>{label}<select value={value.reason} autoFocus={autoFocus} onChange={(e) => onChange({ ...value, reason: e.target.value })}><option value="">Choose a Reason</option>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
    <label>{noteLabel}<input value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} placeholder={value.reason === OTHER ? "Required for Other" : notePlaceholder ?? "Optional"} /></label>
  </>;
}

export function RejectInline({ reasons = REQUEST_REASONS, busy, onReject, onCancel }: { reasons?: string[]; busy?: boolean; onReject: (remarks: string) => void; onCancel: () => void }) {
  const [why, setWhy] = useState<ReasonValue>(NO_REASON);
  const needsNote = why.reason === OTHER && !why.note.trim();
  return <div className="rj" role="group" aria-label="Reject with a reason">
    <ReasonField reasons={reasons} value={why} onChange={setWhy} noteLabel="Note for the Cashier" notePlaceholder="e.g. Attach the official receipt and resubmit" autoFocus />
    <div className="rj-acts">
      {needsNote && <span className="rj-err">Add a note for Other.</span>}
      <button type="button" className="portal-secondary" onClick={onCancel}>Keep</button>
      <button type="button" className="rj-btn" disabled={busy || !reasonReady(why)} onClick={() => onReject(reasonText(why))}>Reject Request</button>
    </div>
  </div>;
}
