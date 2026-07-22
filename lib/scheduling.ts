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

export function batchPatternLabel(code: string, durationLabel: string) {
  if (code === "STPPDSPPS") return "Safety begins every Monday.";
  if (code === "PSCMT") return "Crowd runs Tuesday–Wednesday.";
  if (code === "PSCMHBT") return "Crisis runs Thursday–Saturday.";
  if (code === "UBT-PSSR") return "BT-PSSR may begin any day Monday–Saturday.";
  const duration = courseDays(durationLabel);
  return ({ 1: "This one-day course may run Monday–Saturday.", 2: "Start Monday, Wednesday, or Friday.", 3: "Start Monday or Thursday.", 4: "Start Monday; the course runs Monday–Thursday.", 5: "Start Monday; the course runs Monday–Friday.", 6: "Start Monday; the course runs Monday–Saturday." } as Record<number,string>)[duration] ?? "Start Monday; Sundays are excluded.";
}
