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
