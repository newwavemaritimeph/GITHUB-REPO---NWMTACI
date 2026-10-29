/**
 * Request fee rules: the Refund Policy printed on the TAR (owner, 29 Oct 2026; replaces 8 Oct), counted
 * from the date the trainee asked to the training start date (Manila dates):
 * - 5 or more days before → ₱350.00 processing fee;
 * - under 5 days, on or after the start → 50% of the course fee + ₱250.00.
 * Rescheduling and Cancellation are charged this fee; a Refund keeps it as the deduction and returns the rest.
 * Other request types use the fee the Cashier picks (Schedule of fees).
 */
export const FLAT_FEE = 35000;
export const SERVICE_CHARGE = 25000;
/** Requests whose policy fee is attached as a charge. */
export const RULED_REQUESTS = ["Rescheduling", "Cancellation"] as const;
const MIN_DAYS: Record<string, number> = { Rescheduling: 5, Cancellation: 5, Refund: 5 };

const peso = (v: number) => `₱${(v / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round(dayNumber(toIso) - dayNumber(fromIso));
}

export function requestFee({ type, trainingFeeCentavos, startDate, requestedOn }: { type: string; trainingFeeCentavos: number; startDate?: string | null; requestedOn: string }) {
  const min = MIN_DAYS[type];
  if (min === undefined) return null;
  if (!startDate) return { amountCentavos: FLAT_FEE, daysBefore: null as number | null, rule: `No training date yet: ${peso(FLAT_FEE)}` };
  const daysBefore = daysBetween(requestedOn, startDate);
  const when = daysBefore > 1 ? `${daysBefore} days before the start` : daysBefore === 1 ? "1 day before the start" : daysBefore === 0 ? "on the start date" : "after the start";
  if (daysBefore >= min) return { amountCentavos: FLAT_FEE, daysBefore, rule: `${when}: ${peso(FLAT_FEE)}` };
  const half = Math.round(trainingFeeCentavos / 2);
  return { amountCentavos: half + SERVICE_CHARGE, daysBefore, rule: `${when}: 50% of ${peso(trainingFeeCentavos)} + ${peso(SERVICE_CHARGE)}` };
}

/** What a Refund returns: everything paid less the policy deduction, never below zero. */
export const refundAfterDeduction = (paidCentavos: number, deductionCentavos: number) => Math.max(0, paidCentavos - deductionCentavos);
