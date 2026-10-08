/**
 * Certificate rules (owner, 8 Oct 2026), shared by the server and the screens.
 * A certificate is due to print when the training has ended, the training fee
 * is settled and — for courses with a Google Forms evaluation — the evaluation
 * is in. It prints once; every paid Reprinting request or Admin-approved void
 * allows one more print. A due certificate not printed by the end of its due
 * day is overdue (red alarm for the Releasing Officer and the Admin).
 */

export type CertificateState = "Training not finished" | "Waiting for payment" | "Waiting for evaluation" | "Due" | "Printed" | "Released" | "Void requested" | "Cancelled";

export type CertificateFacts = {
  enrollmentStatus: string;
  /** Last training day (YYYY-MM-DD), or null when not scheduled. */
  trainingEnd: string | null;
  balanceCentavos: number;
  evaluationRequired: boolean;
  /** Day the evaluation came in (YYYY-MM-DD), or null. */
  evaluationOn: string | null;
  /** Day the fee was fully settled (latest payment day), or null. */
  paidOn: string | null;
  cert: { status: string; printCount: number; reprintsAllowed: number; voidStatus?: string | null } | null;
};

export type CertificateView = { state: CertificateState; dueOn: string | null; overdue: boolean; printsLeft: number; printsAllowed: number; printCount: number };

const later = (...days: (string | null)[]) => days.filter((d): d is string => !!d).sort().at(-1) ?? null;

export function certificateState(f: CertificateFacts, today: string): CertificateView {
  const printCount = f.cert?.printCount ?? 0;
  const printsAllowed = 1 + (f.cert?.reprintsAllowed ?? 0);
  const printsLeft = Math.max(0, printsAllowed - printCount);
  const base = { printCount, printsAllowed, printsLeft };
  if (f.cert?.status === "Cancelled" || f.enrollmentStatus === "Cancelled") return { ...base, state: "Cancelled", dueOn: null, overdue: false };
  if (f.cert?.voidStatus === "Requested") return { ...base, state: "Void requested", dueOn: null, overdue: false };
  if (f.cert?.status === "Released") return { ...base, state: "Released", dueOn: null, overdue: false };
  if (printCount > 0) return { ...base, state: "Printed", dueOn: null, overdue: false };
  if (!f.trainingEnd || f.trainingEnd > today) return { ...base, state: "Training not finished", dueOn: null, overdue: false };
  if (f.balanceCentavos > 0) return { ...base, state: "Waiting for payment", dueOn: null, overdue: false };
  if (f.evaluationRequired && !f.evaluationOn) return { ...base, state: "Waiting for evaluation", dueOn: null, overdue: false };
  const dueOn = later(f.trainingEnd, f.paidOn, f.evaluationRequired ? f.evaluationOn : null);
  return { ...base, state: "Due", dueOn, overdue: !!dueOn && dueOn < today };
}

/** Whether a print (first print or an allowed reprint) may happen now. */
export const canPrint = (v: CertificateView) => (v.state === "Due" || v.state === "Printed" || v.state === "Released") && v.printsLeft > 0;

/** "NWM-BT-" + 1245 padded to 5 → "NWM-BT-01245". */
export const formatCertificateNumber = (prefix: string, next: number, pad: number) => `${prefix}${String(Math.max(1, Math.trunc(next))).padStart(Math.max(1, Math.min(10, pad)), "0")}`;

/** The Google Form ID from a pasted Forms link (or the ID itself). */
export function googleFormId(input: string | null | undefined) {
  const v = (input ?? "").trim();
  if (!v) return null;
  const m = v.match(/\/forms\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{10,}$/.test(v) ? v : null;
}

/** The Drive file ID from a pasted Drive link (or the ID itself). */
export function driveFileId(input: string | null | undefined) {
  const v = (input ?? "").trim();
  if (!v) return null;
  const m = v.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) ?? v.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{20,}$/.test(v) ? v : null;
}
