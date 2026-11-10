import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Budget Request then Liquidation (owner, 10 Nov 2026): an advance first, an expense once liquidated with receipts.
const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
const section = (start: string, len = 2600) => { const at = route.indexOf(start); expect(at).toBeGreaterThan(-1); return route.slice(at, at + len); };

describe("Budget Request then Liquidation", () => {
  it("asks for the budget with no receipts and numbers it BR-", () => {
    const body = section('if (input.action === "budget-request") {');
    expect(body).toContain('next_reference", { prefix: "BR"');
    expect(body).toContain("is_budget: true, advance_centavos: input.amountCentavos");
    expect(body).toContain('action: "budget.requested"');
  });
  it("releases an approved budget as an advance, not yet an expense", () => {
    expect(section('if (input.action === "expense-release") {')).toContain('status: isBudget ? "Advanced" : "Paid"');
  });
  it("liquidates only a released budget, with receipt photos, and books what was spent", () => {
    const body = section('if (input.action === "expense-liquidate") {');
    expect(body).toContain('row.status !== "Advanced"');
    expect(body).toContain('status: "Paid", amount_centavos: input.amountCentavos, returned_centavos: advance - input.amountCentavos');
    expect(route).toContain('.min(1, "Attach at least one receipt photo.")');
  });
  it("counts the advance as cash out on the day it leaves the drawer; expense reports wait for liquidation", () => {
    expect(route).toContain('.select("amount_centavos").in("status", ["Paid", "Advanced"])');
    expect(readFileSync("lib/cashier-report.ts", "utf8")).toContain('.in("status", ["Paid", "Advanced"])');
    for (const f of ["lib/finance-summary.ts", "lib/accounting-report.ts", "lib/summary-range.ts"]) expect(readFileSync(f, "utf8")).toContain('.eq("status", "Paid")');
    expect(readFileSync("supabase/migrations/202610290090_budget_requests.sql", "utf8")).toContain("'Advanced'");
  });
});
