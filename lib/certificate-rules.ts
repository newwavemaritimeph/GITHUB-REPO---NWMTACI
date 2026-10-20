/**
 * Certificate rules (owner, 8 Oct 2026), shared by the server and the screens.
 * A certificate is due to print when the training has ended, the training fee
 * is settled and — for courses with a Google Forms evaluation — the evaluation
 * is in. It prints once; every paid Reprinting request or Admin-approved void
 * allows one more print. A due certificate not printed by the end of its due
 * day is overdue (red alarm for the Releasing Officer and the Admin).
 * The trainee's 2x2 photo must be on file before it prints (9 Oct 2026).
 * Since 20 Oct 2026 the evaluation is the portal's own form, required for every
 * New Wave course, and release needs the fee paid and the evaluation in.
 */

export type CertificateState = "Training not finished" | "Waiting for payment" | "Waiting for evaluation" | "Waiting for photo" | "Due" | "Printed" | "Released" | "Void requested" | "Cancelled" | "Revoked";

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
  /** revoked: the Admin revoked it (202610200047); it never prints again and the QR shows REVOKED. */
  cert: { status: string; printCount: number; reprintsAllowed: number; voidStatus?: string | null; revoked?: boolean } | null;
  /** False when the 2x2 photo is missing; undefined when photos are not tracked (before migration 202610090034). */
  photoOnFile?: boolean;
};

export type CertificateView = { state: CertificateState; dueOn: string | null; overdue: boolean; printsLeft: number; printsAllowed: number; printCount: number };

const later = (...days: (string | null)[]) => days.filter((d): d is string => !!d).sort().at(-1) ?? null;

export function certificateState(f: CertificateFacts, today: string): CertificateView {
  const printCount = f.cert?.printCount ?? 0;
  const printsAllowed = 1 + (f.cert?.reprintsAllowed ?? 0);
  const printsLeft = Math.max(0, printsAllowed - printCount);
  const base = { printCount, printsAllowed, printsLeft };
  if (f.cert?.status === "Cancelled" || f.enrollmentStatus === "Cancelled") return { ...base, state: "Cancelled", dueOn: null, overdue: false };
  if (f.cert?.revoked) return { ...base, printsLeft: 0, state: "Revoked", dueOn: null, overdue: false };
  if (f.cert?.voidStatus === "Requested") return { ...base, state: "Void requested", dueOn: null, overdue: false };
  if (f.cert?.status === "Released") return { ...base, state: "Released", dueOn: null, overdue: false };
  if (printCount > 0) return { ...base, state: "Printed", dueOn: null, overdue: false };
  if (!f.trainingEnd || f.trainingEnd > today) return { ...base, state: "Training not finished", dueOn: null, overdue: false };
  if (f.balanceCentavos > 0) return { ...base, state: "Waiting for payment", dueOn: null, overdue: false };
  if (f.evaluationRequired && !f.evaluationOn) return { ...base, state: "Waiting for evaluation", dueOn: null, overdue: false };
  if (f.photoOnFile === false) return { ...base, state: "Waiting for photo", dueOn: null, overdue: false };
  const dueOn = later(f.trainingEnd, f.paidOn, f.evaluationRequired ? f.evaluationOn : null);
  return { ...base, state: "Due", dueOn, overdue: !!dueOn && dueOn < today };
}

/**
 * Portal evaluation (owner, 20 Oct 2026): every New Wave In-House course needs it,
 * STCW included; endorsed partner courses do not.
 */
export const evaluationRequiredFor = (deliveryType: string | null | undefined, partnerOfferId: string | null | undefined) => deliveryType === "In-House" && !partnerOfferId;

/** Why a printed certificate cannot be released yet (owner, 20 Oct 2026: paid and evaluated), or null. */
export function releaseProblem(f: { balanceCentavos: number; evaluationRequired: boolean; evaluationOn: string | null; revoked?: boolean }) {
  if (f.revoked) return "This certificate is revoked.";
  if (f.balanceCentavos > 0) return "Not paid: the training fee still has a balance.";
  if (f.evaluationRequired && !f.evaluationOn) return "Evaluation not submitted yet.";
  return null;
}

/** Admin › Courses › Remove (owner, 20 Oct 2026): an unused course is deleted; a used one is archived. */
export const courseRemoveMode = (references: number) => (references > 0 ? "archive" as const : "delete" as const);

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

export type EvaluationCandidate = { id: string; code: string; categoryName: string | null; createdAt: string; hasEvaluation: boolean };

/**
 * Which enrollment a Google Forms evaluation belongs to, from the form's title
 * (e.g. "ATTENDANCE AND TRAINING EVALUATION SURVEY FORM - HPT-Hydraulic and
 * Pneumatic Training" → course code HPT; "POST TRAINING EVALUATION FORM - STCW
 * COURSES" → the trainee's STCW course). Enrollments still without an
 * evaluation come first, newest first. Null when it cannot be told apart.
 */
export function matchEvaluationEnrollment(title: string, candidates: EvaluationCandidate[]) {
  const t = ` ${title.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  const order = (list: EvaluationCandidate[]) => [...list].sort((a, b) => Number(a.hasEvaluation) - Number(b.hasEvaluation) || b.createdAt.localeCompare(a.createdAt));
  const byCode = candidates.filter((c) => { const code = c.code.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim(); return code.length >= 2 && t.includes(` ${code} `); });
  if (byCode.length) return order(byCode)[0].id;
  if (t.includes(" STCW ")) {
    const stcw = candidates.filter((c) => (c.categoryName ?? "").toUpperCase().includes("STCW"));
    if (stcw.length) return order(stcw)[0].id;
  }
  const open = candidates.filter((c) => !c.hasEvaluation);
  return open.length === 1 ? open[0].id : null;
}

/** STCW courses are told apart by their category name. */
export const isStcwCategory = (categoryName: string | null | undefined) => (categoryName ?? "").toUpperCase().includes("STCW");

/**
 * Who sets a course's certificate numbering (owner, 9 Oct 2026): the Releasing
 * Officer for In-House courses, the Admin for any course (STCW only the Admin).
 */
export const canSetSeries = (roles: string[], stcw: boolean) => roles.includes("admin") || (!stcw && roles.includes("releasing_officer"));

/**
 * Upload Many templates (owner, 20 Oct 2026): pairs each PDF file name with a course.
 * The course code as a whole word wins, longest code first ("HAZMAT-CFR Certificate.pdf"
 * beats HAZMAT); otherwise the full course name in the file name. Unmatched files get null.
 */
export function matchTemplateFiles(fileNames: string[], courses: { id: string; code: string; name: string }[]) {
  const norm = (s: string) => ` ${s.toUpperCase().replace(/\.PDF$/, "").replace(/[^A-Z0-9]+/g, " ").trim()} `;
  const byCode = [...courses].sort((a, b) => norm(b.code).length - norm(a.code).length);
  const byName = [...courses].sort((a, b) => norm(b.name).length - norm(a.name).length);
  return fileNames.map((file) => {
    const f = norm(file);
    const hit = byCode.find((c) => norm(c.code).trim() && f.includes(norm(c.code))) ?? byName.find((c) => norm(c.name).trim() && f.includes(norm(c.name)));
    return { file, courseId: hit?.id ?? null };
  });
}

/** Numbering (owner, 20 Oct 2026): the Certificate No. after the last one used; blank starts at 1. */
export const nextOf = (last: string) => Math.min(99999999, Math.max(0, Math.trunc(Number(last) || 0)) + 1);
