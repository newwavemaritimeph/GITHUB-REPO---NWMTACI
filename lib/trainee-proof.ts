import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeSrn } from "@/lib/validation";

/**
 * Proof of payment sent by the trainee (owner, 29 Oct 2026). It is only for the
 * Cashier to view: it waits until a payment (and its receipt) uses it, or the
 * Cashier marks it Not Valid.
 */
export type TraineeProof = { id: string; source?: string | null; dismissed_at?: string | null };
export type ProofState = "Waiting for Receipt" | "Receipt Issued" | "Not Valid";

export function proofState(p: TraineeProof, usedIds: Set<string>): ProofState {
  if (usedIds.has(p.id)) return "Receipt Issued";
  return p.dismissed_at ? "Not Valid" : "Waiting for Receipt";
}

/** Trainee proofs still waiting for the Cashier, oldest first is up to the caller. */
export function pendingTraineeProofs<T extends TraineeProof>(proofs: T[], usedIds: Set<string>) {
  return proofs.filter((p) => p.source === "Trainee" && proofState(p, usedIds) === "Waiting for Receipt");
}

/** Website lookups: the NWMTACI No. (application or trainee number) and the SRN must belong to the same trainee. */
export async function findTraineeBySrn(db: ReturnType<typeof createSupabaseAdminClient>, srnRaw: string, noRaw: string) {
  const srn = normalizeSrn(srnRaw);
  const no = noRaw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!srn || !no) return null;
  const { data } = await db.from("trainees").select("id,legal_first_name,legal_last_name,srn,application_number,trainee_number,awaiting_course").or(`application_number.eq.${no},trainee_number.eq.${no}`).limit(2);
  return (data ?? []).find((r) => normalizeSrn(r.srn ?? "") === srn) ?? null;
}
