import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { consultancyOpen, groupNumber, groupProblem } from "@/lib/group-payment";

const balances = new Map([["a", 550_000], ["b", 550_000], ["c", 90_000]]);

describe("consultancy group payments", () => {
  it("records only when the ticked amounts equal the transfer and stay within each balance", () => {
    const lines = [{ enrollmentId: "a", amountCentavos: 550_000 }, { enrollmentId: "b", amountCentavos: 550_000 }];
    expect(groupProblem({ totalCentavos: 1_100_000, reference: "BDO-55120931", lines, balances })).toBeNull();
    expect(groupProblem({ totalCentavos: 1_200_000, reference: "BDO-55120931", lines, balances })).toMatch(/add up/);
    expect(groupProblem({ totalCentavos: 100_000, reference: "BDO-1", lines: [{ enrollmentId: "c", amountCentavos: 100_000 }], balances })).toMatch(/balance/);
    expect(groupProblem({ totalCentavos: 1_100_000, reference: " ", lines, balances })).toMatch(/reference/);
    expect(groupProblem({ totalCentavos: 0, reference: "BDO-1", lines: [], balances })).toMatch(/Tick/);
    expect(groupProblem({ totalCentavos: 1_100_000, reference: "BDO-1", lines: [lines[0], lines[0]], balances })).toMatch(/twice/);
  });

  it("lists the consultancy's trainees with a balance, biggest first", () => {
    const enr = [{ id: "a", b: 100 }, { id: "b", b: 0 }, { id: "c", b: 500 }, { id: "d", b: 900 }];
    const refs = { a: "ag1", b: "ag1", c: "ag1", d: "ag2" };
    expect(consultancyOpen(enr, "ag1", refs, (e) => e.b).map((e) => e.id)).toEqual(["c", "a"]);
  });

  it("numbers groups NWM-GRP-YYYY-NNNN", () => expect(groupNumber("GRP-2026-000004")).toBe("NWM-GRP-2026-0004"));

  it("keeps payments insert-only: the migration allows only a void or Duplicate Review → Verified", () => {
    const sql = readFileSync("supabase/migrations/202611120102_group_payments.sql", "utf8");
    expect(sql).toContain("old.verification_state = 'Duplicate Review' and new.verification_state = 'Verified'");
    expect(sql).toContain("(to_jsonb(new) - 'verification_state') = (to_jsonb(old) - 'verification_state')");
    expect(sql).toContain("perform set_config('nwm.payment_group', gid::text, true)");
  });
});
