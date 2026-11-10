import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeRange } from "@/lib/summary-range";
import { summaryRange } from "@/components/portal/accounting-home";

// Daily Summary Design 3 (owner, 10 Nov 2026): Accounting picks any period; totals, a bar per day, modes.
describe("Daily Summary over a period", () => {
  it("works out each period in Manila days, weeks starting Monday", () => {
    const custom = { from: "2026-11-01", to: "2026-11-05" };
    expect(summaryRange("Today", "2026-11-10", custom)).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    expect(summaryRange("Yesterday", "2026-11-10", custom)).toEqual({ from: "2026-11-09", to: "2026-11-09" });
    expect(summaryRange("This Week", "2026-11-10", custom)).toEqual({ from: "2026-11-09", to: "2026-11-10" });
    expect(summaryRange("This Week", "2026-11-09", custom)).toEqual({ from: "2026-11-09", to: "2026-11-09" });
    expect(summaryRange("This Month", "2026-11-10", custom)).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(summaryRange("Custom", "2026-11-10", { from: "2026-11-05", to: "2026-11-01" })).toEqual({ from: "2026-11-01", to: "2026-11-05" });
  });
  it("puts each payment and released voucher on its Manila day, with a row for every day", () => {
    const r = summarizeRange("2026-11-09", "2026-11-10",
      [{ received_at: "2026-11-08T17:30:00Z", method: "Cash", amount_centavos: 90000 }, { received_at: "2026-11-09T03:00:00Z", method: "GCash", amount_centavos: 50000 }, { received_at: "2026-11-10T16:30:00Z", method: "Cash", amount_centavos: 1 }],
      [{ paid_at: "2026-11-10T01:00:00Z", amount_centavos: 12000 }]);
    expect(r.days).toEqual([
      { day: "2026-11-09", receipts: 2, collectedCentavos: 140000, vouchers: 0, expensesCentavos: 0 },
      { day: "2026-11-10", receipts: 0, collectedCentavos: 0, vouchers: 1, expensesCentavos: 12000 },
    ]);
    expect(r.modes).toEqual([{ mode: "Cash", receipts: 1, amountCentavos: 90000 }, { mode: "GCash", receipts: 1, amountCentavos: 50000 }]);
  });
  it("is the Accounting tab's Daily Summary; the Cashier keeps the single-day report", () => {
    const app = readFileSync("components/portal-live-app.tsx", "utf8");
    const accounting = app.slice(app.indexOf('if(gateRole==="accounting"){'), app.indexOf('if(gateRole==="cashier"){'));
    expect(accounting).toContain('if(active==="Daily summary")return <AccountingDailySummary/>;');
    expect(app.slice(app.indexOf('if(gateRole==="cashier"){'))).toContain('if(active==="Daily summary")return <CashierSummaryReport data={data}/>;');
  });
});
