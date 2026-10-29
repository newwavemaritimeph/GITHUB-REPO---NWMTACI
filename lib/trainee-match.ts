import { normalizeSrn } from "@/lib/validation";

/**
 * TAR rule (owner, 29 Oct 2026: "print TAR regardless of payment status"): every course
 * that is not cancelled goes on the TAR, paid or not; the TAR itself shows the balance.
 */
export const tarPrintable = (e: { enrollment_status: string }) => e.enrollment_status !== "Cancelled";

type Person = { id: string; srn?: string | null; legal_first_name?: string | null; legal_last_name?: string | null; birthdate?: string | null };
const norm = (v?: string | null) => (v ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/** Two trainee records for the same person: same SRN, or same last name, first name and birth date. */
export function sameTrainee(a: Person, b: Person) {
  if (a.id === b.id) return false;
  const sa = normalizeSrn(a.srn ?? ""), sb = normalizeSrn(b.srn ?? "");
  if (sa && sb && sa === sb) return true;
  return !!a.birthdate && a.birthdate === b.birthdate && !!norm(a.legal_last_name) && norm(a.legal_last_name) === norm(b.legal_last_name) && norm(a.legal_first_name) === norm(b.legal_first_name);
}
