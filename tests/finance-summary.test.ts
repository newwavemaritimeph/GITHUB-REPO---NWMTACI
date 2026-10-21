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
  it("counts direct sales and what New Wave keeps from endorsements", () => {
    expect(s.direct).toMatchObject({ trainees: 1, sales: 130000, collected: 130000, balance: 0, expenses: 50000, margin: 80000 });
    expect(s.endorsement).toMatchObject({ trainees: 1, fees: 550000, rebate: 130000, share: 100000, keeps: 30000, rebateDue: 0 });
  });
  it("puts an unallocated part of a payment under Direct", () => {
    const t = summarize({ payments: [{ amount: 100000, channel: "Cash", allocations: [{ amount: 60000, endorsement: true }] }], income: [], expenses: [], sales: [] });
    expect([sideTotal(t.received, "E"), sideTotal(t.received, "D")]).toEqual([60000, 40000]);
  });
});
