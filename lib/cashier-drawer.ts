/**
 * Opening and Closing, Cash and GCash (owner, 11 Nov 2026). Shared by the closing screen and the server so the
 * expected amounts are worked out one way.
 *   Cash:  opening + cash collected (payments and other income) − cash expenses − bank deposits = expected in drawer
 *   GCash: opening + GCash collected − GCash expenses − GCash deposited to a bank = expected GCash balance
 */
export const BILLS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;

/** Pesos counted from the number of each bill and coin, in centavos. */
export const countedCentavos = (counts: Partial<Record<number, number>>) => BILLS.reduce((s, b) => s + b * 100 * Math.max(0, Math.floor(Number(counts[b]) || 0)), 0);

export type DayFigures = { openingCash: number; cashIn: number; cashExpenses: number; deposits: number; openingGcash: number; gcashIn: number; gcashExpenses: number; gcashDeposits?: number };
export function expectedOf(f: DayFigures) {
  return { cash: f.openingCash + f.cashIn - f.cashExpenses - f.deposits, gcash: f.openingGcash + f.gcashIn - f.gcashExpenses - (f.gcashDeposits ?? 0) };
}

/** Over (+) or short (−); a variance on either side needs remarks. */
export function closingCheck(f: DayFigures, countedCash: number, gcashActual: number) {
  const e = expectedOf(f);
  const cashVariance = countedCash - e.cash, gcashVariance = gcashActual - e.gcash;
  return { ...e, cashVariance, gcashVariance, needsRemarks: cashVariance !== 0 || gcashVariance !== 0 };
}

/** Which money belongs to which side: Cash, or the GCash channel; other channels are bank money. */
export const isCash = (channel?: string | null) => !channel || /^cash$/i.test(channel);
export const isGcash = (channel?: string | null) => !!channel && /^g-?cash$/i.test(channel.trim());
