"use client";

import { useState } from "react";
import { askText, askConfirm } from "./dialogs";
import { Badge, Message, Modal } from "./shared-ui";
import { HrFormModal, toCentavos } from "./hr-forms";
import type { BankDeposit, DepositStatus } from "@/lib/bank-deposits";

/** Bank Deposits (owner, 11 Nov 2026): Accounting requests drawer cash be deposited, then confirms it. Never an expense. */
type Data = { bankDeposits?: BankDeposit[]; paymentMethods: { name: string; active: boolean }[] };
export const peso2 = (c: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format((Number(c) || 0) / 100);
const shortDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+08:00` : iso)) : "—");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
export const DEP_TONE: Record<DepositStatus, string> = { Requested: "orange", Deposited: "blue", Received: "green", Returned: "red", Cancelled: "slate" };
export const depLabel = (s: DepositStatus) => (s === "Received" ? "Confirmed Received" : s);

export async function depositPost(body: Record<string, unknown> | FormData) {
  const r = await fetch("/api/staff/bank-deposits", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Could not save.");
  return j as { ok: true; depositNo?: string };
}

export function BankDeposits({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const [form, setForm] = useState(false), [show, setShow] = useState("Open");
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const deps = data.bankDeposits ?? [];
  const accounts = data.paymentMethods.filter((m) => m.active && !/^cash$/i.test(m.name)).map((m) => m.name);
  const rows = deps.filter((d) => show === "All" || (show === "Open" ? ["Requested", "Deposited", "Returned"].includes(d.status) : d.status === show));
  const act = async (key: string, body: Record<string, unknown>, ok: string) => { setBusy(key); setMsg(null); try { await depositPost(body); await reload(); setMsg({ kind: "success", text: ok }); } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(""); } };
  return <div className="portal-page hr-page">
    <div className="portal-heading hr-head"><div><span className="portal-eyebrow">Transactions</span><h1>Bank Deposits</h1></div>
      <div className="hr-head-acts"><select className="hr-show" value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">{["Open", "Received", "Cancelled", "All"].map((o) => <option key={o}>{o}</option>)}</select>
        <button type="button" className="portal-primary" onClick={() => setForm(true)}>Request Deposit</button></div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <section className="portal-panel hr-table"><div className="portal-table-wrap"><table className="portal-table cx-cards"><thead><tr><th>Deposit</th><th>To Account</th><th className="num">Amount</th><th>Status</th><th /></tr></thead><tbody>
      {rows.map((d) => <tr key={d.id}>
        <td className="lead" data-l="Deposit"><strong>{d.deposit_no}</strong><small>{d.status === "Requested" ? `Due ${shortDate(d.due_on)}` : d.deposited_on ? `Deposited ${shortDate(d.deposited_on)}${d.reference ? ` · Ref ${d.reference}` : ""}` : `Requested ${shortDate(d.requested_at)}`}{d.note ? ` · ${d.note}` : ""}{d.reason ? ` · ${d.reason}` : ""}</small></td>
        <td data-l="Account">{d.account}</td>
        <td data-l="Amount" className="num"><b>{peso2(d.amount_centavos)}</b></td>
        <td data-l="Status"><Badge tone={DEP_TONE[d.status]}>{depLabel(d.status)}</Badge></td>
        <td data-l="" className="hr-cell-acts"><span className="hr-acts">
          {d.slip_link && <a className="portal-secondary row-act" href={d.slip_link} target="_blank" rel="noreferrer">Slip</a>}
          {d.status === "Requested" && <button type="button" className="portal-secondary danger row-act" disabled={!!busy} onClick={async () => { const reason = await askText(`Why is ${d.deposit_no} cancelled?`); if (reason) await act(`c${d.id}`, { action: "cancel", id: d.id, reason }, `${d.deposit_no} cancelled.`); }}>Cancel</button>}
          {d.status === "Deposited" && <><button type="button" className="portal-secondary row-act" disabled={!!busy} onClick={async () => { const reason = await askText(`What should the Cashier fix on ${d.deposit_no}?`); if (reason) await act(`r${d.id}`, { action: "return", id: d.id, reason }, `${d.deposit_no} returned to the Cashier.`); }}>Return</button>
            <button type="button" className="portal-primary row-act" disabled={!!busy} onClick={async () => { if (await askConfirm(`Confirm ${d.deposit_no} received? Check ${peso2(d.amount_centavos)} on the ${d.account} statement first.`, { okLabel: "Confirm Received" })) await act(`k${d.id}`, { action: "confirm", id: d.id }, `${d.deposit_no} confirmed received.`); }}>Confirm Received</button></>}
        </span></td>
      </tr>)}
      {!rows.length && <tr><td colSpan={5} className="hr-none">No deposits in this list. Use Request Deposit to ask the Cashier to deposit cash.</td></tr>}
    </tbody></table></div></section>
    {form && <HrFormModal title="Request Deposit" submitLabel="Request Deposit" onClose={() => setForm(false)}
      initial={{ account: accounts[0] ?? "", dueOn: today() }}
      fields={[
        { key: "amount", label: "Amount (PHP)", type: "number", required: true, min: "1", step: "0.01" },
        { key: "dueOn", label: "Deposit By", type: "date", min: today() },
        { key: "account", label: "To Account", type: "select", required: true, options: accounts, full: true },
        { key: "note", label: "Note", full: true, placeholder: "e.g. Excess cash from yesterday's collections" },
      ]}
      note="A deposit moves cash from the drawer to the bank. It is never recorded as an expense."
      onSubmit={async (v) => { const r = await depositPost({ action: "request", amountCentavos: toCentavos(v.amount), account: v.account, dueOn: v.dueOn || null, note: v.note }); await reload(); setMsg({ kind: "success", text: `${r.depositNo} requested. The Cashier sees it in Money Out › Deposits.` }); }} />}
  </div>;
}

/** The Cashier's Mark Deposited window: amount, deposit date, bank reference and the slip. */
export function MarkDepositedModal({ deposit, onClose, onDone }: { deposit: BankDeposit; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [on, setOn] = useState(today()), [ref, setRef] = useState(deposit.reference ?? ""), [slip, setSlip] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  return <Modal title={`Mark Deposited · ${deposit.deposit_no}`} onClose={onClose} size="sm">
    <form className="portal-form hr-form" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr("");
      try { const f = new FormData(); f.set("id", deposit.id); f.set("depositedOn", on); f.set("reference", ref); if (slip) f.set("slip", slip); await depositPost(f); await onDone(`${deposit.deposit_no} marked deposited.`); onClose(); }
      catch (x) { setErr(x instanceof Error ? x.message : "Could not save."); } finally { setBusy(false); }
    }}>
      {err && <p className="hr-form-err full" role="alert">{err}</p>}
      {deposit.reason && <p className="hr-form-note full">Returned by Accounting: {deposit.reason}</p>}
      <label>Amount<input value={peso2(deposit.amount_centavos)} readOnly /></label>
      <label>To Account<input value={deposit.account} readOnly /></label>
      <label>Deposit Date<input type="date" required max={today()} value={on} onChange={(e) => setOn(e.target.value)} /></label>
      <label>Bank Reference No.<input required minLength={3} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="From the deposit slip" /></label>
      <label className="full">Deposit Slip (Photo or PDF)<input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setSlip(e.target.files?.[0] ?? null)} /></label>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button className="portal-primary" disabled={busy}>{busy ? "Saving…" : "Mark Deposited"}</button></div>
    </form>
  </Modal>;
}
