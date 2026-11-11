/**
 * Bank Deposits (owner, 11 Nov 2026): Accounting requests, the Cashier deposits drawer cash, Accounting confirms.
 * A transfer between New Wave's own accounts: it lowers Cash on Hand and raises the bank account. Never an expense.
 */
export type DepositStatus = "Requested" | "Deposited" | "Received" | "Returned" | "Cancelled";
export type DepositAction = "cancel" | "mark" | "confirm" | "return";
export type BankDeposit = {
  id: string; deposit_no: string; amount_centavos: number; account: string; due_on: string | null; note: string | null; status: DepositStatus;
  requested_at: string; deposited_at: string | null; deposited_on: string | null; reference: string | null; slip_link: string | null; confirmed_at: string | null; reason: string | null;
};

/** Which status each action moves a deposit to, from where; null when the action is not allowed. */
const MOVES: Record<DepositAction, [DepositStatus[], DepositStatus]> = {
  cancel: [["Requested"], "Cancelled"],
  mark: [["Requested", "Returned"], "Deposited"],
  confirm: [["Deposited"], "Received"],
  return: [["Deposited"], "Returned"],
};
export function nextStatus(from: DepositStatus, action: DepositAction): DepositStatus | null {
  const [allowed, to] = MOVES[action];
  return allowed.includes(from) ? to : null;
}

/** Once deposited the cash has left the drawer, also while Accounting has it Returned for a correction. */
export const leftDrawer = (s: DepositStatus) => s === "Deposited" || s === "Received" || s === "Returned";

/** Cash deposited from the drawer on a day (YYYY-MM-DD, Manila). */
export const depositedOn = (deps: Pick<BankDeposit, "status" | "deposited_on" | "amount_centavos">[], day: string) =>
  deps.filter((d) => leftDrawer(d.status) && d.deposited_on === day).reduce((s, d) => s + Number(d.amount_centavos), 0);

/** Opening + cash collected − cash expenses − bank deposits = expected in the drawer. */
export const drawerExpected = (x: { opening: number; cashIn: number; cashExpenses: number; deposits: number }) => x.opening + x.cashIn - x.cashExpenses - x.deposits;

/** NWM-DEP-2026-0001 from next_reference('DEP') ("DEP-2026-000001"). */
export const depositNumber = (ref: string) => `NWM-${ref.replace(/-0*(\d+)$/, (_, n: string) => `-${n.padStart(4, "0")}`)}`;
