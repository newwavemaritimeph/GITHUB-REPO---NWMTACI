/**
 * Shared portal formatting and money helpers.
 *
 * These were duplicated between `components/portal-live-app.tsx` and
 * `components/portal/live-accounting.tsx` (`dueOf` was a byte-for-byte copy of
 * `dueCentavos`), which let the two screens drift. One definition each, here.
 */

/** A row that carries the money fields every enrollment balance is derived from. */
export type BillableEnrollment = {
  selling_price_centavos: number;
  charges_centavos?: number | null;
  discounts_centavos?: number | null;
  paid_centavos: number;
  enrollment_status?: string;
};

export const pesos = (centavos: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0 }).format((Number(centavos) || 0) / 100);

export const first = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/** Manila calendar day (YYYY-MM-DD) — directly comparable to date columns. */
export const manilaDay = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(value)) : "";
export const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/** Total billed: list price plus approved charges, less approved discounts. */
export const dueCentavos = (e: BillableEnrollment) =>
  Number(e.selling_price_centavos) + Number(e.charges_centavos ?? 0) - Number(e.discounts_centavos ?? 0);

/** Outstanding balance, never negative (an overpayment is not a negative debt). */
export const balanceOf = (e: BillableEnrollment) => Math.max(0, dueCentavos(e) - Number(e.paid_centavos));

/**
 * The single definition of "unpaid" across the portal: the trainee still owes
 * money on a live enrollment. Previously "Pending" meant *balance > 0* on the
 * Payments and Enrollment-reports screens but *status not yet Enrolled* on the
 * Enrollment summary, so the two reported different numbers for the same day.
 */
export const isUnpaid = (e: BillableEnrollment) => e.enrollment_status !== "Cancelled" && balanceOf(e) > 0;
