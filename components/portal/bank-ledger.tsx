"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { askText } from "./dialogs";
import { Badge, Message } from "./shared-ui";
import { HrFormModal, fromCentavos, toCentavos, type HrField } from "./hr-forms";
import { buildLedger, ENTRY_TYPES, isChequeType, type AutoDeposit, type AutoExpense, type AutoPayment, type BankAccount, type BankEntry, type LedgerRow } from "@/lib/bank-ledger";

/** Bank Ledger and Bank Accounts (owner, 11 Nov 2026). Accounting and the Admin only. */
type Data = { accounts: BankAccount[]; entries: BankEntry[]; payments: AutoPayment[]; deposits: AutoDeposit[]; expenses: AutoExpense[]; linkable: { id: string; label: string }[] };
const peso = (c: number) => `${c < 0 ? "−" : ""}₱${(Math.abs(c) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fd = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${iso}T00:00:00+08:00`)) : "—");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const acctName = (a: BankAccount) => `${a.bank} · ${a.account_name}${a.last4 ? ` ••${a.last4}` : ""}`;
const HINT: Record<string, string> = {
  "Cheque Issued": "The book balance drops now; the cleared balance drops when you mark it Encashed. If it pays an expense already in the portal, pick it so it is counted once.",
  Encashment: "New Wave encashes its own cheque (cheque to cash): money moves from this bank to cash on hand.",
  Withdrawal: "Cash taken out of the bank over the counter or by ATM.",
  "Transfer Out": "Posts out of this account and in to the other one, with the same number.",
  "Bank Charge": "Fees the bank deducted, from the statement.", "Interest Earned": "Interest the bank credited, from the statement.",
  "Other Credit": "Any other money in that is not a payment or deposit.", "Other Debit": "Any other money out that is not an expense or cheque.",
  Adjustment: "Only to correct the balance against the bank statement. The reason is required.",
};

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/staff/bank-ledger", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Could not save.");
  return j as { ok: true; entryNo?: string };
}
export function useBankLedger() {
  const [data, setData] = useState<Data | null>(null), [err, setErr] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/staff/bank-ledger", { cache: "no-store" }); const j = await r.json().catch(() => ({}));
    if (r.ok) { setData(j as Data); setErr(""); } else setErr(j.error ?? "Could not load the bank ledger.");
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);
  return { data, err, load };
}

export function BankLedger() {
  const { data, err, load } = useBankLedger();
  const [pick, setPick] = useState(""), [range, setRange] = useState("This Month"), [adding, setAdding] = useState(false), [editing, setEditing] = useState<BankEntry | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const accounts = (data?.accounts ?? []).filter((a) => a.active);
  const acct = accounts.find((a) => a.id === pick) ?? accounts[0];
  const l = acct && data ? buildLedger(acct, data) : null;
  const t = today(), from = range === "This Month" ? `${t.slice(0, 8)}01` : range === "Last Month" ? (() => { const d = new Date(`${t.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })() : range === "This Year" ? `${t.slice(0, 4)}-01-01` : "0000";
  const to = range === "Last Month" ? `${t.slice(0, 8)}00` : "9999";
  const shown = (l?.rows ?? []).filter((r) => r.on >= from && r.on <= to);
  const before = l ? [...l.rows].filter((r) => r.on < from && r.counted).pop()?.balance ?? acct!.opening_balance_centavos : 0;
  const act = async (body: Record<string, unknown>, ok: string) => { setBusy(true); setMsg(null); try { await post(body); await load(); setMsg({ kind: "success", text: ok }); } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(false); } };
  const csv = () => {
    const lines = [["Date", "Description", "Reference", "Source", "In", "Out", "Balance", "Cheque"].join(","), ...shown.map((r) => [r.on, r.description, r.reference, r.type, r.amount > 0 ? (r.amount / 100).toFixed(2) : "", r.amount < 0 ? (-r.amount / 100).toFixed(2) : "", r.balance == null ? "" : (r.balance / 100).toFixed(2), r.cheque ?? ""].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv" })), a = document.createElement("a"); a.href = url; a.download = `bank-ledger-${acct?.bank ?? "account"}-${range.replace(/\s/g, "-")}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  // Edit (owner, 13 Nov 2026): an encoded line not yet reversed, or an outstanding cheque.
  const editBtn = (r: LedgerRow) => <button type="button" className="portal-secondary row-act" disabled={busy} onClick={() => setEditing(r.entry!)}>Edit</button>;
  const actions = (r: LedgerRow) => {
    if (r.source !== "Encoded" || !r.entry) return null;
    if (r.cheque === "Issued") return <span className="hr-acts">{editBtn(r)}<button type="button" className="portal-secondary danger row-act" disabled={busy} onClick={async () => { const reason = await askText("The amount goes back into the book balance. This cannot be undone.", "", { title: "Void This Cheque?", eyebrow: "Bank Ledger", record: [`Cheque ${r.entry!.cheque_no}`, `${peso(-r.amount)} · ${r.description}`], label: "Reason", okLabel: "Void Cheque", danger: true }); if (reason) await act({ action: "cheque-void", id: r.entry!.id, reason }, `Cheque ${r.entry!.cheque_no} voided.`); }}>Void</button><button type="button" className="portal-primary row-act" disabled={busy} onClick={async () => { const on = await askText("Date it cleared, from the bank statement (YYYY-MM-DD).", today(), { title: "Mark Cheque Encashed?", eyebrow: "Bank Ledger", record: [`Cheque ${r.entry!.cheque_no}`, `${peso(-r.amount)} · ${r.description}`], label: "Encashed On", okLabel: "Mark Encashed", required: true, multiline: false }); if (on) await act({ action: "cheque-encash", id: r.entry!.id, on }, `Cheque ${r.entry!.cheque_no} marked encashed.`); }}>Mark Encashed</button></span>;
    if (!r.cheque && r.counted && r.type !== "Reversal" && !r.entry.reversal_of && !(data?.entries ?? []).some((x) => x.reversal_of === r.entry!.id)) return <span className="hr-acts">{editBtn(r)}<button type="button" className="portal-secondary row-act" disabled={busy} onClick={async () => { const reason = await askText("An opposite entry is added; nothing is deleted.", "", { title: "Reverse This Entry?", eyebrow: "Bank Ledger", record: [r.entry!.entry_no, `${peso(r.amount)} · ${r.description}`], label: "Reason", okLabel: "Reverse Entry", danger: true }); if (reason) await act({ action: "entry-reverse", id: r.entry!.id, reason }, `${r.entry!.entry_no} reversed.`); }}>Reverse</button></span>;
    return null;
  };
  const addFields: HrField[] = [
    { key: "type", label: "Entry Type", type: "select", required: true, options: [...ENTRY_TYPES] },
    { key: "accountId", label: "Account", type: "select", required: true, options: accounts.map((a) => [a.id, acctName(a)]) },
    { key: "toAccountId", label: "To Account", type: "select", required: true, full: true, options: accounts.map((a) => [a.id, acctName(a)]), show: (v) => v.type === "Transfer Out" },
    { key: "chequeNo", label: "Cheque No.", required: true, show: (v) => isChequeType(v.type) },
    { key: "on", label: "Date", type: "date", required: true, max: today() },
    { key: "payee", label: "Payee", required: true, full: true, show: (v) => v.type === "Cheque Issued" },
    { key: "amount", label: "Amount (PHP)", type: "number", required: true, min: "0.01", step: "0.01" },
    { key: "direction", label: "Direction", type: "select", required: true, options: [["1", "Add to Balance"], ["-1", "Deduct from Balance"]], show: (v) => v.type === "Adjustment" },
    { key: "expenseId", label: "Pays Expense", type: "select", options: (data?.linkable ?? []).map((x) => [x.id, x.label]), full: true, show: (v) => v.type === "Cheque Issued" },
    { key: "description", label: "Description or Reason", full: true },
  ];

  if (err) return <div className="portal-page hr-page"><div className="portal-heading hr-head"><div><span className="portal-eyebrow">Transactions</span><h1>Bank Ledger</h1></div></div><Message kind="error" text={err} /></div>;
  return <div className="portal-page hr-page">
    <div className="portal-heading hr-head"><div><span className="portal-eyebrow">Transactions</span><h1>Bank Ledger</h1></div>
      {acct && <div className="hr-head-acts">
        <select className="hr-show" value={acct.id} onChange={(e) => setPick(e.target.value)} aria-label="Account">{accounts.map((a) => <option key={a.id} value={a.id}>{acctName(a)}</option>)}</select>
        <select className="hr-show" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Period">{["This Month", "Last Month", "This Year", "All"].map((o) => <option key={o}>{o}</option>)}</select>
        <button type="button" className="portal-secondary" onClick={csv}>Export CSV</button>
        <button type="button" className="portal-primary" onClick={() => setAdding(true)}>Add Entry</button></div>}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {!data ? <p className="hr-none">Loading…</p> : !acct ? <section className="portal-panel"><p className="hr-none">No bank accounts yet. Add one in Configuration › Bank Accounts with its opening balance from the bank statement.</p></section> : l && <>
      <div className="hr-kpis">
        <div className="hr-kpi"><b>{peso(l.book)}</b><small>Book Balance</small></div>
        <div className="hr-kpi"><b>{peso(l.cleared)}</b><small>Cleared Balance · What the Bank Shows</small></div>
        <div className="hr-kpi"><b>{l.outstanding.length}</b><small>Outstanding Cheques · {peso(l.outstandingTotal)}</small></div>
        <div className="hr-kpi"><b>{peso(acct.opening_balance_centavos)}</b><small>Opening Balance · {fd(acct.opening_on)}</small></div>
      </div>
      <section className="portal-panel hr-table"><div className="panel-heading"><h2>Movements</h2><Badge tone="blue">{`${shown.length} Entries`}</Badge></div><div className="portal-table-wrap"><table className="portal-table cx-cards bl-table">
        <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Source</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th><th /></tr></thead>
        <tbody><tr className="bl-open"><td className="lead" data-l="">{from === "0000" ? fd(acct.opening_on) : fd(from)}</td><td data-l="">{from === "0000" || from <= acct.opening_on ? "Opening Balance" : "Balance Brought Forward"}</td><td data-l="" /><td data-l="" /><td data-l="" /><td data-l="" /><td data-l="Balance" className="num"><b>{peso(from === "0000" ? acct.opening_balance_centavos : before)}</b></td><td data-l="" /></tr>
          {shown.map((r) => <tr key={r.key} className={r.counted ? "" : "bl-void"}>
            <td className="lead" data-l="Date">{fd(r.on)}</td>
            <td data-l="Description"><strong>{r.description}</strong>{r.entry && <small>{r.entry.entry_no}{r.entry.reason ? ` · ${r.entry.reason}` : ""}</small>}</td>
            <td data-l="Reference">{r.reference}{r.cheque && <> <Badge tone={r.cheque === "Issued" ? "orange" : r.cheque === "Encashed" ? "green" : "red"}>{r.cheque === "Issued" ? "Outstanding" : r.cheque === "Encashed" ? `Encashed ${fd(r.clearedOn)}` : "Void"}</Badge></>}</td>
            <td data-l="Source"><Badge tone={r.source === "Encoded" ? "slate" : "blue"}>{r.source === "Encoded" ? r.type : r.source}</Badge></td>
            <td data-l="In" className="num bl-in">{r.amount > 0 ? peso(r.amount) : ""}</td>
            <td data-l="Out" className="num bl-out">{r.amount < 0 ? peso(-r.amount) : ""}</td>
            <td data-l="Balance" className="num"><b>{r.balance == null ? "—" : peso(r.balance)}</b></td>
            <td data-l="" className="hr-cell-acts">{actions(r)}</td>
          </tr>)}
          {!shown.length && <tr><td colSpan={8} className="hr-none">No movements in this period.</td></tr>}
        </tbody></table></div></section>
      <section className="portal-panel hr-table"><div className="panel-heading"><h2>Outstanding Cheques</h2><Badge tone="orange">{`${l.outstanding.length} · ${peso(l.outstandingTotal)}`}</Badge></div><div className="portal-table-wrap"><table className="portal-table cx-cards">
        <thead><tr><th>Cheque</th><th>Payee</th><th>Issued</th><th className="num">Amount</th><th /></tr></thead>
        <tbody>{l.outstanding.map((r) => <tr key={r.key}><td className="lead" data-l="Cheque"><strong>{r.reference}</strong><small>{r.entry?.entry_no}</small></td><td data-l="Payee">{r.description}</td><td data-l="Issued">{fd(r.on)}</td><td data-l="Amount" className="num"><b>{peso(-r.amount)}</b></td><td data-l="" className="hr-cell-acts">{actions(r)}</td></tr>)}
          {!l.outstanding.length && <tr><td colSpan={5} className="hr-none">No outstanding cheques.</td></tr>}</tbody></table></div></section>
    </>}
    {editing && acct && <HrFormModal title={`Edit ${editing.entry_no}?`} submitLabel="Save Edit" onClose={() => setEditing(null)}
      fields={[...addFields, { key: "reason", label: "Reason for Edit (Required)", type: "textarea", required: true, full: true, placeholder: "e.g. Wrong amount; checked against the bank statement" }]}
      initial={{ type: editing.entry_type, accountId: editing.account_id, toAccountId: accounts.find((a) => a.id !== editing.account_id)?.id ?? "", chequeNo: editing.cheque_no ?? "", on: editing.entry_on, payee: editing.payee ?? "", amount: fromCentavos(Math.abs(editing.amount_centavos)), direction: editing.amount_centavos < 0 ? "-1" : "1", expenseId: editing.expense_id ?? "", description: editing.description ?? "" }}
      note={<>The original stays on record: it is reversed{editing.cheque_status === "Issued" ? " (its cheque voided)" : ""} with “Edited: reason”, and the corrected entry is added. The running balance follows.</>}
      onSubmit={async (v) => {
        if ((v.reason ?? "").trim().length < 3) throw new Error("Give the reason for the edit.");
        const r = await post({ action: "entry-edit", id: editing.id, reason: v.reason.trim(), accountId: v.accountId, type: v.type, on: v.on, amountCentavos: toCentavos(v.amount), direction: Number(v.direction || 1), toAccountId: v.type === "Transfer Out" ? v.toAccountId : undefined, chequeNo: v.chequeNo, payee: v.payee, description: v.description, expenseId: v.expenseId || null });
        await load(); setMsg({ kind: "success", text: `${editing.entry_no} corrected as ${r.entryNo}. The change and the reason are on record.` });
      }} />}
    {adding && acct && <HrFormModal title="Add Entry" submitLabel="Save Entry" onClose={() => setAdding(false)} fields={addFields}
      initial={{ type: "Cheque Issued", accountId: acct.id, toAccountId: accounts.find((a) => a.id !== acct.id)?.id ?? "", on: today(), direction: "1" }}
      note={<>Withdrawal, Bank Charge and Cheque Issued lower the balance; Interest Earned and Other Credit raise it. {HINT["Cheque Issued"]}</>}
      onSubmit={async (v) => {
        const r = await post({ action: "entry-add", accountId: v.accountId, type: v.type, on: v.on, amountCentavos: toCentavos(v.amount), direction: Number(v.direction || 1), toAccountId: v.type === "Transfer Out" ? v.toAccountId : undefined, chequeNo: v.chequeNo, payee: v.payee, description: v.description, expenseId: v.expenseId || null });
        setPick(v.accountId); await load(); setMsg({ kind: "success", text: `${r.entryNo} saved. The running balance is updated.` });
      }} />}
  </div>;
}

export function BankAccountsSetup({ channels }: { channels: string[] }) {
  const { data, err, load } = useBankLedger();
  const [editing, setEditing] = useState<BankAccount | "new" | null>(null), [msg, setMsg] = useState("");
  const balances = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, buildLedger(a, data!)])), [data]);
  return <div className="portal-page hr-page">
    <div className="portal-heading hr-head"><div><span className="portal-eyebrow">Configuration</span><h1>Bank Accounts</h1></div><div className="hr-head-acts"><button type="button" className="portal-primary" onClick={() => setEditing("new")}>Add Bank Account</button></div></div>
    {err && <Message kind="error" text={err} />}{msg && <Message kind="success" text={msg} />}
    <section className="portal-panel hr-table"><div className="portal-table-wrap"><table className="portal-table cx-cards">
      <thead><tr><th>Account</th><th>Receives Channel</th><th className="num">Opening Balance</th><th className="num">Book Balance</th><th className="num">Cleared Balance</th><th /></tr></thead>
      <tbody>{(data?.accounts ?? []).map((a) => { const b = balances.get(a.id); return <tr key={a.id} className={a.active ? "" : "row-muted"}>
        <td className="lead" data-l="Account"><strong>{acctName(a)}</strong>{!a.active && <small>Inactive</small>}</td>
        <td data-l="Channel"><Badge tone="blue">{a.channel}</Badge></td>
        <td data-l="Opening" className="num">{peso(a.opening_balance_centavos)}<small>As of {fd(a.opening_on)}</small></td>
        <td data-l="Book" className="num"><b>{b ? peso(b.book) : "—"}</b></td><td data-l="Cleared" className="num">{b ? peso(b.cleared) : "—"}</td>
        <td data-l="" className="hr-cell-acts"><button type="button" className="portal-secondary row-act" onClick={() => setEditing(a)}>Edit</button></td></tr>; })}
        {data && !data.accounts.length && <tr><td colSpan={6} className="hr-none">No bank accounts yet. Add each company bank account with its balance from the bank statement.</td></tr>}</tbody></table></div></section>
    <p className="hr-form-note">Payments received in the account&apos;s channel, Bank Deposits to it and expenses paid from it post to its ledger by themselves, from the opening date. E-wallets such as GCash are not bank accounts.</p>
    {editing && <HrFormModal title={editing === "new" ? "Add Bank Account" : `Edit · ${acctName(editing)}`} submitLabel="Save" onClose={() => setEditing(null)}
      initial={editing === "new" ? { openingOn: `${today().slice(0, 8)}01`, active: "Active" } : { bank: editing.bank, accountName: editing.account_name, last4: editing.last4 ?? "", channel: editing.channel, opening: fromCentavos(editing.opening_balance_centavos) || "0", openingOn: editing.opening_on, active: editing.active ? "Active" : "Inactive" }}
      fields={[
        { key: "bank", label: "Bank", required: true, placeholder: "e.g. PSBank" }, { key: "accountName", label: "Account Name", required: true, placeholder: "e.g. Savings" },
        { key: "last4", label: "Last 4 Digits", placeholder: "4421" },
        { key: "channel", label: "Receives Payment Channel", type: "select", required: true, options: channels },
        { key: "opening", label: "Opening Balance (PHP)", type: "number", required: true, step: "0.01" }, { key: "openingOn", label: "As of", type: "date", required: true },
        { key: "active", label: "Status", type: "select", required: true, options: ["Active", "Inactive"] },
      ]}
      note="Take the opening balance from the bank statement on the as-of date. Only movements from that date count."
      onSubmit={async (v) => { await post({ action: "account-save", id: editing === "new" ? null : editing.id, bank: v.bank, accountName: v.accountName, last4: v.last4, channel: v.channel, openingCentavos: Math.round(Number(String(v.opening).replace(/,/g, "")) * 100) || 0, openingOn: v.openingOn, active: v.active !== "Inactive" }); await load(); setMsg("Bank account saved."); }} />}
  </div>;
}

/** Cash Position: each bank's book and cleared balance from the ledger. */
export function BankBalances() {
  const { data } = useBankLedger();
  const rows = (data?.accounts ?? []).filter((a) => a.active).map((a) => ({ a, l: buildLedger(a, data!) }));
  if (!rows.length) return null;
  return <section className="portal-panel hr-table" style={{ marginTop: 12 }}><div className="panel-heading"><h2>Bank Balances</h2></div><div className="portal-table-wrap"><table className="portal-table cx-cards">
    <thead><tr><th>Account</th><th className="num">Book Balance</th><th className="num">Outstanding Cheques</th><th className="num">Cleared Balance</th></tr></thead>
    <tbody>{rows.map(({ a, l }) => <tr key={a.id}><td className="lead" data-l="Account"><strong>{acctName(a)}</strong></td><td data-l="Book" className="num"><b>{peso(l.book)}</b></td><td data-l="Outstanding" className="num">{peso(l.outstandingTotal)}</td><td data-l="Cleared" className="num">{peso(l.cleared)}</td></tr>)}</tbody></table></div></section>;
}
