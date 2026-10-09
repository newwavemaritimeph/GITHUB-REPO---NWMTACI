/**
 * Admin dashboard rules (owner, 9 Oct 2026), shared by the screen and tests:
 * notifications sorted per category, holidays that fall on training days, and
 * the reason check for voids and cancellations.
 */

export const NOTICE_CATEGORIES = ["Classes and Rooms", "Certificates", "Payments and Reconciliation", "MISMO", "Holidays and MARINA Requests"] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];
export type Notice = { category: NoticeCategory; severity: "urgent" | "reminder"; title: string; detail: string; go?: string };
export type NoticeGroup = { category: NoticeCategory; notices: Notice[]; urgent: number };

/** Groups notices by category: categories with urgent items first (then in the fixed order), urgent items first inside each. */
export function groupNotices(notices: Notice[]): NoticeGroup[] {
  const rank = (n: Notice) => (n.severity === "urgent" ? 0 : 1);
  return NOTICE_CATEGORIES.map((category) => {
    const list = notices.filter((n) => n.category === category).sort((a, z) => rank(a) - rank(z));
    return { category, notices: list, urgent: list.filter((n) => n.severity === "urgent").length };
  }).filter((g) => g.notices.length)
    .sort((a, z) => (a.urgent ? 0 : 1) - (z.urgent ? 0 : 1) || NOTICE_CATEGORIES.indexOf(a.category) - NOTICE_CATEGORIES.indexOf(z.category));
}

export type MarinaStatus = "Not Sent" | "Sent" | "Approved" | "Classes Moved";
export type HolidayBatch = { batchNumber: string; courseCode: string; students: number };
export type HolidayDay = { date: string; name: string; kind: string; marinaStatus: MarinaStatus; marinaNote?: string | null; batches: HolidayBatch[] };

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00+08:00`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Holidays from tomorrow up to `days` ahead that have classes and no MARINA request sent yet: these become dashboard reminders. */
export function holidayReminders(holidays: HolidayDay[], today: string, days = 60): HolidayDay[] {
  const until = addDays(today, days);
  return holidays.filter((h) => h.date > today && h.date <= until && h.batches.length > 0 && h.marinaStatus === "Not Sent")
    .sort((a, z) => a.date.localeCompare(z.date));
}

/** The holidays in one month (YYYY-MM), in date order. */
export const holidaysInMonth = (holidays: HolidayDay[], month: string) => holidays.filter((h) => h.date.startsWith(month)).sort((a, z) => a.date.localeCompare(z.date));

/** A void or cancellation needs a written reason of at least 5 characters. */
export const voidReasonProblem = (reason: string) => (reason.trim().length < 5 ? "Enter the reason (at least 5 characters)." : null);

/** Sums amounts per channel name (Cash, GCash, PSBank, UnionBank, other). */
export function totalsByChannel(rows: { channel: string | null | undefined; amount: number }[], channels: readonly string[]) {
  const out: Record<string, number> = Object.fromEntries(channels.map((c) => [c, 0]));
  for (const r of rows) {
    const key = channels.find((c) => c.toLowerCase().replace(/\s+/g, "") === (r.channel ?? "").toLowerCase().replace(/\s+/g, "")) ?? "Other";
    out[key] = (out[key] ?? 0) + Number(r.amount || 0);
  }
  return out;
}
