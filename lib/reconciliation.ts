/**
 * GCash reconciliation rules (owner, 9 Oct 2026), shared by the server, the
 * screen and the day sheet.
 */

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
export const isGcash = (method: string | null | undefined) => (method ?? "").replace(/\s+/g, "").toLowerCase() === "gcash";
