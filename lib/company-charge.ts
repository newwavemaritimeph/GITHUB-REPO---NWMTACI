/**
 * Company Charge (owner, 29 Oct 2026): partners like Marine Force are billed for their trainees
 * on the Billing Statement instead of the trainee paying at the Cashier. No rebate applies.
 */
export const COMPANY_CHARGE = "Company Charge";

/**
 * Splits one company payment across the statement's enrollments, in statement order, up to
 * each one's balance. Paying more than the statement still owes is refused.
 */
export function splitStatementPayment(amountCentavos: number, rows: { enrollmentId: string; balanceCentavos: number }[]) {
  const owed = rows.reduce((s, r) => s + Math.max(0, r.balanceCentavos), 0);
  if (amountCentavos <= 0) return { error: "Enter the amount received.", allocations: [] };
  if (amountCentavos > owed) return { error: `The statement only has ${(owed / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })} left to pay.`, allocations: [] };
  let left = amountCentavos;
  const allocations: { enrollmentId: string; amountCentavos: number }[] = [];
  for (const r of rows) {
    const a = Math.min(left, Math.max(0, r.balanceCentavos));
    if (a > 0) allocations.push({ enrollmentId: r.enrollmentId, amountCentavos: a });
    left -= a;
    if (!left) break;
  }
  return { error: null, allocations };
}

/** Where a trainee came from, as Registration sees it (owner, 29 Oct 2026). */
export function sourceLabel(source: string | null | undefined, partner: { name: string; kind?: string | null } | null) {
  if (partner) return `${partner.kind === "Consultancy" ? "Consultancy" : "Agency"} · ${partner.name}`;
  if (source === "Meta") return "Meta";
  if (source === "Walk-in") return "Walk-In";
  if (source === "Online enrollment" || source === "Public registration") return "Online";
  return source === "Agency" ? "Agency" : "";
}
