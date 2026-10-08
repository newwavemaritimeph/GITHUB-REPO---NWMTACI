import { describe, expect, it } from "vitest";
import { expenseState, expenseTotalsByChannel } from "@/components/portal/live-cashier";
import { voucherNaming } from "@/lib/google-drive";

describe("expense vouchers", () => {
  const rows = [
    { status: "Approved", created_at: "2026-10-02T02:00:00Z", amount_centavos: 100000, payment_channel: "Cash" },
    { status: "Paid", created_at: "2026-10-05T02:00:00Z", amount_centavos: 250000, payment_channel: "GCash" },
    { status: "Paid", created_at: "2026-10-06T02:00:00Z", amount_centavos: 50000, payment_channel: "Cash" },
    { status: "Pending", created_at: "2026-10-06T03:00:00Z", amount_centavos: 999900, payment_channel: "Cash" },
    { status: "Rejected", created_at: "2026-10-06T04:00:00Z", amount_centavos: 777700, payment_channel: "GCash" },
    { status: "Paid", created_at: "2026-09-30T02:00:00Z", amount_centavos: 10000, payment_channel: "Cash" },
  ];

  it("totals approved and released expenses per channel within the dates", () => {
    expect(expenseTotalsByChannel(rows, "2026-10-01", "2026-10-31")).toEqual([
      { channel: "GCash", count: 1, total: 250000 },
      { channel: "Cash", count: 2, total: 150000 },
    ]);
  });

  it("labels statuses in plain words", () => {
    expect(["Pending", "Approved", "Paid", "Rejected"].map((status) => expenseState({ status }))).toEqual(["For approval", "Approved", "Released", "Rejected"]);
  });

  it("files vouchers by category and month, named by date so they sort", () => {
    const n = voucherNaming({ category: "Utilities", approvedAt: "2026-10-07T03:00:00Z", voucherNumber: "CV-2026-000124", payee: "Meralco" });
    expect(n.folders.map((f) => f.name)).toEqual(["Utilities", "2026-10 October"]);
    expect(n.base).toBe("2026-10-07 CV-2026-000124 - MERALCO");
  });
});
