export function courseDays(durationLabel: string) {
  return Math.max(1, Math.ceil(Number.parseFloat(durationLabel) || 1));
}

export function automaticEndDate(start: string, durationLabel: string) {
  if (!start) return "";
  const required = courseDays(durationLabel);
  const cursor = new Date(`${start}T00:00:00Z`);
  let completed = 0;
  while (completed < required) {
    if (cursor.getUTCDay() !== 0) completed += 1;
    if (completed < required) cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cursor.toISOString().slice(0, 10);
}

/**
 * Weekday numbers (1=Mon … 6=Sat) a course of the given duration may start on.
 * New Wave's in-house schedule pattern, opened monthly:
 *   1 day  → Mon–Sat            4 days → Mon, Tue, Wed  (Mon-Thu / Tue-Fri / Wed-Sat)
 *   2 days → Mon, Wed, Fri      5 days → Mon, Tue       (Mon-Fri / Tue-Sat)
 *   3 days → Mon, Thu           6+ days → Mon
 */
export function startWeekdaysForDuration(durationLabel: string): number[] {
  const duration = courseDays(durationLabel);
  if (duration === 1) return [1, 2, 3, 4, 5, 6];
  if (duration === 2) return [1, 3, 5];
  if (duration === 3) return [1, 4];
  if (duration === 4) return [1, 2, 3];
  if (duration === 5) return [1, 2];
  return [1];
}

export function validBatchStart(code: string, durationLabel: string, start: string) {
  if (!start) return false;
  const day = new Date(`${start}T00:00:00Z`).getUTCDay();
  // Specific MARINA STCW courses carry mandated fixed start days.
  if (code === "STPPDSPPS") return day === 1;
  if (code === "PSCMT") return day === 2;
  if (code === "PSCMHBT") return day === 4;
  if (code === "UBT-PSSR") return day >= 1 && day <= 6;
  if (code === "CCMI") return day === 1;
  return startWeekdaysForDuration(durationLabel).includes(day);
}

/* ------------------------------------------------- automatic batch opening */

export type PlannedBatch = { startsOn: string; endsOn: string };

function addDays(iso: string, days: number) {
  const cursor = new Date(`${iso}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

/**
 * The next `count` dates on or after `from` that satisfy the course's start
 * pattern. Used to open New Wave batches ahead of time without anyone picking
 * dates by hand.
 */
export function nextBatchStarts(code: string, durationLabel: string, from: string, count: number): string[] {
  if (!from || count <= 0) return [];
  const starts: string[] = [];
  let cursor = from;
  // A start pattern repeats weekly, so a valid date always appears within seven
  // days. The extra headroom simply stops a malformed pattern looping forever.
  for (let step = 0; step < count * 14 + 14 && starts.length < count; step += 1) {
    if (validBatchStart(code, durationLabel, cursor)) starts.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return starts;
}

/**
 * Opens a schedule for a course.
 *
 * New Wave's own courses follow their weekly start pattern and have their end
 * date derived from the duration, skipping Sundays. Endorsed partner courses
 * have no New Wave pattern — the chosen date is used exactly as picked.
 */
export function planBatches(input: {
  code: string;
  durationLabel: string;
  from: string;
  count?: number;
  endorsed?: boolean;
}): PlannedBatch[] {
  const { code, durationLabel, from, count = 1, endorsed = false } = input;
  if (!from) return [];
  if (endorsed) {
    return [{ startsOn: from, endsOn: automaticEndDate(from, durationLabel) }];
  }
  return nextBatchStarts(code, durationLabel, from, count).map((startsOn) => ({
    startsOn,
    endsOn: automaticEndDate(startsOn, durationLabel),
  }));
}

/**
 * Every valid start date in a given month (1-indexed), matching the course's
 * pattern. This is what "open schedules monthly" generates.
 */
export function monthlyBatchStarts(code: string, durationLabel: string, year: number, month: number): string[] {
  const starts: string[] = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth += 1) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
    if (validBatchStart(code, durationLabel, iso)) starts.push(iso);
  }
  return starts;
}

export function batchPatternLabel(code: string, durationLabel: string) {
  if (code === "STPPDSPPS") return "Safety begins every Monday.";
  if (code === "PSCMT") return "Crowd runs Tuesday–Wednesday.";
  if (code === "PSCMHBT") return "Crisis runs Thursday–Saturday.";
  if (code === "UBT-PSSR") return "BT-PSSR may begin any day Monday–Saturday.";
  const duration = courseDays(durationLabel);
  return (
    {
      1: "One-day course — starts any day Monday to Saturday.",
      2: "Two-day course — starts Monday, Wednesday, or Friday.",
      3: "Three-day course — starts Monday or Thursday.",
      4: "Four-day course — starts Monday, Tuesday, or Wednesday.",
      5: "Five-day course — starts Monday or Tuesday.",
    } as Record<number, string>
  )[duration] ?? "Starts Monday; Sundays are excluded.";
}
