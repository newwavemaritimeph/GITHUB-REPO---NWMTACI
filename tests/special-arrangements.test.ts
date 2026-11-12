import { describe, expect, it } from "vitest";
import { isSpecialCharge, specialAlerts, specialDescription, specialNumber, specialProblem, specialTotals } from "@/lib/special-arrangements";

describe("special arrangement fees", () => {
  it("allows only a price above the standard fee, one open request, and a reason for an off-list price", () => {
    expect(specialProblem({ standard: 90_000, special: 250_000, offList: false, openRequest: false })).toBeNull();
    expect(specialProblem({ standard: 90_000, special: 90_000, offList: false, openRequest: false })).toMatch(/higher/);
    expect(specialProblem({ standard: 90_000, special: 250_000, offList: false, openRequest: true })).toMatch(/already/);
    expect(specialProblem({ standard: 90_000, special: 300_000, offList: true, reason: "rush", openRequest: false })).toMatch(/reason/);
    expect(specialProblem({ standard: 90_000, special: 300_000, offList: true, reason: "Agency asked for a rush class", openRequest: false })).toBeNull();
  });

  it("labels the charge and keeps it out of the general pending-charges queue", () => {
    const d = specialDescription("Online", "BT-PSSR", "SAMPLE Agency");
    expect(d).toBe("Special Arrangement · Online · BT-PSSR · SAMPLE Agency");
    expect(isSpecialCharge({ description: d })).toBe(true);
    expect(isSpecialCharge({ description: "Make-up Class fee" })).toBe(false);
    expect(specialNumber("SA-2026-000003")).toBe("NWM-SA-2026-0003");
  });

  it("totals only what approved requests added", () => {
    const t = specialTotals([
      { approval_status: "Approved", amount_centavos: 160_000, off_list: false },
      { approval_status: "Pending", amount_centavos: 100_000, off_list: false },
      { approval_status: "Rejected", amount_centavos: 150_000, off_list: true },
    ]);
    expect(t).toEqual({ pending: 1, approved: 1, rejected: 1, added: 160_000, offList: 1 });
  });

  it("flags requests waiting over a day and off-list prices approved today", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    const lines = specialAlerts([
      { request_no: "NWM-SA-2026-0001", approval_status: "Pending", off_list: false, created_at: "2026-11-10T02:00:00Z", decided_at: null, special_centavos: 250_000, arrangement: "Online" },
      { request_no: "NWM-SA-2026-0002", approval_status: "Pending", off_list: false, created_at: "2026-11-12T10:00:00Z", decided_at: null, special_centavos: 250_000, arrangement: "Online" },
      { request_no: "NWM-SA-2026-0003", approval_status: "Approved", off_list: true, created_at: "2026-11-12T01:00:00Z", decided_at: "2026-11-12T03:00:00Z", special_centavos: 700_000, arrangement: "Other" },
    ], now);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("NWM-SA-2026-0001");
    expect(lines[0]).not.toContain("0002");
    expect(lines[1]).toContain("₱7,000.00");
  });
});
