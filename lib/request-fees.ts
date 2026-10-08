/**
 * Request fee rules (owner, 8 Oct 2026), counted from the date the trainee
 * asked to the training start date (Manila dates):
 * - Rescheduling: 3 or more days before → ₱300.00; 1–2 days before, on or
 *   after the start → 50% of the training fee + ₱250.00.
 * - Cancellation: 5 or more days before → ₱300.00; under 5 days, on or after
 *   the start → 50% of the training fee + ₱250.00 service charge.
 * Other request types use the fee the Cashier picks (Schedule of fees).
 */
export const FLAT_FEE = 30000;
export const SERVICE_CHARGE = 25000;
export const RULED_REQUESTS = ["Rescheduling", "Cancellation"] as const;
const MIN_DAYS: Record<(typeof RULED_REQUESTS)[number], number> = { Rescheduling: 3, Cancellation: 5 };

const peso = (v: number) => `₱${(v / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round(dayNumber(toIso) - dayNumber(fromIso));
}

export function requestFee({ type, trainingFeeCentavos, startDate, requestedOn }: { type: string; trainingFeeCentavos: number; startDate?: string | null; requestedOn: string }) {
  if (!(RULED_REQUESTS as readonly string[]).includes(type)) return null;
  const min = MIN_DAYS[type as (typeof RULED_REQUESTS)[number]];
  if (!startDate) return { amountCentavos: FLAT_FEE, daysBefore: null as number | null, rule: `No training date yet: ${peso(FLAT_FEE)}` };
  const daysBefore = daysBetween(requestedOn, startDate);
  const when = daysBefore > 1 ? `${daysBefore} days before the start` : daysBefore === 1 ? "1 day before the start" : daysBefore === 0 ? "on the start date" : "after the start";
  if (daysBefore >= min) return { amountCentavos: FLAT_FEE, daysBefore, rule: `${when}: ${peso(FLAT_FEE)}` };
  const half = Math.round(trainingFeeCentavos / 2);
  return { amountCentavos: half + SERVICE_CHARGE, daysBefore, rule: `${when}: 50% of ${peso(trainingFeeCentavos)} + ${peso(SERVICE_CHARGE)}` };
}
