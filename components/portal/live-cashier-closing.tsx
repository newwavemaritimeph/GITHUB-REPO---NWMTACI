"use client";

import { useState } from "react";
import { Badge, Message, submit } from "./shared-ui";
import { BILLS, closingCheck, countedCentavos, isCash, isGcash, type DayFigures } from "@/lib/cashier-drawer";
import { depositedOn, type BankDeposit } from "@/lib/bank-deposits";

/**
 * Opening and Closing, Cash and GCash (owner, 11 Nov 2026): four steps. Opening (drawer cash and GCash balance),
 * Today (expected for each side), Closing (bill counter, GCash balance with a screenshot, remarks when over or
 * short) and History (Accounting reviews). The server works out the expected amounts again when the closing is saved.
 */
type Payment = { amount_centavos: number; method: string; received_at: string; valid?: boolean };
type Closing = { id: string; closing_date: string; opening_cash_centavos: number; cash_collections_centavos: number; online_collections_centavos: number; expenses_centavos: number; expected_cash_centavos: number; actual_cash_centavos?: number | null; variance_centavos?: number | null; status: string; submitted_at?: string | null };
type Extra = { opening_gcash_centavos?: number | null; expected_gcash_centavos?: number | null; actual_gcash_centavos?: number | null; gcash_variance_centavos?: number | null; gcash_screenshot_link?: string | null; bank_deposits_centavos?: number | null; remarks?: string | null };
export type ClosingData = {
  payments: Payment[]; cashierClosings: Closing[]; closingExtras?: Record<string, Extra>;
  cashierOpenings?: { id: string; opening_date: string; opening_cash_centavos: number; opening_gcash_centavos?: number | null; remarks: string | null; created_at: string }[];
  expenses?: { amount_centavos: number; status: string; payment_channel?: string | null; paid_at?: string | null }[];
  otherIncome?: { amount_centavos: number; channel?: string | null; received_on?: string | null; voided_at?: string | null }[];
  bankDeposits?: BankDeposit[];
};
type Step = "Opening" | "Today" | "Closing" | "History";

const peso = (c: number) => `${c < 0 ? "−" : ""}₱${(Math.abs(c) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const dayOf = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso)) : "");
const fd = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));
const clock = (iso: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const cents = (s: string) => Math.round((Number(String(s).replace(/,/g, "")) || 0) * 100);
const sum = (rows: { amount_centavos: number }[]) => rows.reduce((s, r) => s + Number(r.amount_centavos), 0);
const varBadge = (v: number | null | undefined) => v == null ? <Badge tone="slate">—</Badge> : v === 0 ? <Badge tone="green">Balanced</Badge> : v > 0 ? <Badge tone="orange">{`Over ${peso(v)}`}</Badge> : <Badge tone="red">{`Short ${peso(-v)}`}</Badge>;

export function LiveCashierClosing({ data, reload, canAct = true }: { data: ClosingData; reload: () => Promise<void>; canAct?: boolean; initialOpening?: number }) {
  const d = today();
  const opening = (data.cashierOpenings ?? []).find((o) => o.opening_date === d);
  const closed = data.cashierClosings.find((c) => c.closing_date === d);
  const [step, setStep] = useState<Step>(!canAct ? "History" : closed ? "History" : opening ? "Today" : "Opening");
  const [oCash, setOCash] = useState(""), [oG, setOG] = useState(""), [oRemarks, setORemarks] = useState("");
  const [counts, setCounts] = useState<Record<number, string>>({}), [gBal, setGBal] = useState(""), [shot, setShot] = useState<File | null>(null), [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [month, setMonth] = useState(d.slice(0, 7));

  const f: DayFigures = (() => {
    const pays = data.payments.filter((p) => p.valid !== false && dayOf(p.received_at) === d);
    const inc = (data.otherIncome ?? []).filter((i) => !i.voided_at && i.received_on === d);
    const exps = (data.expenses ?? []).filter((x) => x.status === "Paid" && dayOf(x.paid_at) === d);
    return {
      openingCash: opening?.opening_cash_centavos ?? cents(oCash), openingGcash: opening?.opening_gcash_centavos ?? cents(oG),
      cashIn: sum(pays.filter((p) => isCash(p.method))) + sum(inc.filter((i) => isCash(i.channel))),
      gcashIn: sum(pays.filter((p) => isGcash(p.method))) + sum(inc.filter((i) => isGcash(i.channel))),
      cashExpenses: sum(exps.filter((x) => isCash(x.payment_channel))), gcashExpenses: sum(exps.filter((x) => isGcash(x.payment_channel))),
      deposits: depositedOn(data.bankDeposits ?? [], d),
    };
  })();
  const counted = countedCentavos(Object.fromEntries(Object.entries(counts).map(([k, v]) => [Number(k), Number(v)])));
  const check = closingCheck(f, counted, cents(gBal));
  const receipts = (m: (x?: string | null) => boolean) => data.payments.filter((p) => p.valid !== false && dayOf(p.received_at) === d && m(p.method)).length;

  async function recordOpening() {
    setBusy(true); setMsg(null);
    try { await submit({ action: "cashier-open", openingCashCentavos: cents(oCash), openingGcashCentavos: cents(oG), remarks: oRemarks.trim() || undefined }); await reload(); setMsg({ kind: "success", text: "Opening recorded for Cash and GCash." }); setStep("Today"); }
    catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(false); }
  }
  async function submitClosing() {
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.set("openingCashCentavos", String(f.openingCash)); form.set("openingGcashCentavos", String(f.openingGcash));
      form.set("actualGcashCentavos", String(cents(gBal))); form.set("counts", JSON.stringify(counts)); form.set("remarks", remarks.trim());
      if (shot) form.set("screenshot", shot);
      const r = await fetch("/api/staff/cashier-close", { method: "POST", body: form }); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not submit the closing.");
      await reload(); setMsg({ kind: "success", text: "Closing submitted. Accounting reviews it." }); setStep("History");
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not submit the closing." }); } finally { setBusy(false); }
  }

  const lines = (rows: [string, number, ("plus" | "minus" | "total")?][]) => <dl className="ac-lines oc-lines">{rows.map(([k, v, c]) => <div key={k} className={c ?? ""}><dt>{k}</dt><dd className={c === "plus" ? "plus" : c === "minus" ? "minus" : c === "total" ? "eq" : ""}>{peso(v)}</dd></div>)}</dl>;
  const side = (title: string, kind: "cash" | "gcash", body: React.ReactNode, right?: React.ReactNode) => <section className="portal-panel oc-side"><div className="panel-heading"><h2><span className={`oc-dot ${kind}`} />{title}</h2>{right}</div>{body}</section>;
  const done = (s: Step) => (s === "Opening" && !!opening) || (s === "Closing" && !!closed);
  const history = data.cashierClosings.filter((c) => c.closing_date.startsWith(month)).sort((a, b) => b.closing_date.localeCompare(a.closing_date));
  const months = [...new Set([d.slice(0, 7), ...data.cashierClosings.map((c) => c.closing_date.slice(0, 7))])].sort().reverse();

  return <div className="portal-page hr-page oc-page">
    <div className="portal-heading hr-head"><div><span className="portal-eyebrow">Reports</span><h1>Opening and Closing</h1></div>
      <Badge tone={closed ? "blue" : opening ? "green" : "slate"}>{closed ? `Closed · ${closed.status}` : opening ? "Drawer Open" : "Not Opened"}</Badge></div>
    {canAct && <nav className="oc-steps" aria-label="Steps">{(["Opening", "Today", "Closing", "History"] as Step[]).map((s, i) => <button key={s} type="button" className={`${step === s ? "on" : ""}${done(s) ? " done" : ""}`} aria-current={step === s ? "step" : undefined} onClick={() => setStep(s)}><i>{done(s) ? "✓" : i + 1}</i>{s}</button>)}</nav>}
    {msg && <Message kind={msg.kind} text={msg.text} />}

    {step === "Opening" && (opening ? <div className="oc-two">
      {side("Cash", "cash", lines([["Opening Cash in Drawer", opening.opening_cash_centavos]]), <Badge tone="green">{`Recorded ${clock(opening.created_at)}`}</Badge>)}
      {side("GCash", "gcash", opening.opening_gcash_centavos == null ? <p className="hr-none">No GCash opening was recorded today.</p> : lines([["Opening GCash Balance", opening.opening_gcash_centavos]]), <Badge tone="green">{`Recorded ${clock(opening.created_at)}`}</Badge>)}
    </div> : <section className="portal-panel"><div className="panel-heading"><h2>Record Opening</h2><Badge tone="slate">Before the First Payment</Badge></div>
      <form className="portal-form hr-form" onSubmit={(e) => { e.preventDefault(); void recordOpening(); }}>
        <label><span><span className="oc-dot cash" />Cash in Drawer (PHP)</span><input type="number" min="0" step="0.01" required value={oCash} onChange={(e) => setOCash(e.target.value)} /><small className="field-help">Count the drawer before opening.</small></label>
        <label><span><span className="oc-dot gcash" />GCash Balance (PHP)</span><input type="number" min="0" step="0.01" required value={oG} onChange={(e) => setOG(e.target.value)} /><small className="field-help">The balance shown in the GCash app now.</small></label>
        <label className="full">Remarks<input value={oRemarks} onChange={(e) => setORemarks(e.target.value)} placeholder="Optional" /></label>
        <div className="portal-form-actions full"><button className="portal-primary" disabled={busy || oCash === "" || oG === ""}>{busy ? "Saving…" : "Record Opening"}</button></div>
      </form></section>)}

    {step === "Today" && <>
      <div className="hr-kpis"><div className="hr-kpi"><b>{peso(check.cash)}</b><small>Expected Cash</small></div><div className="hr-kpi"><b>{peso(check.gcash)}</b><small>Expected GCash</small></div><div className="hr-kpi"><b>{peso(check.cash + check.gcash)}</b><small>Cash + GCash</small></div></div>
      <div className="oc-two">
        {side("Cash", "cash", lines([["Opening Cash", f.openingCash], [`+ Cash Collected · ${receipts(isCash)} Receipts`, f.cashIn, "plus"], ["− Cash Expenses", f.cashExpenses, "minus"], ["− Bank Deposits", f.deposits, "minus"], ["= Expected in Drawer", check.cash, "total"]]))}
        {side("GCash", "gcash", lines([["Opening GCash Balance", f.openingGcash], [`+ GCash Collected · ${receipts(isGcash)} Receipts`, f.gcashIn, "plus"], ["− GCash Expenses", f.gcashExpenses, "minus"], ["= Expected GCash Balance", check.gcash, "total"]]))}
      </div>
      {canAct && !closed && <div className="portal-form-actions"><button type="button" className="portal-primary" onClick={() => setStep("Closing")}>Start Closing</button></div>}
    </>}

    {step === "Closing" && (closed ? <div className="oc-two">
      {side("Cash", "cash", <>{lines([["Expected", closed.expected_cash_centavos], ["Counted", Number(closed.actual_cash_centavos ?? 0)]])}<div className="oc-var">{varBadge(closed.variance_centavos)}</div></>)}
      {side("GCash", "gcash", data.closingExtras?.[closed.id]?.expected_gcash_centavos == null ? <p className="hr-none">No GCash on this closing.</p> : <>{lines([["Expected", Number(data.closingExtras[closed.id].expected_gcash_centavos)], ["Balance in the App", Number(data.closingExtras[closed.id].actual_gcash_centavos ?? 0)]])}<div className="oc-var">{varBadge(data.closingExtras[closed.id].gcash_variance_centavos)}</div></>)}
    </div> : <>
      <div className="oc-two">
        {side("Count the Cash", "cash", <>
          <div className="oc-bills">{BILLS.map((b) => <label key={b} className="oc-bill"><b>₱{b.toLocaleString("en-PH")}</b><input type="number" min="0" step="1" inputMode="numeric" aria-label={`Number of ₱${b}`} value={counts[b] ?? ""} onChange={(e) => setCounts({ ...counts, [b]: e.target.value })} /><span>{peso(b * 100 * (Math.max(0, Math.floor(Number(counts[b]) || 0))))}</span></label>)}</div>
          <div className="oc-total"><span>Counted</span><b>{peso(counted)}</b></div>
          {lines([["Expected in Drawer", check.cash]])}<div className="oc-var">{varBadge(check.cashVariance)}</div></>, varBadge(check.cashVariance))}
        {side("GCash Balance", "gcash", <>
          <div className="portal-form hr-form oc-g"><label className="full">Balance Shown in the GCash App (PHP)<input type="number" min="0" step="0.01" value={gBal} onChange={(e) => setGBal(e.target.value)} /></label>
            <label className="full">Screenshot of the Balance<input type="file" accept="image/jpeg,image/png" onChange={(e) => setShot(e.target.files?.[0] ?? null)} /><small className="field-help">Saved to Google Drive with the closing.</small></label></div>
          {lines([["Expected GCash Balance", check.gcash]])}<div className="oc-var">{varBadge(gBal === "" ? null : check.gcashVariance)}</div></>, gBal === "" ? undefined : varBadge(check.gcashVariance))}
      </div>
      <section className="portal-panel"><form className="portal-form hr-form" onSubmit={(e) => { e.preventDefault(); void submitClosing(); }}>
        <label className="full">Remarks {check.needsRemarks && <small className="oc-need">Required: explain the variance.</small>}<textarea rows={2} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. ₱20 short: change given to a trainee" /></label>
        <div className="portal-form-actions full"><span className="oc-sum">Cash {peso(counted)} + GCash {peso(cents(gBal))} = <b>{peso(counted + cents(gBal))}</b></span>
          <button className="portal-primary" disabled={busy || gBal === "" || (check.needsRemarks && remarks.trim().length < 3)}>{busy ? "Submitting…" : "Submit Closing"}</button></div>
      </form></section>
    </>)}

    {step === "History" && <section className="portal-panel hr-table"><div className="panel-heading"><h2>Closings</h2><select className="hr-show" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">{months.map((m) => <option key={m} value={m}>{new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(new Date(`${m}-01T00:00:00+08:00`))}</option>)}</select></div>
      <div className="portal-table-wrap"><table className="portal-table cx-cards oc-table"><thead><tr><th rowSpan={2}>Date</th><th colSpan={3} className="oc-grp">Cash</th><th colSpan={3} className="oc-grp">GCash</th><th rowSpan={2}>Status</th></tr>
        <tr><th className="num oc-g1">Expected</th><th className="num">Counted</th><th>Variance</th><th className="num oc-g1">Expected</th><th className="num">In the App</th><th>Variance</th></tr></thead>
        <tbody>{history.map((c) => { const x = data.closingExtras?.[c.id]; return <tr key={c.id}>
          <td className="lead" data-l="Date"><strong>{fd(c.closing_date)}</strong>{(x?.remarks) && <small>{x.remarks}</small>}</td>
          <td data-l="Cash Expected" className="num oc-g1">{peso(c.expected_cash_centavos)}</td><td data-l="Counted" className="num">{c.actual_cash_centavos == null ? "—" : peso(c.actual_cash_centavos)}</td><td data-l="Cash Variance">{varBadge(c.variance_centavos)}</td>
          <td data-l="GCash Expected" className="num oc-g1">{x?.expected_gcash_centavos == null ? "—" : peso(x.expected_gcash_centavos)}</td><td data-l="In the App" className="num">{x?.actual_gcash_centavos == null ? "—" : <>{peso(x.actual_gcash_centavos)}{x.gcash_screenshot_link && <a className="hr-link" href={x.gcash_screenshot_link} target="_blank" rel="noreferrer"> Screenshot</a>}</>}</td><td data-l="GCash Variance">{x?.expected_gcash_centavos == null ? "—" : varBadge(x.gcash_variance_centavos)}</td>
          <td data-l="Status"><Badge tone={c.status === "Reviewed" ? "green" : "blue"}>{c.status === "Submitted" ? "For Review" : c.status}</Badge></td></tr>; })}
          {!history.length && <tr><td colSpan={8} className="hr-none">No closings in this month.</td></tr>}</tbody></table></div></section>}
  </div>;
}
