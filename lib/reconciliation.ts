/**
 * Payment reconciliation rules (owner, 9 Oct 2026): GCash, PSBank and
 * UnionBank payments checked against each printed transaction history. Shared
 * by the server, the screen, the day sheet and the Accounting reminder.
 */

export const CHANNELS = ["GCash", "PSBank", "UnionBank"] as const;
export type Channel = (typeof CHANNELS)[number];
const squash = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, "").toLowerCase();
/** The reconciled channel a payment method belongs to, or null (Cash and others are not reconciled here). */
export const channelOf = (method: string | null | undefined): Channel | null => CHANNELS.find((c) => squash(c) === squash(method)) ?? null;
/** A channel name from a query string, defaulting to GCash. */
export const parseChannel = (v: string | null | undefined): Channel => channelOf(v) ?? "GCash";

export type ReconStatus = "Reconciled" | "Not in History";
export type ReconLine = { amount_centavos: number; received_at: string; status?: ReconStatus | null };

/** Manila calendar day (YYYY-MM-DD) of a timestamp. */
export const manilaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));

/** Start and end instants (ISO) of a Manila day. */
export function manilaDayBounds(day: string) {
  const start = new Date(`${day}T00:00:00+08:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000 - 1).toISOString() };
}

/** The given day and the days before it, newest first. */
export function recentDays(today: string, count: number) {
  const base = new Date(`${today}T12:00:00+08:00`).getTime();
  return Array.from({ length: count }, (_, i) => manilaDay(new Date(base - i * 86_400_000).toISOString()));
}

export type DaySummary = { day: string; count: number; total: number; reconciled: number; reconciledTotal: number; missing: number; toCheck: number };

/** Per-day counts and totals for the day list. */
export function summarizeDays(lines: ReconLine[], days: string[]): DaySummary[] {
  const by = new Map(days.map((d) => [d, { day: d, count: 0, total: 0, reconciled: 0, reconciledTotal: 0, missing: 0, toCheck: 0 }]));
  for (const l of lines) {
    const s = by.get(manilaDay(l.received_at));
    if (!s) continue;
    const amount = Number(l.amount_centavos);
    s.count++; s.total += amount;
    if (l.status === "Reconciled") { s.reconciled++; s.reconciledTotal += amount; }
    else if (l.status === "Not in History") s.missing++;
    else s.toCheck++;
  }
  return days.map((d) => by.get(d)!);
}

/** Whether a payment method is GCash (stored as the channel name). */
export const isGcash = (method: string | null | undefined) => channelOf(method) === "GCash";

export type OverdueDay = { day: string; count: number; total: number };

/**
 * Payments still not reconciled from before today (owner, 9 Oct 2026: overdue
 * from the next day), grouped by day, oldest first.
 */
export function groupOverdue(lines: ReconLine[], today: string): OverdueDay[] {
  const by = new Map<string, OverdueDay>();
  for (const l of lines) {
    if (l.status) continue;
    const day = manilaDay(l.received_at);
    if (day >= today) continue;
    const d = by.get(day) ?? { day, count: 0, total: 0 };
    d.count++; d.total += Number(l.amount_centavos);
    by.set(day, d);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}
