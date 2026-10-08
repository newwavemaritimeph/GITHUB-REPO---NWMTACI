/**
 * Report periods for the Accounting Manager (owner, 8 Oct 2026): daily,
 * weekly (Monday to Sunday), monthly, quarterly and annual buckets ending with
 * the period that contains `end` (that last one runs only to `end`, "to date").
 * Dates are Manila calendar dates as YYYY-MM-DD.
 */
export const PERIODS = ["Daily", "Weekly", "Monthly", "Quarterly", "Annually"] as const;
export type Period = (typeof PERIODS)[number];
export type Bucket = { label: string; from: string; to: string };

const COUNT: Record<Period, number> = { Daily: 14, Weekly: 12, Monthly: 12, Quarterly: 8, Annually: 5 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const toDate = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };

/** The start of the period that contains `iso`. */
export function periodStart(period: Period, iso: string) {
  const d = toDate(iso), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (period === "Daily") return iso;
  if (period === "Weekly") return addDays(iso, -((d.getUTCDay() + 6) % 7)); // Monday
  if (period === "Monthly") return toIso(new Date(Date.UTC(y, m, 1)));
  if (period === "Quarterly") return toIso(new Date(Date.UTC(y, m - (m % 3), 1)));
  return `${y}-01-01`;
}

/** The last day of the period that starts on `start`. */
function periodEnd(period: Period, start: string) {
  const d = toDate(start), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (period === "Daily") return start;
  if (period === "Weekly") return addDays(start, 6);
  if (period === "Monthly") return toIso(new Date(Date.UTC(y, m + 1, 0)));
  if (period === "Quarterly") return toIso(new Date(Date.UTC(y, m + 3, 0)));
  return `${y}-12-31`;
}

function labelOf(period: Period, start: string) {
  const d = toDate(start), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (period === "Daily") return `${MONTHS[m]} ${d.getUTCDate()}`;
  if (period === "Weekly") return `Wk ${MONTHS[m]} ${d.getUTCDate()}`;
  if (period === "Monthly") return `${MONTHS[m]} ${String(y).slice(2)}`;
  if (period === "Quarterly") return `Q${Math.floor(m / 3) + 1} ${String(y).slice(2)}`;
  return String(y);
}

/** Buckets oldest first; the last is the current period, cut at `end`. */
export function periodBuckets(period: Period, end: string, count = COUNT[period]): Bucket[] {
  const out: Bucket[] = [];
  let start = periodStart(period, end);
  for (let i = 0; i < count; i++) {
    const to = i === 0 ? end : periodEnd(period, start);
    out.unshift({ label: labelOf(period, start), from: start, to });
    start = periodStart(period, addDays(start, -1));
  }
  return out;
}

/** A readable title for the current period, e.g. "October 2026 (to date)". */
export function periodTitle(period: Period, end: string) {
  const start = periodStart(period, end), d = toDate(start), e = toDate(end);
  const full = periodEnd(period, start), toDateNote = end < full ? " (to date)" : "";
  const day = (x: Date) => `${LONG[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`;
  if (period === "Daily") return day(e);
  if (period === "Weekly") return `Week of ${day(d)}${toDateNote}`;
  if (period === "Monthly") return `${LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}${toDateNote}`;
  if (period === "Quarterly") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}${toDateNote}`;
  return `${d.getUTCFullYear()}${toDateNote}`;
}

export const PREVIOUS_LABEL: Record<Period, string> = { Daily: "the day before", Weekly: "the week before", Monthly: "the month before", Quarterly: "the quarter before", Annually: "the year before" };

/** Percent change from `before` to `now`, rounded; null when there is nothing to compare with. */
export function percentChange(now: number, before: number) {
  return before ? Math.round((100 * (now - before)) / before) : null;
}
