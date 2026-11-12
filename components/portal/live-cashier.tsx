"use client";

import { MarkDepositedModal } from "./bank-deposits";
import { SPECIAL_TONE, SpecialRequestForm, specialCourse, specialTrainee } from "./special-arrangements";
import { consultancyOpen, groupProblem } from "@/lib/group-payment";
import { depositedOn, drawerExpected, fromLabel, type BankDeposit } from "@/lib/bank-deposits";
import { useEffect, useState, type ReactNode } from "react";
import { ReferralVoucherPanel } from "./accounting-home";
import type { PortalData, Enrollment, TraineeProofRow } from "../portal-live-app";
import { addDays, balanceOf, dueCentavos, first, manilaToday, pesos, pesos2 } from "@/lib/portal-format";
import { pesosInWords } from "@/lib/amount-words";
import { ActionsMenu, ALL_DATES, Badge, Message, Modal, PageHead, ViewIcon, fullName, fmtDate, fmtClock, txWhen, useNeedSince, usePaged, usePost, openAdmissionRecord, submit, MonthBar, usePeriod } from "./shared-ui";
import { PaymentDayRow, PrintGlyph, RequestVoidIcon, paymentStatus } from "./payment-void";
import { unpaidAfterTraining, type BalanceEnrollment } from "@/lib/unpaid-balances";
import { requestFee } from "@/lib/request-fees";
import type { CashierReportSnapshot } from "@/lib/documents";
import { tcl } from "@/lib/title-case";
import { PayTheCenters, centerLines } from "./pay-centers";
import { shrinkProof } from "@/lib/proof-shrink";
import { NO_REASON, REASONS, REJECT_REASONS, ReasonField, reasonReady, reasonText, type ReasonValue } from "./reject-inline";
import { printableTars, rankMatches, tarPrintable, type TarGroup } from "@/lib/trainee-match";
import { isEndorsedEnrollment, itemAllowed, sourceLabel } from "@/lib/company-charge";

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
 *   Accounting decides.
 */

type RequestRow = PortalData["requests"][number];

/** The rule-based fee for a rescheduling or cancellation request (lib/request-fees), from what the screen already has. */
export function feeForRequest(data: Pick<PortalData, "enrollments">, r: RequestRow) {
  const en = first(r.enrollments);
  const e = data.enrollments.find((x) => x.id === en?.id);
  if (!e) return null;
  const requestedOn = r.requested_on ?? day(r.created_at);
  const startDate = first(e.batches)?.starts_on ?? e.scheduled_on ?? null;
  const fee = requestFee({ type: r.request_type, trainingFeeCentavos: Number(e.selling_price_centavos), startDate, requestedOn });
  return fee ? { ...fee, requestedOn, startDate } : null;
}
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");

/** Free prints of the Training Admission Record before Accounting approval is needed. */
export const TAR_FREE_PRINTS = 2;
const PAID_STATUSES = ["Enrolled", "Open Schedule"];

/**
 * Print state of a trainee's TAR. A record covers the trainee's current set of
 * paid enrollments; adding a paid course starts a new record (new AR number).
 */
// TAR courses (owner, 29 Oct 2026): every course not cancelled, regardless of payment.
// One TAR per transaction (owner, 4 Nov 2026): `groupIds` names the courses of one transaction.
export function tarState(data: PortalData, traineeId: string, groupIds?: string[]) {
  const paid = data.enrollments.filter((e) => e.trainee_id === traineeId && tarPrintable(e));
  const ids = (groupIds ?? paid.map((e) => e.id)).slice().sort().join("|");
  const record = (data.admissionRecords ?? []).find((r) => r.trainee_id === traineeId && [...r.enrollment_ids].sort().join("|") === ids) ?? null;
  const allowed = TAR_FREE_PRINTS + Number(record?.reprints_approved ?? 0);
  const printed = Number(record?.print_count ?? 0);
  const pendingReprint = !!record && data.requests.some((r) => r.request_type === "TAR reprint" && r.status === "Pending" && record.enrollment_ids.includes(first(r.enrollments)?.id ?? ""));
  return { paid, record, printed, allowed, left: Math.max(0, allowed - printed), pendingReprint };
}

/** Print the TAR, or — once the limit is reached — ask Accounting for one more print. */
/** Print receipt (owner, 8 Oct 2026): prints twice; after the second print the button is gone. */
/** The receipts of a trainee's latest payments (owner, 10 Nov 2026, Print AR Design 3): the training fee and each item or fee have their own AR. */
export function receiptsOf(data: Pick<PortalData, "payments">, traineeId: string) {
  const mine = data.payments.filter((p) => p.trainee_id === traineeId && (p as { valid?: boolean }).valid !== false).sort((a, b) => b.received_at.localeCompare(a.received_at));
  if (!mine.length) return [];
  // One transaction: everything recorded within two minutes of the newest payment.
  const newest = new Date(mine[0].received_at).getTime();
  return mine.filter((p) => newest - new Date(p.received_at).getTime() <= 120000).map((p) => { const remarks = (p as { remarks?: string | null }).remarks ?? ""; return { id: p.id, label: /^(Miscellaneous|Service Fee) · /.test(remarks) ? remarks : "Training Fee", amount: Number(p.amount_centavos) }; });
}
/** Print AR ▾ on the Cashier Dashboard: every receipt of the trainee's latest payment, each printed twice at most. */
export function PrintArMenu({ data, traineeId, reload }: { data: PortalData; traineeId: string; reload?: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const list = receiptsOf(data, traineeId);
  if (!list.length) return null;
  const printed = (id: string) => data.receiptPrints?.[id] ?? 0;
  return <span className="cx-split ar-split"><button type="button" className="portal-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Print AR ▾</button>
    {open && <div className="cx-splitmenu ar-menu" role="menu">{list.map((r) => printed(r.id) >= 2
      ? <span key={r.id} className="ar-done"><b>{r.label}</b><small>{pesos(r.amount)} · Printed Twice</small></span>
      : <a key={r.id} role="menuitem" href={`/portal/payment-receipt/${r.id}`} target="_blank" rel="noreferrer" onClick={() => { setOpen(false); window.setTimeout(() => void reload?.(), 2500); }}><b>{r.label}</b><small>{pesos(r.amount)} · printed {printed(r.id)} of 2</small></a>)}</div>}
  </span>;
}
export function ReceiptButton({ data, paymentId, reload, className = "portal-secondary", icon }: { data: PortalData; paymentId: string; reload?: () => Promise<void>; className?: string; icon?: boolean }) {
  const printed = data.receiptPrints?.[paymentId] ?? 0;
  if (printed >= 2) return icon ? <small className="muted-text">Printed Twice</small> : null;
  return <a className={icon ? "pv-icon" : className} title={icon ? "Print Receipt" : undefined} aria-label={icon ? "Print Receipt" : undefined} href={`/portal/payment-receipt/${paymentId}`} target="_blank" rel="noreferrer" onClick={() => window.setTimeout(() => void reload?.(), 2500)}>{icon ? <PrintGlyph /> : "Receipt"}</a>;
}

/**
 * Print TAR (owner, 8 Oct 2026): prints twice; after the second print it is gone. Registration prints it (20 Oct 2026). With several TARs
 * left the main part prints the newest and ▾ lists the rest (Split Button, 5 Nov 2026); with one it is a plain button. The Enrollment window prints its own course's.
 */
export function TarButton({ data, traineeId, reload, className = "portal-secondary", enrollmentId }: { data: PortalData; traineeId: string; reload?: () => Promise<void>; className?: string; enrollmentId?: string }) {
  const [error, setError] = useState(""), [menu, setMenu] = useState(false);
  // One TAR per transaction (owner, 4 Nov 2026). The server alone knows which payment first covered each
  // course; read again when a course, receipt or TAR of the trainee changes.
  const [groups, setGroups] = useState<TarGroup[] | null>(null);
  const stamp = [data.enrollments.filter((e) => e.trainee_id === traineeId).map((e) => e.id).join(), data.payments.filter((p) => p.trainee_id === traineeId).length, (data.admissionRecords ?? []).filter((r) => r.trainee_id === traineeId).length].join("|");
  useEffect(() => {
    let live = true;
    void fetch(`/api/staff/trainee-account?traineeId=${traineeId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b) => { if (live && b?.tarGroups) setGroups(b.tarGroups); }).catch(() => undefined);
    return () => { live = false; };
  }, [traineeId, stamp]);
  const print = (ids: string[]) => { setError(""); void openAdmissionRecord(traineeId, ids).then(() => reload?.()).catch((e) => setError(e instanceof Error ? e.message : "Could not open the admission record.")); };
  const left = printableTars(groups ?? [], (ids) => tarState(data, traineeId, ids).left, enrollmentId);
  const issue = error ? <Message kind="error" text={error} /> : null;
  if (!left.length) return issue;
  const codes = (g: TarGroup) => g.ids.map((id) => { const e = data.enrollments.find((x) => x.id === id); return e ? courseCode(e) : ""; }).filter(Boolean).join(", ");
  if (left.length === 1) return <><button type="button" className={className} onClick={() => print(left[0].ids)}>Print TAR</button>{issue}</>;
  return <><span className="cx-split tar-split">
    <button type="button" className={className} title={`Prints ${codes(left[0])}`} onClick={() => print(left[0].ids)}>Print TAR</button>
    <button type="button" className={`${className} cx-splitdd`} aria-haspopup="menu" aria-expanded={menu} aria-label="Choose Another TAR" onClick={() => setMenu((v) => !v)}>▾</button>
    {menu && <div className="cx-splitmenu tar-menu" role="menu">{left.slice(1).map((g) => <button key={g.ids.join("|")} type="button" role="menuitem" onClick={() => { setMenu(false); print(g.ids); }}><b>{codes(g) || "TAR"}</b><small>{txWhen(g.at)}</small></button>)}</div>}
  </span>{issue}</>;
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
    <PageHead eyebrow="Collections" title="For Payment" text="Applicants registration has screened and handed over. Record their payment: once paid and on a batch they are enrolled automatically. Then print their training admission record." />
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
          <td>{paid > 0 ? <Badge tone="active">{e.batch_id ? "Paid · Enrolling" : "Paid · Awaiting Batch"}</Badge> : <button type="button" className="portal-primary" onClick={() => onPay(e.id)}>Record</button>}</td>
        </tr>;
      })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">No applicants waiting for payment. Registration hands them over once their requirements are complete.</p>}</div>

    <section className="portal-panel live-list" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>Paid · Training Admission Record</h2></div><span className="slot-count">{toPrint.length}</span></div>
      {toPrint.map((t) => { const s = tarState(data, t.id); return <div className="live-row-item" key={t.id}>
        <div><strong>{fullName(t)}</strong><small>{data.applicationNumbers?.[t.id] ? <span className="app-no">{data.applicationNumbers[t.id]}</span> : null}{s.paid.map((e) => first(e.courses)?.code ?? first(e.courses)?.name).filter(Boolean).join(", ")}{s.record ? ` · ${s.record.ar_number} · printed ${s.printed} of ${s.allowed}` : " · not printed yet"}</small></div>
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
  const ruled = feeForRequest(data, request);
  function choose(id: string) {
    setCatalogId(id);
    const item = catalog.find((c) => c.id === id);
    if (item) { setDescription(item.name); setAmount((Number(item.default_amount_centavos) / 100).toFixed(2)); setNoCharge(false); }
  }
  const send = () => void post(ruled ? { action: "request-charge", id: request.id, amountCentavos: ruled.amountCentavos, remarks: remarks.trim() || undefined } : { action: "request-charge", id: request.id, chargeCatalogId: noCharge ? null : catalogId || null, description: noCharge ? undefined : description || `${typeLabel} fee`, amountCentavos: noCharge ? 0 : centavos, remarks: remarks.trim() || undefined }, "Sent to Accounting for approval.").then(onClose).catch(() => undefined);
  return <Modal title={`Charges · ${request.request_number}`} onClose={onClose}>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      <div className="rate-preview full"><span>{typeLabel}</span><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "Trainee"}</strong><small>{e?.enrollment_number}{first(e?.courses)?.name ? ` · ${first(e?.courses)?.name}` : ""} · {request.reason}</small></div>
      {request.request_type === "Make-up Class" && <p className="portal-form-note full">Policy: Php 350.00 per make-up training day.</p>}
      {ruled ? <div className="rate-preview full"><span>Fee by policy</span><strong>{pesos(ruled.amountCentavos)}</strong><small>Requested {fmtDate(ruled.requestedOn)}{ruled.startDate ? ` · training starts ${fmtDate(ruled.startDate)}` : ""} · {ruled.rule}</small></div> : <>
      <label className="portal-check full"><input type="checkbox" checked={noCharge} onChange={(ev) => setNoCharge(ev.target.checked)} /><span>No charge for this request</span></label>
      {!noCharge && <>
        <label className="full">Charge<select value={catalogId} onChange={(ev) => choose(ev.target.value)}><option value="">Custom Amount</option>{catalog.map((c) => <option key={c.id} value={c.id}>{c.name} · {pesos(c.default_amount_centavos)}</option>)}</select></label>
        <label>Description<input value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder={`${typeLabel} fee`} /></label>
        <label>Amount (PHP)<input type="number" min="0" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} /></label>
      </>}
      </>}
      <label className="full">Remarks (Optional)<input value={remarks} onChange={(ev) => setRemarks(ev.target.value)} placeholder="For Accounting" /></label>
      <p className="portal-form-note full">The charge is added to the trainee&apos;s balance only when Accounting approves the request.</p>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || (!ruled && !valid)} onClick={send}>{busy ? "Sending…" : "Send for Approval"}</button></div>
    </div>
  </Modal>;
}

/* ====================================================== Cashier workspace (Oct 2026) */

const modeNames = (data: PortalData) => data.paymentMethods.filter((m) => m.active).map((m) => m.name);
const needsReference = (data: PortalData, method: string) => !!data.paymentMethods.find((m) => m.name === method)?.requires_reference;
const traineeName = (e: Enrollment) => { const t = first(e.trainees); return t ? fullName(t) : e.enrollment_number; };
const paidOf = (e: Enrollment) => Number(e.paid_centavos ?? 0);
const scheduleText = (e: Enrollment) => { const b = first(e.batches); return b ? `${fmtDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""}` : e.scheduled_on ? fmtDate(e.scheduled_on) : "No schedule yet"; };
const centerOf = (e: Enrollment) => first(first((e as { partner_course_offers?: unknown }).partner_course_offers as { partner_centers?: unknown } | null)?.partner_centers as { name?: string } | null)?.name ?? "";
const courseCode = (e: Enrollment) => { const code = first(e.courses)?.code ?? first(e.courses)?.name ?? "Course"; const c = centerOf(e); return c ? `${code} · ${c}` : code; };
const toCentavos = (v: string) => { const n = Math.round(Number(String(v).replace(/,/g, "")) * 100); return Number.isFinite(n) && n > 0 ? n : 0; };
const MODE_COLORS: Record<string, string> = { Cash: "#0a7a3e", GCash: "#0571D0", PSBank: "#123F63", UnionBank: "#F25615", Cheque: "#5d6f7e" };

/** One trainee with all of their enrollments, for the trainee-based lists. */
type TraineeGroup = { traineeId: string; name: string; number: string; enrollments: Enrollment[]; due: number; paid: number; balance: number; since: string };
function groupByTrainee(data: PortalData, list: Enrollment[], sinceOf: (e: Enrollment) => string = (e) => e.created_at): TraineeGroup[] {
  const map = new Map<string, TraineeGroup>();
  for (const e of list) {
    const g = map.get(e.trainee_id) ?? { traineeId: e.trainee_id, name: traineeName(e), number: data.applicationNumbers?.[e.trainee_id] ?? first(e.trainees)?.trainee_number ?? "", enrollments: [], due: 0, paid: 0, balance: 0, since: sinceOf(e) };
    g.enrollments.push(e); g.due += dueCentavos(e); g.paid += paidOf(e); g.balance += balanceOf(e);
    if (sinceOf(e) < g.since) g.since = sinceOf(e);
    map.set(e.trainee_id, g);
  }
  return [...map.values()];
}
/**
 * Tick boxes for separate payments (owner, 4 Nov 2026): each course with a balance has a tick; the button records the
 * ticked ones. Ticked courses paid together share one receipt and one TAR; paid separately, each has its own.
 */
type Unticked = Record<string, boolean>;
export function RecordTicked({ data, list, off, onPay }: { data: PortalData; list: Enrollment[]; off: Unticked; onPay: (enrollmentId: string, courses: string[]) => void }) {
  const ticked = list.filter((e) => balanceOf(e) > 0 && !off[e.id]);
  const amount = ticked.reduce((s, e) => s + Math.max(0, balanceOf(e) - (data.pendingRebates?.[e.id] ?? 0)), 0);
  return <button type="button" className="portal-primary row-act" disabled={!ticked.length} onClick={() => onPay(ticked[0].id, ticked.map((e) => e.id))}>{ticked.length ? `Record ${pesos(amount)}` : "Tick a Course"}</button>;
}
/** Paid and Enrolled, Balance First: who still owes stays in view; everyone fully paid folds into one line. */
export function paidSections<G extends { balance: number; paid: number }>(groups: G[]) {
  const withBalance = groups.filter((g) => g.balance > 0), fullyPaid = groups.filter((g) => g.balance <= 0);
  return { withBalance, fullyPaid, fullyPaidTotal: fullyPaid.reduce((s, g) => s + g.paid, 0) };
}
const Who = ({ name, number }: { name: string; number?: string }) => <><span className="cx-name">{name}</span>{number ? <span className="cx-id">{number}</span> : null}</>;
const payState = (e: Enrollment) => (e.enrollment_status === "Cancelled" ? "Cancelled" : balanceOf(e) === 0 ? "Paid" : paidOf(e) > 0 ? "Partially paid" : "Unpaid");
const PAY_TONE: Record<string, string> = { Paid: "active", "Partially paid": "orange", Unpaid: "red", Cancelled: "cancelled", "Company Charge": "pending" };

/** Company Charge (owner, 29 Oct 2026; 5 Nov 2026): one payment for a partner's Billing Statement, with its proof, and one Service Invoice to the company. */
export function CompanyPaymentModal({ data, reload, onClose, initialId }: { data: PortalData; reload: () => Promise<void>; onClose: () => void; initialId?: string }) {
  const open = (data.billingStatements ?? []).filter((b) => b.paid_centavos < b.total_centavos);
  const [id, setId] = useState(initialId ?? open[0]?.id ?? "");
  const st = open.find((b) => b.id === id);
  const left = st ? st.total_centavos - st.paid_centavos : 0;
  const [amount, setAmount] = useState(left ? (left / 100).toFixed(2) : "");
  const modes = modeNames(data);
  const [method, setMethod] = useState(modes.find((m) => m !== "Cash") ?? modes[0] ?? "Cash"), [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState<string | null>(null), [proofFile, setProofFile] = useState<File | null>(null), [invoice, setInvoice] = useState<{ id?: string; number?: string; error?: string } | null>(null);
  const cents = toCentavos(amount), needRef = needsReference(data, method);
  const valid = !!st && cents > 0 && cents <= left && (!needRef || (reference.trim().length > 0 && !!proofFile));
  async function save() {
    setBusy(true); setError("");
    try {
      let proofId: string | undefined;
      if (needRef && proofFile && st) {
        const form = new FormData();
        form.append("proof", await shrinkProof(proofFile)); form.append("companyName", st.bill_to); form.append("mode", method); form.append("receivedAt", new Date(receivedAt).toISOString()); form.append("reference", reference.trim());
        const res = await fetch("/api/staff/payment-proofs/drive", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not save the proof to Google Drive.");
        proofId = body.proofId;
      }
      const r = await submit({ action: "company-payment", billingStatementId: id, amountCentavos: cents, method, referenceNumber: reference.trim(), receivedAt: new Date(receivedAt).toISOString(), proofId }) as { companyPaymentId?: string; invoice?: { id?: string; number?: string; error?: string } };
      setInvoice(r.invoice ?? null); setDone(r.companyPaymentId ?? ""); await reload();
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not record the payment."); } finally { setBusy(false); }
  }
  const range = (b: NonNullable<typeof st>) => `${fmtDate(b.coverage_from)} – ${fmtDate(b.coverage_to)}`;
  if (done !== null) return <Modal title="Company Payment Recorded" onClose={onClose}><div className="portal-form">
    <div className="full"><Message kind="success" text={`${pesos(cents)} received from ${st?.bill_to ?? "the company"} · applied to its trainees and counted as sales on the date paid.`} /></div>
    {invoice?.error && <div className="full"><Message kind="error" text={`The payment is recorded, but the Service Invoice was not issued: ${invoice.error} Issue it from Company Charge › Paid.`} /></div>}
    <div className="portal-form-actions full">{invoice?.id && <a className="portal-primary" href={`/api/documents/service-invoice/${invoice.id}`} target="_blank" rel="noreferrer">Print Service Invoice {invoice.number}</a>}<button type="button" className="portal-secondary" onClick={onClose}>Done</button></div>
  </div></Modal>;
  return <Modal title="Record Company Payment" onClose={onClose}><div className="portal-form">
    {error && <div className="full"><Message kind="error" text={error} /></div>}
    <label className="full">Billing Statement<select value={id} onChange={(e) => { setId(e.target.value); const b = open.find((x) => x.id === e.target.value); setAmount(b ? ((b.total_centavos - b.paid_centavos) / 100).toFixed(2) : ""); }}>{open.map((b) => <option key={b.id} value={b.id}>BS No. {String(b.bs_number).padStart(6, "0")} · {b.bill_to} · {range(b)} · {pesos(b.total_centavos - b.paid_centavos)} left</option>)}</select></label>
    <label>Amount Received (₱)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />{cents > left && <small className="field-error">More than the {pesos(left)} left on this statement.</small>}</label>
    <label>Date Paid<input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></label>
    <div className="full"><span className="pay-label">Mode of Payment</span><div className="cx-choice" role="radiogroup" aria-label="Mode of payment">{modes.map((m) => <button type="button" role="radio" aria-checked={method === m} key={m} className={method === m ? "on" : ""} onClick={() => setMethod(m)}>{m}</button>)}</div></div>
    {needRef && <label className="full">Reference No.<input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="Bank or e-wallet reference" /></label>}
    {needRef && <label className="full">Proof of Payment (Photo or PDF)<input type="file" accept="image/*,application/pdf" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} /></label>}
    <p className="portal-form-note full">The amount is applied to the statement&apos;s trainees in order and counts as sales on the date paid. One Service Invoice goes to the company.</p>
    <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !valid} onClick={() => void save()}>{busy ? "Recording…" : "Record and Issue Invoice"}</button></div>
  </div></Modal>;
}

type ExtraLine = { key: string; chargeCatalogId: string | null; description: string; unit: number; quantity: number; enrollmentId: string; kind: "item" | "fee"; chargeId?: string };
/** Items Registration added at the hand-over (owner, 10 Nov 2026), still unpaid: each opens as a line in Record Payment. */
export const itemLines = (data: Pick<PortalData, "enrollments" | "pendingItems">, traineeId: string): ExtraLine[] => {
  const mine = new Set(data.enrollments.filter((e) => e.trainee_id === traineeId && e.enrollment_status !== "Cancelled").map((e) => e.id));
  return (data.pendingItems ?? []).filter((i) => mine.has(i.enrollment_id)).map((i) => ({ key: `i-${i.id}`, chargeId: i.id, chargeCatalogId: i.charge_catalog_id, description: i.description, unit: Number(i.amount_centavos), quantity: 1, enrollmentId: i.enrollment_id, kind: "item" }));
};

/**
 * Record payment for one trainee: the amount received is applied across their
 * unpaid courses (split), plus any miscellaneous charges sold at the counter.
 * One payment, one receipt. A reference is required for every mode except Cash.
 */
/** The typed letters in bold at the start of each matching word. */
function markWords(name: string, term: string) {
  const t = term.trim().toLowerCase();
  return name.split(" ").map((w, i) => <span key={i}>{i ? " " : ""}{t && w.toLowerCase().startsWith(t) ? <><mark className="cx-mark">{w.slice(0, t.length)}</mark>{w.slice(t.length)}</> : w}</span>);
}

export function RecordPaymentModal({ data, initialEnrollmentId, initialCourses, initialAmountCentavos, initialFeeLabel, initialProof, onClose, onSaved }: { data: PortalData; initialEnrollmentId?: string; initialCourses?: string[]; initialAmountCentavos?: number; initialFeeLabel?: string; initialProof?: TraineeProofRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const initial = initialEnrollmentId ? data.enrollments.find((e) => e.id === initialEnrollmentId) : undefined;
  const [traineeId, setTraineeId] = useState(initialProof?.trainee_id ?? initial?.trainee_id ?? "");
  const [search, setSearch] = useState("");
  const modes = modeNames(data);
  // A trainee's proof (29 Oct 2026) fills the mode, amount and reference, and is used instead of a new upload.
  const [method, setMethod] = useState(initialProof && modes.includes(initialProof.method) ? initialProof.method : modes[0] ?? "Cash");
  const [reference, setReference] = useState(initialProof?.reference ?? "");
  // "Collect fee" from Requests opens with the request fee filled in.
  // Courses ticked on the row open filled in, each at its balance less any rebate due on full payment (owner, 4 Nov 2026).
  const payable = (e: Enrollment) => Math.max(0, balanceOf(e) - (data.pendingRebates?.[e.id] ?? 0));
  const money = (centavos: number) => (centavos / 100).toFixed(2);
  const ticked = initialCourses ? data.enrollments.filter((e) => initialCourses.includes(e.id) && balanceOf(e) > 0) : [];
  const preset = ticked.length ? money(ticked.reduce((s, e) => s + payable(e), 0)) : initialProof?.amount_centavos ? money(initialProof.amount_centavos) : initialEnrollmentId && initialAmountCentavos ? money(initialAmountCentavos) : "";
  // Items Registration added at the hand-over open as lines below, so Amount Received includes them. A trainee's proof keeps its own amount.
  const heldAtOpen = itemLines(data, initialProof?.trainee_id ?? initial?.trainee_id ?? "");
  const [received, setReceived] = useState(preset && !initialProof ? money(Math.round(Number(preset) * 100) + heldAtOpen.reduce((s, x) => s + x.unit * x.quantity, 0)) : preset);
  const [amounts, setAmounts] = useState<Record<string, string>>(ticked.length ? Object.fromEntries(ticked.map((e) => [e.id, money(payable(e))])) : preset && initialEnrollmentId ? { [initialEnrollmentId]: preset } : {});
  const [extras, setExtras] = useState<ExtraLine[]>(heldAtOpen);
  // Design 03 · Split Primary (owner, 3 Nov 2026): the highlighted suggestion and the ▾ menu beside Record.
  const [hi, setHi] = useState(0), [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const close = (ev: MouseEvent | KeyboardEvent) => { if (ev instanceof KeyboardEvent ? ev.key === "Escape" : !(ev.target as HTMLElement).closest(".cx-split")) setMenu(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [menu]);
  const [receivedAt, setReceivedAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [remarks, setRemarks] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState<{ receipts: { id: string; label: string; amount: number }[]; amount: number; drive: { link: string; path: string } | null } | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proof, setProof] = useState<{ id: string; link: string; path: string; duplicate: boolean } | null>(initialProof ? { id: initialProof.id, link: initialProof.drive_link ?? "", path: "", duplicate: false } : null);
  const [dupWarning, setDupWarning] = useState(false), [dupConfirmed, setDupConfirmed] = useState(false);
  // Paid By (owner, 12 Nov 2026, Option B): a consultancy paying several trainees with one transfer.
  const [paidBy, setPaidBy] = useState<"Trainee" | "Consultancy">("Trainee");
  const canGroup = !initial && !initialProof;

  // Company Charge courses are paid by the partner on its Billing Statement (Accounting records it, 5 Nov 2026), never here.
  const mine = data.enrollments.filter((e) => e.trainee_id === traineeId && e.enrollment_status !== "Cancelled" && !data.companyCharge?.[e.id]);
  const open = mine.filter((e) => balanceOf(e) > 0);
  const term = search.trim().toLowerCase();
  // A trainee from an older month can still pay (owner, 3 Nov 2026): typing looks across all dates.
  useNeedSince(term ? ALL_DATES : "");
  // No list until a letter is typed (owner, 3 Nov 2026); suggestions follow each letter.
  const candidates = term ? rankMatches(groupByTrainee(data, data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && !data.companyCharge?.[e.id]))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name)), term, (g) => g.name, (g) => `${g.number} ${g.enrollments.map((e) => `${courseCode(e)} ${e.enrollment_number}`).join(" ")}`) : [];
  const group = traineeId ? groupByTrainee(data, mine)[0] : undefined;
  // Referral (8 Oct 2026): the agency's rebate is already deducted from these balances.
  // Each course has its own partner (owner, 3 Nov 2026); its line in the table says so, with the rebate.
  const partnerOn = (e: { id: string }) => { const id = data.referralByEnrollment?.[e.id]; return id ? data.agencies.find((a) => a.id === id) ?? null : null; };
  // Rebates that come off once fully paid (21 Oct 2026): Pay All in Full collects the balance less them.
  const pending = (e: { id: string }) => data.pendingRebates?.[e.id] ?? 0;
  const applied = open.reduce((s, e) => s + Math.min(toCentavos(amounts[e.id] ?? ""), balanceOf(e)), 0);
  const extraTotal = extras.reduce((s, x) => s + x.unit * x.quantity, 0);
  const total = applied + extraTotal;
  const receivedCentavos = toCentavos(received);
  const over = open.some((e) => toCentavos(amounts[e.id] ?? "") > balanceOf(e));
  const refRequired = needsReference(data, method);
  const matches = receivedCentavos > 0 && receivedCentavos === total;
  const valid = total > 0 && !over && matches && (!refRequired || (reference.trim().length > 0 && (!!proofFile || !!proof)));

  // Choosing a trainee fills every unpaid course in full; ▾ › Distribute in Order handles a partial payment.
  function choose(id: string) { setTraineeId(id); const opens = data.enrollments.filter((e) => e.trainee_id === id && e.enrollment_status !== "Cancelled" && !data.companyCharge?.[e.id] && balanceOf(e) > 0); setAmounts(Object.fromEntries(opens.map((e) => [e.id, (Math.max(0, balanceOf(e) - pending(e)) / 100).toFixed(2)]))); const held = itemLines(data, id); setReceived(((opens.reduce((s, e) => s + Math.max(0, balanceOf(e) - pending(e)), 0) + held.reduce((s, x) => s + x.unit * x.quantity, 0)) / 100).toFixed(2)); setExtras(held); }
  function fill(how: "all" | "spread" | "clear") {
    if (how === "clear") { setAmounts({}); return; }
    if (how === "all") { setAmounts(Object.fromEntries(open.map((e) => [e.id, (Math.max(0, balanceOf(e) - pending(e)) / 100).toFixed(2)]))); setReceived(((open.reduce((s, e) => s + Math.max(0, balanceOf(e) - pending(e)), 0) + extraTotal) / 100).toFixed(2)); return; }
    let left = receivedCentavos - extraTotal;
    setAmounts(Object.fromEntries(open.map((e) => { const a = Math.max(0, Math.min(left, balanceOf(e))); left -= a; return [e.id, a > 0 ? (a / 100).toFixed(2) : ""]; })));
  }
  // The tick on a course line: on fills its balance, off clears it; Amount Received follows.
  function tick(e: Enrollment, on: boolean) {
    const next = { ...amounts, [e.id]: on ? money(payable(e)) : "" };
    setAmounts(next);
    setReceived(money(open.reduce((s, x) => s + Math.min(toCentavos(next[x.id] ?? ""), balanceOf(x)), 0) + extraTotal));
  }
  function removeExtra(key: string) { const x = extras.find((l) => l.key === key); setExtras((cur) => cur.filter((l) => l.key !== key)); if (x) setReceived((Math.max(0, receivedCentavos - x.unit * x.quantity) / 100).toFixed(2)); }
  // Item Chips (owner, 10 Nov 2026): the Cashier adds Uniform, T-Shirt, Online Assessment and every other Miscellaneous Item
  // from the Schedule of Fees; − and + change the quantity and Amount Received follows.
  const itemFor = open[0]?.id ?? mine[0]?.id;
  const itemEnrollment = mine.find((x) => x.id === itemFor);
  const itemEndorsed = !!itemEnrollment && isEndorsedEnrollment(itemEnrollment, data.courses.find((c) => c.id === itemEnrollment.course_id)?.delivery_type);
  const counterItems = data.charges.filter((c) => c.active && c.kind === "item" && itemAllowed(c.name, itemEndorsed));
  function addItem(c: { id: string; name: string; default_amount_centavos: number }) {
    if (!itemFor) return;
    const unit = Number(c.default_amount_centavos), hit = extras.find((x) => !x.chargeId && x.chargeCatalogId === c.id);
    if (hit && hit.quantity >= 50) return;
    setExtras((cur) => hit ? cur.map((x) => (x.key === hit.key ? { ...x, quantity: x.quantity + 1 } : x)) : [...cur, { key: `c-${c.id}`, chargeCatalogId: c.id, description: c.name, unit, quantity: 1, enrollmentId: itemFor, kind: "item" }]);
    setReceived(money(receivedCentavos + unit));
  }
  function stepItem(key: string, by: 1 | -1) {
    const x = extras.find((l) => l.key === key);
    if (!x || x.quantity + by > 50) return;
    if (x.quantity + by <= 0) { removeExtra(key); return; }
    setExtras((cur) => cur.map((l) => (l.key === key ? { ...l, quantity: l.quantity + by } : l)));
    setReceived(money(Math.max(0, receivedCentavos + by * x.unit)));
  }

  /** GCash, PSBank and UnionBank: file the proof in Google Drive first (Mode › Month, "LASTNAME - date"). */
  async function fileProof() {
    if (!refRequired) return null;
    if (proof) return proof;
    if (!proofFile || !group) throw new Error("Attach the proof of payment.");
    const upload = await shrinkProof(proofFile);
    const form = new FormData();
    form.set("proof", upload); form.set("traineeId", group.traineeId); form.set("mode", method);
    form.set("receivedAt", new Date(receivedAt).toISOString()); form.set("reference", reference.trim());
    const response = await fetch("/api/staff/payment-proofs/drive", { method: "POST", body: form });
    // A non-JSON reply (e.g. the host's "Request Entity Too Large") becomes a plain message.
    const text = await response.text();
    let body: { proofId?: string; driveLink?: string; drivePath?: string; duplicateReference?: boolean; error?: string } = {};
    try { body = JSON.parse(text); } catch { body = { error: response.status === 413 || /too large/i.test(text) ? "The proof file is too large. Use a screenshot or a PDF under 4 MB." : "Could not save the proof to Google Drive." }; }
    if (!response.ok || !body.proofId) throw new Error(body.error ?? "Could not save the proof to Google Drive.");
    const filed = { id: body.proofId, link: body.driveLink ?? "", path: body.drivePath ?? "", duplicate: !!body.duplicateReference };
    setProof(filed);
    return filed;
  }
  async function post() {
    setBusy(true); setError("");
    try {
      const filed = await fileProof();
      if (filed?.duplicate && !dupConfirmed) { setDupWarning(true); return; }
      const lines = open.map((e) => ({ enrollmentId: e.id, amountCentavos: Math.min(toCentavos(amounts[e.id] ?? ""), balanceOf(e)) })).filter((a) => a.amountCentavos > 0);
      // A request fee from Requests › Collect Fee gets its own receipt (owner, 3 Nov 2026); anything above it is a training-fee payment.
      const feeLine = initialFeeLabel && initialEnrollmentId ? lines.find((a) => a.enrollmentId === initialEnrollmentId) : undefined;
      const feeAmount = feeLine ? Math.min(feeLine.amountCentavos, initialAmountCentavos ?? feeLine.amountCentavos) : 0;
      const fee = feeLine && feeAmount > 0 ? { enrollmentId: feeLine.enrollmentId, amountCentavos: feeAmount, label: initialFeeLabel } : null;
      const allocations = lines.map((a) => (fee && a.enrollmentId === fee.enrollmentId ? { ...a, amountCentavos: a.amountCentavos - fee.amountCentavos } : a)).filter((a) => a.amountCentavos > 0);
      const result = await submit({ action: "payment-split", allocations, fee, items: extras.map((x) => ({ enrollmentId: x.enrollmentId, chargeCatalogId: x.chargeCatalogId, description: x.description, unitCentavos: x.unit, quantity: x.quantity, ...(x.chargeId ? { chargeId: x.chargeId } : {}) })), method, receivingAccount: method === "Cash" ? "Main cashier" : method, referenceNumber: reference.trim(), receivedAt: new Date(receivedAt).toISOString(), remarks, proofId: filed?.id ?? null }) as { payments?: { id: string; label: string; amount: number }[] };
      if (agencyId) for (const a of allocations) { try { await submit({ action: "record-agency-rebate", enrollmentId: a.enrollmentId, agencyId }); } catch { /* the rebate never blocks the payment */ } }
      setPosted({ receipts: result.payments ?? [], amount: total, drive: filed ? { link: filed.link, path: filed.path } : null });
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not record the payment."); } finally { setBusy(false); }
  }

  if (posted && group) return <Modal title="Payment Recorded" onClose={onClose}>
    <div className="portal-form">
      <div className="full"><Message kind="success" text={`${pesos(posted.amount)} received from ${group.name}.`} /></div>
      {posted.drive && <p className="portal-form-note full cx-drive">Proof kept in Google Drive{posted.drive.path ? ` · ${posted.drive.path.split(" / ").slice(1).join(" / ")}` : ""}.</p>}
      {posted.receipts.length > 1 && <p className="portal-form-note full">{posted.receipts.length} separate receipts: the training fee, miscellaneous items and service fees each have their own.</p>}
      <div className="cx-receipts full">{posted.receipts.map((r) => <div key={r.id}><span><b>{r.label}</b><small className="cx-amt">{pesos(r.amount)}</small></span><ReceiptButton data={data} paymentId={r.id} reload={onSaved} /></div>)}</div>
      <div className="portal-form-actions full"><button type="button" className="portal-primary" onClick={onClose}>Done</button></div>
    </div>
  </Modal>;

  const paidBySwitch = canGroup && !group && <div className="full gp-paidby" role="radiogroup" aria-label="Paid By"><span className="pay-label">Paid By</span>{(["Trainee", "Consultancy"] as const).map((v) => <label key={v} className="gp-radio"><input type="radio" name="paid-by" checked={paidBy === v} onChange={() => setPaidBy(v)} />{v}</label>)}</div>;
  if (canGroup && paidBy === "Consultancy") return <Modal title="Record Payment" onClose={onClose} wide><div className="portal-form cx-pay">{paidBySwitch}<ConsultancyPayment data={data} onClose={onClose} onSaved={onSaved} /></div></Modal>;
  return <Modal title="Record Payment" onClose={onClose} wide>
    <div className="portal-form cx-pay">
      {error && <div className="full"><Message kind="error" text={error} /></div>}
      {paidBySwitch}
      {!group ? <div className="full cx-pick">
        <label>Find Trainee<input autoFocus role="combobox" aria-expanded={!!term} aria-controls="cx-sug" autoComplete="off" value={search} placeholder="Type a name, NWMTACI No. or course"
          onChange={(ev) => { setSearch(ev.target.value); setHi(0); }}
          onKeyDown={(ev) => { const n = candidates.length; if (!n) return; if (ev.key === "ArrowDown") { ev.preventDefault(); setHi((hi + 1) % n); } else if (ev.key === "ArrowUp") { ev.preventDefault(); setHi((hi - 1 + n) % n); } else if (ev.key === "Enter") { ev.preventDefault(); choose(candidates[Math.min(hi, n - 1)].traineeId); } }} /></label>
        {term ? <div className="cx-results cx-sug" id="cx-sug" role="listbox">{candidates.map((g, i) => { const unpaid = g.enrollments.filter((e) => balanceOf(e) > 0); return <button type="button" role="option" aria-selected={i === hi} className={i === hi ? "hi" : ""} key={g.traineeId} onMouseEnter={() => setHi(i)} onClick={() => choose(g.traineeId)}><span><b>{markWords(g.name, term)}</b><small>{g.number} · {unpaid.length ? unpaid.map(courseCode).join(" · ") : "All courses paid"}</small></span><strong className="cx-amt">{pesos(g.balance)}</strong></button>; })}
          {!candidates.length && <p className="portal-empty-copy">No trainee matches “{search.trim()}”.</p>}</div> : <p className="portal-form-note">Start typing; suggestions appear with each letter.</p>}
      </div> : <>
        <div className="cx-whocard full"><div><Who name={group.name} number={group.number} /></div><div className="cx-right"><small>Balance</small><span className="cx-amt">{pesos(group.balance)}</span></div></div>
        <label>Amount Received (PHP)<input className="cx-mono" inputMode="decimal" value={received} onChange={(ev) => setReceived(ev.target.value)} placeholder="0.00" /></label>
        <div className="cx-lines full"><table><thead><tr>{open.length > 1 && <th aria-label="Pay now"></th>}<th>Course or Charge</th><th className="r">Balance</th><th className="r">Apply</th></tr></thead><tbody>
          {open.map((e) => { const v = amounts[e.id] ?? ""; const bad = toCentavos(v) > balanceOf(e); return <tr key={e.id} className={toCentavos(v) > 0 ? "sel" : ""}>{open.length > 1 && <td><input type="checkbox" className="cx-tickbox" checked={toCentavos(v) > 0} aria-label={`Pay ${courseCode(e)} now`} onChange={(ev) => tick(e, ev.target.checked)} /></td>}<td><span className="cx-code">{courseCode(e)}</span> <small>{first(e.courses)?.name} · {scheduleText(e)}</small>{(() => { const ag = partnerOn(e); return ag ? <small className="ref-line">{ag.name} · {ag.rebate_mode === "No deduction" ? "rebate paid to the agency later" : pending(e) > 0 ? `rebate ${pesos(pending(e))} once ${pesos(balanceOf(e) - pending(e))} is paid` : "rebate deducted"}</small> : <small className="ref-line wk">{sourceLabel(e.source, null) || "Online"} · no rebate</small>; })()}</td><td className="r cx-amt">{pesos(balanceOf(e))}</td><td className="r"><input className="cx-apply" inputMode="decimal" value={v} placeholder="0.00" aria-label={`Amount for ${courseCode(e)}`} onChange={(ev) => setAmounts((cur) => ({ ...cur, [e.id]: ev.target.value }))} />{bad && <small className="cx-bad">More than the balance</small>}</td></tr>; })}
          {extras.map((x) => { const e = mine.find((m) => m.id === x.enrollmentId); return <tr key={x.key} className="misc">{open.length > 1 && <td></td>}<td><span className="cx-code misc">{x.kind === "item" ? "Item" : "Fee"}</span> <strong>{x.description}</strong>{x.chargeId && x.quantity > 1 ? ` x ${x.quantity}` : ""} {x.chargeId ? <span className="cx-from">From Registration</span> : <small>{pesos(x.unit)} each · For {e ? courseCode(e) : "course"}</small>}</td><td className="r cx-amt">{pesos(x.unit * x.quantity)}</td><td className="r">{x.chargeId ? <button type="button" className="ghost-button" onClick={() => removeExtra(x.key)}>Remove</button> : <span className="cx-step"><button type="button" aria-label={`One less ${x.description}`} onClick={() => stepItem(x.key, -1)}>−</button><b>{x.quantity}</b><button type="button" aria-label={`One more ${x.description}`} onClick={() => stepItem(x.key, 1)}>+</button></span>}</td></tr>; })}
          {counterItems.length > 0 && itemFor && <tr className="cx-chiprow">{open.length > 1 && <td></td>}<td colSpan={3}><div className="cx-chips">{counterItems.map((c) => <button key={c.id} type="button" className="cx-chip" onClick={() => addItem(c)}>+ {c.name} {pesos(Number(c.default_amount_centavos)).replace(/\.00$/, "")}</button>)}</div></td></tr>}
          {!open.length && !extras.length && <tr><td colSpan={3}><small>All courses are fully paid.</small></td></tr>}
        </tbody></table></div>
        <div className={`cx-tally full ${matches ? "ok" : "no"}`}><span>Applied {pesos(total)} of {pesos(receivedCentavos)}</span><span>{!receivedCentavos ? "Enter the amount received" : matches ? "Ready to record" : total < receivedCentavos ? `${pesos(receivedCentavos - total)} not applied` : `${pesos(total - receivedCentavos)} over the amount received`}</span></div>
        <div className="full"><span className="pay-label">Mode of payment</span><div className="cx-choice" role="radiogroup" aria-label="Mode of payment">{modes.map((m) => <button type="button" role="radio" aria-checked={method === m} key={m} className={method === m ? "on" : ""} onClick={() => { setMethod(m); if (!initialProof || m !== initialProof.method) setProof(null); else setProof({ id: initialProof.id, link: initialProof.drive_link ?? "", path: "", duplicate: false }); }}>{m}</button>)}</div></div>
        <label>{refRequired ? "Reference number (required)" : "Reference number"}<input className="cx-mono" value={reference} onChange={(ev) => setReference(ev.target.value.toUpperCase())} placeholder={refRequired ? `${method} reference` : "Not needed for cash"} /></label>
        {refRequired && initialProof && proof?.id === initialProof.id ? <p className="portal-form-note full cx-drive">Proof sent by the trainee · {initialProof.method} · Ref. {initialProof.reference} {initialProof.drive_link && <ViewIcon label="View Proof" href={initialProof.drive_link} />}</p> : refRequired && <label>Proof of Payment (Required)<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(ev) => { setProofFile(ev.target.files?.[0] ?? null); setProof(null); setDupWarning(false); setDupConfirmed(false); }} />{proof ? <small className="portal-form-note">Saved to Google Drive · {proof.path.split(" / ").slice(1).join(" / ")}</small> : <small className="portal-form-note">Filed in Google Drive under {method} › this month as the trainee&apos;s last name and date.</small>}</label>}
        {dupWarning && <div className="full cx-dup"><Message kind="error" text={`Reference ${reference.trim()} was already used on another payment. Check the proof before recording it again.`} /><label className="portal-check"><input type="checkbox" checked={dupConfirmed} onChange={(ev) => setDupConfirmed(ev.target.checked)} /><span>I checked it; record this payment anyway</span></label></div>}
        <label>Received at<input type="datetime-local" value={receivedAt} onChange={(ev) => setReceivedAt(ev.target.value)} /></label>
        <label>Endorsing Agency<select value={agencyId} onChange={(ev) => setAgencyId(ev.target.value)}><option value="">None</option>{data.agencies.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Remarks<input value={remarks} onChange={(ev) => setRemarks(ev.target.value)} /></label>
      </>}
      <div className="portal-form-actions full cx-foot">{group && !initial && <button type="button" className="cx-textbtn cx-left" onClick={() => { setTraineeId(""); setAmounts({}); setExtras([]); setReceived(""); }}>Change Trainee</button>}<button type="button" className="cx-textbtn" onClick={onClose}>Cancel</button>{group && <span className="cx-split">
        {menu && <div className="cx-splitmenu" role="menu">
          <button type="button" role="menuitem" onClick={() => { fill("all"); setMenu(false); }}>Pay All in Full</button>
          <button type="button" role="menuitem" onClick={() => { fill("spread"); setMenu(false); }}>Distribute in Order</button>
          <button type="button" role="menuitem" onClick={() => { fill("clear"); setMenu(false); }}>Clear Amounts</button>
        </div>}
        <button type="button" className="portal-primary" disabled={!valid || busy} onClick={() => void post()}>{busy ? "Recording…" : `Record ${receivedCentavos > 0 ? pesos(receivedCentavos) : "Payment"}`}</button>
        <button type="button" className="portal-primary cx-splitdd" aria-label="More payment options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>▾</button>
      </span>}</div>
    </div>
  </Modal>;
}

/**
 * Record Payment › Paid By: Consultancy (owner, 12 Nov 2026, Option B). One transfer and one reference for several
 * trainees: pick the consultancy, its trainees with a balance are listed and ticked, untick or lower any amount,
 * and Record Payment stays off until the ticked amounts equal the transfer. Each trainee gets their own receipt.
 */
function ConsultancyPayment({ data, onClose, onSaved }: { data: PortalData; onClose: () => void; onSaved: () => Promise<void> }) {
  const agencies = data.agencies.filter((a) => a.active);
  const modes = modeNames(data).filter((m) => needsReference(data, m));
  const usable = (e: Enrollment) => e.enrollment_status !== "Cancelled" && !data.companyCharge?.[e.id] && balanceOf(e) > 0;
  const theirs = (id: string) => consultancyOpen(data.enrollments.filter(usable), id, data.referralByEnrollment, balanceOf);
  const money = (c: number) => (c / 100).toFixed(2);
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? "");
  const [extra, setExtra] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(theirs(agencies[0]?.id ?? "").map((e) => [e.id, money(balanceOf(e))])));
  const [method, setMethod] = useState(modes[0] ?? ""), [reference, setReference] = useState(""), [total, setTotal] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [proofFile, setProofFile] = useState<File | null>(null), [proof, setProof] = useState<{ id: string; path: string } | null>(null);
  const [adding, setAdding] = useState(false), [q, setQ] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dupWarning, setDupWarning] = useState(false), [dupConfirmed, setDupConfirmed] = useState(false);
  const [done, setDone] = useState<{ groupNo: string; payments: { payment_id: string; trainee_id: string; amount_centavos: number; verification_state: string }[] } | null>(null);
  const term = q.trim().toLowerCase();
  useNeedSince(term ? ALL_DATES : "");
  const agency = agencies.find((a) => a.id === agencyId);
  const listed = [...theirs(agencyId), ...extra.map((id) => data.enrollments.find((e) => e.id === id)).filter((e): e is Enrollment => !!e && !theirs(agencyId).some((x) => x.id === e.id))];
  const others = term ? data.enrollments.filter((e) => usable(e) && !listed.some((x) => x.id === e.id) && `${traineeName(e)} ${e.enrollment_number} ${courseCode(e)}`.toLowerCase().includes(term)).slice(0, 6) : [];
  const lines = listed.map((e) => ({ enrollmentId: e.id, amountCentavos: toCentavos(amounts[e.id] ?? "") })).filter((l) => l.amountCentavos > 0);
  const totalCentavos = toCentavos(total), split = lines.reduce((t, l) => t + l.amountCentavos, 0), diff = totalCentavos - split;
  const problem = groupProblem({ totalCentavos, reference, lines, balances: new Map(listed.map((e) => [e.id, balanceOf(e)])) });
  const ready = !problem && !!agency && !!method && (!!proofFile || !!proof);
  function pickAgency(id: string) { setAgencyId(id); setExtra([]); const t = theirs(id); setAmounts(Object.fromEntries(t.map((e) => [e.id, money(balanceOf(e))]))); }
  function add(e: Enrollment) { setExtra((cur) => [...cur, e.id]); setAmounts((cur) => ({ ...cur, [e.id]: money(balanceOf(e)) })); setQ(""); setAdding(false); }
  async function fileProof() {
    if (proof) return proof;
    if (!proofFile || !agency) throw new Error("Attach the transfer screenshot.");
    const form = new FormData();
    form.set("proof", await shrinkProof(proofFile)); form.set("companyName", agency.name); form.set("mode", method);
    form.set("receivedAt", new Date(receivedAt).toISOString()); form.set("reference", reference.trim());
    const response = await fetch("/api/staff/payment-proofs/drive", { method: "POST", body: form });
    const text = await response.text();
    let body: { proofId?: string; drivePath?: string; error?: string } = {};
    try { body = JSON.parse(text); } catch { body = { error: response.status === 413 ? "The proof file is too large. Use a screenshot or a PDF under 4 MB." : "Could not save the proof to Google Drive." }; }
    if (!response.ok || !body.proofId) throw new Error(body.error ?? "Could not save the proof to Google Drive.");
    const filed = { id: body.proofId, path: body.drivePath ?? "" };
    setProof(filed);
    return filed;
  }
  async function post() {
    setBusy(true); setError("");
    try {
      const filed = await fileProof();
      const response = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "payment-group", agencyId, method, receivingAccount: method, referenceNumber: reference.trim(), receivedAt: new Date(receivedAt).toISOString(), totalCentavos, proofId: filed.id, lines, confirmDuplicate: dupConfirmed }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.duplicate) { setDupWarning(true); return; }
      if (!response.ok) throw new Error(body.error ?? "Could not record the payment.");
      setDone({ groupNo: body.groupNo, payments: body.payments ?? [] });
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record the payment."); } finally { setBusy(false); }
  }
  const nameOf = (traineeId: string) => { const e = data.enrollments.find((x) => x.trainee_id === traineeId); return e ? traineeName(e) : "Trainee"; };
  if (done) return <>
    <div className="full"><Message kind="success" text={`${done.groupNo}: ${pesos(totalCentavos)} from ${agency?.name ?? "the consultancy"} for ${done.payments.length} trainee${done.payments.length === 1 ? "" : "s"}, reference ${reference.trim()}.`} /></div>
    <div className="cx-receipts full">{done.payments.map((p) => <div key={p.payment_id}><span><b>{nameOf(p.trainee_id)}</b><small className="cx-amt">{pesos(p.amount_centavos)}{p.verification_state !== "Verified" ? " · Duplicate Reference" : ""}</small></span><ReceiptButton data={data} paymentId={p.payment_id} reload={onSaved} /></div>)}</div>
    <div className="portal-form-actions full"><button type="button" className="portal-primary" onClick={onClose}>Done</button></div>
  </>;
  return <>
    {error && <div className="full"><Message kind="error" text={error} /></div>}
    <label className="full">Consultancy<select value={agencyId} onChange={(ev) => pickAgency(ev.target.value)}>{!agencies.length && <option value="">No Consultancy</option>}{agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <div className="full"><span className="pay-label">Mode of payment</span><div className="cx-choice" role="radiogroup" aria-label="Mode of payment">{modes.map((m) => <button type="button" role="radio" aria-checked={method === m} key={m} className={method === m ? "on" : ""} onClick={() => { setMethod(m); setProof(null); }}>{m}</button>)}</div></div>
    <label>Reference Number (Required)<input className="cx-mono" value={reference} onChange={(ev) => { setReference(ev.target.value.toUpperCase()); setDupWarning(false); setDupConfirmed(false); }} placeholder={`${method} reference`} /></label>
    <label>Total Transfer (PHP)<input className="cx-mono" inputMode="decimal" value={total} onChange={(ev) => setTotal(ev.target.value)} placeholder="0.00" /></label>
    <label>Received at<input type="datetime-local" value={receivedAt} onChange={(ev) => setReceivedAt(ev.target.value)} /></label>
    <label>Transfer Screenshot (Required)<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(ev) => { setProofFile(ev.target.files?.[0] ?? null); setProof(null); }} />{proof ? <small className="portal-form-note">Saved to Google Drive · {proof.path.split(" / ").slice(1).join(" / ")}</small> : <small className="portal-form-note">Filed in Google Drive under {method} › this month as the consultancy&apos;s name.</small>}</label>
    <div className="cx-lines full"><table><thead><tr><th aria-label="Include"></th><th>Their Trainees with a Balance</th><th className="r">Balance</th><th className="r">Pays</th></tr></thead><tbody>
      {listed.map((e) => { const v = amounts[e.id] ?? ""; const on = toCentavos(v) > 0; return <tr key={e.id} className={on ? "sel" : ""}>
        <td><input type="checkbox" className="cx-tickbox" checked={on} aria-label={`Include ${traineeName(e)}`} onChange={(ev) => setAmounts((cur) => ({ ...cur, [e.id]: ev.target.checked ? money(balanceOf(e)) : "" }))} /></td>
        <td><b>{traineeName(e)}</b> <small>{courseCode(e)} · {e.enrollment_number}{extra.includes(e.id) ? " · added" : ""}</small></td>
        <td className="r cx-amt">{pesos(balanceOf(e))}</td>
        <td className="r"><input className="cx-apply" inputMode="decimal" value={v} placeholder="0.00" aria-label={`Amount for ${traineeName(e)}`} onChange={(ev) => setAmounts((cur) => ({ ...cur, [e.id]: ev.target.value }))} />{toCentavos(v) > balanceOf(e) && <small className="cx-bad">More than the balance</small>}</td></tr>; })}
      {!listed.length && <tr><td colSpan={4}><small>No trainee of this consultancy has a balance. Use Add a Trainee Not Listed.</small></td></tr>}
      <tr className="cx-chiprow"><td colSpan={4}>{adding ? <div className="gp-add"><input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Type a name, NWMTACI No. or course" aria-label="Find a trainee to add" />
        {others.map((e) => <button key={e.id} type="button" className="gp-addrow" onClick={() => add(e)}><span><b>{traineeName(e)}</b> · {courseCode(e)}</span><strong className="cx-amt">{pesos(balanceOf(e))}</strong></button>)}
        {term && !others.length && <small>No trainee with a balance matches “{q.trim()}”.</small>}</div> : <button type="button" className="cx-textbtn" onClick={() => setAdding(true)}>+ Add a Trainee Not Listed</button>}</td></tr>
    </tbody></table></div>
    <div className={`cx-tally full ${diff === 0 && split > 0 ? "ok" : "no"}`}><span>Ticked {pesos(split)} of {pesos(totalCentavos)} · {lines.length} trainee{lines.length === 1 ? "" : "s"}</span><span>{!totalCentavos ? "Enter the total transfer" : diff === 0 ? (problem ?? "Balanced") : diff > 0 ? `${pesos(diff)} not yet split` : `${pesos(-diff)} over the transfer`}</span></div>
    <p className="portal-form-note full">Each trainee gets their own Acknowledgement Receipt and TAR with this reference. Payments in this transfer are not marked Duplicate Reference.</p>
    {dupWarning && <div className="full cx-dup"><Message kind="error" text={`Reference ${reference.trim()} was already used on another payment. Check the transfer before recording it again.`} /><label className="portal-check"><input type="checkbox" checked={dupConfirmed} onChange={(ev) => setDupConfirmed(ev.target.checked)} /><span>I checked it; record this payment anyway</span></label></div>}
    <div className="portal-form-actions full cx-foot"><button type="button" className="cx-textbtn" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={!ready || busy || (dupWarning && !dupConfirmed)} onClick={() => void post()}>{busy ? "Recording…" : `Record ${totalCentavos > 0 ? pesos(totalCentavos) : "Payment"}`}</button></div>
  </>;
}

/**
 * Cashier dashboard: today's collections by mode, new enrollments endorsed by
 * Registration (waiting for payment), trainees already paid and enrolled, and
 * balances still due after training (emailed daily at 4:00 PM).
 */
/** A dashboard row (owner, 10 Nov 2026): who with a one-line note, a status, the amount, the actions aligned right. */
export function WorkRow({ who, meta, mid, amount, acts }: { who: ReactNode; meta?: string; mid?: ReactNode; amount?: string; acts?: ReactNode }) {
  return <div className="wr-row"><div className="wr-who">{who}{meta && <small title={meta}>{meta}</small>}</div><div className="wr-mid">{mid}</div><strong className="cx-amt wr-amt">{amount ?? ""}</strong><div className="cx-acts wr-acts">{acts}</div></div>;
}

export function CashierDashboard({ data, onPay, reload, go, onOpenTrainee }: { data: PortalData; onPay: (enrollmentId: string, courses?: string[]) => void; reload: () => Promise<void>; go?: (module: string) => void; onOpenTrainee?: (traineeId: string) => void }) {
  const [raising, setRaising] = useState(false), [reqFilter, setReqFilter] = useState<"All" | "For Approval" | "Approved" | "Rejected">("All");
  // Organized (owner, 10 Nov 2026): tabs in Money In and Money Out, 5 rows a page, folds.
  const [showPaid, setShowPaid] = useState(false), [showUnpaid, setShowUnpaid] = useState(false), [showChannels, setShowChannels] = useState(false);
  const [inTab, setInTab] = useState<"proofs" | "new" | null>(null), [outTab, setOutTab] = useState<"release" | "requests" | "deposits" | null>(null), [marking, setMarking] = useState<BankDeposit | null>(null);
  const today = manilaToday();
  const handed = data.handedToCashier ?? {};
  const todays = data.payments.filter((p) => day(p.received_at) === today);
  const totalToday = todays.reduce((s, p) => s + Number(p.amount_centavos), 0);
  const tileModes = [...new Set(["Cash", "GCash", "PSBank", "UnionBank", ...modeNames(data)])];
  // New enrollments: handed over by Registration, nothing paid yet, grouped by trainee.
  const awaiting = data.enrollments.filter((e) => e.enrollment_status === "Pending" && handed[e.id] && paidOf(e) === 0);
  const billed = (e: Enrollment) => !!data.companyCharge?.[e.id];
  // Per course (owner, 4 Nov 2026): a course still unpaid stays here after another course of the trainee is paid.
  const fresh = groupByTrainee(data, awaiting.filter((e) => !billed(e)), (e) => handed[e.id] ?? e.created_at).sort((a, b) => a.since.localeCompare(b.since));
  const [off, setOff] = useState<Unticked>({});
  // Paid and enrolled: paid in the last 7 days.
  const since = addDays(today, -6);
  // Decided requests stay on the dashboard for 5 days only (owner, 3 Nov 2026); open ones always show.
  const decidedSince = addDays(today, -4);
  const paidRecently = new Set(data.payments.filter((p) => day(p.received_at) >= since).map((p) => p.trainee_id));
  const paid = groupByTrainee(data, data.enrollments.filter((e) => paidRecently.has(e.trainee_id) && e.enrollment_status !== "Cancelled" && !billed(e) && paidOf(e) > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const durations = new Map(data.courses.map((c) => [c.id, c.duration_label]));
  const unpaid = unpaidAfterTraining(data.enrollments.filter((e) => !data.companyCharge?.[e.id]) as unknown as BalanceEnrollment[], (id) => durations.get(id), today);
  const proofs = data.traineeProofs ?? [];
  const [fromProof, setFromProof] = useState<TraineeProofRow | null>(null), [notValid, setNotValid] = useState<{ id: string; why: ReasonValue } | null>(null);
  const { withBalance, fullyPaid, fullyPaidTotal } = paidSections(paid);
  const paidList = [...withBalance, ...fullyPaid];
  const freshP = usePaged(fresh, 5), paidP = usePaged(paidList, 5), unpaidP = usePaged(unpaid, 5), proofP = usePaged(proofs, 5);
  // Paid and Enrolled, Design 1 · Balance First (owner, 6 Nov 2026): the course count stays; the Trainee Account holds the courses, and the Record window the ticks.
  const trainee = (id: string, name: string, number: string) => (onOpenTrainee ? <button type="button" className="pv-open" onClick={() => onOpenTrainee(id)}><Who name={name} number={number} /></button> : <Who name={name} number={number} />);
  const nameOnly = (id: string, name: string) => (onOpenTrainee ? <button type="button" className="pv-open" onClick={() => onOpenTrainee(id)}><span className="cx-name">{name}</span></button> : <span className="cx-name">{name}</span>);
  const paidRow = (g: TraineeGroup) => <WorkRow key={g.traineeId} who={nameOnly(g.traineeId, g.name)} meta={`${g.number} · ${g.enrollments.length} Course${g.enrollments.length === 1 ? "" : "s"} · Paid ${pesos(g.paid)}`}
    mid={g.balance === 0 ? <Badge tone="active">Paid</Badge> : <Badge tone="orange">{`Balance ${pesos(g.balance)}`}</Badge>}
    acts={<>{g.balance > 0 && <RecordTicked data={data} list={g.enrollments} off={{}} onPay={onPay} />}<PrintArMenu data={data} traineeId={g.traineeId} reload={reload} /></>} />;
  const unpaidTotal = unpaid.reduce((s, r) => s + r.balanceCentavos, 0);
  const { busy, msg, post } = usePost(reload);
  const opening = (data.cashierOpenings ?? []).find((o) => o.opening_date === today);
  const closedToday = data.cashierClosings.some((c) => c.closing_date === today);
  const cashIn = todays.filter((p) => p.method === "Cash").reduce((s, p) => s + Number(p.amount_centavos), 0);
  const released = (data.expenses as (PortalData["expenses"][number] & { payment_channel?: string | null; paid_at?: string | null })[]).filter((e) => e.status === "Paid" && day(e.paid_at) === today);
  const releasedToday = released.reduce((s, e) => s + Number(e.amount_centavos), 0);
  const cashOut = released.filter((e) => e.payment_channel === "Cash").reduce((s, e) => s + Number(e.amount_centavos), 0);
  // Payments in and expenses out per channel, today.
  const channels = [...new Set([...tileModes, ...released.map((e) => e.payment_channel ?? "Cash")])].map((m) => ({ m, in: todays.filter((p) => p.method === m).reduce((x, p) => x + Number(p.amount_centavos), 0), receipts: todays.filter((p) => p.method === m).length, out: released.filter((e) => (e.payment_channel ?? "Cash") === m).reduce((x, e) => x + Number(e.amount_centavos), 0) })).filter((c) => c.in || c.out || ["Cash", "GCash", "PSBank", "UnionBank"].includes(c.m));
  // Bank deposits (owner, 11 Nov 2026): cash moved to the bank leaves the drawer, but is never an expense.
  const deps = data.bankDeposits ?? [];
  const toDeposit = deps.filter((d) => d.status === "Requested" || d.status === "Returned");
  const depositedToday = depositedOn(deps, today);
  const expected = drawerExpected({ opening: opening?.opening_cash_centavos ?? 0, cashIn, cashExpenses: cashOut, deposits: depositedToday });
  // Approvals and requests the Cashier is waiting on: expenses, change requests and voucher reprints, newest first.
  type Ask = { id: string; kind: string; what: string; status: "For Approval" | "Approved" | "Rejected" | "To Do"; label: string; at: string; done?: string | null; note: string };
  const exps = data.expenses as (PortalData["expenses"][number] & { payee?: string; voucher_number?: string | null; created_at?: string; decision_remarks?: string | null; approved_at?: string | null; paid_at?: string | null })[];
  const asks: Ask[] = [
    ...exps.map((e) => ({ id: `x${e.id}`, kind: "Expense", what: `${e.payee ?? "Expense"} · ${pesos2(Number(e.amount_centavos))}`, status: (e.status === "Pending" ? "For Approval" : e.status === "Rejected" ? "Rejected" : "Approved") as Ask["status"], label: e.status === "Pending" ? "For Approval" : e.status === "Rejected" ? "Rejected" : e.status === "Paid" ? "Released" : `Approved${e.voucher_number ? ` · ${e.voucher_number}` : ""}`, at: e.created_at ?? "", done: e.paid_at ?? e.approved_at, note: e.status === "Rejected" ? e.decision_remarks ?? "" : e.status === "Approved" ? "Print the voucher and release" : "" })),
    ...data.requests.map((r) => { const en = first((r as unknown as { enrollments?: unknown }).enrollments as { trainees?: unknown; courses?: unknown } | null); const t = first(en?.trainees as { legal_first_name?: string; legal_last_name?: string } | null), c = first(en?.courses as { code?: string } | null); const stage = (r as { stage?: string }).stage;
      return { id: `r${r.id}`, kind: r.request_type, what: `${t ? `${(t.legal_last_name ?? "").toUpperCase()}, ${t.legal_first_name ?? ""}` : r.request_number}${c?.code ? ` · ${c.code}` : ""}`, status: (r.status === "Pending" ? (stage === "With cashier" ? "To Do" : "For Approval") : r.status === "Rejected" ? "Rejected" : "Approved") as Ask["status"], label: r.status === "Pending" ? (stage === "With cashier" ? "Add Charge" : "For Approval") : r.status, at: r.created_at, done: r.decided_at, note: r.status === "Rejected" ? r.decision_remarks ?? "" : "" }; }),
    ...(data.expenseReprints ?? []).map((v) => ({ id: `v${v.id}`, kind: "Voucher Reprint", what: v.reason, status: (v.status === "Pending" ? "For Approval" : v.status === "Rejected" ? "Rejected" : "Approved") as Ask["status"], label: v.status === "Pending" ? "For Approval" : v.status, at: v.requested_at, note: v.decision_remarks ?? "" })),
  ].filter((x: Ask) => x.status === "For Approval" || x.status === "To Do" || day(x.done || x.at) >= decidedSince).sort((x, y) => y.at.localeCompare(x.at));
  const askShown = asks.filter((x) => reqFilter === "All" || x.status === reqFilter || (reqFilter === "For Approval" && x.status === "To Do"));
  const askP = usePaged(askShown, 5);
  const ASK_TONE: Record<Ask["status"], string> = { "For Approval": "orange", "To Do": "pending", Approved: "active", Rejected: "cancelled" };
  // Design 3 + 6 (owner, 10 Nov 2026): Money In and Money Out on the left, Today's Cash on the right.
  const moneyIn = proofs.reduce((s, p) => s + Number(p.amount_centavos), 0) + fresh.reduce((s, g) => s + g.balance, 0);
  const partnerName = (id: string) => data.agencies.find((a) => a.id === id)?.name ?? "Partner";
  const toRelease = [
    ...exps.filter((e) => e.status === "Approved").map((e) => ({ id: `x${e.id}`, what: `${(e as { is_budget?: boolean | null }).is_budget ? "Budget · " : ""}${e.payee ?? "Expense"}`, ref: e.voucher_number ?? (e as { expense_number?: string }).expense_number ?? "", amount: Number(e.amount_centavos) })),
    ...(data.referralVouchers ?? []).filter((v) => v.status === "Approved").map((v) => ({ id: `rv${v.id}`, what: `${partnerName(v.agency_id)} · Referral Voucher${v.mode ? ` · ${v.mode}` : ""}`, ref: v.voucher_number, amount: Number(v.total_centavos) })),
  ];
  const moneyOut = toRelease.reduce((s, r) => s + r.amount, 0);
  const proofTotal = proofs.reduce((s, p) => s + Number(p.amount_centavos), 0), freshTotal = fresh.reduce((s, g) => s + g.balance, 0);
  const inShown = inTab ?? (proofs.length || !fresh.length ? "proofs" : "new"), outShown = outTab ?? (toRelease.length ? "release" : toDeposit.length ? "deposits" : asks.length ? "requests" : "release");
  const releaseP = usePaged(toRelease, 5);
  const rebateLines = centerLines(data).filter((l) => l.state === "Paid"), got = (data as unknown as { rebatesReceived?: Record<string, string> }).rebatesReceived ?? {};
  const rebatesToCollect = rebateLines.filter((l) => !got[l.e.id] && Number(l.e.rebate_centavos) > 0);
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">{fmtDate(today)}</span><h1>Cashier Dashboard</h1></div>
      <span className="bc-foot-actions">{go && <button type="button" className="portal-secondary" data-short="Search" onClick={() => go("Search trainee")}>Search Trainee</button>}<button type="button" className="portal-secondary" data-short="Expense" onClick={() => setRaising(true)}>Raise Expense</button><button type="button" className="portal-primary" data-short={`Payment${fresh.length ? ` · ${fresh.length}` : ""}`} onClick={() => onPay("")}>Record Payment{fresh.length ? ` · ${fresh.length} Waiting` : ""}</button></span></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {(() => { const due = centerLines(data).filter((l) => l.state === "Due"); return due.length ? <p className="ac-note fr-warn">⚠ {pesos2(due.reduce((s, l) => s + l.amount, 0))} due to partnered centers · {due.length} trainee{due.length === 1 ? "" : "s"} <span className="muted-text">Accounting › Expenses › Pay the Centers</span></p> : null; })()}
    {/* Design 3 + 6, organized (owner, 10 Nov 2026): Money In and Money Out as tabbed panels, 5 rows a page, the rest folded; Today's Cash in one card. */}
    <div className="cx-dash">
      <div className="ac-stack">
        <section className="portal-panel cx-panel">
          <div className="panel-heading"><h2>Money In</h2><span className="cx-sum in">{proofs.length + fresh.length} · {pesos(moneyIn)} to Collect</span></div>
          <div className="cx-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={inShown === "proofs"} className={inShown === "proofs" ? "on" : ""} onClick={() => setInTab("proofs")}>Proofs of Payment<b>{proofs.length}</b><em>{pesos(proofTotal)}</em></button>
            <button type="button" role="tab" aria-selected={inShown === "new"} className={inShown === "new" ? "on" : ""} onClick={() => setInTab("new")}>New Enrollments<b>{fresh.length}</b><em>{pesos(freshTotal)}</em></button>
          </div>
          {/* Proofs of payment sent by trainees from the website, still with no receipt (owner, 29 Oct 2026). */}
          {inShown === "proofs" && (proofs.length ? <div className="wr-list">
            {proofP.shown.map((p) => { const hasCourse = data.enrollments.some((e) => e.trainee_id === p.trainee_id && e.enrollment_status !== "Cancelled"); return <div key={p.id}>
              <WorkRow who={nameOnly(p.trainee_id, p.name)} meta={`${p.number} · ${p.method}${p.reference ? ` · ${p.reference}` : ""} · Uploaded ${fmtDate(day(p.submitted_at))}, ${fmtClock(p.submitted_at)}`}
                mid={!hasCourse ? <Badge tone="orange">No Course Yet</Badge> : null} amount={pesos(p.amount_centavos)}
                acts={<>{p.drive_link && <ViewIcon label="View Proof" href={p.drive_link} />}<button type="button" className="portal-primary row-act" disabled={!hasCourse} onClick={() => setFromProof(p)}>Record</button><ActionsMenu items={[{ label: "Not Valid", danger: true, onClick: () => setNotValid({ id: p.id, why: NO_REASON }) }]} /></>} />
              {notValid?.id === p.id && <div className="cx-acts pf-notvalid"><span className="cx-reasons"><ReasonField reasons={REASONS.proofNotValid} value={notValid.why} onChange={(why) => setNotValid({ id: p.id, why })} autoFocus /></span><button type="button" className="portal-primary" disabled={busy || !reasonReady(notValid.why)} onClick={async () => { await post({ action: "proof-dismiss", proofId: p.id, reason: reasonText(notValid.why) }, "Marked Not Valid."); setNotValid(null); }}>Confirm</button><button type="button" className="portal-secondary" onClick={() => setNotValid(null)}>Cancel</button></div>}
            </div>; })}
            {proofP.pager}</div> : <p className="portal-empty-copy">No proofs waiting.</p>)}
          {/* Design A, Aligned Table (owner, 11 Nov 2026): real columns; each course on its own line under the trainee. */}
          {inShown === "new" && (fresh.length ? <div className="wr-list"><div className="portal-table-wrap ne-wrap"><table className="portal-table cx-cards ne-table">
            <thead><tr><th>Trainee</th><th>Course</th><th>Schedule</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>{freshP.shown.map((g) => g.enrollments.map((e, j) => <tr key={e.id} className={j ? "ne-sub" : "ne-first"}>
              {j === 0 && <td className="lead" data-l="" rowSpan={g.enrollments.length}><span className="cx-name">{g.name}</span><small>{g.number} · Endorsed {fmtDate(day(g.since))}, {fmtClock(g.since)}</small></td>}
              <td data-l="Course"><span className="ne-course">{balanceOf(e) > 0 ? <input type="checkbox" checked={!off[e.id]} onChange={(ev) => { const on = ev.target.checked; setOff((cur) => ({ ...cur, [e.id]: !on })); }} aria-label={`Pay ${courseCode(e)} now`} /> : <Badge tone="active">Paid</Badge>}<span className="cx-code">{courseCode(e)}</span></span></td>
              <td data-l="Schedule">{scheduleText(e)}</td>
              <td data-l="Amount" className="num"><b>{pesos(balanceOf(e))}</b></td>
              {j === 0 && <td data-l="" className="ne-act" rowSpan={g.enrollments.length}><RecordTicked data={data} list={g.enrollments} off={off} onPay={onPay} /></td>}
            </tr>))}</tbody></table></div>
            {freshP.pager}</div> : <p className="portal-empty-copy">No new enrollments.</p>)}
        </section>
        <section className="portal-panel cx-panel">
          <div className="panel-heading"><h2>Money Out</h2><span className="cx-sum out">{toRelease.length} · {pesos(moneyOut)} to Release</span></div>
          <div className="cx-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={outShown === "release"} className={outShown === "release" ? "on" : ""} onClick={() => setOutTab("release")}>To Release<b>{toRelease.length}</b><em>{pesos(moneyOut)}</em></button>
            <button type="button" role="tab" aria-selected={outShown === "requests"} className={outShown === "requests" ? "on" : ""} onClick={() => setOutTab("requests")}>Requests<b>{asks.length}</b></button>
            <button type="button" role="tab" aria-selected={outShown === "deposits"} className={outShown === "deposits" ? "on" : ""} onClick={() => setOutTab("deposits")}>Deposits<b>{toDeposit.length}</b><em>{pesos(toDeposit.reduce((s, d) => s + Number(d.amount_centavos), 0))}</em></button>
          </div>
          {outShown === "deposits" && (toDeposit.length ? <div className="wr-list">{toDeposit.map((d) => <WorkRow key={d.id} who={<span className="cx-name">{d.deposit_no} · {fromLabel(d.source)}{d.cheque_no ? ` (Cheque ${d.cheque_no})` : ""} → {d.account}</span>} meta={d.status === "Returned" ? `Returned: ${d.reason ?? ""}` : `Deposit by ${d.due_on ? fmtDate(d.due_on) : "today"}${d.note ? ` · ${d.note}` : ""}`}
            mid={<Badge tone={d.status === "Returned" ? "cancelled" : "orange"}>{d.status === "Returned" ? "Returned" : "To Deposit"}</Badge>} amount={pesos2(Number(d.amount_centavos))} acts={<button type="button" className="portal-primary row-act" onClick={() => setMarking(d)}>Mark Deposited</button>} />)}</div> : <p className="portal-empty-copy">No deposits requested by Accounting.</p>)}
          {outShown === "release" && (toRelease.length ? <div className="wr-list">{releaseP.shown.map((r) => <WorkRow key={r.id} who={<span className="cx-name">{r.what}</span>} meta={r.ref} amount={pesos2(r.amount)} acts={go ? <button type="button" className="portal-primary row-act" onClick={() => go("Expenses")}>Release</button> : null} />)}{releaseP.pager}</div> : <p className="portal-empty-copy">Nothing approved to release.</p>)}
          {outShown === "requests" && <>
            <label className="cx-status">Status<select value={reqFilter} onChange={(ev) => setReqFilter(ev.target.value as typeof reqFilter)}>{(["All", "For Approval", "Approved", "Rejected"] as const).map((k) => <option key={k} value={k}>{k} · {asks.filter((x) => k === "All" || x.status === k || (k === "For Approval" && x.status === "To Do")).length}</option>)}</select></label>
            {askShown.length ? <div className="wr-list">{askP.shown.map((x) => <WorkRow key={x.id} who={<b>{x.kind}</b>} meta={`${x.what} · Sent ${fmtDate(day(x.at))}${x.at ? `, ${fmtClock(x.at)}` : ""}${x.note ? ` · ${x.note}` : ""}`} mid={<Badge tone={ASK_TONE[x.status]}>{x.label}</Badge>} />)}{askP.pager}</div> : <p className="portal-empty-copy">No open requests; decided ones show for 5 days.</p>}
          </>}
        </section>
        {/* Paid and Enrolled (owner, 20 Oct 2026): paid in the last 7 days, balances first; folded to one line. */}
        <button type="button" className="pe-fold" aria-expanded={showPaid} onClick={() => setShowPaid((v) => !v)}><span>Paid and Enrolled · {withBalance.length} With Balance {pesos(withBalance.reduce((s, g) => s + g.balance, 0))} · {fullyPaid.length} Fully Paid {pesos(fullyPaidTotal)}</span><span>{showPaid ? "Hide ▴" : "Show ▾"}</span></button>
        {showPaid && <section className="portal-panel cx-panel">{paidList.length ? <div className="wr-list">{paidP.shown.map(paidRow)}{paidP.pager}</div> : <p className="portal-empty-copy">No paid trainees in the last 7 days.</p>}</section>}
        <button type="button" className="pe-fold" aria-expanded={showUnpaid} onClick={() => setShowUnpaid((v) => !v)}><span>{unpaid.length} Unpaid Balances · 4:00 PM Summary · {pesos(unpaidTotal)}</span><span>{showUnpaid ? "Hide ▴" : "Show ▾"}</span></button>
        {showUnpaid && <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Unpaid Balances · 4:00 PM Summary</h2><span className="document-actions"><button type="button" className="portal-secondary" disabled={busy} onClick={() => void post({ action: "balance-summary-send" }, "Summary emailed.").catch(() => undefined)}>Email Summary Now</button></span></div>
          {unpaid.length ? <div className="wr-list">{unpaidP.shown.map((r) => <WorkRow key={r.id} who={<span className="cx-name">{r.traineeName}</span>} meta={`${r.enrollmentNumber} · ${r.course} · ${r.endsToday ? "Ends today" : `Ended ${fmtDate(r.trainingEnd)}`} · of ${pesos(r.dueCentavos)}`}
            mid={r.endsToday ? <Badge tone="orange">Ends Today</Badge> : <Badge tone="cancelled">Past Due</Badge>} amount={pesos(r.balanceCentavos)} acts={<button type="button" className="portal-primary row-act" onClick={() => onPay(r.id, [r.id])}>Balance</button>} />)}{unpaidP.pager}</div> : <p className="portal-empty-copy">No unpaid balances after training.</p>}
        </section>}
      </div>
      <aside className="cx-cashcol" aria-label="Today's Cash">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Today&apos;s Cash</h2><Badge tone={closedToday ? "active" : opening ? "orange" : "cancelled"}>{closedToday ? "Closed" : opening ? "Drawer Open" : "Not Opened"}</Badge></div>
          <dl className="ac-lines">
            <div><dt>Opening Cash{opening ? ` · ${fmtClock(opening.created_at)}` : ""}</dt><dd>{opening ? pesos(opening.opening_cash_centavos) : "Not Recorded"}</dd></div>
            <div><dt>+ Cash Collected</dt><dd className="plus">{pesos(cashIn)}</dd></div>
            <div><dt>− Cash Expenses</dt><dd className="minus">{pesos(cashOut)}</dd></div>
            {(depositedToday > 0 || toDeposit.length > 0) && <div><dt>− Bank Deposits</dt><dd className="minus">{pesos(depositedToday)}</dd></div>}
            <div className="total"><dt>= Expected in Drawer</dt><dd className="eq">{pesos(expected)}</dd></div>
          </dl>
          <button type="button" className="pe-fold cx-chfold" aria-expanded={showChannels} onClick={() => setShowChannels((v) => !v)}><span>Per Channel · Net {pesos(totalToday - releasedToday)}</span><span>{showChannels ? "Hide ▴" : "Show ▾"}</span></button>
          {showChannels && <dl className="ac-lines">
            {channels.map((c) => <div key={c.m}><dt><span className="cr-dot" style={{ background: MODE_COLORS[c.m] ?? "#0571D0" }} />{c.m}<small className="cl-sub cl-block">{c.receipts} receipt{c.receipts === 1 ? "" : "s"}</small></dt><dd><span className="plus">{pesos(c.in)}</span>{c.out > 0 && <small className="minus cl-block">− {pesos(c.out)}</small>}</dd></div>)}
          </dl>}
          {rebateLines.length > 0 && <dl className="ac-lines"><div><dt>Rebates to Collect · {rebatesToCollect.length}{go && <> · <button type="button" className="cx-textbtn" onClick={() => go("Other income")}>Open</button></>}</dt><dd className="minus">{pesos2(rebatesToCollect.reduce((s, l) => s + Number(l.e.rebate_centavos), 0))}</dd></div></dl>}
          {!closedToday && <button type="button" className="portal-primary cx-close" onClick={() => go?.("Opening and closing")}>{opening ? "Close Cash" : "Record Opening Cash"}</button>}
        </section>
      </aside>
    </div>
    {raising && <RecordExpenseModal data={data} onClose={() => setRaising(false)} post={post} />}
    {marking && <MarkDepositedModal deposit={marking} onClose={() => setMarking(null)} onDone={reload} />}
    {fromProof && <RecordPaymentModal data={data} initialProof={fromProof} onClose={() => setFromProof(null)} onSaved={reload} />}
  </div>;
}

/** Payment records: every payment with mode, reference and receipt, by date range. */
export function CashierPayments({ data, onPay, reload }: { data: PortalData; onPay: (enrollmentId: string) => void; reload?: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload ?? (async () => undefined));
  // Hidden until a date is picked; a search looks across all dates (owner, 5 Nov 2026).
  const per = usePeriod();
  const [mode, setMode] = useState("");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  useNeedSince(term ? ALL_DATES : "");
  // Voided payments stay listed, marked VOID (owner, 29 Oct 2026); totals count valid payments only.
  const rows = [...data.payments, ...(data.voidedPayments ?? [])].filter((p) => { const t = first(p.trainees); return (!!term || per.inRange(p.received_at)) && (!mode || p.method === mode) && (!term || `${p.payment_number} ${p.reference_number ?? ""} ${t ? `${t.legal_first_name} ${t.legal_last_name}` : ""}`.toLowerCase().includes(term)); })
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  const byMode = new Map<string, number>();
  const valid = rows.filter((p) => (p as { valid?: boolean }).valid !== false);
  for (const p of valid) byMode.set(p.method, (byMode.get(p.method) ?? 0) + Number(p.amount_centavos));
  const total = valid.reduce((s, p) => s + Number(p.amount_centavos), 0);
  const paged = usePaged(rows);
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Payments</h1></div><button type="button" className="portal-primary" onClick={() => onPay("")}>Record</button></div>
    <div className="cx-bar">
      <label className="cx-dt">Mode<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All Modes</option>{[...new Set([...modeNames(data), ...data.payments.map((p) => p.method)])].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      <input className="cx-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, receipt or reference" aria-label="Search payments" />
    </div>
    <MonthBar p={per} what="Received" count={`${rows.length} payment${rows.length === 1 ? "" : "s"}`} searching={!!term} />
    {(per.picked || !!term) && <><div className="cx-tiles">{[["Total", total, valid.length] as const, ...[...byMode.entries()].map(([m, v]) => [m, v, valid.filter((p) => p.method === m).length] as const)].map(([m, v, n]) => <div className="cx-tile" key={m} style={{ ["--c" as string]: MODE_COLORS[m] ?? "#123F63" }}><span>{m}</span><b>{pesos(v)}</b><small>{n} receipt{n === 1 ? "" : "s"}</small></div>)}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <section className="portal-panel cx-panel">{rows.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Time</th><th>Trainee</th><th>Mode</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead><tbody>
      {paged.shown.flatMap((p, i) => {
        const t = first(p.trainees), d = day(p.received_at), s = paymentStatus(data, p), isVoid = (p as { valid?: boolean }).valid === false;
        const ar = first((p as { receipts?: { receipt_number: string } | { receipt_number: string }[] | null }).receipts)?.receipt_number;
        const rowsOn = rows.filter((x) => day(x.received_at) === d);
        return [
          (!i || day(paged.shown[i - 1].received_at) !== d) && <PaymentDayRow key={`day-${d}`} day={fmtDate(d)} count={rowsOn.length} span={4} total={pesos(rowsOn.filter((x) => (x as { valid?: boolean }).valid !== false).reduce((n, x) => n + Number(x.amount_centavos), 0))} />,
          <tr key={p.id} className={isVoid ? "pv-void" : undefined}><td data-l="Time" className="cx-mono">{fmtClock(p.received_at)}</td><td data-l="" className="lead"><span className="cx-name">{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</span><small className="cx-mono">{ar ?? p.payment_number}</small></td><td data-l="Mode">{p.method}{p.reference_number ? <small className="cx-mono">{p.reference_number}</small> : null}</td><td data-l="Status"><Badge tone={s.tone}>{s.label}</Badge>{s.note && <small>{s.note}</small>}</td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos(p.amount_centavos)}</strong></td><td data-l=""><div className="cx-acts"><ReceiptButton data={data} paymentId={p.id} reload={reload} icon />{reload && s.canVoid && <RequestVoidIcon payment={p} busy={busy} post={post} />}</div></td></tr>,
        ];
      })}
    </tbody></table>{paged.pager}</div> : <p className="portal-empty-copy">No payments in this range.</p>}</section></>}
  </div>;
}

/** Discount and Special Arrangement requests filed by the Cashier, in one Request dropdown (owner, 12 Nov 2026); Accounting or the Admin decide. */
export function DiscountRequests({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload);
  const [kind, setKind] = useState<"Discount" | "Special Arrangement">("Discount");
  const [saNote, setSaNote] = useState("");
  // Special arrangements waiting, and those decided in the last 7 days so the Cashier sees the outcome.
  const weekAgo = addDays(manilaToday(), -7);
  const specials = (data.specialRequests ?? []).filter((r) => r.approval_status === "Pending" || (r.decided_at && day(r.decided_at) >= weekAgo));
  const [enrollmentId, setEnrollmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState<ReasonValue>(NO_REASON);
  const [agencyId, setAgencyId] = useState("");
  const open = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && balanceOf(e) > 0).sort((a, b) => traineeName(a).localeCompare(traineeName(b)));
  const e = open.find((x) => x.id === enrollmentId);
  const rebate = e && agencyId ? data.agencyCourseRebates.find((r) => r.agency_id === agencyId && r.course_id === e.course_id)?.rebate_centavos ?? null : null;
  const centavos = rebate ?? Math.round(Number(amount || 0) * 100);
  const file = () => void post({ action: "discount-request", enrollmentId, amountCentavos: centavos, description: reasonText(why), agencyId: agencyId || null }, "Discount request sent for approval.").then(() => { setEnrollmentId(""); setAmount(""); setWhy(NO_REASON); setAgencyId(""); }).catch(() => undefined);
  const enrollmentOf = (id: string) => data.enrollments.find((x) => x.id === id);
  return <div className="cx-stack">
    <section className="portal-panel cx-panel">
      <div className="panel-heading"><div><h2>New Request</h2></div></div>
      {msg && <Message kind={msg.kind} text={msg.text} />}
      {saNote && <Message kind="success" text={saNote} />}
      <div className="portal-form cx-formpad">
        <label className="full">Request<select value={kind} onChange={(ev) => { setKind(ev.target.value as typeof kind); setSaNote(""); }}><option>Discount</option><option>Special Arrangement</option></select></label>
        {kind === "Special Arrangement" ? <SpecialRequestForm data={data} enrollments={data.enrollments} onSent={async (text) => { await reload(); setSaNote(text); }} /> : <>
        <label className="full">Enrollment<select value={enrollmentId} onChange={(ev) => setEnrollmentId(ev.target.value)}><option value="">Select a Trainee with a Balance</option>{open.map((x) => <option key={x.id} value={x.id}>{traineeName(x)} · {x.enrollment_number} · {courseCode(x)} · {pesos(balanceOf(x))}</option>)}</select></label>
        <label>Endorsing Agency<select value={agencyId} onChange={(ev) => setAgencyId(ev.target.value)}><option value="">None</option>{data.agencies.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Discount Amount (PHP){rebate != null ? <input value={(rebate / 100).toFixed(2)} readOnly /> : <input type="number" min="0.01" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} />}</label>
        <ReasonField reasons={REASONS.discount} value={why} onChange={setWhy} />
        <div className="portal-form-actions full"><button type="button" className="portal-primary" disabled={busy || !e || !reasonReady(why) || centavos <= 0 || (e && centavos > balanceOf(e))} onClick={file}>{busy ? "Sending…" : "Request Discount"}</button></div>
        </>}
      </div>
    </section>
    <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>For Approval</h2></div><span className="slot-count">{data.pendingDiscounts.length + specials.filter((r) => r.approval_status === "Pending").length}</span></div>
      {data.pendingDiscounts.length || specials.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Trainee</th><th>Request</th><th>Details</th><th>Filed</th><th className="r">Amount</th></tr></thead><tbody>
        {specials.map((r) => <tr key={r.id}><td data-l="" className="lead"><span className="cx-name">{specialTrainee(r)}</span><span className="cx-id">{r.request_no ?? r.enrollments?.enrollment_number}</span></td><td data-l="Request"><Badge tone={SPECIAL_TONE[r.approval_status]}>{r.approval_status === "Pending" ? "Special Arrangement" : `Special Arrangement ${r.approval_status}`}</Badge></td><td data-l="Details">{specialCourse(r)} · {r.arrangement} · {pesos(r.standard_centavos)} → {pesos(r.special_centavos)}{r.decision_remarks ? ` · ${r.decision_remarks}` : ""}</td><td data-l="Filed">{fmtDate(day(r.created_at))}</td><td data-l="Amount" className="r cx-amt">+ {pesos(r.amount_centavos)}</td></tr>)}
        {data.pendingDiscounts.map((d) => { const x = enrollmentOf(d.enrollment_id); return <tr key={d.id}><td data-l="" className="lead"><span className="cx-name">{x ? traineeName(x) : "Enrollment"}</span><span className="cx-id">{x?.enrollment_number}</span></td><td data-l="Request"><Badge tone="blue">Discount</Badge></td><td data-l="Details">{d.description}</td><td data-l="Filed">{fmtDate(day(d.created_at))}</td><td data-l="Amount" className="r cx-amt">− {pesos(d.amount_centavos)}</td></tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">No discount or special arrangement requests for approval.</p>}
    </section>
  </div>;
}

const STATUS_ORDER = ["Unpaid", "Partially paid", "Company Charge", "Paid", "Cancelled"] as const;
/** Every enrollment with its payment status, filtered by status and enrolled date. */
export function CashierEnrollments({ data, onPay, reload, onOpenTrainee }: { data: PortalData; onPay: (enrollmentId: string, courses?: string[]) => void; reload: () => Promise<void>; onOpenTrainee?: (traineeId: string) => void }) {
  const [filter, setFilter] = useState<"All" | (typeof STATUS_ORDER)[number]>("All");
  const rowState = (e: Enrollment) => (e.enrollment_status !== "Cancelled" && data.companyCharge?.[e.id] && balanceOf(e) > 0 ? "Company Charge" : payState(e));
  const [q, setQ] = useState("");
  // Hidden until a date is picked; a search looks across all dates (owner, 5 Nov 2026).
  const per = usePeriod();
  const dateOf = (e: Enrollment) => day(e.enrolled_at ?? e.created_at);
  const term = q.trim().toLowerCase();
  useNeedSince(term ? ALL_DATES : "");
  const base = data.enrollments.filter((e) => { const d = dateOf(e); return (!!term || (per.picked && d >= per.range.from && d <= per.range.to)) && (!term || `${traineeName(e)} ${e.enrollment_number} ${first(e.courses)?.name ?? ""} ${courseCode(e)} ${data.applicationNumbers?.[e.trainee_id] ?? ""}`.toLowerCase().includes(term)); });
  const rows = base.filter((e) => filter === "All" || rowState(e) === filter)
    .sort((a, b) => STATUS_ORDER.indexOf(rowState(a) as (typeof STATUS_ORDER)[number]) - STATUS_ORDER.indexOf(rowState(b) as (typeof STATUS_ORDER)[number]) || dateOf(b).localeCompare(dateOf(a))).slice(0, 300);
  const count = (f: string) => base.filter((e) => f === "All" || rowState(e) === f).length;
  const paged = usePaged(rows);
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Enrollments</span><h1>Search Trainee</h1></div></div>
    <div className="cx-status" role="tablist">{(["All", ...STATUS_ORDER] as const).map((f) => <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{tcl(f)}<span>{count(f)}</span></button>)}</div>
    <div className="cx-bar"><input className="cx-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, NWMTACI number or course" aria-label="Search enrollments" />
    </div>
    <MonthBar p={per} what="Enrolled" count={`${rows.length} enrollment${rows.length === 1 ? "" : "s"}`} searching={!!term} />
    {(per.picked || !!term) && <section className="portal-panel cx-panel">{rows.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Trainee</th><th>Enrolled</th><th>Course</th><th className="r">Total Due</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th><th></th></tr></thead><tbody>
      {paged.shown.map((e) => { const st = rowState(e); return <tr key={e.id}><td data-l="" className="lead">{onOpenTrainee ? <button type="button" className="pv-open" onClick={() => onOpenTrainee(e.trainee_id)} title="Open the Trainee Account"><Who name={traineeName(e)} number={data.applicationNumbers?.[e.trainee_id] ?? first(e.trainees)?.trainee_number} /></button> : <Who name={traineeName(e)} number={data.applicationNumbers?.[e.trainee_id] ?? first(e.trainees)?.trainee_number} />}</td><td data-l="Enrolled">{fmtDate(dateOf(e))}</td><td data-l="Course"><span className="cx-code">{courseCode(e)}</span><small>{scheduleText(e)}</small></td><td data-l="Total due" className="r cx-amt">{pesos(dueCentavos(e))}</td><td data-l="Paid" className="r cx-amt">{pesos(paidOf(e))}</td><td data-l="Balance" className="r"><strong className="cx-amt">{pesos(e.enrollment_status === "Cancelled" ? 0 : balanceOf(e))}</strong></td><td data-l="Status"><Badge tone={PAY_TONE[st]}>{st}</Badge></td><td data-l=""><div className="cx-acts">{st === "Company Charge" ? <small className="muted-text">Billed on the Billing Statement</small> : st !== "Paid" && st !== "Cancelled" && <button type="button" className="portal-primary" onClick={() => onPay(e.id, [e.id])}>Balance</button>}</div></td></tr>; })}
    </tbody></table>{paged.pager}</div> : <p className="portal-empty-copy">No enrollments match these filters.</p>}</section>}
  </div>;
}

/** The schedule of fees: miscellaneous items sold at the counter and service fees for change requests. */
export function ScheduleOfFees({ data }: { data: PortalData }) {
  const active = data.charges.filter((c) => c.active);
  const group = (kind: "item" | "fee", title: string) => { const list = active.filter((c) => ((c.kind ?? "fee") === "item" ? "item" : "fee") === kind); return <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>{title}</h2></div><span className="slot-count">{list.length}</span></div>
    {list.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Name</th><th className="r">Price</th></tr></thead><tbody>{list.map((c) => <tr key={c.id}><td data-l="" className="lead"><span className="cx-name">{c.name}</span></td><td data-l="Price" className="r"><strong className="cx-amt">{Number(c.default_amount_centavos) > 0 ? pesos(c.default_amount_centavos) : "Set by the Cashier"}</strong></td></tr>)}</tbody></table></div> : <p className="portal-empty-copy">None yet.</p>}</section>; };
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Schedule of Fees</h1></div></div>
    {group("item", "Miscellaneous items")}
    {group("fee", "Service fees")}
  </div>;
}

/** TAR reprint requests and their approval status. */
export function TarReprints({ data }: { data: PortalData }) {
  const rows = data.requests.filter((r) => r.request_type === "TAR reprint").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const stageOf = (r: RequestRow) => (r.status !== "Pending" ? r.status : r.stage === "With cashier" ? "Add charge" : "For approval");
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Requests</span><h1>TAR Reprints</h1></div></div>
    <section className="portal-panel cx-panel">{rows.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Request</th><th>Trainee</th><th>Reason</th><th>Status</th></tr></thead><tbody>
      {rows.map((r) => { const t = first(r.trainees); const st = stageOf(r); return <tr key={r.id}><td data-l="" className="lead"><span className="cx-name cx-mono">{r.request_number}</span><small>{fmtDate(day(r.created_at))}</small></td><td data-l="Trainee">{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</td><td data-l="Reason">{r.reason}</td><td data-l="Status"><Badge tone={st === "Approved" ? "active" : st === "Rejected" ? "cancelled" : "orange"}>{st}</Badge></td></tr>; })}
    </tbody></table></div> : <p className="portal-empty-copy">No TAR reprint requests.</p>}</section>
  </div>;
}

/** Start-of-day opening cash, recorded once per day; the closing below starts from it. */

/** Summary report: collections by mode, expenses, net cash, the cash drawer and balances due after training. */
type ReportData = Omit<CashierReportSnapshot, "logoBytes">;
/**
 * Report (owner, 8 Oct 2026): one consolidated day, the same as the PDF.
 * Cash position, collections by source and channel, receipts by source,
 * expenses with voucher numbers.
 */
export function CashierSummaryReport({ embedded, day }: { data?: PortalData; embedded?: boolean; day?: string }) {
  const today = manilaToday();
  const [picked, setDate] = useState(today);
  const date = day ?? picked;
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/staff/cashier-report?date=${date}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load the report.");
        if (live) { setReport(body as ReportData); setError(""); }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load the report."); }
    })();
    return () => { live = false; };
  }, [date]);
  const shown = report && report.dateLabel ? report : null;
  const p = shown?.position;
  const grand = shown ? shown.matrix.reduce((s, r) => s + r.totalCentavos, 0) : 0;
  const receipts = shown ? shown.matrix.reduce((s, r) => s + r.count, 0) : 0;
  const expTotal = shown ? shown.expenses.reduce((s, e) => s + e.amountCentavos, 0) : 0;
  const cell = (n: number, v: number) => (n ? <><span className="cx-amt">{pesos(v)}</span><small>{n} receipt{n === 1 ? "" : "s"}</small></> : <span className="muted-text">—</span>);
  return <div className={embedded ? "" : "portal-page cx"}>
    {!embedded && <div className="cx-head"><div><span className="portal-eyebrow">Reports</span><h1>Daily Summary</h1></div></div>}
    {!day && <div className="cx-bar">
      <label className="cx-dt">Date<input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      <a className="portal-primary" href={`/api/documents/cashier-report?date=${date}`} target="_blank" rel="noreferrer">Generate Report (PDF)</a>
      {shown && <span className="cx-mono muted-text">{shown.dateLabel}</span>}
    </div>}
    {error && <Message kind="error" text={error} />}
    {!shown && !error && <p className="portal-empty-copy">Loading the report…</p>}
    {shown && p && <>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Cash Position</h2><span className="muted-text">Cash only</span></div>
        <div className="rp-cash">
          <div><span>{p.previousLabel}</span><b className="cx-mono">{pesos(p.previousCentavos)}</b><small>{p.previousNote}</small></div>
          <div className="plus"><span>+ Cash collected</span><b className="cx-mono">{pesos(p.cashCollectedCentavos)}</b></div>
          <div className="minus"><span>− Cash expenses</span><b className="cx-mono">{pesos(p.cashExpensesCentavos)}</b></div>
          <div className="eq"><span>= Cash on hand</span><b className="cx-mono">{pesos(p.onHandCentavos)}</b></div>
          <div><span>Counted at closing</span><b className="cx-mono">{p.countedCentavos == null ? "Not yet" : pesos(p.countedCentavos)}</b></div>
          <div className={p.overShortCentavos ? (p.overShortCentavos < 0 ? "minus" : "plus") : ""}><span>Over / short</span><b className="cx-mono">{p.overShortCentavos == null ? "—" : `${p.overShortCentavos > 0 ? "+" : ""}${pesos(p.overShortCentavos)}`}</b></div>
        </div>
      </section>

      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections Summary</h2><span className="cx-mono">{receipts} receipt{receipts === 1 ? "" : "s"} · {pesos(grand)}</span></div>
        <div className="portal-table cx-cards"><table><thead><tr><th>Source</th>{shown.channels.map((c) => <th key={c} className="r">{c}</th>)}<th className="r">Total</th></tr></thead><tbody>
          {shown.matrix.map((r) => <tr key={r.source}><td data-l="" className="lead"><span className="cx-name">{r.source}</span></td>{shown.channels.map((c) => { const k = r.cells.find((x) => x.channel === c); return <td key={c} data-l={c} className="r">{cell(k?.count ?? 0, k?.totalCentavos ?? 0)}</td>; })}<td data-l="Total" className="r"><strong>{cell(r.count, r.totalCentavos)}</strong></td></tr>)}
          <tr className="rp-total"><td data-l="" className="lead"><strong>Total</strong></td>{shown.channels.map((c) => { const n = shown.matrix.reduce((s, r) => s + (r.cells.find((x) => x.channel === c)?.count ?? 0), 0), v = shown.matrix.reduce((s, r) => s + (r.cells.find((x) => x.channel === c)?.totalCentavos ?? 0), 0); return <td key={c} data-l={c} className="r"><strong>{cell(n, v)}</strong></td>; })}<td data-l="Total" className="r"><strong>{cell(receipts, grand)}</strong></td></tr>
        </tbody></table></div>
      </section>

      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections Detail</h2></div>
        {shown.groups.length ? shown.groups.map((g) => { const key = `${g.kind}|${g.name}`, isOpen = open[key] ?? true; return <div key={key} className="rp-group">
          <button type="button" className="cx-month-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}><span className="cx-month-name">{g.kind}{g.name ? ` · ${g.name}` : ""}</span><span className="cx-month-meta">{g.rows.length} receipt{g.rows.length === 1 ? "" : "s"}</span><b className="cx-mono">{pesos(g.subtotalCentavos)}</b><span aria-hidden="true" className="cx-month-caret">{isOpen ? "▾" : "▸"}</span></button>
          {isOpen && <div className="portal-table cx-cards"><table><thead><tr><th>Receipt</th><th>Time</th><th>Trainee</th><th>Course</th><th>Channel</th><th>Reference</th><th className="r">Amount</th></tr></thead><tbody>
            {g.rows.map((r, i) => <tr key={`${r.receipt}-${i}`}><td data-l="" className="lead"><span className="cx-name cx-mono">{r.receipt}</span></td><td data-l="Time">{r.time}</td><td data-l="Trainee">{r.trainee}</td><td data-l="Course">{r.course}</td><td data-l="Channel">{r.channel}</td><td data-l="Reference" className="cx-mono">{r.reference || "—"}</td><td data-l="Amount" className="r cx-amt">{pesos(r.amountCentavos)}</td></tr>)}
          </tbody></table></div>}
        </div>; }) : <p className="portal-empty-copy">No collections on this day.</p>}
      </section>

      {(shown.otherIncome ?? []).length > 0 && <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Other Income</h2><span className="cx-mono">{shown.otherIncome!.length} receipt{shown.otherIncome!.length === 1 ? "" : "s"} · {pesos(shown.otherIncome!.reduce((t, i) => t + i.amountCentavos, 0))}</span></div>
        <div className="portal-table cx-cards"><table><thead><tr><th>Income no.</th><th>Source</th><th>Received From</th><th>Channel</th><th>Reference</th><th className="r">Amount</th></tr></thead><tbody>
          {shown.otherIncome!.map((i) => <tr key={i.number}><td data-l="" className="lead"><span className="cx-name cx-mono">{i.number}</span></td><td data-l="Source">{i.source}</td><td data-l="Received from">{i.payer}</td><td data-l="Channel">{i.channel}</td><td data-l="Reference" className="cx-mono">{i.reference || "—"}</td><td data-l="Amount" className="r cx-mono">{pesos(i.amountCentavos)}</td></tr>)}
        </tbody></table></div></section>}

      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Expenses</h2><span className="cx-mono">{shown.expenses.length} voucher{shown.expenses.length === 1 ? "" : "s"} · {pesos(expTotal)}</span></div>
        {shown.expenses.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Voucher no.</th><th>Payee</th><th>Category</th><th>Channel</th><th>Reference</th><th className="r">Amount</th></tr></thead><tbody>
          {shown.expenses.map((e, i) => <tr key={`${e.voucher}-${i}`}><td data-l="" className="lead"><span className="cx-name cx-mono">{e.voucher}</span></td><td data-l="Payee">{e.payee}</td><td data-l="Category">{e.category}</td><td data-l="Channel">{e.channel || "—"}</td><td data-l="Reference" className="cx-mono">{e.reference || "—"}</td><td data-l="Amount" className="r cx-amt">{pesos(e.amountCentavos)}</td></tr>)}
          {shown.expenseTotals.map((t) => <tr key={t.channel} className="rp-sub"><td data-l="" className="lead"><span className="muted-text">Subtotal</span></td><td data-l="" /><td data-l="" /><td data-l="Channel">{t.channel}</td><td data-l="" /><td data-l="Amount" className="r cx-amt">{pesos(t.totalCentavos)}</td></tr>)}
        </tbody></table></div> : <p className="portal-empty-copy">No expenses released on this day.</p>}
      </section>
    </>}
  </div>;
}

/* ====================================================== Expenses (Oct 2026) */

type ReceiptFile = { fileId: string; link: string; name: string; mime: string };
type ExpenseRow = PortalData["expenses"][number] & { receipt_files?: ReceiptFile[] | null; purpose?: string; payment_channel?: string | null; reference_number?: string | null; request_number?: string | null; voucher_number?: string | null; approved_at?: string | null; decision_remarks?: string | null; released_at?: string | null; paid_at?: string | null; drive_link?: string | null; print_count?: number | null; reprints_approved?: number | null; line_items?: { description: string; quantity: number; unitCentavos: number }[] | null; supporting_document?: string | null; requested_by_name?: string | null; approved_by_name?: string | null; released_by_name?: string | null; is_budget?: boolean | null; advance_centavos?: number | null; returned_centavos?: number | null; liquidated_at?: string | null };
type ReprintRow = NonNullable<PortalData["expenseReprints"]>[number];
export const EXPENSE_STATUSES = ["All", "For approval", "Approved", "Advanced", "Released", "Rejected"] as const;
export const expenseState = (e: { status: string }) => (e.status === "Pending" ? "For approval" : e.status === "Paid" ? "Released" : e.status);
/** Approved and released expenses in [from, to] (Manila dates), totalled per payment channel. */
export function expenseTotalsByChannel(rows: { status: string; created_at: string; amount_centavos: number; payment_channel?: string | null }[], from: string, to: string) {
  const map = new Map<string, { count: number; total: number }>();
  for (const e of rows) {
    const d = day(e.created_at);
    if ((from && d < from) || (to && d > to) || (e.status !== "Approved" && e.status !== "Paid")) continue;
    const k = e.payment_channel || "Not set";
    const c = map.get(k) ?? { count: 0, total: 0 };
    c.count += 1; c.total += Number(e.amount_centavos);
    map.set(k, c);
  }
  return [...map].map(([channel, c]) => ({ channel, ...c })).sort((a, b) => b.total - a.total);
}

/**
 * Voucher print limit (owner, 8 Oct 2026): one print; each reprint needs the
 * Accounting's approval. "print" = can print now, "request" = used up,
 * "pending" = a request is waiting, "rejected" = the last request was refused.
 */
export function voucherPrintState(e: { id: string; print_count?: number | null; reprints_approved?: number | null }, reprints: { expense_id: string; status: string; requested_at: string }[]) {
  const used = Number(e.print_count ?? 0), allowed = 1 + Number(e.reprints_approved ?? 0);
  const latest = reprints.filter((r) => r.expense_id === e.id).sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0];
  if (used < allowed) return { state: "print" as const, used, allowed };
  if (latest?.status === "Pending") return { state: "pending" as const, used, allowed };
  if (latest?.status === "Rejected") return { state: "rejected" as const, used, allowed };
  return { state: "request" as const, used, allowed };
}

/** Vouchers (with a CV number) grouped by month of approval, newest month first. */
export function vouchersByMonth<T extends { status: string; created_at: string; amount_centavos: number; voucher_number?: string | null; approved_at?: string | null }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const e of rows) {
    if (e.status !== "Approved" && e.status !== "Paid") continue;
    const key = day(e.approved_at ?? e.created_at).slice(0, 7);
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  return [...map].sort((a, b) => b[0].localeCompare(a[0])).map(([month, list]) => ({
    month,
    label: new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`)),
    rows: list.slice().sort((a, b) => (b.voucher_number ?? "").localeCompare(a.voucher_number ?? "")),
    total: list.reduce((s, e) => s + Number(e.amount_centavos), 0),
  }));
}
const EXPENSE_TONE: Record<string, string> = { "For approval": "orange", Approved: "blue", Advanced: "orange", Released: "active", Rejected: "cancelled" };

export const VOUCHER_FILTERS = ["All", "Awaiting release", "Released", "Reprint requests"] as const;
/** Voucher list filter (owner, 8 Oct 2026). */
export function voucherMatches(e: { id: string; status: string }, filter: (typeof VOUCHER_FILTERS)[number], reprints: { expense_id: string; status: string }[]) {
  if (filter === "Awaiting release") return e.status === "Approved";
  if (filter === "Released") return e.status === "Paid";
  if (filter === "Reprint requests") return reprints.some((r) => r.expense_id === e.id && r.status === "Pending");
  return true;
}

/** One voucher, opened from the Vouchers tab: details, lines, history and the actions it allows. */
function VoucherDrawer({ e, reprints, isManager, onClose, onRelease, onRequestReprint, reload }: { e: ExpenseRow; reprints: ReprintRow[]; isManager: boolean; onClose: () => void; onRelease: (e: ExpenseRow) => void; onRequestReprint: (e: ExpenseRow) => void; reload: () => Promise<void> }) {
  const p = voucherPrintState(e, reprints);
  const lines = Array.isArray(e.line_items) && e.line_items.length ? e.line_items : [{ description: e.purpose ?? "Expense", quantity: 1, unitCentavos: Number(e.amount_centavos) }];
  const released = e.status === "Paid";
  const steps: [string, string, boolean][] = [
    ["Recorded", `${e.request_number ?? e.expense_number}${e.requested_by_name ? ` · ${e.requested_by_name}` : ""} · ${fmtDate(day(e.created_at))}`, true],
    ["Approved", e.approved_at ? `${e.approved_by_name ?? "Accounting"} · ${fmtDate(day(e.approved_at))}` : "Waiting for Accounting", !!e.approved_at],
    ["Printed", p.used ? `${p.used} print${p.used > 1 ? "s" : ""}${p.state === "pending" ? " · reprint requested" : ""}` : "Not yet", p.used > 0],
    ["Released", released && e.released_at ? `${e.payment_channel ?? ""}${e.reference_number ? ` · ${e.reference_number}` : ""} · ${e.released_by_name ?? "Cashier"} · ${fmtDate(day(e.released_at))}` : "Waiting for the Cashier", released],
  ];
  useEffect(() => { const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  return <div className="vx-drawer" onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
    <aside className="vx-panel" role="dialog" aria-label={`Voucher ${e.voucher_number ?? e.expense_number}`}>
      <div className="vx-dh"><div><span className="portal-eyebrow">Liquidation Form</span><h2 className="cx-mono">{e.voucher_number ?? e.expense_number}</h2><Badge tone={released ? "active" : "blue"}>{released ? "Released" : "Awaiting Release"}</Badge></div><button type="button" className="vx-x" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="vx-db">
        <dl className="vx-kv">
          <div><dt>Payee</dt><dd>{e.payee}</dd></div><div><dt>Category</dt><dd>{e.category}</dd></div>
          <div><dt>Date issued</dt><dd>{fmtDate(day(e.approved_at ?? e.created_at))}</dd></div><div><dt>Request no.</dt><dd className="cx-mono">{e.request_number ?? "—"}</dd></div>
          <div><dt>Mode of payment</dt><dd>{e.payment_channel || "—"}{e.reference_number ? ` · ${e.reference_number}` : ""}</dd></div><div><dt>Receipts</dt><dd>{e.receipt_files?.length ? <ReceiptLinks files={e.receipt_files} /> : "—"}</dd></div><div><dt>Supporting document</dt><dd>{e.supporting_document || "—"}</dd></div>
        </dl>
        <div className="vx-lines"><table><thead><tr><th>Particulars</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead><tbody>
          {lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="r cx-mono">{l.quantity}</td><td className="r cx-mono">{pesos2(l.quantity * l.unitCentavos)}</td></tr>)}
        </tbody><tfoot><tr><td colSpan={2}>Total</td><td className="r cx-mono">{pesos2(e.amount_centavos)}</td></tr></tfoot></table></div>
        <p className="vx-words">{pesosInWords(Number(e.amount_centavos))}</p>
        <div><span className="portal-eyebrow">History</span><ol className="vx-tl">{steps.map(([t, d, done]) => <li key={t} className={done ? "" : "todo"}><i aria-hidden="true">{done ? "✓" : ""}</i><div><strong>{tcl(t)}</strong><small>{d}</small></div></li>)}</ol></div>
      </div>
      <div className="vx-df">
        <ViewIcon label="View File Copy" href={`/api/documents/expense/${e.id}?copy=1`} />
        {e.drive_link && <a className="portal-secondary" href={e.drive_link} target="_blank" rel="noreferrer">Open in Drive</a>}
        {!released && !isManager && <button type="button" className="portal-primary" onClick={() => onRelease(e)}>Mark Released</button>}
        {p.state === "print" ? <a className="portal-primary" href={`/api/documents/expense/${e.id}`} target="_blank" rel="noreferrer" onClick={() => window.setTimeout(() => void reload(), 2500)}>{p.used ? "Print Reprint" : "Print Voucher"}</a>
          : p.state === "pending" ? <span className="cx-chip">Reprint awaiting approval</span>
          : <button type="button" className="portal-secondary" onClick={() => onRequestReprint(e)}>{p.state === "rejected" ? "Request Reprint Again" : "Request Reprint"}</button>}
      </div>
    </aside>
  </div>;
}

/** Print voucher, or the reprint step it needs (request, waiting, refused). */
function VoucherPrint({ e, reprints, onRequest, reload }: { e: ExpenseRow; reprints: ReprintRow[]; onRequest: (e: ExpenseRow) => void; reload: () => Promise<void> }) {
  const p = voucherPrintState(e, reprints);
  if (p.state === "print") return <a className="portal-secondary" href={`/api/documents/expense/${e.id}`} target="_blank" rel="noreferrer" onClick={() => window.setTimeout(() => void reload(), 2500)}>{p.used ? "Print Reprint" : "Print Voucher"}</a>;
  if (p.state === "pending") return <span className="cx-chip">Reprint awaiting approval</span>;
  return <button type="button" className="portal-secondary" onClick={() => onRequest(e)}>{p.state === "rejected" ? "Request Reprint Again" : "Request Reprint"}</button>;
}

/** Reports › Expenses Summary (owner, 5 Nov 2026): totals per payment channel for a date range, with the PDF. */
export function CashierExpensesSummary({ data }: { data: PortalData }) {
  const today = manilaToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`), [to, setTo] = useState(today);
  useNeedSince(from);
  const channels = expenseTotalsByChannel(data.expenses as ExpenseRow[], from, to);
  const total = channels.reduce((s, c) => s + c.total, 0), vouchers = channels.reduce((s, c) => s + c.count, 0);
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Reports</span><h1>Expenses Summary</h1></div>{from && to && <a className="portal-primary" href={`/api/documents/expenses-summary?from=${from}&to=${to}`} target="_blank" rel="noreferrer">Generate Summary (PDF)</a>}</div>
    <div className="cx-bar">
      <label className="cx-dt">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="cx-dt">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
    </div>
    <div className="cx-tiles">
      <div className="cx-tile" style={{ ["--c" as string]: "#123F63" }}><span>Total expenses</span><b>{pesos(total)}</b><small>{vouchers} voucher{vouchers === 1 ? "" : "s"}</small></div>
      {channels.map((c) => <div className="cx-tile" key={c.channel} style={{ ["--c" as string]: MODE_COLORS[c.channel] ?? "#0571D0" }}><span>{c.channel}</span><b>{pesos(c.total)}</b><small>{c.count} voucher{c.count === 1 ? "" : "s"}</small></div>)}
    </div>
  </div>;
}

/**
 * Expenses (owner, 7–8 Oct 2026). Expenses: the Cashier records an expense
 * (ER-…), Accounting approves it (CV-…), the Cashier prints the
 * voucher once and marks it released; the channel totals and summary PDF are
 * in Reports › Expenses Summary. Vouchers: every voucher filed by month, with file copies,
 * prints and reprint requests (approved by Accounting).
 */
export function ExpensesWorkspace({ data, role, reload }: { data: PortalData; role: string; reload: () => Promise<void> }) {
  const today = manilaToday();
  const canDecide = role === "accounting" || role === "admin";
  const isManager = role === "accounting";
  const [view, setView] = useState<"Expenses" | "Vouchers" | "Pay the Centers" | "Referral Vouchers">("Expenses");
  const centersDue = centerLines(data).filter((l) => l.state === "Due").length;
  // Open expenses always show; released and rejected ones wait for a date (owner, 5 Nov 2026).
  const per = usePeriod();
  const [tab, setTab] = useState<(typeof EXPENSE_STATUSES)[number]>(canDecide ? "For approval" : "All");
  const [recording, setRecording] = useState(false), [budgeting, setBudgeting] = useState(false), [liquidating, setLiquidating] = useState<ExpenseRow | null>(null);
  const [releasing, setReleasing] = useState<ExpenseRow | null>(null);
  const [rejecting, setRejecting] = useState<ExpenseRow | null>(null);
  const [reprinting, setReprinting] = useState<ExpenseRow | null>(null);
  const [deciding, setDeciding] = useState<ReprintRow | null>(null);
  const [why, setWhy] = useState<ReasonValue>(NO_REASON);
  const [month, setMonth] = useState("");
  const [vFilter, setVFilter] = useState<(typeof VOUCHER_FILTERS)[number]>("All"), [vChannel, setVChannel] = useState(""), [vSearch, setVSearch] = useState("");
  const [selected, setSelected] = useState<ExpenseRow | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { busy, msg, post } = usePost(reload);
  const reprints = data.expenseReprints ?? [];
  const rows = (data.expenses as ExpenseRow[]).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byId = new Map(rows.map((e) => [e.id, e]));
  const inRange = rows.filter((e) => e.status === "Pending" || e.status === "Approved" || e.status === "Advanced" || per.inRange(e.created_at));
  const shown = inRange.filter((e) => tab === "All" || expenseState(e) === tab);
  const count = (t: string) => inRange.filter((e) => t === "All" || expenseState(e) === t).length;
  const months = vouchersByMonth(rows);
  const thisMonth = today.slice(0, 7);
  const monthsShown = month ? months.filter((m) => m.month === month) : months;
  const pendingReprints = reprints.filter((r) => r.status === "Pending");
  const approve = (e: ExpenseRow) => void post({ action: "expense-decide", id: e.id, decision: "Approved" }, "Approved. The voucher number is issued and the voucher is filed in Google Drive.").catch(() => undefined);
  const reject = () => { if (!rejecting) return; void post({ action: "expense-decide", id: rejecting.id, decision: "Rejected", remarks: reasonText(why) }, "Rejected.").then(() => { setRejecting(null); setWhy(NO_REASON); }).catch(() => undefined); };
  const requestReprint = () => { if (!reprinting) return; void post({ action: "expense-reprint-request", id: reprinting.id, reason: reasonText(why) }, "Reprint request sent to Accounting.").then(() => { setReprinting(null); setWhy(NO_REASON); }).catch(() => undefined); };
  const decideReprint = (r: ReprintRow, decision: "Approved" | "Rejected", remarks?: string) => void post({ action: "expense-reprint-decide", requestId: r.id, decision, remarks }, decision === "Approved" ? "Reprint approved. The voucher can be printed once more." : "Reprint request rejected.").then(() => { setDeciding(null); setWhy(NO_REASON); }).catch(() => undefined);
  const printCell = (e: ExpenseRow) => <VoucherPrint e={e} reprints={reprints} onRequest={(x) => { setReprinting(x); setWhy(NO_REASON); }} reload={reload} />;

  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Expenses</h1></div><span className="cx-acts"><button type="button" className="portal-secondary" data-short="Budget" onClick={() => setBudgeting(true)}>Request Budget</button><button type="button" className="portal-primary" data-short="Expense" onClick={() => setRecording(true)}>Record Expense</button></span></div>
    <div className="cx-status cx-views" role="tablist">{(["Expenses", "Vouchers", "Pay the Centers", "Referral Vouchers"] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v}{v === "Pay the Centers" && centersDue > 0 && <span className="cx-count"> {centersDue}</span>}{v === "Vouchers" && pendingReprints.length ? <span>{pendingReprints.length}</span> : null}</button>)}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}

    {view === "Expenses" && <>
      <MonthBar p={per} what="Recorded" count={`${inRange.length} expense${inRange.length === 1 ? "" : "s"}`} waitText="Pick a date to show released and rejected expenses." />
      <div className="cx-status" role="tablist">{EXPENSE_STATUSES.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{tcl(t)}<span>{count(t)}</span></button>)}</div>
      <section className="portal-panel cx-panel">{shown.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Number</th><th>Payee</th><th>Category</th><th>Channel</th><th className="r">Amount</th><th>Status</th><th></th></tr></thead><tbody>
        {shown.map((e) => { const st = expenseState(e); return <tr key={e.id}>
          <td data-l="" className="lead"><span className="cx-name cx-mono">{e.voucher_number ?? e.expense_number}</span><small>{e.is_budget ? "Budget · " : ""}{e.voucher_number && e.request_number && e.request_number !== e.voucher_number ? `${e.request_number} · ` : ""}{fmtDate(day(e.created_at))}</small></td>
          <td data-l="Payee">{e.payee}<small>{e.purpose}</small></td>
          <td data-l="Category">{e.category}</td>
          <td data-l="Channel">{e.payment_channel || "—"}{e.reference_number ? <small className="cx-mono">{e.reference_number}</small> : null}</td>
          <td data-l="Amount" className="r"><strong className="cx-amt">{pesos(e.amount_centavos)}</strong></td>
          <td data-l="Status"><Badge tone={EXPENSE_TONE[st]}>{st}</Badge>{st === "Rejected" && e.decision_remarks ? <small>{e.decision_remarks}</small> : null}{st === "Released" && e.released_at ? <small>{fmtDate(day(e.released_at))}</small> : null}{st === "Advanced" ? <small>Cash out · liquidate when spent</small> : null}{e.is_budget && e.liquidated_at && e.returned_centavos != null ? <small>{e.returned_centavos >= 0 ? `Change ${pesos(e.returned_centavos)}` : `Reimburse ${pesos(-e.returned_centavos)}`}</small> : null}</td>
          <td data-l=""><div className="cx-acts">
            {st === "For approval" && canDecide && <><button type="button" className="portal-primary" disabled={busy} onClick={() => approve(e)}>Approve</button><button type="button" className="portal-secondary" disabled={busy} onClick={() => { setRejecting(e); setWhy(NO_REASON); }}>Reject</button></>}
            {(st === "Approved" || st === "Released") && printCell(e)}
            {st === "Approved" && <button type="button" className="portal-primary" onClick={() => setReleasing(e)}>{e.is_budget ? "Release Cash" : "Mark Released"}</button>}
            {st === "Advanced" && <button type="button" className="portal-primary row-act" onClick={() => setLiquidating(e)}>Liquidate</button>}
            {e.drive_link && <a className="ghost-button" href={e.drive_link} target="_blank" rel="noreferrer">Drive</a>}
          </div></td>
        </tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">No expenses in this view.</p>}</section>
    </>}

    {view === "Referral Vouchers" && <ReferralVoucherPanel data={data} busy={busy} post={post} role={canDecide ? "accounting" : "cashier"} />}
    {view === "Pay the Centers" && <PayTheCenters data={data} reload={reload} onRelease={(id) => { const e = byId.get(id); if (e) setReleasing(e); }} />}
    {view === "Vouchers" && <>
      {pendingReprints.length > 0 && <section className="portal-panel cx-panel">
        <div className="panel-heading"><h2>Reprint Requests</h2></div>
        <div className="portal-table cx-cards"><table><thead><tr><th>Voucher</th><th>Reason</th><th>Requested by</th><th></th></tr></thead><tbody>
          {pendingReprints.map((r) => { const e = byId.get(r.expense_id); return <tr key={r.id}>
            <td data-l="" className="lead"><span className="cx-name cx-mono">{e?.voucher_number ?? e?.expense_number ?? "—"}</span><small>{e ? `${e.payee} · ${pesos(e.amount_centavos)}` : ""}</small></td>
            <td data-l="Reason">{r.reason}</td>
            <td data-l="Requested by">{r.requested_by_name ?? "—"}<small>{fmtDate(day(r.requested_at))}</small></td>
            <td data-l=""><div className="cx-acts">{isManager
              ? <><button type="button" className="portal-primary" disabled={busy} onClick={() => decideReprint(r, "Approved")}>Approve Reprint</button><button type="button" className="portal-secondary" disabled={busy} onClick={() => { setDeciding(r); setWhy(NO_REASON); }}>Reject</button></>
              : <span className="cx-chip">Waiting for Accounting</span>}</div></td>
          </tr>; })}
        </tbody></table></div>
      </section>}
      {(() => {
        const cur = months.find((m) => m.month === (month || thisMonth)) ?? months[0];
        const sumOf = (list: ExpenseRow[]) => list.reduce((s, e) => s + Number(e.amount_centavos), 0);
        const released = cur ? cur.rows.filter((e) => e.status === "Paid") : [], waiting = cur ? cur.rows.filter((e) => e.status === "Approved") : [];
        return <div className="cx-tiles">
          <div className="cx-tile" style={{ ["--c" as string]: "#123F63" }}><span>{cur?.label ?? "This month"}</span><b>{pesos(cur?.total ?? 0)}</b><small>{cur?.rows.length ?? 0} voucher{cur?.rows.length === 1 ? "" : "s"}</small></div>
          <div className="cx-tile" style={{ ["--c" as string]: "#0a7a3e" }}><span>Released</span><b>{pesos(sumOf(released))}</b><small>{released.length} paid out</small></div>
          <div className="cx-tile" style={{ ["--c" as string]: "#F25615" }}><span>Awaiting release</span><b>{pesos(sumOf(waiting))}</b><small>{waiting.length} approved, not yet paid</small></div>
          <div className="cx-tile" style={{ ["--c" as string]: "#a2470b" }}><span>Reprint requests</span><b>{pendingReprints.length}</b><small>{isManager ? "waiting for you" : "waiting for Accounting"}</small></div>
        </div>;
      })()}
      <div className="cx-bar vx-filters">
        <label className="cx-dt">Month<select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">All Months</option>{months.map((m) => <option key={m.month} value={m.month}>{m.label}</option>)}</select></label>
        <div className="cx-seg" role="tablist">{VOUCHER_FILTERS.map((f) => <button key={f} type="button" className={vFilter === f ? "on" : ""} onClick={() => setVFilter(f)}>{tcl(f)}<small>{months.filter((m) => !month || m.month === month).flatMap((m) => m.rows).filter((e) => voucherMatches(e, f, reprints)).length}</small></button>)}</div>
        <label className="cx-dt">Channel<select value={vChannel} onChange={(e) => setVChannel(e.target.value)}><option value="">All Channels</option>{expenseChannels(data).map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <input className="vx-search" aria-label="Search vouchers" placeholder="Search voucher no., payee or category" value={vSearch} onChange={(e) => setVSearch(e.target.value)} />
      </div>
      {(() => {
        const term = vSearch.trim().toLowerCase();
        const groups = monthsShown.map((m) => ({ ...m, list: m.rows.filter((e) => voucherMatches(e, vFilter, reprints) && (!vChannel || e.payment_channel === vChannel) && (!term || `${e.voucher_number ?? e.expense_number} ${e.payee} ${e.category}`.toLowerCase().includes(term))) })).filter((m) => m.list.length);
        if (!groups.length) return <section className="portal-panel cx-panel"><p className="portal-empty-copy">{months.length ? "No vouchers match." : "No vouchers yet. A voucher is issued when Accounting approves an expense."}</p></section>;
        return groups.map((m) => { const isOpen = open[m.month] ?? !!month; const last = new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)), 0).getDate(); return <section className="portal-panel cx-panel cx-month" key={m.month}>
          <div className="cx-month-head vx-mhead">
            <button type="button" className="vx-mtoggle" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [m.month]: !isOpen }))}><span className="cx-month-name">{m.label}</span><span className="cx-month-meta">{m.list.length} voucher{m.list.length === 1 ? "" : "s"}</span><b className="cx-mono">{pesos(m.list.reduce((s, e) => s + Number(e.amount_centavos), 0))}</b><span aria-hidden="true" className="cx-month-caret">{isOpen ? "▾" : "▸"}</span></button>
            <a className="portal-secondary vx-pdf" href={`/api/documents/expenses-summary?from=${m.month}-01&to=${m.month}-${String(last).padStart(2, "0")}`} target="_blank" rel="noreferrer">Summary PDF</a>
          </div>
          {isOpen && <div className="portal-table cx-cards vx-table"><table><thead><tr><th>Voucher</th><th>Payee</th><th>Channel</th><th className="r">Amount</th><th>Status</th><th>Printing</th><th></th></tr></thead><tbody>
            {m.list.map((e) => { const st = expenseState(e), p = voucherPrintState(e, reprints); return <tr key={e.id} className="vx-row" onClick={() => setSelected(e)}>
              <td data-l="" className="lead"><span className="cx-name cx-mono">{e.voucher_number ?? e.expense_number}</span><small>{fmtDate(day(e.approved_at ?? e.created_at))}</small></td>
              <td data-l="Payee"><strong>{e.payee}</strong><small>{e.category}</small></td>
              <td data-l="Channel">{e.payment_channel || "—"}{e.reference_number ? <small className="cx-mono">{e.reference_number}</small> : null}</td>
              <td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(e.amount_centavos)}</strong></td>
              <td data-l="Status"><Badge tone={EXPENSE_TONE[st]}>{st === "Approved" ? "Awaiting Release" : st}</Badge></td>
              <td data-l="Printing"><span className={`vx-print ${p.state === "print" ? "no" : p.state === "pending" ? "wait" : "ok"}`}>{p.state === "print" ? (p.used ? "Reprint allowed" : "Not printed yet") : p.state === "pending" ? "Reprint awaiting approval" : p.used > 1 ? `✓ Printed ${p.used}×` : "✓ Printed"}</span></td>
              <td data-l="" onClick={(ev) => ev.stopPropagation()}><div className="cx-acts">
                {st === "Approved" && !isManager && <button type="button" className="portal-primary" onClick={() => setReleasing(e)}>Mark Released</button>}
                {printCell(e)}
                <button type="button" className="portal-secondary" onClick={() => setSelected(e)}>Open</button>
              </div></td>
            </tr>; })}
          </tbody></table></div>}
        </section>; });
      })()}
    </>}

    {selected && <VoucherDrawer e={(data.expenses as ExpenseRow[]).find((x) => x.id === selected.id) ?? selected} reprints={reprints} isManager={isManager} reload={reload} onClose={() => setSelected(null)} onRelease={(x) => { setSelected(null); setReleasing(x); }} onRequestReprint={(x) => { setReprinting(x); setWhy(NO_REASON); }} />}
    {recording && <RecordExpenseModal data={data} onClose={() => setRecording(false)} post={post} />}
    {budgeting && <BudgetRequestModal data={data} onClose={() => setBudgeting(false)} post={post} />}
    {liquidating && <RecordExpenseModal data={data} liquidate={liquidating} onClose={() => setLiquidating(null)} post={post} />}
    {releasing && <ReleaseExpenseModal data={data} expense={releasing} onClose={() => setReleasing(null)} post={post} />}
    {rejecting && <Modal title={`Reject ${rejecting.expense_number}`} onClose={() => setRejecting(null)}>
      <div className="portal-form">
        <ReasonField reasons={REJECT_REASONS.expense} value={why} onChange={setWhy} autoFocus />
        <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={() => setRejecting(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !reasonReady(why)} onClick={reject}>Reject Expense</button></div>
      </div>
    </Modal>}
    {reprinting && <Modal title={`Request reprint of ${reprinting.voucher_number ?? reprinting.expense_number}`} onClose={() => setReprinting(null)}>
      <div className="portal-form">
        <ReasonField reasons={REASONS.voucherReprint} label="Reason for Reprinting" value={why} onChange={setWhy} autoFocus />
        <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={() => setReprinting(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !reasonReady(why)} onClick={requestReprint}>Send to Accounting</button></div>
      </div>
    </Modal>}
    {deciding && <Modal title="Reject Reprint Request" onClose={() => setDeciding(null)}>
      <div className="portal-form">
        <ReasonField reasons={REJECT_REASONS.voucherReprint} value={why} onChange={setWhy} autoFocus />
        <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={() => setDeciding(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !reasonReady(why)} onClick={() => decideReprint(deciding, "Rejected", reasonText(why))}>Reject Request</button></div>
      </div>
    </Modal>}
  </div>;
}

/** Receipt links that open in Google Drive. */
function ReceiptLinks({ files }: { files: ReceiptFile[] }) {
  return <span className="cx-receipt-links">{files.map((f, i) => <a key={f.fileId} href={f.link} target="_blank" rel="noreferrer">Receipt {i + 1}</a>)}</span>;
}
/** Phone photos over 4 MB are scaled down (longest side 2000 px, JPEG) so they fit the upload limit. */
export async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= 4 * 1024 * 1024 || !file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}
const isInstructorCategory = (name: string) => /^instructors?$/i.test(name.trim());
const expenseChannels = (data: PortalData) => { const all = data.paymentMethods.filter((m) => m.active); const payable = all.filter((m) => m.kind === "payable"); return (payable.length ? payable : all).map((m) => m.name); };

/** Budget Request (owner, 10 Nov 2026): the Cashier asks for cash first; receipts come with the Liquidation Form. */
function BudgetRequestModal({ data, onClose, post }: { data: PortalData; onClose: () => void; post: (body: Record<string, unknown>, ok?: string) => Promise<Record<string, unknown>> }) {
  const categories = data.expenseCategories.filter((c) => c.active);
  const [payee, setPayee] = useState(""), [category, setCategory] = useState(categories[0]?.name ?? ""), [purpose, setPurpose] = useState(""), [amount, setAmount] = useState("");
  const cents = toCentavos(amount);
  const ready = !!payee.trim() && !!category && purpose.trim().length >= 3 && cents > 0;
  return <Modal title="Request Budget" onClose={onClose}>
    <div className="portal-form">
      <label>Payee or Supplier<input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. Office Warehouse" /></label>
      <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></label>
      <label className="full">Purpose<input value={purpose} maxLength={300} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Office supplies and courier for the week" /></label>
      <label>Amount Needed (PHP)<input className="cx-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
      <p className="portal-form-note full">Accounting approves it; the cash is then released as an advance. File the Liquidation Form with the receipts and the change once it is spent.</p>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={!ready} onClick={() => void post({ action: "budget-request", payee: payee.trim(), category, purpose: purpose.trim(), amountCentavos: cents }, "Budget request sent to Accounting.").then(onClose).catch(() => undefined)}>Send to Accounting</button></div>
    </div>
  </Modal>;
}

function RecordExpenseModal({ data, onClose, post, liquidate }: { data: PortalData; onClose: () => void; post: (body: Record<string, unknown>, ok?: string) => Promise<Record<string, unknown>>; liquidate?: ExpenseRow }) {
  // "Instructors" is always offered (owner, 19 Oct 2026), even before it is added in Configuration.
  const active = data.expenseCategories.filter((c) => c.active);
  const categories = active.some((c) => isInstructorCategory(c.name)) ? active : [...active, { id: "instructors", name: "Instructors", active: true }];
  const channels = expenseChannels(data);
  // Liquidation mode (owner, 10 Nov 2026): the budget's payee and category, its receipts and what was spent.
  const [payee, setPayee] = useState(liquidate?.payee ?? ""), [category, setCategory] = useState(liquidate?.category ?? categories[0]?.name ?? "");
  const advance = liquidate ? Number(liquidate.advance_centavos ?? liquidate.amount_centavos) : 0;
  const [channel, setChannel] = useState(channels[0] ?? "Cash"), [reference, setReference] = useState(""), [supporting, setSupporting] = useState("");
  // Voucher lines (Design 2): particulars, quantity and unit cost; the total is their sum.
  const [lines, setLines] = useState([{ description: "", quantity: "1", unit: "" }]);
  const setLine = (i: number, patch: Partial<{ description: string; quantity: string; unit: string }>) => setLines((all) => all.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const parsed = lines.map((l) => ({ description: l.description.trim(), quantity: Math.max(0, Math.floor(Number(l.quantity) || 0)), unitCentavos: toCentavos(l.unit) }));
  const filled = parsed.filter((l) => l.description || l.unitCentavos > 0);
  const total = filled.reduce((s, l) => s + l.quantity * l.unitCentavos, 0);
  const linesOk = filled.length > 0 && filled.every((l) => l.description && l.quantity > 0 && l.unitCentavos > 0);
  // Instructors: no line items, just the payee and one amount.
  const instructor = isInstructorCategory(category);
  const [amount, setAmount] = useState(""), [note, setNote] = useState("");
  const single = toCentavos(amount);
  // Receipt photos (owner, 19 Oct 2026): required; each is filed in Google Drive as soon as it is picked.
  const [receipts, setReceipts] = useState<(ReceiptFile & { key: string })[]>([]);
  const [uploading, setUploading] = useState<{ key: string; name: string; error?: string }[]>([]);
  async function attach(files: FileList | null) {
    for (const original of Array.from(files ?? []).slice(0, Math.max(0, 10 - receipts.length))) {
      const key = `${Date.now()}-${original.name}`;
      setUploading((u) => [...u, { key, name: original.name }]);
      try {
        const file = await shrinkPhoto(original);
        const form = new FormData(); form.set("file", file); form.set("payee", payee);
        const r = await fetch("/api/staff/expense-receipts", { method: "POST", body: form });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? "Could not upload the receipt.");
        setReceipts((all) => [...all, { ...(b as ReceiptFile), key }]);
        setUploading((u) => u.filter((x) => x.key !== key));
      } catch (e) {
        setUploading((u) => u.map((x) => (x.key === key ? { ...x, error: e instanceof Error ? e.message : "Could not upload the receipt." } : x)));
      }
    }
  }
  const ready = !!payee.trim() && !!category && (instructor ? single > 0 : linesOk && total > 0) && receipts.length > 0 && !uploading.some((u) => !u.error);
  const purpose = instructor ? (note.trim() || "Instructor's fee").slice(0, 300) : filled.map((l) => l.description).join("; ").slice(0, 300);
  const spent = instructor ? single : total;
  return <Modal title={liquidate ? `Liquidation Form · ${liquidate.voucher_number ?? liquidate.expense_number}` : "Record Expense"} onClose={onClose}>
    <div className="portal-form">
      {liquidate && <div className="full cx-liq"><div><span>Cash Advance</span><b className="cx-mono">{pesos(advance)}</b></div><div><span>Spent</span><b className="cx-mono">{pesos(spent)}</b></div><div className={advance - spent < 0 ? "due" : "ok"}><span>{advance - spent < 0 ? "To Reimburse" : "Change Returned"}</span><b className="cx-mono">{pesos(Math.abs(advance - spent))}</b></div></div>}
      <label>Payee<input value={payee} disabled={!!liquidate} onChange={(e) => setPayee(e.target.value)} /></label>
      <label>Category<select value={category} disabled={!!liquidate} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></label>
      {instructor ? <>
        <label>Amount (PHP)<input className="cx-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
        <label>Purpose<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Instructor's fee, BT-PSSR Oct 12" /></label>
      </> : <div className="full cx-lines">
        <div className="cx-lines-head"><span>Particulars</span><span>Qty</span><span>Unit Cost (PHP)</span><span>Amount</span><span /></div>
        {lines.map((l, i) => <div className="cx-lines-row" key={i}>
          <input aria-label={`Particulars, line ${i + 1}`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
          <input aria-label={`Quantity, line ${i + 1}`} className="cx-mono" inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, "") })} />
          <input aria-label={`Unit cost, line ${i + 1}`} className="cx-mono" inputMode="decimal" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
          <span className="cx-mono cx-lines-amt" data-l="Amount">{pesos(parsed[i].quantity * parsed[i].unitCentavos)}</span>
          <button type="button" className="portal-secondary cx-lines-x" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((all) => all.filter((_, k) => k !== i))}>Remove</button>
        </div>)}
        <div className="cx-lines-foot">
          <button type="button" className="portal-secondary" disabled={lines.length >= 10} onClick={() => setLines((all) => [...all, { description: "", quantity: "1", unit: "" }])}>Add Line</button>
          <span>Total <b className="cx-mono">{pesos(total)}</b></span>
        </div>
      </div>}
      <label>Payment Channel<select value={channel} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Receipt or Reference Number<input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
      <div className="full cx-receipts">
        <label className="cx-receipts-pick">Receipt Photos (Required)<input type="file" accept="image/*,application/pdf" multiple onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} disabled={receipts.length >= 10} /></label>
        {(receipts.length > 0 || uploading.length > 0) && <ul>
          {receipts.map((f) => <li key={f.key}><a href={f.link} target="_blank" rel="noreferrer">✓ {f.name}</a><button type="button" className="portal-secondary" onClick={() => setReceipts((all) => all.filter((x) => x.key !== f.key))}>Remove</button></li>)}
          {uploading.map((u) => <li key={u.key} className={u.error ? "err" : ""}><span>{u.error ? `${u.name}: ${u.error}` : `Uploading ${u.name}…`}</span>{u.error && <button type="button" className="portal-secondary" onClick={() => setUploading((all) => all.filter((x) => x.key !== u.key))}>Dismiss</button>}</li>)}
        </ul>}
        <small>A photo or screenshot of the receipt or bill, e.g. a Shopee order receipt. Saved in Google Drive for Accounting.</small>
      </div>
      <label className="full">Supporting Document (Optional Note)<input placeholder="e.g. Meralco bill and official receipt" value={supporting} onChange={(e) => setSupporting(e.target.value)} /></label>
      {!categories.length && <p className="portal-form-note full">Accounting adds expense categories in Configuration.</p>}
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button>{liquidate
        ? <button type="button" className="portal-primary" disabled={!ready} onClick={() => void post({ action: "expense-liquidate", id: liquidate.id, amountCentavos: spent, lines: instructor ? [] : filled, receiptFiles: receipts.map((f) => ({ fileId: f.fileId, link: f.link, name: f.name, mime: f.mime })), referenceNumber: reference.trim(), supportingDocument: supporting.trim() }, advance - spent >= 0 ? `Liquidated. Return the change of ${pesos(advance - spent)} to the drawer.` : `Liquidated. ${pesos(spent - advance)} is to be reimbursed.`).then(onClose).catch(() => undefined)}>Submit Liquidation</button>
        : <button type="button" className="portal-primary" disabled={!ready} onClick={() => void post({ action: "expense-create", payee: payee.trim(), category, amountCentavos: instructor ? single : total, purpose, lines: instructor ? [] : filled, receiptFiles: receipts.map((f) => ({ fileId: f.fileId, link: f.link, name: f.name, mime: f.mime })), paymentChannel: channel, referenceNumber: reference.trim(), supportingDocument: supporting.trim() }, "Expense recorded and sent for approval.").then(onClose).catch(() => undefined)}>Send for Approval</button>}</div>
    </div>
  </Modal>;
}

function ReleaseExpenseModal({ data, expense, onClose, post }: { data: PortalData; expense: ExpenseRow; onClose: () => void; post: (body: Record<string, unknown>, ok?: string) => Promise<Record<string, unknown>> }) {
  const channels = expenseChannels(data);
  const [channel, setChannel] = useState(expense.payment_channel && channels.includes(expense.payment_channel) ? expense.payment_channel : channels[0] ?? "Cash");
  const [reference, setReference] = useState(expense.reference_number ?? "");
  const needsRef = !!data.paymentMethods.find((m) => m.name === channel)?.requires_reference;
  return <Modal title={`Release ${expense.voucher_number ?? expense.expense_number}`} onClose={onClose}>
    <div className="portal-form">
      <div className="cx-whocard full"><div><span className="cx-name">{expense.payee}</span><small>{expense.category}</small></div><div className="cx-right"><span className="cx-amt">{pesos(expense.amount_centavos)}</span></div></div>
      <label>Released Through<select value={channel} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>{needsRef ? "Reference number (required)" : "Reference number"}<input className="cx-mono" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} /></label>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={needsRef && !reference.trim()} onClick={() => void post({ action: "expense-release", id: expense.id, paymentChannel: channel, referenceNumber: reference.trim() }, "Released and marked paid.").then(onClose).catch(() => undefined)}>Mark Released</button></div>
    </div>
  </Modal>;
}
