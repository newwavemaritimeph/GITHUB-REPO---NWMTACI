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

export function validBatchStart(code: string, durationLabel: string, start: string) {
  if (!start) return false;
  const day = new Date(`${start}T00:00:00Z`).getUTCDay();
  if (code === "STPPDSPPS") return day === 1;
  if (code === "PSCMT") return day === 2;
  if (code === "PSCMHBT") return day === 4;
  if (code === "UBT-PSSR") return day >= 1 && day <= 6;
  if (code === "CCMI") return day === 1;
  const duration = courseDays(durationLabel);
  if (duration === 1) return day >= 1 && day <= 6;
  if (duration === 2) return [1, 3, 5].includes(day);
  if (duration === 3) return [1, 4].includes(day);
  return day === 1;
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

export function batchPatternLabel(code: string, durationLabel: string) {
  if (code === "STPPDSPPS") return "Safety begins every Monday.";
  if (code === "PSCMT") return "Crowd runs Tuesday–Wednesday.";
  if (code === "PSCMHBT") return "Crisis runs Thursday–Saturday.";
  if (code === "UBT-PSSR") return "BT-PSSR may begin any day Monday–Saturday.";
  const duration = courseDays(durationLabel);
  return ({ 1: "This one-day course may run Monday–Saturday.", 2: "Start Monday, Wednesday, or Friday.", 3: "Start Monday or Thursday.", 4: "Start Monday; the course runs Monday–Thursday.", 5: "Start Monday; the course runs Monday–Friday.", 6: "Start Monday; the course runs Monday–Saturday." } as Record<number,string>)[duration] ?? "Start Monday; Sundays are excluded.";
}
