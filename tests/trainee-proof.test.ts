import { describe, expect, it } from "vitest";
import { pendingTraineeProofs, proofState } from "@/lib/trainee-proof";

describe("trainee proof of payment", () => {
  const proofs = [
    { id: "a", source: "Trainee", dismissed_at: null },
    { id: "b", source: "Trainee", dismissed_at: null },
    { id: "c", source: "Trainee", dismissed_at: "2026-10-29T03:00:00Z" },
    { id: "d", source: "Cashier", dismissed_at: null },
  ];
  const used = new Set(["b"]);

  it("lists only trainee proofs with no receipt and not marked Not Valid", () => {
    expect(pendingTraineeProofs(proofs, used).map((p) => p.id)).toEqual(["a"]);
  });

  it("names the state the trainee sees", () => {
    expect(proofState(proofs[0], used)).toBe("Waiting for Receipt");
    expect(proofState(proofs[1], used)).toBe("Receipt Issued");
    expect(proofState(proofs[2], used)).toBe("Not Valid");
  });
});
