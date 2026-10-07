"use client";

import { useState } from "react";
import type { PortalData, Enrollment } from "../portal-live-app";
import { addDays, balanceOf, dueCentavos, first, manilaToday, pesos } from "@/lib/portal-format";
import { Badge, Message, Modal, PageHead, fullName, fmtDate, fmtClock, usePost, openAdmissionRecord } from "./shared-ui";
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
  if (!s.paid.length) button = <button type="button" className={className} disabled title="The TAR prints once a course is paid">Print TAR</button>;
  else if (s.left > 0) button = <button type="button" className={className} onClick={print}>{s.printed ? `Reprint TAR (${s.printed} of ${s.allowed} printed)` : "Print TAR"}</button>;
  else if (s.pendingReprint) button = <button type="button" className={className} disabled>Reprint awaiting approval</button>;
  else button = <button type="button" className={className} onClick={() => setRequesting(s.paid[0])}>Request TAR reprint</button>;
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
    <PageHead eyebrow="Collections" title="For payment" text="Applicants Registration has screened and handed over. Record their payment: once paid and on a batch they are enrolled automatically. Then print their Training Admission Record." />
    <div className="portal-table portal-panel"><table><thead><tr><th>Applicant</th><th>Course &amp; batch</th><th>Handed over</th><th>Total due</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>
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
          <td>{paid > 0 ? <Badge tone="active">{e.batch_id ? "Paid · enrolling" : "Paid · awaiting batch"}</Badge> : <button type="button" className="portal-primary" onClick={() => onPay(e.id)}>Record payment</button>}</td>
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
        <label className="full">Charge<select value={catalogId} onChange={(ev) => choose(ev.target.value)}><option value="">Custom amount</option>{catalog.map((c) => <option key={c.id} value={c.id}>{c.name} · {pesos(c.default_amount_centavos)}</option>)}</select></label>
        <label>Description<input value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder={`${typeLabel} fee`} /></label>
        <label>Amount (PHP)<input type="number" min="0" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} /></label>
      </>}
      <label className="full">Remarks (optional)<input value={remarks} onChange={(ev) => setRemarks(ev.target.value)} placeholder="For the Accounting Manager" /></label>
      <p className="portal-form-note full">The charge is added to the trainee&apos;s balance only when the Accounting Manager approves the request.</p>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !valid} onClick={send}>{busy ? "Sending…" : "Send for approval"}</button></div>
    </div>
  </Modal>;
}
