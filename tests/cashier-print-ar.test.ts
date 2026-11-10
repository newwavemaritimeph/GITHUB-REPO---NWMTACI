import { describe, expect, it } from "vitest";
import { receiptsOf } from "@/components/portal/live-cashier";

// Print AR · Design 3 (owner, 10 Nov 2026): every receipt of the trainee's latest payment, not only the newest one.
const data = {
  payments: [
    { id: "p1", trainee_id: "t1", amount_centavos: 90000, received_at: "2026-11-10T01:00:00Z", remarks: null, valid: true },
    { id: "p2", trainee_id: "t1", amount_centavos: 15000, received_at: "2026-11-10T01:00:05Z", remarks: "Miscellaneous · Uniform", valid: true },
    { id: "p0", trainee_id: "t1", amount_centavos: 50000, received_at: "2026-11-02T01:00:00Z", remarks: null, valid: true },
    { id: "pv", trainee_id: "t1", amount_centavos: 70000, received_at: "2026-11-10T01:00:30Z", remarks: null, valid: false },
    { id: "x", trainee_id: "t2", amount_centavos: 1000, received_at: "2026-11-10T01:00:00Z", remarks: null, valid: true },
  ],
} as unknown as Parameters<typeof receiptsOf>[0];

describe("Print AR on the Cashier Dashboard", () => {
  it("lists the training fee and the uniform receipts of the latest payment, leaving out older and voided ones", () => {
    expect(receiptsOf(data, "t1")).toEqual([
      { id: "p2", label: "Miscellaneous · Uniform", amount: 15000 },
      { id: "p1", label: "Training Fee", amount: 90000 },
    ]);
    expect(receiptsOf(data, "none")).toEqual([]);
  });
});
