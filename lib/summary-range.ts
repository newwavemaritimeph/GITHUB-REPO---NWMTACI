import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/portal-format";

/**
 * Daily Summary over a period, Design 3 (owner, 10 Nov 2026, Accounting tab): totals, one bar per day's
 * collection, and the mode breakdown. Same rules as the single-day report: valid payments by received_at,
 * released (Paid) vouchers by paid_at, Manila days.
 */
export type SummaryDay = { day: string; receipts: number; collectedCentavos: number; vouchers: number; expensesCentavos: number };
export type SummaryRange = { from: string; to: string; days: SummaryDay[]; modes: { mode: string; receipts: number; amountCentavos: number }[] };
export const MAX_RANGE_DAYS = 92;

const manilaDayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));

export function summarizeRange(from: string, to: string, payments: { received_at: string; method: string; amount_centavos: number }[], expenses: { paid_at: string; amount_centavos: number }[]): SummaryRange {
  const days: SummaryDay[] = [];
  for (let d = from; d <= to && days.length < MAX_RANGE_DAYS; d = addDays(d, 1)) days.push({ day: d, receipts: 0, collectedCentavos: 0, vouchers: 0, expensesCentavos: 0 });
  const byDay = new Map(days.map((d) => [d.day, d]));
  const modes = new Map<string, { mode: string; receipts: number; amountCentavos: number }>();
  for (const p of payments) {
    const d = byDay.get(manilaDayOf(p.received_at));
    if (!d) continue;
    d.receipts += 1; d.collectedCentavos += Number(p.amount_centavos);
    const m = modes.get(p.method) ?? { mode: p.method, receipts: 0, amountCentavos: 0 };
    m.receipts += 1; m.amountCentavos += Number(p.amount_centavos); modes.set(p.method, m);
  }
  for (const e of expenses) {
    const d = byDay.get(manilaDayOf(e.paid_at));
    if (d) { d.vouchers += 1; d.expensesCentavos += Number(e.amount_centavos); }
  }
  return { from, to, days, modes: [...modes.values()].sort((a, b) => b.amountCentavos - a.amountCentavos) };
}

export async function buildSummaryRange(db: ReturnType<typeof createSupabaseAdminClient>, from: string, to: string): Promise<SummaryRange> {
  const start = `${from}T00:00:00+08:00`, end = `${to}T23:59:59.999+08:00`;
  // shortcut: one read of up to 20,000 rows each covers about three months at today's volume; page it if a period grows past that.
  const [{ data: pay, error: payError }, { data: ex, error: exError }] = await Promise.all([
    db.from("payments").select("received_at,method,amount_centavos").eq("valid", true).gte("received_at", start).lte("received_at", end).limit(20000),
    db.from("expenses").select("paid_at,amount_centavos").eq("status", "Paid").gte("paid_at", start).lte("paid_at", end).limit(20000),
  ]);
  if (payError) throw payError;
  if (exError) throw exError;
  return summarizeRange(from, to, (pay ?? []) as { received_at: string; method: string; amount_centavos: number }[], (ex ?? []) as { paid_at: string; amount_centavos: number }[]);
}
