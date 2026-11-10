/**
 * Six-month HR checks (owner, 10 Nov 2026): Medical Fit to Work and Updated Biodata.
 * A check is due a set number of months after the last accepted certificate or biodata
 * confirmation. It shows as Due Soon from `firstReminderDays` before, Overdue after,
 * Missing when there is nothing on file, and For Checking while a new upload waits for HR.
 */
export type HrSettings = { fit_to_work_months: number; biodata_months: number; first_reminder_days: number; repeat_days: number; include_in_daily_email: boolean };
export const HR_DEFAULTS: HrSettings = { fit_to_work_months: 6, biodata_months: 6, first_reminder_days: 30, repeat_days: 7, include_in_daily_email: true };

export type DueState = "Overdue" | "Missing" | "Due Soon" | "For Checking" | "Current";
export type DueKind = "fit" | "biodata";
export type DueEmployee = {
  id: string; employee_number: string; complete_name: string; active: boolean;
  fit_to_work_on?: string | null; fit_to_work_pending_on?: string | null; biodata_confirmed_at?: string | null;
};
export type DueItem = { employeeId: string; name: string; number: string; kind: DueKind; last: string | null; due: string | null; days: number | null; state: DueState };

const DAY = 86_400_000;
/** YYYY-MM-DD in Manila for a timestamp (or a date string, returned as is). */
export function manilaDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(value));
}
/** Adds calendar months; a day past the month's end lands on its last day (Aug 31 + 6 → Feb 28). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function dueOf(last: string | null | undefined, months: number, firstDays: number, today: string): Pick<DueItem, "last" | "due" | "days" | "state"> {
  if (!last) return { last: null, due: null, days: null, state: "Missing" };
  const lastDay = manilaDate(last), due = addMonths(lastDay, months), days = daysBetween(today, due);
  return { last: lastDay, due, days, state: days < 0 ? "Overdue" : days <= firstDays ? "Due Soon" : "Current" };
}

const RANK: Record<DueState, number> = { Overdue: 0, Missing: 1, "For Checking": 2, "Due Soon": 3, Current: 4 };

/** Every active employee's two checks, most urgent first. */
export function hrDueItems(employees: DueEmployee[], settings: HrSettings, today: string): DueItem[] {
  const out: DueItem[] = [];
  for (const e of employees) {
    if (!e.active) continue;
    const base = { employeeId: e.id, name: e.complete_name, number: e.employee_number };
    const fit = dueOf(e.fit_to_work_on, settings.fit_to_work_months, settings.first_reminder_days, today);
    out.push({ ...base, kind: "fit", ...fit, state: e.fit_to_work_pending_on ? "For Checking" : fit.state });
    out.push({ ...base, kind: "biodata", ...dueOf(e.biodata_confirmed_at, settings.biodata_months, settings.first_reminder_days, today) });
  }
  return out.sort((a, b) => RANK[a.state] - RANK[b.state] || (a.days ?? -9999) - (b.days ?? -9999) || a.name.localeCompare(b.name));
}

/** Items that need someone to act (everything but Current). */
export const needsAction = (items: DueItem[]) => items.filter((i) => i.state !== "Current");

export function dueLabel(i: Pick<DueItem, "state" | "days">): string {
  if (i.state === "Overdue") return `Overdue ${Math.abs(i.days ?? 0)} Day${Math.abs(i.days ?? 0) === 1 ? "" : "s"}`;
  if (i.state === "Due Soon") return i.days === 0 ? "Due Today" : `Due in ${i.days} Day${i.days === 1 ? "" : "s"}`;
  if (i.state === "Missing") return "Nothing on File";
  return i.state;
}
export const KIND_LABEL: Record<DueKind, string> = { fit: "Medical Fit to Work", biodata: "Updated Biodata" };
