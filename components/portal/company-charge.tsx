"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChargePayment, ChargeStatement } from "@/app/api/staff/company-charge/route";
import { formatNumber } from "@/lib/certificate-rules";
import { canRecordCompanyPayment } from "@/lib/company-charge";
import { manilaToday, pesos2 } from "@/lib/portal-format";
import { BLANK_SETUP, siFormatProblem, type InvoiceSetup } from "@/lib/service-invoice";
import type { PortalData } from "../portal-live-app";
import { BillingStatementReport } from "./accounting-home";
import { CompanyPaymentModal } from "./live-cashier";
import { Badge, Message, fmtDate, manilaDay, submit, usePaged } from "./shared-ui";

/**
 * Company Charge (owner, 5 Nov 2026; Design 1): the statements still Unpaid and the payments already in, with mode,
 * reference and proof. A payment counts as sales on the day it was paid and gets a Service Invoice with a system SI No.
 */
type Payload = { statements: ChargeStatement[]; payments: ChargePayment[]; setup: InvoiceSetup | null };
type Sort = "oldest" | "company" | "amount";
const balanceOf = (s: ChargeStatement) => s.total - s.paid;
const daysSince = (iso: string, today: string) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${manilaDay(iso)}T00:00:00Z`)) / 86_400_000));

/** Oldest first, by company, or the highest amount first; pure, for the test. */
export function sortStatements(rows: ChargeStatement[], sort: Sort) {
  return [...rows].sort((a, z) => (sort === "company" ? a.billTo.localeCompare(z.billTo) : sort === "amount" ? balanceOf(z) - balanceOf(a) : a.issuedAt.localeCompare(z.issuedAt)) || a.bsNumber.localeCompare(z.bsNumber));
}
export function sortPayments(rows: ChargePayment[], sort: Sort) {
  return [...rows].sort((a, z) => (sort === "company" ? a.billTo.localeCompare(z.billTo) : sort === "amount" ? z.amount - a.amount : z.receivedAt.localeCompare(a.receivedAt)) || a.bsNumber.localeCompare(z.bsNumber));
}
/** What the three figures read, from the payments in. */
export function chargeFigures(statements: ChargeStatement[], payments: ChargePayment[], today: string) {
  const unpaid = statements.filter((s) => balanceOf(s) > 0);
  const on = (p: ChargePayment) => manilaDay(p.receivedAt);
  return { unpaidCount: unpaid.length, unpaidTotal: unpaid.reduce((t, s) => t + balanceOf(s), 0), paidMonth: payments.filter((p) => on(p).slice(0, 7) === today.slice(0, 7)).reduce((t, p) => t + p.amount, 0), salesToday: payments.filter((p) => on(p) === today).reduce((t, p) => t + p.amount, 0) };
}

function useCharge() {
  const [state, setState] = useState<{ data: Payload | null; error: string }>({ data: null, error: "" });
  const load = useCallback(() => {
    void fetch("/api/staff/company-charge", { cache: "no-store" }).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error ?? "Could not load."); setState({ data: b as Payload, error: "" }); })
      .catch((e) => setState((c) => ({ data: c.data, error: e instanceof Error ? e.message : "Could not load." })));
  }, []);
  useEffect(() => { load(); }, [load]);
  return { ...state, load };
}

export function CompanyChargeReport({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const today = manilaToday();
  const { data: charge, error, load } = useCharge();
  const [tab, setTab] = useState<"Unpaid" | "Paid">("Unpaid"), [sort, setSort] = useState<Sort>("oldest"), [recording, setRecording] = useState<string | null>(null), [issuing, setIssuing] = useState(false), [problem, setProblem] = useState(""), [busy, setBusy] = useState("");
  const statements = charge?.statements ?? [], payments = charge?.payments ?? [];
  const unpaid = sortStatements(statements.filter((s) => balanceOf(s) > 0), sort), paid = sortPayments(payments, sort);
  const unpaidPage = usePaged(unpaid), paidPage = usePaged(paid);
  const figures = chargeFigures(statements, payments, today);
  const canRecord = canRecordCompanyPayment(data.roles);
  async function issueInvoice(p: ChargePayment) {
    setBusy(p.id); setProblem("");
    try { await submit({ action: "service-invoice-issue", companyPaymentId: p.id }); load(); }
    catch (e) { setProblem(e instanceof Error ? e.message : "Could not issue the Service Invoice."); } finally { setBusy(""); }
  }
  if (issuing) return <BillingStatementReport onBack={() => { setIssuing(false); load(); void reload(); }} />;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting · Reports</span><h1>Company Charge</h1></div><div className="ac-controls"><button type="button" className="portal-secondary" onClick={() => setIssuing(true)}>Issue Statement</button></div></div>
    {(error || problem) && <Message kind="error" text={error || problem} />}
    {charge && !charge.setup && <Message kind="error" text="The Service Invoice tables are not in the database yet. Apply database update 202610290083 first." />}
    <div className="cc-tiles">
      <div className="cc-tile hot"><span>Unpaid · {figures.unpaidCount} Statement{figures.unpaidCount === 1 ? "" : "s"}</span><b>{pesos2(figures.unpaidTotal)}</b></div>
      <div className="cc-tile ok"><span>Paid This Month</span><b>{pesos2(figures.paidMonth)}</b></div>
      <div className="cc-tile"><span>Sales Today from Company Charge</span><b>{pesos2(figures.salesToday)}</b></div>
    </div>
    <section className="portal-panel cx-panel cc-panel">
      <div className="cc-tools"><span className="cx-seg" role="tablist">{(["Unpaid", "Paid"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t} <small className="cl-mono">{t === "Unpaid" ? unpaid.length : paid.length}</small></button>)}</span>
        <label className="cc-sort">Sort<select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="oldest">{tab === "Unpaid" ? "Oldest First" : "Newest First"}</option><option value="company">Company</option><option value="amount">Highest Amount</option></select></label></div>
      {!charge ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : tab === "Unpaid" ? (unpaid.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Company</th><th>Coverage</th><th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th><th>Issued</th><th></th></tr></thead><tbody>
        {unpaidPage.shown.map((s) => { const days = daysSince(s.issuedAt, today); return <tr key={s.id}>
          <td data-l="" className="lead"><span className="cx-name">{s.billTo}</span><small>{s.kind} · BS No. <span className="cl-mono">{s.bsNumber}</span></small></td>
          <td data-l="Coverage">{fmtDate(s.from)} – {fmtDate(s.to)}<small>{s.trainees} Trainee{s.trainees === 1 ? "" : "s"}</small></td>
          <td data-l="Total" className="r cx-amt">{pesos2(s.total)}</td><td data-l="Paid" className="r cx-amt">{pesos2(s.paid)}</td><td data-l="Balance" className="r"><strong className="cx-amt">{pesos2(balanceOf(s))}</strong></td>
          <td data-l="Issued">{fmtDate(manilaDay(s.issuedAt))}<small><Badge tone={days > 30 ? "cancelled" : "pending"}>{`${days} Day${days === 1 ? "" : "s"}`}</Badge></small></td>
          <td data-l=""><div className="cx-acts"><a className="st-b" href={`/api/documents/billing-statement?agency=${s.agencyId}&from=${s.from}&to=${s.to}`} target="_blank" rel="noreferrer">Statement</a>{canRecord && <button type="button" className="st-b p" onClick={() => setRecording(s.id)}>Record Payment</button>}</div></td>
        </tr>; })}
      </tbody></table>{unpaidPage.pager}</div> : <p className="portal-empty-copy">Every statement is paid.</p>) : (paid.length ? <div className="portal-table cx-cards"><table><thead><tr><th>SI No.</th><th>Date Paid</th><th>Mode</th><th>Proof</th><th className="r">Amount</th><th></th></tr></thead><tbody>
        {paidPage.shown.map((p) => <tr key={p.id}>
          <td data-l="" className="lead"><span className="cx-name cl-mono">{p.siNumber ?? "No Invoice Yet"}</span><small>{p.billTo} · BS No. <span className="cl-mono">{p.bsNumber}</span></small></td>
          <td data-l="Date Paid">{fmtDate(manilaDay(p.receivedAt))}</td>
          <td data-l="Mode">{p.method}{p.reference && <small className="cl-mono">{p.reference}</small>}</td>
          <td data-l="Proof">{p.proofLink ? <a className="cc-link" href={p.proofLink} target="_blank" rel="noreferrer">View Proof</a> : <small>{p.method === "Cash" ? "No Proof, Cash" : "No Proof"}</small>}</td>
          <td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(p.amount)}</strong><small>{p.statementBalance > 0 ? `${pesos2(p.statementBalance)} Left` : <Badge tone="active">Fully Paid</Badge>}</small></td>
          <td data-l=""><div className="cx-acts">{p.invoiceId ? <a className="st-b" href={`/api/documents/service-invoice/${p.invoiceId}`} target="_blank" rel="noreferrer">Service Invoice</a> : canRecord && <button type="button" className="st-b p" disabled={busy === p.id || !charge.setup} onClick={() => void issueInvoice(p)}>{busy === p.id ? "Issuing…" : "Issue Invoice"}</button>}</div></td>
        </tr>)}
      </tbody></table>{paidPage.pager}</div> : <p className="portal-empty-copy">No company has paid yet.</p>)}
    </section>
    {recording && <CompanyPaymentModal data={data} reload={async () => { load(); await reload(); }} initialId={recording} onClose={() => { setRecording(null); setTab("Paid"); }} />}
  </div>;
}

/** Configuration › Form Numbers › Service Invoice: set once by Accounting; staff never type an SI No. */
export function ServiceInvoiceSetup({ post, busy }: { post: (body: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const { data: charge, error, load } = useCharge();
  const saved = charge?.setup ?? null;
  const [edit, setEdit] = useState<InvoiceSetup | null>(null), [done, setDone] = useState("");
  const v = edit ?? saved ?? BLANK_SETUP;
  const set = (key: keyof InvoiceSetup, value: string) => { setDone(""); setEdit({ ...v, [key]: key === "lastNumber" ? Math.max(0, Math.trunc(Number(value.replace(/\D/g, "")) || 0)) : value }); };
  const problem = siFormatProblem(v.format);
  const field = (key: keyof InvoiceSetup, label: string, extra: { inputMode?: "numeric"; maxLength?: number } = {}) => <label>{label}<input className="cl-mono" value={String(v[key])} maxLength={extra.maxLength ?? 40} inputMode={extra.inputMode} onChange={(e) => set(key, e.target.value)} /></label>;
  async function save() {
    try { await post({ action: "service-invoice-setup-save", ...v }); setEdit(null); setDone("Service Invoice setup saved."); load(); } catch { /* the page shows the error */ }
  }
  return <section className="portal-panel cx-panel">
    <div className="panel-heading"><h2>Service Invoice</h2></div>
    {error && <Message kind="error" text={error} />}
    {charge && !saved && <Message kind="error" text="Apply database update 202610290083 first." />}
    {done && <Message kind="success" text={done} />}
    <div className="portal-form cx-formpad">
      {field("controlNo", "Control No.")}{field("formNo", "Form No.")}{field("revisionNo", "Revision No.", { maxLength: 20 })}{field("revisionDate", "Revision Date", { maxLength: 20 })}{field("issuedDate", "Issued Date", { maxLength: 20 })}{field("tin", "New Wave TIN", { maxLength: 30 })}{field("format", "SI Number Format")}{field("lastNumber", "Last SI No. Used", { inputMode: "numeric", maxLength: 12 })}
      <p className="portal-form-note full">{problem ?? <>Next SI No. <b className="cl-mono">{formatNumber(v.format, "", v.lastNumber + 1)}</b>. Tokens: {"{YYYY}, {YY}, {MM}, {N:6}"}.</>}</p>
      <div className="portal-form-actions full"><button type="button" className="portal-primary" disabled={busy || !saved || !!problem || !edit} onClick={() => void save()}>Save</button></div>
    </div>
  </section>;
}
