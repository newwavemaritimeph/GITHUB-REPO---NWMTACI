/**
 * Consultancy group payments (owner, 12 Nov 2026): one transfer and one reference number for several trainees,
 * recorded once in Record Payment › Paid By: Consultancy. Each trainee still gets their own payment and receipt.
 */
export type GroupLine = { enrollmentId: string; amountCentavos: number };

/** Why a group payment cannot be recorded, or null. Balances are in centavos by enrollment id. */
export function groupProblem(g: { totalCentavos: number; reference: string; lines: GroupLine[]; balances: Map<string, number> }) {
  if (g.reference.trim().length < 3) return "Enter the reference number of the transfer.";
  if (!g.lines.length) return "Tick at least one trainee.";
  if (new Set(g.lines.map((l) => l.enrollmentId)).size !== g.lines.length) return "A course is listed twice.";
  if (g.lines.some((l) => !Number.isInteger(l.amountCentavos) || l.amountCentavos <= 0)) return "Every ticked trainee needs an amount.";
  const over = g.lines.find((l) => l.amountCentavos > (g.balances.get(l.enrollmentId) ?? 0));
  if (over) return "An amount is more than that trainee's balance.";
  const sum = g.lines.reduce((s, l) => s + l.amountCentavos, 0);
  if (sum !== g.totalCentavos) return "The trainees' amounts must add up to the transfer.";
  return null;
}

/** NWM-GRP-2026-0001 from next_reference("GRP") → GRP-2026-000001. */
export const groupNumber = (ref: string) => `NWM-${ref.replace(/-0*(\d+)$/, (_, n: string) => `-${n.padStart(4, "0")}`)}`;

/** The consultancy's enrollments with a balance, biggest balance first; the window ticks them all. */
export function consultancyOpen<T extends { id: string }>(enrollments: T[], agencyId: string, referralByEnrollment: Record<string, string> | undefined, balance: (e: T) => number) {
  return enrollments.filter((e) => referralByEnrollment?.[e.id] === agencyId && balance(e) > 0).sort((a, b) => balance(b) - balance(a));
}
