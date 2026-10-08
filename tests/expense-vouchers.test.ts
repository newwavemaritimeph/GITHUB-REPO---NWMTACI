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

import { voucherPrintState, vouchersByMonth } from "@/components/portal/live-cashier";

describe("voucher print limit", () => {
  const e = { id: "x", print_count: 0, reprints_approved: 0 };
  it("prints once, then needs a reprint request", () => {
    expect(voucherPrintState(e, []).state).toBe("print");
    expect(voucherPrintState({ ...e, print_count: 1 }, []).state).toBe("request");
    expect(voucherPrintState({ ...e, print_count: 1 }, [{ expense_id: "x", status: "Pending", requested_at: "2026-10-08T01:00:00Z" }]).state).toBe("pending");
    expect(voucherPrintState({ ...e, print_count: 1 }, [{ expense_id: "x", status: "Rejected", requested_at: "2026-10-08T01:00:00Z" }]).state).toBe("rejected");
  });
  it("allows one more print per approved reprint", () => {
    expect(voucherPrintState({ ...e, print_count: 1, reprints_approved: 1 }, [{ expense_id: "x", status: "Approved", requested_at: "2026-10-08T01:00:00Z" }])).toEqual({ state: "print", used: 1, allowed: 2 });
  });
});

describe("vouchers by month", () => {
  it("groups approved and released vouchers by month of approval, newest first", () => {
    const groups = vouchersByMonth([
      { status: "Paid", created_at: "2026-09-29T02:00:00Z", approved_at: "2026-10-01T02:00:00Z", amount_centavos: 1000, voucher_number: "CV-2026-000002" },
      { status: "Approved", created_at: "2026-10-05T02:00:00Z", approved_at: "2026-10-06T02:00:00Z", amount_centavos: 2500, voucher_number: "CV-2026-000003" },
      { status: "Paid", created_at: "2026-09-10T02:00:00Z", approved_at: "2026-09-11T02:00:00Z", amount_centavos: 700, voucher_number: "CV-2026-000001" },
      { status: "Pending", created_at: "2026-10-07T02:00:00Z", amount_centavos: 9999 },
    ]);
    expect(groups.map((g) => [g.month, g.label, g.rows.length, g.total])).toEqual([["2026-10", "October 2026", 2, 3500], ["2026-09", "September 2026", 1, 700]]);
    expect(groups[0].rows[0].voucher_number).toBe("CV-2026-000003");
  });
});
