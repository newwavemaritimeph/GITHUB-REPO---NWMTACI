import { normalizeSrn } from "@/lib/validation";

/**
 * TAR rule (owner, 29 Oct 2026: "If the trainee has balance, allow TAR"): any course
 * that is not cancelled and has a schedule (batch or start date) goes on the TAR,
 * paid or not; the TAR itself shows the balance.
 */
export const tarPrintable = (e: { enrollment_status: string; batch_id?: string | null; scheduled_on?: string | null }) =>
  e.enrollment_status !== "Cancelled" && !!(e.batch_id || e.scheduled_on);

type Person = { id: string; srn?: string | null; legal_first_name?: string | null; legal_last_name?: string | null; birthdate?: string | null };
const norm = (v?: string | null) => (v ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/** Two trainee records for the same person: same SRN, or same last name, first name and birth date. */
export function sameTrainee(a: Person, b: Person) {
  if (a.id === b.id) return false;
  const sa = normalizeSrn(a.srn ?? ""), sb = normalizeSrn(b.srn ?? "");
  if (sa && sb && sa === sb) return true;
  return !!a.birthdate && a.birthdate === b.birthdate && !!norm(a.legal_last_name) && norm(a.legal_last_name) === norm(b.legal_last_name) && norm(a.legal_first_name) === norm(b.legal_first_name);
}
