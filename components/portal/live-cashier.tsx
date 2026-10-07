"use client";

import { useState } from "react";
import type { PortalData, Enrollment } from "../portal-live-app";
import { addDays, balanceOf, dueCentavos, first, manilaToday, pesos } from "@/lib/portal-format";
import { Badge, Message, Modal, PageHead, fullName, fmtDate, fmtClock, usePost, openAdmissionRecord, submit } from "./shared-ui";
import { unpaidAfterTraining, type BalanceEnrollment } from "@/lib/unpaid-balances";
import { RequestActionModal } from "./payment-actions";

/**
 * Cashier pieces of the registration workflow (Oct 2026):
 * - "For payment": applicants Registration has screened and handed over. The
 *   Cashier records their payment with the existing payment form; a paid
 *   applicant on a batch is enrolled automatically.
 * - The Training Admission Record: printed by the Cashier, twice at most; a
 *   further reprint needs a "TAR reprint" request approved by the Accounting
 *   Manager (each approval allows one more print).
 * - The charge step for change requests: Registration's requests come to the
 *   Cashier first, who adds the applicable fee (or "no charge") before the
 *   Accounting Manager decides.
 */

type RequestRow = PortalData["requests"][number];
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");

/** Free prints of the Training Admission Record before Accounting approval is needed. */
export const TAR_FREE_PRINTS = 2;
const PAID_STATUSES = ["Enrolled", "Open Schedule"];

/**
 * Print state of a trainee's TAR. A record covers the trainee's current set of
 * paid enrollments; adding a paid course starts a new record (new AR number).
 */
export function tarState(data: PortalData, traineeId: string) {
  const paid = data.enrollments.filter((e) => e.trainee_id === traineeId && PAID_STATUSES.includes(e.enrollment_status));
  const ids = paid.map((e) => e.id).sort().join("|");
  const record = (data.admissionRecords ?? []).find((r) => r.trainee_id === traineeId && [...r.enrollment_ids].sort().join("|") === ids) ?? null;
  const allowed = TAR_FREE_PRINTS + Number(record?.reprints_approved ?? 0);
  const printed = Number(record?.print_count ?? 0);
  const pendingReprint = !!record && data.requests.some((r) => r.request_type === "TAR reprint" && r.status === "Pending" && record.enrollment_ids.includes(first(r.enrollments)?.id ?? ""));
  return { paid, record, printed, allowed, left: Math.max(0, allowed - printed), pendingReprint };
}

/** Print the TAR, or — once the limit is reached — ask the Accounting Manager for one more print. */
export function TarButton({ data, traineeId, reload, className = "portal-secondary" }: { data: PortalData; traineeId: string; reload?: () => Promise<void>; className?: string }) {
  const s = tarState(data, traineeId);
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState<Enrollment | null>(null);
  const { post } = usePost(reload ?? (async () => undefined));
  const print = () => { setError(""); void openAdmissionRecord(traineeId).then(() => reload?.()).catch((e) => setError(e instanceof Error ? e.message : "Could not open the admission record.")); };
  let button;
  if (!s.paid.length) button = <button type="button" className={className} disabled title="The TAR Prints Once a Course Is Paid">Print TAR</button>;
  else if (s.left > 0) button = <button type="button" className={className} onClick={print}>{s.printed ? `Reprint TAR (${s.printed} of ${s.allowed} printed)` : "Print TAR"}</button>;
  else if (s.pendingReprint) button = <button type="button" className={className} disabled>Reprint Awaiting Approval</button>;
  else button = <button type="button" className={className} onClick={() => setRequesting(s.paid[0])}>Request TAR Reprint</button>;
  return <>
    {button}
    {error && <Message kind="error" text={error} />}
    {requesting && <RequestActionModal data={data} enrollment={requesting} reqType="TAR reprint" onClose={() => setRequesting(null)} post={(body) => post(body, "Reprint request raised. Add the charge (or no charge) in Requests to send it for approval.")} />}
  </>;
}

export function CashierPaymentQueue({ data, onPay, reload }: { data: PortalData; onPay: (enrollmentId: string) => void; reload: () => Promise<void> }) {
  const handed = data.handedToCashier ?? {};
  const rows = data.enrollments
    .filter((e) => e.enrollment_status === "Pending" && handed[e.id])
    .sort((a, b) => (handed[a.id] ?? "").localeCompare(handed[b.id] ?? ""));
  // Trainees paid in the last 7 days whose courses are enrolled: print their TAR.
  const since = addDays(manilaToday(), -6);
  const paidRecently = new Set(data.payments.filter((p) => day(p.received_at) >= since).map((p) => p.trainee_id));
  const toPrint = [...new Set(data.enrollments.filter((e) => PAID_STATUSES.includes(e.enrollment_status) && paidRecently.has(e.trainee_id)).map((e) => e.trainee_id))]
    .map((id) => data.trainees.find((t) => t.id === id)).filter((t): t is PortalData["trainees"][number] => !!t);
  return <div className="portal-page">
    <PageHead eyebrow="Collections" title="For Payment" text="Applicants Registration has screened and handed over. Record their payment: once paid and on a batch they are enrolled automatically. Then print their Training Admission Record." />
    <div className="portal-table portal-panel"><table><thead><tr><th>Applicant</th><th>Course &Amp; Batch</th><th>Handed Over</th><th>Total Due</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>
      {rows.map((e) => {
        const t = first(e.trainees), b = first(e.batches), balance = balanceOf(e), paid = Number(e.verified_paid_centavos ?? e.paid_centavos);
        const number = data.applicationNumbers?.[e.trainee_id];
        return <tr key={e.id}>
          <td><strong>{t ? fullName(t) : "Unknown"}</strong><small>{number ? <span className="app-no">{number}</span> : null}{e.enrollment_number}</small></td>
          <td>{first(e.courses)?.name ?? "—"}<small>{b ? `${b.batch_number} · ${fmtDate(b.starts_on)}` : "No batch"}</small></td>
          <td>{fmtDate(day(handed[e.id]))}<small>{fmtClock(handed[e.id])}</small></td>
          <td>{pesos(dueCentavos(e))}</td>
          <td>{pesos(paid)}</td>
          <td><strong>{pesos(balance)}</strong></td>
          <td>{paid > 0 ? <Badge tone="active">{e.batch_id ? "Paid · Enrolling" : "Paid · Awaiting Batch"}</Badge> : <button type="button" className="portal-primary" onClick={() => onPay(e.id)}>Record Payment</button>}</td>
        </tr>;
      })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">No applicants waiting for payment. Registration hands them over once their requirements are complete.</p>}</div>

    <section className="portal-panel live-list" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>Paid · Training Admission Record</h2><p>Enrolled trainees paid in the last 7 days. The TAR prints twice; more needs the Accounting Manager&apos;s approval.</p></div><span className="slot-count">{toPrint.length}</span></div>
      {toPrint.map((t) => { const s = tarState(data, t.id); return <div className="live-row-item" key={t.id}>
        <div><strong>{fullName(t)}</strong><small>{data.applicationNumbers?.[t.id] ? <span className="app-no">{data.applicationNumbers[t.id]}</span> : null}{s.paid.map((e) => first(e.courses)?.code ?? first(e.courses)?.name).filter(Boolean).join(", ")}{s.record ? ` · ${s.record.ar_number} · printed ${s.printed} of ${s.allowed}` : " · not printed yet"}</small></div>
        <div className="document-actions"><TarButton data={data} traineeId={t.id} reload={reload} className="portal-primary" /></div>
      </div>; })}
      {!toPrint.length && <p className="portal-empty-copy">No newly paid trainees.</p>}
    </section>
  </div>;
}

/** The Cashier adds the fee for a change request, or marks it "no charge", and forwards it for approval. */
export function RequestChargeModal({ data, request, reload, onClose }: { data: PortalData; request: RequestRow; reload: () => Promise<void>; onClose: () => void }) {
  const { busy, msg, post } = usePost(reload);
  const [catalogId, setCatalogId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [noCharge, setNoCharge] = useState(false);
  const [remarks, setRemarks] = useState("");
  const catalog = data.charges.filter((c) => c.active);
  const centavos = Math.round(Number(amount || 0) * 100);
  const valid = noCharge || (Number.isFinite(centavos) && centavos > 0);
  const t = first(request.trainees), e = first(request.enrollments);
  const typeLabel = request.request_type === "Rescheduling" ? "Change batch / reschedule" : request.request_type;
  function choose(id: string) {
    setCatalogId(id);
    const item = catalog.find((c) => c.id === id);
    if (item) { setDescription(item.name); setAmount((Number(item.default_amount_centavos) / 100).toFixed(2)); setNoCharge(false); }
  }
  const send = () => void post({ action: "request-charge", id: request.id, chargeCatalogId: noCharge ? null : catalogId || null, description: noCharge ? undefined : description || `${typeLabel} fee`, amountCentavos: noCharge ? 0 : centavos, remarks: remarks.trim() || undefined }, "Sent to the Accounting Manager for approval.").then(onClose).catch(() => undefined);
  return <Modal title={`Charges · ${request.request_number}`} onClose={onClose}>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      <div className="rate-preview full"><span>{typeLabel}</span><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "Trainee"}</strong><small>{e?.enrollment_number}{first(e?.courses)?.name ? ` · ${first(e?.courses)?.name}` : ""} · {request.reason}</small></div>
      {request.request_type === "Make-up Class" && <p className="portal-form-note full">Policy: Php 350.00 per make-up training day.</p>}
      {request.request_type === "Cancellation" && <p className="portal-form-note full">Policy: 5+ days before training, Php 350.00 processing fee; within 5 days, 50% of the course fee plus Php 250.00.</p>}
      <label className="portal-check full"><input type="checkbox" checked={noCharge} onChange={(ev) => setNoCharge(ev.target.checked)} /><span>No charge for this request</span></label>
      {!noCharge && <>
        <label className="full">Charge<select value={catalogId} onChange={(ev) => choose(ev.target.value)}><option value="">Custom Amount</option>{catalog.map((c) => <option key={c.id} value={c.id}>{c.name} · {pesos(c.default_amount_centavos)}</option>)}</select></label>
        <label>Description<input value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder={`${typeLabel} fee`} /></label>
        <label>Amount (PHP)<input type="number" min="0" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} /></label>
      </>}
      <label className="full">Remarks (Optional)<input value={remarks} onChange={(ev) => setRemarks(ev.target.value)} placeholder="For the Accounting Manager" /></label>
      <p className="portal-form-note full">The charge is added to the trainee&apos;s balance only when the Accounting Manager approves the request.</p>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !valid} onClick={send}>{busy ? "Sending…" : "Send for Approval"}</button></div>
    </div>
  </Modal>;
}

/* ====================================================== Cashier workspace (Oct 2026) */

const modeNames = (data: PortalData) => data.paymentMethods.filter((m) => m.active).map((m) => m.name);
const needsReference = (data: PortalData, method: string) => !!data.paymentMethods.find((m) => m.name === method)?.requires_reference;
const traineeName = (e: Enrollment) => { const t = first(e.trainees); return t ? fullName(t) : e.enrollment_number; };
const paidOf = (e: Enrollment) => Number(e.paid_centavos ?? 0);
const scheduleText = (e: Enrollment) => { const b = first(e.batches); return b ? `${fmtDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""}` : e.scheduled_on ? fmtDate(e.scheduled_on) : "No schedule yet"; };

/**
 * Record a payment (training fee or charges): find the trainee, see the fee
 * breakdown, pick Cash / GCash / PSBank / UnionBank (a reference is required for
 * every mode except Cash), enter the amount. Receipts are issued by the server.
 */
export function RecordPaymentModal({ data, initialEnrollmentId, onClose, onSaved }: { data: PortalData; initialEnrollmentId?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const eligible = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && balanceOf(e) > 0);
  const [enrollmentId, setEnrollmentId] = useState(initialEnrollmentId && eligible.some((e) => e.id === initialEnrollmentId) ? initialEnrollmentId : "");
  const [search, setSearch] = useState("");
  const modes = modeNames(data);
  const [method, setMethod] = useState(modes[0] ?? "Cash");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [remarks, setRemarks] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState<{ id: string; amount: number } | null>(null);
  const e = eligible.find((x) => x.id === enrollmentId);
  const term = search.trim().toLowerCase();
  const matches = eligible.filter((x) => !term || `${traineeName(x)} ${x.enrollment_number} ${first(x.courses)?.name ?? ""} ${data.applicationNumbers?.[x.trainee_id] ?? ""} ${first(x.trainees)?.trainee_number ?? ""}`.toLowerCase().includes(term)).slice(0, 8);
  const balance = e ? balanceOf(e) : 0;
  const centavos = Math.round(Number(amount || 0) * 100);
  const refRequired = needsReference(data, method);
  const rebate = e && agencyId ? data.agencyCourseRebates.find((r) => r.agency_id === agencyId && r.course_id === e.course_id)?.rebate_centavos ?? null : null;
  const valid = !!e && centavos > 0 && centavos <= balance && (!refRequired || reference.trim().length > 0);
  async function post() {
    if (!e) return;
    setBusy(true); setError("");
    try {
      const result = await submit({ action: "post-payment", enrollmentId: e.id, amountCentavos: centavos, method, receivingAccount: method === "Cash" ? "Main cashier" : method, referenceNumber: reference.trim(), proofId: null, receivedAt: new Date(receivedAt).toISOString(), remarks }) as { payment?: { id?: string } | string };
      if (agencyId) { try { await submit({ action: "record-agency-rebate", enrollmentId: e.id, agencyId }); } catch { /* the rebate never blocks the payment */ } }
      const paymentId = typeof result.payment === "string" ? result.payment : result.payment?.id ?? "";
      setPosted({ id: paymentId, amount: centavos });
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not record the payment."); } finally { setBusy(false); }
  }
  if (posted && e) return <Modal title="Payment Recorded" onClose={onClose}>
    <div className="portal-form">
      <div className="full"><Message kind="success" text={`${pesos(posted.amount)} recorded for ${traineeName(e)} (${e.enrollment_number}). A paid trainee on a batch is enrolled automatically.`} /></div>
      <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
        {posted.id && <a href={`/api/documents/payment/${posted.id}?type=receipt`} target="_blank" rel="noreferrer">Receipt</a>}
        <TarButton data={data} traineeId={e.trainee_id} className="portal-secondary" />
      </div>
      <div className="portal-form-actions full"><button type="button" className="portal-primary" onClick={onClose}>Done</button></div>
    </div>
  </Modal>;
  return <Modal title="Record Payment" onClose={onClose} wide>
    <div className="portal-form">
      {error && <div className="full"><Message kind="error" text={error} /></div>}
      {!e ? <div className="full pay-pick">
        <label>Find Trainee<input autoFocus value={search} onChange={(ev) => setSearch(ev.target.value)} placeholder="Name, NWMTACI number, enrollment number or course" /></label>
        <div className="pay-results">{matches.map((x) => <button type="button" key={x.id} className="pay-result" onClick={() => setEnrollmentId(x.id)}><span><b>{traineeName(x)}</b><small>{x.enrollment_number} · {first(x.courses)?.name ?? "Course"} · {scheduleText(x)}</small></span><strong>{pesos(balanceOf(x))}</strong></button>)}
          {!matches.length && <p className="portal-empty-copy">No unpaid enrollment matches.</p>}</div>
      </div> : <>
        <div className="pay-breakdown full">
          <div className="pay-who"><b>{traineeName(e)}</b><small>{e.enrollment_number} · {first(e.courses)?.name ?? "Course"} · {scheduleText(e)}</small>{!initialEnrollmentId && <button type="button" className="ghost-button" onClick={() => { setEnrollmentId(""); setAmount(""); }}>Change</button>}</div>
          <dl>
            <div><dt>Training Fee</dt><dd>{pesos(e.selling_price_centavos)}</dd></div>
            {Number(e.charges_centavos ?? 0) > 0 && <div><dt>Charges</dt><dd>+{pesos(Number(e.charges_centavos))}</dd></div>}
            {Number(e.discounts_centavos ?? 0) > 0 && <div><dt>Discounts</dt><dd>−{pesos(Number(e.discounts_centavos))}</dd></div>}
            <div><dt>Paid</dt><dd>{pesos(paidOf(e))}</dd></div>
            <div className="due"><dt>Balance</dt><dd>{pesos(balance)}</dd></div>
          </dl>
        </div>
        <div className="full"><span className="pay-label">Mode of Payment</span><div className="pay-modes" role="radiogroup" aria-label="Mode of payment">{modes.map((m) => <button type="button" role="radio" aria-checked={method === m} key={m} className={method === m ? "on" : ""} onClick={() => setMethod(m)}>{m}</button>)}</div></div>
        <label>Amount (PHP)<input type="number" min="0.01" step="0.01" max={balance / 100} value={amount} onChange={(ev) => setAmount(ev.target.value)} /><span className="amount-shortcuts"><button type="button" onClick={() => setAmount(((balance / 100) * 0.5).toFixed(2))}>50%</button><button type="button" onClick={() => setAmount((balance / 100).toFixed(2))}>Full Balance</button></span></label>
        {refRequired ? <label>Reference Number*<input value={reference} onChange={(ev) => setReference(ev.target.value.toUpperCase())} placeholder={`${method} reference`} /></label> : <label>Reference Number<input value={reference} onChange={(ev) => setReference(ev.target.value.toUpperCase())} placeholder="Not needed for cash" /></label>}
        <label>Received At<input type="datetime-local" value={receivedAt} onChange={(ev) => setReceivedAt(ev.target.value)} /></label>
        <label>Endorsing Agency (Optional)<select value={agencyId} onChange={(ev) => setAgencyId(ev.target.value)}><option value="">— None —</option>{data.agencies.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{rebate != null && <small className="portal-form-note">Rebate {pesos(rebate)} is recorded for the agency.</small>}</label>
        <label className="full">Remarks<input value={remarks} onChange={(ev) => setRemarks(ev.target.value)} placeholder="Optional" /></label>
        {centavos > balance && <p className="portal-form-note full" style={{ color: "#b42318" }}>The amount is more than the balance of {pesos(balance)}.</p>}
      </>}
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={!valid || busy} onClick={() => void post()}>{busy ? "Recording…" : `Record ${centavos > 0 ? pesos(centavos) : "Payment"}`}</button></div>
    </div>
  </Modal>;
}

/**
 * Cashier dashboard (owner, 7 Oct 2026): only what needs collecting.
 * - For Payment: applicants Registration handed over.
 * - Unpaid Balances: training ended (or ends today) with a balance still due;
 *   the same list is emailed to the Cashier and Accounting Manager at 4:00 PM.
 */
export function CashierDashboard({ data, onPay, reload }: { data: PortalData; onPay: (enrollmentId: string) => void; reload: () => Promise<void> }) {
  const today = manilaToday();
  const handed = data.handedToCashier ?? {};
  const forPayment = data.enrollments.filter((e) => e.enrollment_status === "Pending" && handed[e.id] && Number(e.verified_paid_centavos ?? e.paid_centavos) === 0)
    .sort((a, b) => (handed[a.id] ?? "").localeCompare(handed[b.id] ?? ""));
  const durations = new Map(data.courses.map((c) => [c.id, c.duration_label]));
  const unpaid = unpaidAfterTraining(data.enrollments as unknown as BalanceEnrollment[], (id) => durations.get(id), today);
  const total = unpaid.reduce((s, r) => s + r.balanceCentavos, 0);
  const { busy, msg, post } = usePost(reload);
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Collections</span><h1>Cashier Dashboard</h1><p>Payments to collect today, and balances still due after training.</p></div><button type="button" className="portal-primary" onClick={() => onPay("")}>Record Payment</button></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <section className="portal-panel live-list">
      <div className="panel-heading"><div><h2>For Payment</h2><p>Handed over by Registration · requirements complete</p></div><span className="slot-count">{forPayment.length}</span></div>
      {forPayment.map((e) => <div className="live-row-item" key={e.id}><div><strong>{traineeName(e)}</strong><small>{data.applicationNumbers?.[e.trainee_id] ? <span className="app-no">{data.applicationNumbers[e.trainee_id]}</span> : null}{first(e.courses)?.name ?? "Course"} · {scheduleText(e)} · handed over {fmtDate(day(handed[e.id]))} {fmtClock(handed[e.id])}</small></div><div className="document-actions"><strong>{pesos(dueCentavos(e))}</strong><button type="button" className="portal-primary" onClick={() => onPay(e.id)}>Record Payment</button></div></div>)}
      {!forPayment.length && <p className="portal-empty-copy">Nobody is waiting for payment.</p>}
    </section>
    <section className="portal-panel live-list" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>Unpaid Balances · 4:00 PM Summary</h2><p>Training ended or ends today, balance not settled · {unpaid.length} trainee{unpaid.length === 1 ? "" : "s"} · {pesos(total)} due · emailed daily at 4:00 PM</p></div>
        <span className="document-actions"><button type="button" className="portal-secondary" onClick={() => window.print()}>Print / Save</button><button type="button" className="portal-secondary" disabled={busy} onClick={() => void post({ action: "balance-summary-send" }, "Summary emailed to the Cashier and Accounting Manager.").catch(() => undefined)}>Email Summary Now</button></span></div>
      {unpaid.map((r) => <div className="live-row-item" key={r.id}><div><strong>{r.traineeName}</strong><small>{r.enrollmentNumber} · {r.course} · training {r.endsToday ? "ends today" : `ended ${fmtDate(r.trainingEnd)}`}</small></div><div className="document-actions">{r.endsToday ? <Badge tone="orange">Ends Today</Badge> : <Badge tone="cancelled">Past Due</Badge>}<span className="bal-cell">{pesos(r.balanceCentavos)}<small>of {pesos(r.dueCentavos)}</small></span><button type="button" className="portal-primary" onClick={() => onPay(r.id)}>Record Payment</button></div></div>)}
      {!unpaid.length && <p className="portal-empty-copy">No unpaid balances after training. </p>}
    </section>
  </div>;
}

const RANGES = ["Today", "This Week", "This Month", "Custom"] as const;
/** Payment records: every payment with mode, reference and receipt, by date range. */
export function CashierPayments({ data, onPay }: { data: PortalData; onPay: (enrollmentId: string) => void }) {
  const today = manilaToday();
  const [range, setRange] = useState<(typeof RANGES)[number]>("Today");
  const [from, setFrom] = useState(today), [to, setTo] = useState(today);
  const [mode, setMode] = useState("");
  const [q, setQ] = useState("");
  const start = range === "Today" ? today : range === "This Week" ? addDays(today, -6) : range === "This Month" ? `${today.slice(0, 8)}01` : from;
  const end = range === "Custom" ? to : today;
  const term = q.trim().toLowerCase();
  const rows = data.payments.filter((p) => { const d = day(p.received_at); const t = first(p.trainees); return d >= start && d <= end && (!mode || p.method === mode) && (!term || `${p.payment_number} ${p.reference_number ?? ""} ${t ? `${t.legal_first_name} ${t.legal_last_name}` : ""}`.toLowerCase().includes(term)); })
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  const byMode = new Map<string, number>();
  for (const p of rows) byMode.set(p.method, (byMode.get(p.method) ?? 0) + Number(p.amount_centavos));
  const total = rows.reduce((s, p) => s + Number(p.amount_centavos), 0);
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Collections</span><h1>Payments</h1><p>Record training fees and charges, and review every payment received.</p></div><button type="button" className="portal-primary" onClick={() => onPay("")}>Record Payment</button></div>
    <div className="portal-tabs">{RANGES.map((r) => <button key={r} type="button" className={range === r ? "active" : ""} onClick={() => setRange(r)}>{r}</button>)}</div>
    <div className="pay-filters">
      {range === "Custom" && <><label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label></>}
      <label>Mode<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All Modes</option>{[...new Set([...modeNames(data), ...data.payments.map((p) => p.method)])].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      <label className="grow">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Trainee, payment number or reference" /></label>
    </div>
    <div className="pay-totals"><div><span>Total</span><b>{pesos(total)}</b><small>{rows.length} payment{rows.length === 1 ? "" : "s"}</small></div>{[...byMode.entries()].map(([m, v]) => <div key={m}><span>{m}</span><b>{pesos(v)}</b></div>)}</div>
    <div className="portal-table portal-panel"><table><thead><tr><th>Payment</th><th>Trainee</th><th>Mode</th><th>Reference</th><th>Received</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>
      {rows.map((p) => { const t = first(p.trainees); return <tr key={p.id}><td><strong>{p.payment_number}</strong></td><td>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</td><td>{p.method}</td><td>{p.reference_number || "—"}</td><td>{fmtDate(day(p.received_at))}<small>{fmtClock(p.received_at)}</small></td><td><Badge tone={p.verification_state === "Verified" ? "active" : "orange"}>{p.verification_state}</Badge></td><td><strong>{pesos(p.amount_centavos)}</strong></td><td><a href={`/api/documents/payment/${p.id}?type=receipt`} target="_blank" rel="noreferrer">Receipt</a></td></tr>; })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">No payments in this range.</p>}</div>
  </div>;
}

/** Discount requests filed by the Cashier; the Accounting Manager approves them. */
export function DiscountRequests({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload);
  const [enrollmentId, setEnrollmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const open = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && balanceOf(e) > 0).sort((a, b) => traineeName(a).localeCompare(traineeName(b)));
  const e = open.find((x) => x.id === enrollmentId);
  const rebate = e && agencyId ? data.agencyCourseRebates.find((r) => r.agency_id === agencyId && r.course_id === e.course_id)?.rebate_centavos ?? null : null;
  const centavos = rebate ?? Math.round(Number(amount || 0) * 100);
  const file = () => void post({ action: "discount-request", enrollmentId, amountCentavos: centavos, description: reason.trim() || undefined, agencyId: agencyId || null }, "Discount request sent to the Accounting Manager.").then(() => { setEnrollmentId(""); setAmount(""); setReason(""); setAgencyId(""); }).catch(() => undefined);
  const enrollmentOf = (id: string) => data.enrollments.find((x) => x.id === id);
  return <section className="portal-panel">
    <div className="panel-heading"><div><h2>Discount Requests</h2><p>File a discount for a trainee; it changes the balance once the Accounting Manager approves it.</p></div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="portal-form">
      <label className="full">Enrollment<select value={enrollmentId} onChange={(ev) => setEnrollmentId(ev.target.value)}><option value="">Select a trainee with a balance</option>{open.map((x) => <option key={x.id} value={x.id}>{traineeName(x)} · {x.enrollment_number} · {first(x.courses)?.name ?? ""} · {pesos(balanceOf(x))}</option>)}</select></label>
      <label>Endorsing Agency (Optional)<select value={agencyId} onChange={(ev) => setAgencyId(ev.target.value)}><option value="">— None —</option>{data.agencies.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Discount Amount (PHP){rebate != null ? <input value={(rebate / 100).toFixed(2)} readOnly /> : <input type="number" min="0.01" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} />}{rebate != null && <small className="portal-form-note">The agency&apos;s configured rebate is used.</small>}</label>
      <label className="full">Reason<input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Agency rebate, promo, returning trainee" /></label>
      <div className="portal-form-actions full"><button type="button" className="portal-primary" disabled={busy || !e || centavos <= 0 || (e && centavos > balanceOf(e))} onClick={file}>{busy ? "Sending…" : "Request Discount"}</button></div>
    </div>
    <div className="live-list" style={{ marginTop: 12 }}>
      <h3 className="review-subhead">Waiting for Approval</h3>
      {data.pendingDiscounts.map((d) => { const x = enrollmentOf(d.enrollment_id); return <div className="live-row-item" key={d.id}><div><strong>{x ? traineeName(x) : "Enrollment"}</strong><small>{x?.enrollment_number} · {d.description} · filed {fmtDate(day(d.created_at))}</small></div><span className="slot-count">{pesos(d.amount_centavos)}</span></div>; })}
      {!data.pendingDiscounts.length && <p className="portal-empty-copy">No discount requests waiting.</p>}
    </div>
  </section>;
}

const PAY_FILTERS = ["All", "Unpaid", "Partially Paid", "Paid", "Cancelled"] as const;
/** Every enrollment with its payment state, for the Cashier. */
export function CashierEnrollments({ data, onPay, reload }: { data: PortalData; onPay: (enrollmentId: string) => void; reload: () => Promise<void> }) {
  const [filter, setFilter] = useState<(typeof PAY_FILTERS)[number]>("All");
  const [q, setQ] = useState("");
  const stateOf = (e: Enrollment) => (e.enrollment_status === "Cancelled" ? "Cancelled" : balanceOf(e) === 0 ? "Paid" : paidOf(e) > 0 ? "Partially Paid" : "Unpaid");
  const term = q.trim().toLowerCase();
  const rows = data.enrollments.filter((e) => (filter === "All" || stateOf(e) === filter) && (!term || `${traineeName(e)} ${e.enrollment_number} ${first(e.courses)?.name ?? ""} ${data.applicationNumbers?.[e.trainee_id] ?? ""}`.toLowerCase().includes(term)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300);
  const count = (f: (typeof PAY_FILTERS)[number]) => data.enrollments.filter((e) => f === "All" || stateOf(e) === f).length;
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Collections</span><h1>Enrollments</h1><p>Every enrollment with what was paid and what is still due.</p></div></div>
    <div className="portal-tabs">{PAY_FILTERS.map((f) => <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f}<small style={{ marginLeft: 6, opacity: 0.7 }}>{count(f)}</small></button>)}</div>
    <div className="pay-filters"><label className="grow">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Trainee, NWMTACI number, enrollment number, course" /></label></div>
    <div className="portal-table portal-panel"><table><thead><tr><th>Trainee</th><th>Enrollment</th><th>Course &amp; Schedule</th><th>Status</th><th>Due</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>
      {rows.map((e) => { const st = stateOf(e); return <tr key={e.id}><td><strong>{traineeName(e)}</strong><small>{data.applicationNumbers?.[e.trainee_id] ?? first(e.trainees)?.trainee_number}</small></td><td>{e.enrollment_number}<small>{e.enrollment_status}</small></td><td>{first(e.courses)?.name ?? "—"}<small>{scheduleText(e)}</small></td><td><Badge tone={st === "Paid" ? "active" : st === "Partially Paid" ? "orange" : st === "Cancelled" ? "cancelled" : "red"}>{st}</Badge></td><td>{pesos(dueCentavos(e))}</td><td>{pesos(paidOf(e))}</td><td><strong>{pesos(e.enrollment_status === "Cancelled" ? 0 : balanceOf(e))}</strong></td><td className="document-actions">{st !== "Paid" && st !== "Cancelled" && <button type="button" className="portal-primary" onClick={() => onPay(e.id)}>Record Payment</button>}{st !== "Unpaid" && st !== "Cancelled" && <TarButton data={data} traineeId={e.trainee_id} reload={reload} />}</td></tr>; })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">No matching enrollments.</p>}</div>
  </div>;
}

/** Start-of-day opening cash, recorded once per day; the closing below starts from it. */
export function CashierOpening({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const today = manilaToday();
  const opening = (data.cashierOpenings ?? []).find((o) => o.opening_date === today);
  const { busy, msg, post } = usePost(reload);
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  return <section className="portal-panel" style={{ marginBottom: 16 }}>
    <div className="panel-heading"><div><h2>Cashier Opening</h2><p>{fmtDate(today)} · record the cash in the drawer before the first payment.</p></div>{opening && <Badge tone="active">Opened</Badge>}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {opening ? <p className="portal-form-note">Opening cash {pesos(opening.opening_cash_centavos)} recorded {fmtClock(opening.created_at)}{opening.remarks ? ` · ${opening.remarks}` : ""}.</p>
      : <div className="portal-form">
        <label>Opening Cash (PHP)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Remarks<input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" /></label>
        <div className="portal-form-actions full"><button type="button" className="portal-primary" disabled={busy || amount === ""} onClick={() => void post({ action: "cashier-open", openingCashCentavos: Math.round(Number(amount) * 100), remarks: remarks.trim() || undefined }, "Opening recorded.").catch(() => undefined)}>{busy ? "Saving…" : "Record Opening"}</button></div>
      </div>}
  </section>;
}

/**
 * Summary Report (Cashier › Accounting): for a day or range, collections by
 * mode, expenses, net cash, the cash drawer, and balances still due after
 * training. Printable.
 */
export function CashierSummaryReport({ data }: { data: PortalData }) {
  const today = manilaToday();
  const [range, setRange] = useState<(typeof RANGES)[number]>("Today");
  const [from, setFrom] = useState(today), [to, setTo] = useState(today);
  const start = range === "Today" ? today : range === "This Week" ? addDays(today, -6) : range === "This Month" ? `${today.slice(0, 8)}01` : from;
  const end = range === "Custom" ? to : today;
  const inRange = (iso?: string | null) => { const d = day(iso); return !!d && d >= start && d <= end; };
  const payments = data.payments.filter((p) => inRange(p.received_at));
  const modes = [...new Set([...modeNames(data), ...payments.map((p) => p.method)])];
  const byMode = modes.map((m) => { const list = payments.filter((p) => p.method === m); return { mode: m, count: list.length, total: list.reduce((s, p) => s + Number(p.amount_centavos), 0) }; });
  const collected = payments.reduce((s, p) => s + Number(p.amount_centavos), 0);
  const cashIn = byMode.find((m) => m.mode === "Cash")?.total ?? 0;
  const expenses = data.expenses.filter((x) => (x.status === "Paid" || x.status === "Approved") && inRange((x as { paid_at?: string | null }).paid_at ?? x.created_at));
  const expenseTotal = expenses.reduce((s, x) => s + Number(x.amount_centavos), 0);
  const singleDay = start === end;
  const opening = singleDay ? (data.cashierOpenings ?? []).find((o) => o.opening_date === start)?.opening_cash_centavos ?? null : null;
  const closing = singleDay ? data.cashierClosings.find((c) => c.closing_date === start) ?? null : null;
  const durations = new Map(data.courses.map((c) => [c.id, c.duration_label]));
  const unpaid = unpaidAfterTraining(data.enrollments as unknown as BalanceEnrollment[], (id) => durations.get(id), today);
  const unpaidTotal = unpaid.reduce((s, r) => s + r.balanceCentavos, 0);
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Accounting</span><h1>Summary Report</h1><p>{singleDay ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`}</p></div><button type="button" className="portal-secondary" onClick={() => window.print()}>Print / Save</button></div>
    <div className="portal-tabs">{RANGES.map((r) => <button key={r} type="button" className={range === r ? "active" : ""} onClick={() => setRange(r)}>{r}</button>)}</div>
    {range === "Custom" && <div className="pay-filters"><label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label></div>}
    <div className="pay-totals">
      <div><span>Collections</span><b>{pesos(collected)}</b><small>{payments.length} payment{payments.length === 1 ? "" : "s"}</small></div>
      <div><span>Expenses</span><b>{pesos(expenseTotal)}</b><small>{expenses.length} voucher{expenses.length === 1 ? "" : "s"}</small></div>
      <div><span>Net</span><b>{pesos(collected - expenseTotal)}</b><small>Collections less expenses</small></div>
      <div><span>Unpaid After Training</span><b>{pesos(unpaidTotal)}</b><small>{unpaid.length} trainee{unpaid.length === 1 ? "" : "s"}</small></div>
    </div>
    <div className="rd-two">
      <section className="portal-panel"><div className="panel-heading"><div><h2>Collections by Mode</h2><p>Payments received in the period</p></div></div>
        <div className="portal-table"><table><thead><tr><th>Mode</th><th>Payments</th><th>Total</th></tr></thead><tbody>{byMode.map((m) => <tr key={m.mode}><td><strong>{m.mode}</strong></td><td>{m.count}</td><td><strong>{pesos(m.total)}</strong></td></tr>)}<tr><td><strong>Total</strong></td><td>{payments.length}</td><td><strong>{pesos(collected)}</strong></td></tr></tbody></table></div>
      </section>
      <section className="portal-panel"><div className="panel-heading"><div><h2>Cash Drawer</h2><p>{singleDay ? "Opening, cash received and expenses for the day" : "Pick a single day to see the cash drawer"}</p></div></div>
        {singleDay ? <dl className="sum-dl">
          <div><dt>Opening Cash</dt><dd>{opening == null ? "Not recorded" : pesos(opening)}</dd></div>
          <div><dt>Cash Received</dt><dd>+{pesos(cashIn)}</dd></div>
          <div><dt>Expenses Paid</dt><dd>−{pesos(expenseTotal)}</dd></div>
          <div className="due"><dt>Expected Cash</dt><dd>{pesos((opening ?? 0) + cashIn - expenseTotal)}</dd></div>
          <div><dt>Closing</dt><dd>{closing ? `${pesos(Number(closing.actual_cash_centavos ?? 0))} counted · variance ${pesos(Number(closing.variance_centavos ?? 0))}` : "Not yet closed"}</dd></div>
        </dl> : <p className="portal-empty-copy">Choose Today or a single custom day.</p>}
      </section>
    </div>
    <section className="portal-panel" style={{ marginTop: 16 }}><div className="panel-heading"><div><h2>Expenses</h2><p>Approved and paid expenses in the period</p></div></div>
      <div className="portal-table"><table><thead><tr><th>Voucher</th><th>Payee</th><th>Purpose</th><th>Status</th><th>Amount</th></tr></thead><tbody>{expenses.map((x) => <tr key={x.id}><td><strong>{x.expense_number}</strong></td><td>{x.payee}</td><td>{(x as { purpose?: string }).purpose ?? ""}</td><td>{x.status}</td><td><strong>{pesos(x.amount_centavos)}</strong></td></tr>)}</tbody></table>{!expenses.length && <p className="portal-empty-copy">No expenses in this period.</p>}</div>
    </section>
    <section className="portal-panel live-list" style={{ marginTop: 16 }}><div className="panel-heading"><div><h2>Unpaid Balances After Training</h2><p>As of today · also emailed daily at 4:00 PM</p></div></div>
      {unpaid.map((r) => <div className="live-row-item" key={r.id}><div><strong>{r.traineeName}</strong><small>{r.enrollmentNumber} · {r.course} · training {r.endsToday ? "ends today" : `ended ${fmtDate(r.trainingEnd)}`}</small></div><span className="bal-cell">{pesos(r.balanceCentavos)}<small>of {pesos(r.dueCentavos)}</small></span></div>)}
      {!unpaid.length && <p className="portal-empty-copy">No unpaid balances after training.</p>}
    </section>
  </div>;
}
