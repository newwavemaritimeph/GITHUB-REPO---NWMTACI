import { describe, expect, it } from "vitest";
import { buildLedger, entryNumber, signedAmount, type BankAccount, type BankEntry } from "@/lib/bank-ledger";

const psb: BankAccount = { id: "a", bank: "PSBank", account_name: "Savings", last4: "4421", channel: "PSBank", opening_balance_centavos: 15_000_000, opening_on: "2026-11-01", active: true };
const entry = (over: Partial<BankEntry>): BankEntry => ({ id: Math.random().toString(36).slice(2), entry_no: "NWM-BNK-2026-0001", account_id: "a", entry_type: "Bank Charge", entry_on: "2026-11-05", amount_centavos: -15_000, payee: null, description: null, cheque_no: null, cheque_status: null, cleared_on: null, expense_id: null, reversal_of: null, reason: null, ...over });

describe("bank ledger", () => {
  it("signs entries: charges and cheques out, interest and transfers in, adjustments by direction", () => {
    expect(signedAmount("Cheque Issued", 500)).toBe(-500);
    expect(signedAmount("Interest Earned", 500)).toBe(500);
    expect(signedAmount("Transfer In", 500)).toBe(500);
    expect(signedAmount("Adjustment", 500, -1)).toBe(-500);
  });

  it("runs the balance from the opening, with book and cleared balances for an outstanding cheque", () => {
    const l = buildLedger(psb, {
      payments: [{ id: "p1", on: "2026-11-03", amount: 950_000, method: "PSBank", reference: "OR 1", who: "Trainee" }, { id: "p0", on: "2026-10-30", amount: 1_000, method: "PSBank", reference: "OR 0", who: "Before opening" }, { id: "g", on: "2026-11-03", amount: 5_000, method: "GCash", reference: "OR 2", who: "Other channel" }],
      deposits: [{ id: "d1", on: "2026-11-05", amount: 3_000_000, account: "PSBank", reference: "NWM-DEP-2026-0006" }],
      expenses: [{ id: "x1", on: "2026-11-06", amount: 842_000, channel: "PSBank", reference: "CV-1", who: "Meralco" }],
      entries: [entry({ entry_type: "Cheque Issued", amount_centavos: -1_800_000, cheque_no: "001202", cheque_status: "Issued", entry_on: "2026-11-07" }), entry({ entry_on: "2026-11-10" })],
    });
    expect(l.rows.map((r) => r.source)).toEqual(["Payment", "Deposit", "Expense", "Encoded", "Encoded"]);
    expect(l.book).toBe(15_000_000 + 950_000 + 3_000_000 - 842_000 - 1_800_000 - 15_000);
    expect(l.cleared).toBe(l.book + 1_800_000);
    expect(l.outstanding).toHaveLength(1);
  });

  it("drops a void cheque, counts a cheque-paid expense once, and lets a reversal cancel an entry", () => {
    const l = buildLedger(psb, {
      payments: [], deposits: [],
      expenses: [{ id: "x2", on: "2026-11-04", amount: 320_000, channel: "PSBank", reference: "CV-2", who: "Supplies" }],
      entries: [
        entry({ entry_type: "Cheque Issued", amount_centavos: -320_000, cheque_no: "1", cheque_status: "Encashed", cleared_on: "2026-11-06", expense_id: "x2" }),
        entry({ entry_type: "Cheque Issued", amount_centavos: -99_000, cheque_no: "2", cheque_status: "Void" }),
        entry({ entry_type: "Bank Charge", amount_centavos: -15_000 }), entry({ entry_type: "Reversal", amount_centavos: 15_000 }),
      ],
    });
    expect(l.book).toBe(15_000_000 - 320_000);
    expect(l.cleared).toBe(l.book);
    expect(l.rows.find((r) => r.cheque === "Void")?.balance).toBeNull();
  });

  it("numbers entries NWM-BNK-YYYY-NNNN", () => expect(entryNumber("BNK-2026-000012")).toBe("NWM-BNK-2026-0012"));
  it("moves a bank-to-bank deposit out of the source bank and into the target", () => {
    const ub: BankAccount = { ...psb, id: "b", bank: "UnionBank", channel: "UnionBank", opening_balance_centavos: 0 };
    const src = { payments: [], expenses: [], entries: [], deposits: [{ id: "d9", on: "2026-11-12", amount: 500_000, account: "UnionBank", reference: "NWM-DEP-2026-0009", source: "PSBank" }] };
    expect(buildLedger(psb, src).book).toBe(15_000_000 - 500_000);
    expect(buildLedger(ub, src).book).toBe(500_000);
    expect(buildLedger(ub, src).rows[0].description).toBe("From PSBank");
  });
});
