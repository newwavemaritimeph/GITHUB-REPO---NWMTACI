/**
 * Date filtering shared by every report.
 *
 * Reports must always be bound to a period — an unbounded export is what makes
 * two people quoting "the collections report" disagree. Presets cover the common
 * cases; a custom range is available for everything else.
 */

export const REPORT_RANGES = [
  "Today",
  "Last 7 days",
  "This month",
  "Last month",
  "This year",
  "Custom",
] as const;

export type ReportRangePreset = (typeof REPORT_RANGES)[number];

export type DateRange = { from: string; to: string };

/**
 * Formats from local calendar parts. `toISOString` would convert to UTC first,
 * which in Manila (UTC+8) turns local midnight on the 1st into the 30th of the
 * previous month.
 */
function iso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00`);
}

/**
 * Resolves a preset into inclusive from/to dates. `today` is injectable so the
 * behaviour is testable and so a report period never shifts mid-render.
 */
export function resolveRange(preset: ReportRangePreset, today: string, custom?: Partial<DateRange>): DateRange {
  const base = startOfDay(today);
  const year = base.getFullYear();
  const month = base.getMonth();

  switch (preset) {
    case "Today":
      return { from: today, to: today };
    case "Last 7 days": {
      const from = new Date(base);
      from.setDate(from.getDate() - 6);
      return { from: iso(from), to: today };
    }
    case "This month":
      return { from: iso(new Date(year, month, 1)), to: iso(new Date(year, month + 1, 0)) };
    case "Last month":
      return { from: iso(new Date(year, month - 1, 1)), to: iso(new Date(year, month, 0)) };
    case "This year":
      return { from: iso(new Date(year, 0, 1)), to: iso(new Date(year, 11, 31)) };
    case "Custom":
    default: {
      const from = custom?.from || today;
      const to = custom?.to || today;
      // Tolerate a range entered back to front rather than silently returning nothing.
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/**
 * True when a timestamp or date falls inside the range. Accepts full ISO
 * timestamps and plain dates; only the date part is compared, so a payment at
 * 11pm on the closing day is still inside the period.
 */
export function withinRange(value: string | undefined | null, range: DateRange) {
  if (!value) return false;
  const date = value.slice(0, 10);
  return date >= range.from && date <= range.to;
}

/** Filters rows by a date extracted from each row. */
export function filterByRange<T>(rows: readonly T[], range: DateRange, dateOf: (row: T) => string | undefined | null) {
  return rows.filter((row) => withinRange(dateOf(row), range));
}

/** "1 Jul 2026 – 31 Jul 2026", for report headers and export filenames. */
export function describeRange(range: DateRange) {
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric" }).format(startOfDay(value));
  return range.from === range.to ? format(range.from) : `${format(range.from)} – ${format(range.to)}`;
}
