import { normalizeSrn } from "@/lib/validation";

/**
 * TAR rule (owner, 29 Oct 2026: "print TAR regardless of payment status"): every course
 * that is not cancelled goes on the TAR, paid or not; the TAR itself shows the balance.
 */
export const tarPrintable = (e: { enrollment_status: string }) => e.enrollment_status !== "Cancelled";

export type TarGroup = { date: string; at: string; ids: string[] };
type TarRow = { id: string; enrollment_status: string; created_at: string; receipt_at?: string | null; paid_by?: string | null };
const manilaDay = (v: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v));
/** Courses added this close together, before any TAR or receipt exists, are one visit. */
export const TAR_VISIT_MINUTES = 30;

/**
 * One TAR per transaction, newest first (owner, 4 Nov 2026). Courses on an issued TAR stay together, so it
 * keeps its number ("if the TAR and AR is already generated, do not combine"). Paid courses go by their first
 * payment: paid together, one TAR and Acknowledgement Receipt; paid separately, one each. Unpaid courses go by
 * when they were added. `issued` is newest record first.
 */
/** The TARs that can still print, newest first; only that course's when an enrollment is given. */
export const printableTars = <G extends { ids: string[] }>(groups: G[], printsLeft: (ids: string[]) => number, enrollmentId?: string) => groups.filter((g) => (!enrollmentId || g.ids.includes(enrollmentId)) && printsLeft(g.ids) > 0);

export function tarGroups(rows: TarRow[], issued: string[][] = []): TarGroup[] {
  const live = new Map(rows.filter(tarPrintable).map((r) => [r.id, r]));
  const time = (v: string) => new Date(v).getTime();
  const groups: TarRow[][] = [];
  for (const ids of issued) {
    const group = ids.flatMap((id) => live.get(id) ?? []);
    if (!group.length) continue;
    group.forEach((r) => live.delete(r.id));
    groups.push(group);
  }
  const paid = new Map<string, TarRow[]>();
  let unpaid: TarRow[] = [], last = 0;
  for (const r of [...live.values()].sort((x, y) => time(x.created_at) - time(y.created_at))) {
    const by = r.paid_by ?? r.receipt_at;
    if (by) { paid.set(by, [...(paid.get(by) ?? []), r]); continue; }
    if (!unpaid.length || time(r.created_at) - last > TAR_VISIT_MINUTES * 60000) groups.push(unpaid = []);
    unpaid.push(r);
    last = time(r.created_at);
  }
  return [...groups, ...paid.values()]
    .map((g) => { const at = g.map((r) => r.created_at).sort((x, y) => time(x) - time(y))[0]; return { date: manilaDay(at), at, ids: g.map((r) => r.id).sort() }; })
    .sort((x, y) => time(y.at) - time(x.at));
}

type Person = { id: string; srn?: string | null; legal_first_name?: string | null; legal_last_name?: string | null; birthdate?: string | null };
const norm = (v?: string | null) => (v ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/** Two trainee records for the same person: same SRN, or same last name, first name and birth date. */
/**
 * Type-ahead ranking (owner, 3 Nov 2026): nothing until a letter is typed; names with a word
 * starting with the letters come first, then anything else containing them (number, course).
 */
export function rankMatches<T>(items: T[], term: string, name: (x: T) => string, other: (x: T) => string, limit = 6): T[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const starts: T[] = [], rest: T[] = [];
  for (const x of items) {
    const n = name(x).toLowerCase();
    if (n.split(/\s+/).some((w) => w.startsWith(t))) starts.push(x);
    else if (`${n} ${other(x).toLowerCase()}`.includes(t)) rest.push(x);
  }
  return [...starts, ...rest].slice(0, limit);
}

export function sameTrainee(a: Person, b: Person) {
  if (a.id === b.id) return false;
  const sa = normalizeSrn(a.srn ?? ""), sb = normalizeSrn(b.srn ?? "");
  if (sa && sb && sa === sb) return true;
  return !!a.birthdate && a.birthdate === b.birthdate && !!norm(a.legal_last_name) && norm(a.legal_last_name) === norm(b.legal_last_name) && norm(a.legal_first_name) === norm(b.legal_first_name);
}
