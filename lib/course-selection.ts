/**
 * Course picks on the public registration form (owner, 7 Oct 2026): up to five
 * courses per application, each on an STCW batch or (In-House) a start date.
 * Passenger-ship courses follow a fixed order: Crowd must start after Safety,
 * and Crisis after Safety and Crowd, whenever they are in the same application.
 * Shared by the form (to grey out dates) and the server (to refuse them).
 */

export const MAX_COURSES = 5;

/** Safety → Crowd → Crisis. */
const ORDER: Record<string, { rank: number; label: string }> = {
  STPPDSPPS: { rank: 1, label: "Safety" },
  PSCMT: { rank: 2, label: "Crowd" },
  PSCMHBT: { rank: 3, label: "Crisis" },
};

export type PickRange = { code: string; start: string; end: string };

const shortDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const rangeText = (r: PickRange) => (r.start === r.end ? shortDate(r.start) : r.start.slice(0, 7) === r.end.slice(0, 7) ? `${shortDate(r.start)}–${Number(r.end.slice(8, 10))}` : `${shortDate(r.start)}–${shortDate(r.end)}`);

/**
 * Why `candidate` cannot be taken together with `others`, or null when it can.
 * A later course in the order must start after every earlier one has ended,
 * and an earlier course must end before any later one starts.
 */
export function orderConflict(candidate: PickRange, others: PickRange[]): string | null {
  const mine = ORDER[candidate.code];
  if (!mine) return null;
  const earlier = others.filter((o) => ORDER[o.code] && ORDER[o.code].rank < mine.rank && o.end >= candidate.start);
  if (earlier.length) return `Must start after your ${earlier.map((o) => `${ORDER[o.code].label} (${rangeText(o)})`).join(" and ")} date${earlier.length > 1 ? "s" : ""}`;
  const later = others.filter((o) => ORDER[o.code] && ORDER[o.code].rank > mine.rank && candidate.end >= o.start);
  if (later.length) return `Must end before your ${later.map((o) => `${ORDER[o.code].label} (${rangeText(o)})`).join(" and ")} date${later.length > 1 ? "s" : ""}`;
  return null;
}

/** The first order problem across a whole set of picks, for the server. */
export function firstOrderConflict(picks: PickRange[]): string | null {
  for (let i = 0; i < picks.length; i += 1) {
    const reason = orderConflict(picks[i], picks.filter((_, j) => j !== i));
    if (reason) return reason;
  }
  return null;
}

/** Order rule text shown on the form. */
export const ORDER_RULE_TEXT = "Crowd must start after Safety, and Crisis after Safety and Crowd.";
