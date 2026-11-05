import { describe, expect, it } from "vitest";
import { channelTotal, sideTotal, summarize } from "@/lib/finance-summary";

describe("cash and sales summary", () => {
  const sale = { code: "UBT-PSSR", name: "BT-PSSR", center: "", payable: 0, rebate: 0, share: 0, charges: 0, discounts: 0, rebateReceived: 0 };
  const s = summarize({
    payments: [
      { amount: 130000, channel: "GCash", allocations: [{ amount: 130000, endorsement: false }] },
      { amount: 550000, channel: "Cash", allocations: [{ amount: 550000, endorsement: true }] },
    ],
    income: [{ amount: 130000, channel: "PSBank", source: "Endorsement Rebate" }, { amount: 500000, channel: "Cash", source: "Rental" }],
    expenses: [{ amount: 550000, channel: "PSBank", category: "Partnered Center Payment" }, { amount: 50000, channel: "Cash", category: "Utilities" }],
    sales: [
      { ...sale, endorsement: false, price: 130000, collected: 130000 },
      { ...sale, endorsement: true, code: "BT", name: "Basic Training", center: "Nautical Options", price: 550000, payable: 550000, rebate: 130000, share: 100000, collected: 550000, rebateReceived: 130000 },
    ],
  });
  it("splits cash received and disbursed into Endorsement and Direct", () => {
    expect(sideTotal(s.received, "E")).toBe(680000);
    expect(sideTotal(s.received, "D")).toBe(630000);
    expect(sideTotal(s.disbursed, "E")).toBe(550000);
    expect(sideTotal(s.disbursed, "D")).toBe(50000);
    expect(channelTotal(s.received, "D", "GCash")).toBe(130000);
    expect(s.received[0]).toMatchObject({ label: "Training Fees", side: "E" });
  });
  it("segregates Total Sales into New Wave by category and Endorsed by center", () => {
    const t = summarize({ payments: [], income: [], expenses: [], sales: [
      { ...sale, endorsement: false, category: "STCW", code: "UBT-PSSR", price: 130000, charges: 15000, discounts: 5000, collected: 100000 },
      { ...sale, endorsement: false, category: "STCW", code: "UBT-PSSR", price: 130000, collected: 200000 },
      { ...sale, endorsement: false, category: "In-House", code: "APA", name: "Anti Piracy", price: 70000, collected: 70000 },
      { ...sale, endorsement: true, center: "Mariana", code: "RASE", price: 700000, charges: 2000, payable: 700000, rebate: 150000, share: 80000, collected: 500000, rebateReceived: 50000 },
    ] });
    expect(t.direct.categories.map((c) => [c.name, c.trainees, c.sales])).toEqual([["STCW Courses", 2, 270000], ["In-House Courses", 1, 70000]]);
    expect(t.direct.categories[0].courses).toEqual([expect.objectContaining({ code: "UBT-PSSR", trainees: 2, fees: 260000, charges: 15000, discounts: 5000, sales: 270000, collected: 230000, balance: 40000 })]);
    expect(t.direct).toMatchObject({ trainees: 3, sales: 340000, collected: 300000, balance: 40000 });
    expect(t.endorsement).toMatchObject({ trainees: 1, fees: 700000, charges: 2000, sales: 702000, collected: 500000, balance: 202000, rebateDue: 100000, keeps: 70000 });
    expect(t.endorsement.centers[0]).toMatchObject({ name: "Mariana", sales: 702000, balance: 202000, due: 100000, keeps: 70000 });
    for (const k of ["trainees", "fees", "charges", "discounts", "sales", "collected", "balance"] as const) {
      expect(t.totalSales[k]).toBe(t.direct[k] + t.endorsement[k]);
      expect(t.direct[k]).toBe(t.direct.categories.reduce((n, c) => n + c[k], 0));
    }
  });
  it("counts direct sales and what New Wave keeps from endorsements", () => {
    expect(s.direct).toMatchObject({ trainees: 1, sales: 130000, collected: 130000, balance: 0, expenses: 50000, margin: 80000 });
    expect(s.endorsement).toMatchObject({ trainees: 1, fees: 550000, rebate: 130000, share: 100000, keeps: 30000, rebateDue: 0 });
  });
  it("puts an unallocated part of a payment under Direct", () => {
    const t = summarize({ payments: [{ amount: 100000, channel: "Cash", allocations: [{ amount: 60000, endorsement: true }] }], income: [], expenses: [], sales: [] });
    expect([sideTotal(t.received, "E"), sideTotal(t.received, "D")]).toEqual([60000, 40000]);
  });
});
