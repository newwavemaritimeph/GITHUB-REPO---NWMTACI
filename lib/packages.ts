/**
 * CCI Package (owner, 21 Oct 2026): Safety (Monday), Crowd (Tuesday–Wednesday) and
 * Crisis (Thursday–Saturday) in one week, ₱4,100.00. Enrolling creates the three
 * enrollments (database: assign_cci_package); the CCI course row holds the price
 * and the partners' CCI rebate and is never scheduled on its own.
 */
export const CCI_CODE = "CCI";
export const CCI_PARTS = [["STPPDSPPS", 0], ["PSCMT", 1], ["PSCMHBT", 3]] as const;
export const isPackageCourse = (code: string | null | undefined) => String(code ?? "").trim().toUpperCase() === CCI_CODE;

const shift = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Weeks a CCI Package can start: a Monday with an open Safety, Crowd (Tue) and Crisis (Thu) batch; full when any is full. */
export function packageWeeks(batches: { code: string; startsOn: string; full: boolean }[]) {
  const on = (code: string, day: string) => batches.filter((b) => b.code === code && b.startsOn === day);
  const mondays = [...new Set(batches.filter((b) => b.code === "STPPDSPPS" && new Date(`${b.startsOn}T00:00:00Z`).getUTCDay() === 1).map((b) => b.startsOn))].sort();
  return mondays.flatMap((monday) => {
    const parts = CCI_PARTS.map(([code, offset]) => on(code, shift(monday, offset)));
    if (parts.some((p) => !p.length)) return [];
    return [{ monday, ends: shift(monday, 5), full: parts.some((p) => p.every((b) => b.full)) }];
  });
}
