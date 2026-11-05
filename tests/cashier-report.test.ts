import { describe, expect, it } from "vitest";
import { buildCashierReport, cashPosition, collectionsBySource, type CollectionRow } from "@/lib/cashier-report";

const row = (kind: CollectionRow["kind"], agency: string, channel: string, amount: number): CollectionRow => ({ receipt: "AR", time: "8:00 AM", trainee: "T", course: "C", channel, reference: "", amountCentavos: amount, kind, agency });

describe("cashier summary report", () => {
  it("splits collections into walk-ins, agencies and consultancies per channel", () => {
    const { channels, matrix, groups } = collectionsBySource([
      row("Direct walk-in", "", "Cash", 180000), row("Direct walk-in", "", "GCash", 150000),
      row("Agency", "Magsaysay", "UnionBank", 450000), row("Agency", "Alpha", "Cash", 150000),
      row("Consultancy", "Bluewave", "GCash", 250000),
    ], ["Cash", "GCash", "PSBank", "UnionBank"]);
    expect(channels).toEqual(["Cash", "GCash", "PSBank", "UnionBank"]);
    expect(matrix.map((m) => [m.source, m.count, m.totalCentavos])).toEqual([["Direct walk-ins", 2, 330000], ["Agencies", 2, 600000], ["Consultancies", 1, 250000]]);
    expect(matrix[1].cells.find((c) => c.channel === "UnionBank")).toEqual({ channel: "UnionBank", count: 1, totalCentavos: 450000 });
    expect(groups.map((g) => `${g.kind}:${g.name}:${g.subtotalCentavos}`)).toEqual(["Direct walk-in::330000", "Agency:Alpha:150000", "Agency:Magsaysay:450000", "Consultancy:Bluewave:250000"]);
  });
  it("adds today's cash to the previous cash, less cash expenses, and compares with the count", () => {
    expect(cashPosition({ previousCentavos: 1500000, cashCollectedCentavos: 580000, cashExpensesCentavos: 168500, countedCentavos: 1909500 })).toMatchObject({ onHandCentavos: 1911500, overShortCentavos: -2000 });
    expect(cashPosition({ previousCentavos: 0, cashCollectedCentavos: 100, cashExpensesCentavos: 0, countedCentavos: null }).overShortCentavos).toBeNull();
  });
});

/** A database stand-in: every call chains; `eq` filters; awaiting gives the table's rows. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(name: string) {
      let rows = tables[name] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "in", "lte", "gte", "lt", "neq", "not", "is", "order", "limit"]) chain[m] = () => chain;
      chain.eq = (col: string, val: unknown) => { rows = rows.filter((r) => !(col in r) || r[col] === val); return chain; };
      chain.then = (done: (v: unknown) => void) => done({ data: rows, error: null });
      return chain;
    },
  } as never;
}

const payment = (id: string, valid: boolean, extra: Record<string, unknown> = {}) => ({ id, valid, payment_number: `PAY-${id}`, amount_centavos: 100000, method: "GCash", reference_number: "884422", received_at: "2026-11-05T02:00:00Z", proof_id: null, verification_state: "Verified", trainees: { legal_last_name: "Cruz", legal_first_name: "Juan" }, ...extra });

describe("Cashier report rows for Accounting › Payments", () => {
  const report = () => buildCashierReport(fakeDb({
    payments: [payment("good", true), payment("bad", false, { void_reason: "Wrong amount" })],
    receipts: [{ payment_id: "good", receipt_number: "AR-1" }, { payment_id: "bad", receipt_number: "AR-2" }],
    payment_allocations: [{ payment_id: "good", enrollment_id: "e1", enrollments: { courses: { code: "APA", name: "Anti-Piracy" } } }],
    agency_rebates: [{ enrollment_id: "e1", agency_id: "a1", rebate_centavos: 30000, status: "Paid" }],
    marketing_agencies: [{ id: "a1", name: "Sample Agency", kind: "Agency" }],
  }), "2026-11-05", "Tester");

  it("keeps the payment id and rebate, which Reprint and the Source column need", async () => {
    const r = (await report()).groups.flatMap((g) => g.rows)[0];
    expect(r).toMatchObject({ paymentId: "good", receipt: "AR-1", codes: "APA", rebateCentavos: 30000, rebateStatus: "Deducted", verificationState: "Verified" });
  });
  it("lists a voided payment apart, with its reason, in no total", async () => {
    const r = await report();
    expect(r.voided).toMatchObject([{ paymentId: "bad", valid: false, voidReason: "Wrong amount" }]);
    expect(r.groups.flatMap((g) => g.rows).map((x) => x.paymentId)).toEqual(["good"]);
    expect(r.matrix.reduce((n, m) => n + m.totalCentavos, 0)).toBe(100000);
  });
});
