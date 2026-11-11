/**
 * Bank Ledger (owner, 11 Nov 2026): one account's movements with a running balance. Automatic rows come from the
 * portal's own records (payments in the account's channel, Bank Deposits, expenses paid from it); encoded rows come
 * from bank_entries. A cheque lowers the book balance when issued and the cleared balance when encashed.
 */
export const ENTRY_TYPES = ["Cheque Issued", "Encashment", "Withdrawal", "Transfer Out", "Bank Charge", "Interest Earned", "Other Credit", "Other Debit", "Adjustment"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number] | "Transfer In" | "Reversal";
/** Money in for these types; Adjustment and Reversal carry their own sign. */
export const INFLOW: EntryType[] = ["Interest Earned", "Other Credit", "Transfer In"];
export const isChequeType = (t: string) => t === "Cheque Issued" || t === "Encashment";

export type BankAccount = { id: string; bank: string; account_name: string; last4: string | null; channel: string; opening_balance_centavos: number; opening_on: string; active: boolean };
export type BankEntry = {
  id: string; entry_no: string; account_id: string; entry_type: EntryType; entry_on: string; amount_centavos: number; payee: string | null; description: string | null;
  cheque_no: string | null; cheque_status: "Issued" | "Encashed" | "Void" | null; cleared_on: string | null; expense_id: string | null; reversal_of: string | null; reason: string | null;
};
export type AutoPayment = { id: string; on: string; amount: number; method: string; reference: string; who: string };
export type AutoDeposit = { id: string; on: string; amount: number; account: string; reference: string };
export type AutoExpense = { id: string; on: string; amount: number; channel: string; reference: string; who: string };

export type LedgerRow = {
  key: string; on: string; source: "Payment" | "Deposit" | "Expense" | "Encoded"; type: string; description: string; reference: string;
  amount: number; balance: number | null; counted: boolean; cheque?: BankEntry["cheque_status"]; clearedOn?: string | null; entry?: BankEntry;
};

/** Signed amount for a new entry: inflow types add, the rest subtract; Adjustment uses the chosen direction. */
export function signedAmount(type: EntryType, centavos: number, direction: 1 | -1 = 1) {
  if (type === "Adjustment" || type === "Reversal") return Math.abs(centavos) * direction;
  return INFLOW.includes(type) ? Math.abs(centavos) : -Math.abs(centavos);
}

export function buildLedger(a: BankAccount, src: { payments: AutoPayment[]; deposits: AutoDeposit[]; expenses: AutoExpense[]; entries: BankEntry[] }) {
  const mine = src.entries.filter((e) => e.account_id === a.id);
  // An expense paid by a linked cheque is counted once, through the cheque.
  const chequePaid = new Set(src.entries.filter((e) => e.expense_id && e.cheque_status !== "Void").map((e) => e.expense_id));
  const after = (on: string) => on >= a.opening_on;
  const rows: Omit<LedgerRow, "balance">[] = [
    ...src.payments.filter((p) => p.method === a.channel && after(p.on)).map((p) => ({ key: `p${p.id}`, on: p.on, source: "Payment" as const, type: "Payment", description: p.who, reference: p.reference, amount: p.amount, counted: true })),
    ...src.deposits.filter((d) => d.account === a.channel && after(d.on)).map((d) => ({ key: `d${d.id}`, on: d.on, source: "Deposit" as const, type: "Bank Deposit", description: "Cash from the drawer", reference: d.reference, amount: d.amount, counted: true })),
    ...src.expenses.filter((x) => x.channel === a.channel && after(x.on) && !chequePaid.has(x.id)).map((x) => ({ key: `x${x.id}`, on: x.on, source: "Expense" as const, type: "Expense", description: x.who, reference: x.reference, amount: -Math.abs(x.amount), counted: true })),
    ...mine.filter((e) => after(e.entry_on)).map((e) => ({
      key: `e${e.id}`, on: e.entry_on, source: "Encoded" as const, type: e.entry_type, entry: e,
      description: [e.payee, e.description].filter(Boolean).join(" · ") || e.entry_type,
      reference: e.cheque_no ? `Chq ${e.cheque_no}` : e.entry_no, amount: e.amount_centavos, counted: e.cheque_status !== "Void", cheque: e.cheque_status, clearedOn: e.cleared_on,
    })),
  ].sort((x, y) => x.on.localeCompare(y.on) || x.key.localeCompare(y.key));
  let run = a.opening_balance_centavos;
  const ledger: LedgerRow[] = rows.map((r) => { if (r.counted) run += r.amount; return { ...r, balance: r.counted ? run : null }; });
  const outstanding = ledger.filter((r) => r.counted && r.cheque === "Issued");
  const outstandingTotal = outstanding.reduce((s, r) => s + -r.amount, 0);
  return { rows: ledger, book: run, cleared: run + outstandingTotal, outstanding, outstandingTotal };
}

/** NWM-BNK-2026-0001 from next_reference('BNK'). */
export const entryNumber = (ref: string) => `NWM-${ref.replace(/-0*(\d+)$/, (_, n: string) => `-${n.padStart(4, "0")}`)}`;
