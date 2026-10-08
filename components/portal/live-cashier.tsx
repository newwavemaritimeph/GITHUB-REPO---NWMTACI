"use client";

import { useRef, useState } from "react";
import type { PortalData, Enrollment } from "../portal-live-app";
import { addDays, balanceOf, dueCentavos, first, manilaToday, pesos } from "@/lib/portal-format";
import { Badge, Message, Modal, PageHead, fullName, fmtDate, fmtClock, usePost, openAdmissionRecord, submit } from "./shared-ui";
import { unpaidAfterTraining, type BalanceEnrollment } from "@/lib/unpaid-balances";
import { RequestActionModal } from "./payment-actions";
import { requestFee } from "@/lib/request-fees";

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
    <PageHead eyebrow="Collections" title="For payment" text="Applicants registration has screened and handed over. Record their payment: once paid and on a batch they are enrolled automatically. Then print their training admission record." />
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
          <td>{paid > 0 ? <Badge tone="active">{e.batch_id ? "Paid · Enrolling" : "Paid · Awaiting batch"}</Badge> : <button type="button" className="portal-primary" onClick={() => onPay(e.id)}>Record payment</button>}</td>
        </tr>;
      })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">No applicants waiting for payment. Registration hands them over once their requirements are complete.</p>}</div>

    <section className="portal-panel live-list" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>Paid · Training admission record</h2><p>Enrolled trainees paid in the last 7 days. The TAR prints twice; more needs the accounting manager&apos;s approval.</p></div><span className="slot-count">{toPrint.length}</span></div>
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
  const ruled = feeForRequest(data, request);
  function choose(id: string) {
    setCatalogId(id);
    const item = catalog.find((c) => c.id === id);
    if (item) { setDescription(item.name); setAmount((Number(item.default_amount_centavos) / 100).toFixed(2)); setNoCharge(false); }
  }
  const send = () => void post(ruled ? { action: "request-charge", id: request.id, amountCentavos: ruled.amountCentavos, remarks: remarks.trim() || undefined } : { action: "request-charge", id: request.id, chargeCatalogId: noCharge ? null : catalogId || null, description: noCharge ? undefined : description || `${typeLabel} fee`, amountCentavos: noCharge ? 0 : centavos, remarks: remarks.trim() || undefined }, "Sent to the Accounting Manager for approval.").then(onClose).catch(() => undefined);
  return <Modal title={`Charges · ${request.request_number}`} onClose={onClose}>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      <div className="rate-preview full"><span>{typeLabel}</span><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "Trainee"}</strong><small>{e?.enrollment_number}{first(e?.courses)?.name ? ` · ${first(e?.courses)?.name}` : ""} · {request.reason}</small></div>
      {request.request_type === "Make-up Class" && <p className="portal-form-note full">Policy: Php 350.00 per make-up training day.</p>}
      {ruled ? <div className="rate-preview full"><span>Fee by policy</span><strong>{pesos(ruled.amountCentavos)}</strong><small>Requested {fmtDate(ruled.requestedOn)}{ruled.startDate ? ` · training starts ${fmtDate(ruled.startDate)}` : ""} · {ruled.rule}</small></div> : <>
      <label className="portal-check full"><input type="checkbox" checked={noCharge} onChange={(ev) => setNoCharge(ev.target.checked)} /><span>No charge for this request</span></label>
      {!noCharge && <>
        <label className="full">Charge<select value={catalogId} onChange={(ev) => choose(ev.target.value)}><option value="">Custom amount</option>{catalog.map((c) => <option key={c.id} value={c.id}>{c.name} · {pesos(c.default_amount_centavos)}</option>)}</select></label>
        <label>Description<input value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder={`${typeLabel} fee`} /></label>
        <label>Amount (PHP)<input type="number" min="0" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} /></label>
      </>}
      </>}
      <label className="full">Remarks (Optional)<input value={remarks} onChange={(ev) => setRemarks(ev.target.value)} placeholder="For the accounting manager" /></label>
      <p className="portal-form-note full">The charge is added to the trainee&apos;s balance only when the accounting manager approves the request.</p>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || (!ruled && !valid)} onClick={send}>{busy ? "Sending…" : "Send for approval"}</button></div>
    </div>
  </Modal>;
}

/* ====================================================== Cashier workspace (Oct 2026) */

const modeNames = (data: PortalData) => data.paymentMethods.filter((m) => m.active).map((m) => m.name);
const needsReference = (data: PortalData, method: string) => !!data.paymentMethods.find((m) => m.name === method)?.requires_reference;
const traineeName = (e: Enrollment) => { const t = first(e.trainees); return t ? fullName(t) : e.enrollment_number; };
const paidOf = (e: Enrollment) => Number(e.paid_centavos ?? 0);
const scheduleText = (e: Enrollment) => { const b = first(e.batches); return b ? `${fmtDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""}` : e.scheduled_on ? fmtDate(e.scheduled_on) : "No schedule yet"; };
const courseCode = (e: Enrollment) => first(e.courses)?.code ?? first(e.courses)?.name ?? "Course";
const toCentavos = (v: string) => { const n = Math.round(Number(String(v).replace(/,/g, "")) * 100); return Number.isFinite(n) && n > 0 ? n : 0; };
const MODE_COLORS: Record<string, string> = { Cash: "#0a7a3e", GCash: "#0571D0", PSBank: "#123F63", UnionBank: "#F25615" };

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
function CourseList({ list }: { list: Enrollment[] }) {
  return <div className="cx-courses">{list.map((e) => <div key={e.id}><span className="cx-code">{courseCode(e)}</span><small>{scheduleText(e)}</small></div>)}</div>;
}
const Who = ({ name, number }: { name: string; number?: string }) => <><span className="cx-name">{name}</span>{number ? <span className="cx-id">{number}</span> : null}</>;
const payState = (e: Enrollment) => (e.enrollment_status === "Cancelled" ? "Cancelled" : balanceOf(e) === 0 ? "Paid" : paidOf(e) > 0 ? "Partially paid" : "Unpaid");
const PAY_TONE: Record<string, string> = { Paid: "active", "Partially paid": "orange", Unpaid: "red", Cancelled: "cancelled" };

/**
 * Proofs go through the hosting platform, which refuses uploads over about
 * 4.5 MB. Photos and screenshots are scaled down to at most 2000 px and saved
 * as JPEG (stepping the quality down until under 3.5 MB); PDFs over the limit
 * are refused with a plain message.
 */
const PROOF_LIMIT = 3.5 * 1024 * 1024;
async function shrinkProof(file: File): Promise<File> {
  if (file.size <= PROOF_LIMIT && file.type !== "image/heic") return file;
  if (!file.type.startsWith("image/")) throw new Error("The PDF is too large. Use a PDF under 3.5 MB or a screenshot.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("This image type can't be read here. Save it as JPEG or PNG and try again."); });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= PROOF_LIMIT) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  }
  throw new Error("The image is still too large after shrinking. Crop it to the payment details and try again.");
}

type ExtraLine = { key: string; chargeCatalogId: string | null; description: string; unit: number; quantity: number; enrollmentId: string; kind: "item" | "fee" };

/**
 * Record payment for one trainee: the amount received is applied across their
 * unpaid courses (split), plus any miscellaneous charges sold at the counter.
 * One payment, one receipt. A reference is required for every mode except Cash.
 */
export function RecordPaymentModal({ data, initialEnrollmentId, initialAmountCentavos, onClose, onSaved }: { data: PortalData; initialEnrollmentId?: string; initialAmountCentavos?: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const initial = initialEnrollmentId ? data.enrollments.find((e) => e.id === initialEnrollmentId) : undefined;
  const [traineeId, setTraineeId] = useState(initial?.trainee_id ?? "");
  const [search, setSearch] = useState("");
  const modes = modeNames(data);
  const [method, setMethod] = useState(modes[0] ?? "Cash");
  const [reference, setReference] = useState("");
  // "Collect fee" from Requests opens with the request fee filled in.
  const preset = initialEnrollmentId && initialAmountCentavos ? (initialAmountCentavos / 100).toFixed(2) : "";
  const [received, setReceived] = useState(preset);
  const [amounts, setAmounts] = useState<Record<string, string>>(preset && initialEnrollmentId ? { [initialEnrollmentId]: preset } : {});
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const extraSeq = useRef(0);
  const [pick, setPick] = useState("");
  const [otherName, setOtherName] = useState("");
  const [otherAmount, setOtherAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [forEnrollment, setForEnrollment] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [remarks, setRemarks] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState<{ id: string; amount: number; drive: { link: string; path: string } | null } | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proof, setProof] = useState<{ id: string; link: string; path: string; duplicate: boolean } | null>(null);
  const [dupWarning, setDupWarning] = useState(false), [dupConfirmed, setDupConfirmed] = useState(false);

  const mine = data.enrollments.filter((e) => e.trainee_id === traineeId && e.enrollment_status !== "Cancelled");
  const open = mine.filter((e) => balanceOf(e) > 0);
  const catalog = data.charges.filter((c) => c.active);
  // Miscellaneous charges are only Uniform and Others (owner, 8 Oct 2026). Uniform's price comes from the schedule of fees, else ₱150.00.
  const uniform = catalog.find((c) => /uniform/i.test(c.name) && Number(c.default_amount_centavos) > 0);
  const uniformPrice = uniform ? Number(uniform.default_amount_centavos) : 15000;
  const term = search.trim().toLowerCase();
  const candidates = groupByTrainee(data, data.enrollments.filter((e) => e.enrollment_status !== "Cancelled"))
    .filter((g) => !term || `${g.name} ${g.number} ${g.enrollments.map((e) => `${courseCode(e)} ${e.enrollment_number}`).join(" ")}`.toLowerCase().includes(term))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name)).slice(0, 8);
  const group = traineeId ? groupByTrainee(data, mine)[0] : undefined;
  const applied = open.reduce((s, e) => s + Math.min(toCentavos(amounts[e.id] ?? ""), balanceOf(e)), 0);
  const extraTotal = extras.reduce((s, x) => s + x.unit * x.quantity, 0);
  const total = applied + extraTotal;
  const receivedCentavos = toCentavos(received);
  const over = open.some((e) => toCentavos(amounts[e.id] ?? "") > balanceOf(e));
  const refRequired = needsReference(data, method);
  const matches = receivedCentavos > 0 && receivedCentavos === total;
  const valid = total > 0 && !over && matches && (!refRequired || (reference.trim().length > 0 && (!!proofFile || !!proof)));

  function choose(id: string) { setTraineeId(id); setAmounts({}); setExtras([]); const firstOpen = data.enrollments.find((e) => e.trainee_id === id && e.enrollment_status !== "Cancelled"); setForEnrollment(firstOpen?.id ?? ""); if (!data.enrollments.some((e) => e.trainee_id === id && e.enrollment_status !== "Cancelled" && balanceOf(e) > 0)) setAddOpen(true); }
  function fill(how: "all" | "spread" | "clear") {
    if (how === "clear") { setAmounts({}); return; }
    if (how === "all") { setAmounts(Object.fromEntries(open.map((e) => [e.id, (balanceOf(e) / 100).toFixed(2)]))); setReceived(((open.reduce((s, e) => s + balanceOf(e), 0) + extraTotal) / 100).toFixed(2)); return; }
    let left = receivedCentavos - extraTotal;
    setAmounts(Object.fromEntries(open.map((e) => { const a = Math.max(0, Math.min(left, balanceOf(e))); left -= a; return [e.id, a > 0 ? (a / 100).toFixed(2) : ""]; })));
  }
  function addExtra() {
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const target = forEnrollment || mine[0]?.id;
    if (!target) return;
    let line: ExtraLine;
    if (pick === "uniform") {
      line = { key: `x${++extraSeq.current}`, chargeCatalogId: uniform?.id ?? null, description: "Uniform", unit: uniformPrice, quantity: qty, enrollmentId: target, kind: "item" };
    } else if (pick === "other") {
      const unit = toCentavos(otherAmount);
      if (!otherName.trim() || !unit) { setError("Enter the charge name and amount."); return; }
      line = { key: `x${++extraSeq.current}`, chargeCatalogId: null, description: otherName.trim(), unit, quantity: qty, enrollmentId: target, kind: "item" };
    } else {
      const c = catalog.find((x) => x.id === pick);
      if (!c || Number(c.default_amount_centavos) <= 0) { setError("Choose a charge with a price in the schedule of fees."); return; }
      line = { key: `x${++extraSeq.current}`, chargeCatalogId: c.id, description: c.name, unit: Number(c.default_amount_centavos), quantity: qty, enrollmentId: target, kind: (c.kind ?? "fee") === "item" ? "item" : "fee" };
    }
    setError(""); setExtras((cur) => [...cur, line]); setReceived(((receivedCentavos + line.unit * line.quantity) / 100).toFixed(2)); setQuantity("1"); setOtherName(""); setOtherAmount("");
  }
  function removeExtra(key: string) { const x = extras.find((l) => l.key === key); setExtras((cur) => cur.filter((l) => l.key !== key)); if (x) setReceived((Math.max(0, receivedCentavos - x.unit * x.quantity) / 100).toFixed(2)); }

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
      const allocations = open.map((e) => ({ enrollmentId: e.id, amountCentavos: Math.min(toCentavos(amounts[e.id] ?? ""), balanceOf(e)) })).filter((a) => a.amountCentavos > 0);
      const result = await submit({ action: "payment-split", allocations, items: extras.map((x) => ({ enrollmentId: x.enrollmentId, chargeCatalogId: x.chargeCatalogId, description: x.description, unitCentavos: x.unit, quantity: x.quantity })), method, receivingAccount: method === "Cash" ? "Main cashier" : method, referenceNumber: reference.trim(), receivedAt: new Date(receivedAt).toISOString(), remarks, proofId: filed?.id ?? null }) as { payment?: { id?: string } | string };
      if (agencyId) for (const a of allocations) { try { await submit({ action: "record-agency-rebate", enrollmentId: a.enrollmentId, agencyId }); } catch { /* the rebate never blocks the payment */ } }
      const paymentId = typeof result.payment === "string" ? result.payment : result.payment?.id ?? "";
      setPosted({ id: paymentId, amount: total, drive: filed ? { link: filed.link, path: filed.path } : null });
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not record the payment."); } finally { setBusy(false); }
  }

  if (posted && group) return <Modal title="Payment recorded" onClose={onClose}>
    <div className="portal-form">
      <div className="full"><Message kind="success" text={`${pesos(posted.amount)} received from ${group.name}.`} /></div>
      {posted.drive && <p className="portal-form-note full cx-drive">Saved to Google Drive · {posted.drive.path.split(" / ").slice(1).join(" / ")} {posted.drive.link && <a href={posted.drive.link} target="_blank" rel="noreferrer">Open</a>}</p>}
      <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
        {posted.id && <a className="portal-secondary" href={`/portal/payment-receipt/${posted.id}`} target="_blank" rel="noreferrer">Receipt</a>}
        <TarButton data={data} traineeId={group.traineeId} className="portal-secondary" />
      </div>
      <div className="portal-form-actions full"><button type="button" className="portal-primary" onClick={onClose}>Done</button></div>
    </div>
  </Modal>;

  return <Modal title="Record payment" onClose={onClose} wide>
    <div className="portal-form cx-pay">
      {error && <div className="full"><Message kind="error" text={error} /></div>}
      {!group ? <div className="full cx-pick">
        <label>Find trainee<input autoFocus value={search} onChange={(ev) => setSearch(ev.target.value)} placeholder="Name, NWMTACI number or course" /></label>
        <div className="cx-results">{candidates.map((g) => { const unpaid = g.enrollments.filter((e) => balanceOf(e) > 0); return <button type="button" key={g.traineeId} onClick={() => choose(g.traineeId)}><span><b>{g.name}</b><small>{unpaid.length ? unpaid.map(courseCode).join(" · ") : "All courses paid"}</small></span><strong className="cx-amt">{pesos(g.balance)}</strong></button>; })}
          {!candidates.length && <p className="portal-empty-copy">No trainee matches.</p>}</div>
      </div> : <>
        <div className="cx-whocard full"><div><Who name={group.name} number={group.number} /></div><div className="cx-right"><small>Balance</small><span className="cx-amt">{pesos(group.balance)}</span></div></div>
        <label>Amount received (PHP)<input className="cx-mono" inputMode="decimal" value={received} onChange={(ev) => setReceived(ev.target.value)} placeholder="0.00" /></label>
        <div><span className="pay-label">Apply the amount</span><div className="cx-choice"><button type="button" onClick={() => fill("all")}>Pay all in full</button><button type="button" onClick={() => fill("spread")}>Distribute in order</button><button type="button" onClick={() => fill("clear")}>Clear</button></div></div>
        <div className="cx-lines full"><table><thead><tr><th>Course or charge</th><th className="r">Balance</th><th className="r">Apply</th></tr></thead><tbody>
          {open.map((e) => { const v = amounts[e.id] ?? ""; const bad = toCentavos(v) > balanceOf(e); return <tr key={e.id} className={toCentavos(v) > 0 ? "sel" : ""}><td><span className="cx-code">{courseCode(e)}</span> <small>{first(e.courses)?.name} · {scheduleText(e)}</small></td><td className="r cx-amt">{pesos(balanceOf(e))}</td><td className="r"><input className="cx-apply" inputMode="decimal" value={v} placeholder="0.00" aria-label={`Amount for ${courseCode(e)}`} onChange={(ev) => setAmounts((cur) => ({ ...cur, [e.id]: ev.target.value }))} />{bad && <small className="cx-bad">More than the balance</small>}</td></tr>; })}
          {extras.map((x) => { const e = mine.find((m) => m.id === x.enrollmentId); return <tr key={x.key} className="misc"><td><span className="cx-code misc">{x.kind === "item" ? "Item" : "Fee"}</span> <strong>{x.description}</strong>{x.quantity > 1 ? ` x ${x.quantity}` : ""} <small>For {e ? courseCode(e) : "course"}</small></td><td className="r cx-amt">{pesos(x.unit * x.quantity)}</td><td className="r"><button type="button" className="ghost-button" onClick={() => removeExtra(x.key)}>Remove</button></td></tr>; })}
          {!open.length && !extras.length && <tr><td colSpan={3}><small>All courses are fully paid.</small></td></tr>}
        </tbody></table></div>
        <details className="cx-addbox full" open={addOpen} onToggle={(ev) => setAddOpen((ev.target as HTMLDetailsElement).open)}>
          <summary>Add miscellaneous charges</summary>
          <div className="portal-form">
            <label>Charge<select value={pick} onChange={(ev) => setPick(ev.target.value)}><option value="">Select a charge</option>
              <option value="uniform">Uniform · {pesos(uniformPrice)}</option>
              <option value="other">Others</option></select></label>
            <label>For course<select value={forEnrollment} onChange={(ev) => setForEnrollment(ev.target.value)}>{mine.map((e) => <option key={e.id} value={e.id}>{courseCode(e)} · {e.enrollment_number}</option>)}</select></label>
            {pick === "other" && <><label>What is it?<input value={otherName} onChange={(ev) => setOtherName(ev.target.value)} /></label><label>Amount (PHP)<input className="cx-mono" inputMode="decimal" value={otherAmount} onChange={(ev) => setOtherAmount(ev.target.value)} /></label></>}
            <label>Quantity<input className="cx-mono" inputMode="numeric" value={quantity} onChange={(ev) => setQuantity(ev.target.value)} /></label>
            <div className="cx-addbtn"><button type="button" className="portal-secondary" disabled={!pick} onClick={addExtra}>Add to payment</button></div>
          </div>
        </details>
        <div className={`cx-tally full ${matches ? "ok" : "no"}`}><span>Applied {pesos(total)} of {pesos(receivedCentavos)}</span><span>{!receivedCentavos ? "Enter the amount received" : matches ? "Ready to record" : total < receivedCentavos ? `${pesos(receivedCentavos - total)} not applied` : `${pesos(total - receivedCentavos)} over the amount received`}</span></div>
        <div className="full"><span className="pay-label">Mode of payment</span><div className="cx-choice" role="radiogroup" aria-label="Mode of payment">{modes.map((m) => <button type="button" role="radio" aria-checked={method === m} key={m} className={method === m ? "on" : ""} onClick={() => { setMethod(m); setProof(null); }}>{m}</button>)}</div></div>
        <label>{refRequired ? "Reference number (required)" : "Reference number"}<input className="cx-mono" value={reference} onChange={(ev) => setReference(ev.target.value.toUpperCase())} placeholder={refRequired ? `${method} reference` : "Not needed for cash"} /></label>
        {refRequired && <label>Proof of payment (required)<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(ev) => { setProofFile(ev.target.files?.[0] ?? null); setProof(null); setDupWarning(false); setDupConfirmed(false); }} />{proof ? <small className="portal-form-note">Saved to Google Drive · {proof.path.split(" / ").slice(1).join(" / ")}</small> : <small className="portal-form-note">Filed in Google Drive under {method} › this month as the trainee&apos;s last name and date.</small>}</label>}
        {dupWarning && <div className="full cx-dup"><Message kind="error" text={`Reference ${reference.trim()} was already used on another payment. Check the proof before recording it again.`} /><label className="portal-check"><input type="checkbox" checked={dupConfirmed} onChange={(ev) => setDupConfirmed(ev.target.checked)} /><span>I checked it; record this payment anyway</span></label></div>}
        <label>Received at<input type="datetime-local" value={receivedAt} onChange={(ev) => setReceivedAt(ev.target.value)} /></label>
        <label>Endorsing agency<select value={agencyId} onChange={(ev) => setAgencyId(ev.target.value)}><option value="">None</option>{data.agencies.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Remarks<input value={remarks} onChange={(ev) => setRemarks(ev.target.value)} /></label>
      </>}
      <div className="portal-form-actions full">{group && !initial && <button type="button" className="portal-secondary cx-left" onClick={() => { setTraineeId(""); setAmounts({}); setExtras([]); }}>Change trainee</button>}<button type="button" className="portal-secondary" onClick={onClose}>Cancel</button>{group && <button type="button" className="portal-primary" disabled={!valid || busy} onClick={() => void post()}>{busy ? "Recording…" : `Record ${receivedCentavos > 0 ? pesos(receivedCentavos) : "payment"}`}</button>}</div>
    </div>
  </Modal>;
}

/**
 * Cashier dashboard: today's collections by mode, new enrollments endorsed by
 * Registration (waiting for payment), trainees already paid and enrolled, and
 * balances still due after training (emailed daily at 4:00 PM).
 */
export function CashierDashboard({ data, onPay, reload }: { data: PortalData; onPay: (enrollmentId: string) => void; reload: () => Promise<void> }) {
  const today = manilaToday();
  const handed = data.handedToCashier ?? {};
  const todays = data.payments.filter((p) => day(p.received_at) === today);
  const totalToday = todays.reduce((s, p) => s + Number(p.amount_centavos), 0);
  const tileModes = [...new Set(["Cash", "GCash", "PSBank", "UnionBank", ...modeNames(data)])];
  // New enrollments: handed over by Registration, nothing paid yet, grouped by trainee.
  const awaiting = data.enrollments.filter((e) => e.enrollment_status === "Pending" && handed[e.id] && paidOf(e) === 0);
  const freshIds = new Set(awaiting.map((e) => e.trainee_id));
  const fresh = groupByTrainee(data, data.enrollments.filter((e) => freshIds.has(e.trainee_id) && e.enrollment_status !== "Cancelled" && (handed[e.id] || PAID_STATUSES.includes(e.enrollment_status))), (e) => handed[e.id] ?? e.created_at)
    .filter((g) => g.paid === 0).sort((a, b) => a.since.localeCompare(b.since));
  // Paid and enrolled: paid in the last 7 days.
  const since = addDays(today, -6);
  const paidRecently = new Set(data.payments.filter((p) => day(p.received_at) >= since).map((p) => p.trainee_id));
  const paid = groupByTrainee(data, data.enrollments.filter((e) => paidRecently.has(e.trainee_id) && e.enrollment_status !== "Cancelled" && paidOf(e) > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const durations = new Map(data.courses.map((c) => [c.id, c.duration_label]));
  const unpaid = unpaidAfterTraining(data.enrollments as unknown as BalanceEnrollment[], (id) => durations.get(id), today);
  const unpaidTotal = unpaid.reduce((s, r) => s + r.balanceCentavos, 0);
  const firstOpen = (g: TraineeGroup) => (g.enrollments.find((e) => balanceOf(e) > 0) ?? g.enrollments[0]).id;
  const { busy, msg, post } = usePost(reload);
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">{fmtDate(today)}</span><h1>Cashier dashboard</h1></div><button type="button" className="portal-primary" onClick={() => onPay("")}>Record payment</button></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cx-tiles">{tileModes.map((m) => { const list = todays.filter((p) => p.method === m); return <div className="cx-tile" key={m} style={{ ["--c" as string]: MODE_COLORS[m] ?? "#0571D0" }}><span>{m === "Cash" ? "Cash collected" : m}</span><b>{pesos(list.reduce((s, p) => s + Number(p.amount_centavos), 0))}</b><small>{list.length} receipt{list.length === 1 ? "" : "s"}</small></div>; })}</div>
    <div className="cx-totalbar"><div><span>Total collected today</span><b>{pesos(totalToday)}</b></div><div className="cx-stats"><div><b>{fresh.length}</b><small>New enrollments</small></div><div><b>{paid.length}</b><small>Paid and enrolled</small></div><div><b>{pesos(unpaidTotal)}</b><small>Unpaid after training</small></div></div></div>

    <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>New enrollments</h2></div><span className="slot-count">{fresh.length}</span></div>
      {fresh.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Trainee</th><th>Courses</th><th>Endorsed</th><th className="r">Total due</th><th></th></tr></thead><tbody>
        {fresh.map((g) => <tr key={g.traineeId}><td data-l="" className="lead"><Who name={g.name} number={g.number} /></td><td data-l="Courses"><CourseList list={g.enrollments} /></td><td data-l="Endorsed">{fmtDate(day(g.since))}<small>{fmtClock(g.since)}</small></td><td data-l="Total due" className="r"><strong className="cx-amt">{pesos(g.due)}</strong><small>{g.enrollments.length} course{g.enrollments.length === 1 ? "" : "s"}</small></td><td data-l=""><div className="cx-acts"><button type="button" className="portal-primary" onClick={() => onPay(firstOpen(g))}>Record payment</button></div></td></tr>)}
      </tbody></table></div> : <p className="portal-empty-copy">No new enrollments.</p>}
    </section>

    <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>Paid and enrolled</h2></div><span className="slot-count">{paid.length}</span></div>
      {paid.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Trainee</th><th>Courses</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th><th></th></tr></thead><tbody>
        {paid.map((g) => { const latest = data.payments.filter((p) => p.trainee_id === g.traineeId).sort((a, b) => b.received_at.localeCompare(a.received_at))[0]; return <tr key={g.traineeId}><td data-l="" className="lead"><Who name={g.name} number={g.number} /></td><td data-l="Courses"><CourseList list={g.enrollments} /></td><td data-l="Paid" className="r cx-amt">{pesos(g.paid)}</td><td data-l="Balance" className="r"><strong className="cx-amt">{pesos(g.balance)}</strong></td><td data-l="Status"><Badge tone={g.balance === 0 ? "active" : "orange"}>{g.balance === 0 ? "Paid" : "Partially paid"}</Badge></td><td data-l=""><div className="cx-acts">{g.balance > 0 && <button type="button" className="portal-secondary" onClick={() => onPay(firstOpen(g))}>Collect balance</button>}{latest && <a className="portal-secondary" href={`/portal/payment-receipt/${latest.id}`} target="_blank" rel="noreferrer">Receipt</a>}<TarButton data={data} traineeId={g.traineeId} reload={reload} className="portal-primary" /></div></td></tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">No paid trainees in the last 7 days.</p>}
    </section>

    <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>Unpaid balances · 4:00 PM summary</h2></div><span className="document-actions"><button type="button" className="portal-secondary" disabled={busy} onClick={() => void post({ action: "balance-summary-send" }, "Summary emailed.").catch(() => undefined)}>Email summary now</button></span></div>
      {unpaid.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Trainee</th><th>Training</th><th>Status</th><th className="r">Balance</th><th></th></tr></thead><tbody>
        {unpaid.map((r) => <tr key={r.id}><td data-l="" className="lead"><span className="cx-name">{r.traineeName}</span><span className="cx-id">{r.enrollmentNumber}</span></td><td data-l="Training">{r.course}<small>{r.endsToday ? "Ends today" : `Ended ${fmtDate(r.trainingEnd)}`}</small></td><td data-l="Status">{r.endsToday ? <Badge tone="orange">Ends today</Badge> : <Badge tone="cancelled">Past due</Badge>}</td><td data-l="Balance" className="r"><strong className="cx-amt">{pesos(r.balanceCentavos)}</strong><small>of {pesos(r.dueCentavos)}</small></td><td data-l=""><div className="cx-acts"><button type="button" className="portal-primary" onClick={() => onPay(r.id)}>Record payment</button></div></td></tr>)}
      </tbody></table></div> : <p className="portal-empty-copy">No unpaid balances after training.</p>}
    </section>
  </div>;
}

const RANGES = ["Today", "This week", "This month", "Custom"] as const;
/** Payment records: every payment with mode, reference and receipt, by date range. */
export function CashierPayments({ data, onPay }: { data: PortalData; onPay: (enrollmentId: string) => void }) {
  const today = manilaToday();
  const [range, setRange] = useState<(typeof RANGES)[number]>("Today");
  const [from, setFrom] = useState(today), [to, setTo] = useState(today);
  const [mode, setMode] = useState("");
  const [q, setQ] = useState("");
  const start = range === "Today" ? today : range === "This week" ? addDays(today, -6) : range === "This month" ? `${today.slice(0, 8)}01` : from;
  const end = range === "Custom" ? to : today;
  const term = q.trim().toLowerCase();
  const rows = data.payments.filter((p) => { const d = day(p.received_at); const t = first(p.trainees); return d >= start && d <= end && (!mode || p.method === mode) && (!term || `${p.payment_number} ${p.reference_number ?? ""} ${t ? `${t.legal_first_name} ${t.legal_last_name}` : ""}`.toLowerCase().includes(term)); })
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  const byMode = new Map<string, number>();
  for (const p of rows) byMode.set(p.method, (byMode.get(p.method) ?? 0) + Number(p.amount_centavos));
  const total = rows.reduce((s, p) => s + Number(p.amount_centavos), 0);
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Payments</h1></div><button type="button" className="portal-primary" onClick={() => onPay("")}>Record payment</button></div>
    <div className="cx-bar"><div className="cx-seg">{RANGES.map((r) => <button key={r} type="button" className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}</div>
      {range === "Custom" && <><label className="cx-dt">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label className="cx-dt">To<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label></>}
      <label className="cx-dt">Mode<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All modes</option>{[...new Set([...modeNames(data), ...data.payments.map((p) => p.method)])].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      <input className="cx-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, receipt or reference" aria-label="Search payments" />
    </div>
    <div className="cx-tiles">{[["Total", total, rows.length] as const, ...[...byMode.entries()].map(([m, v]) => [m, v, rows.filter((p) => p.method === m).length] as const)].map(([m, v, n]) => <div className="cx-tile" key={m} style={{ ["--c" as string]: MODE_COLORS[m] ?? "#123F63" }}><span>{m}</span><b>{pesos(v)}</b><small>{n} receipt{n === 1 ? "" : "s"}</small></div>)}</div>
    <section className="portal-panel cx-panel">{rows.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Receipt</th><th>Trainee</th><th>Mode</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead><tbody>
      {rows.map((p) => { const t = first(p.trainees); return <tr key={p.id}><td data-l="" className="lead"><span className="cx-name cx-mono">{p.payment_number}</span><small>{fmtDate(day(p.received_at))} · {fmtClock(p.received_at)}</small></td><td data-l="Trainee">{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</td><td data-l="Mode">{p.method}{p.reference_number ? <small className="cx-mono">{p.reference_number}</small> : null}</td><td data-l="Status"><Badge tone={p.verification_state === "Verified" ? "active" : "orange"}>{p.verification_state === "Duplicate Review" ? "Duplicate reference" : p.verification_state}</Badge></td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos(p.amount_centavos)}</strong></td><td data-l=""><div className="cx-acts"><a className="portal-secondary" href={`/portal/payment-receipt/${p.id}`} target="_blank" rel="noreferrer">Receipt</a></div></td></tr>; })}
    </tbody></table></div> : <p className="portal-empty-copy">No payments in this range.</p>}</section>
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
  const file = () => void post({ action: "discount-request", enrollmentId, amountCentavos: centavos, description: reason.trim() || undefined, agencyId: agencyId || null }, "Discount request sent for approval.").then(() => { setEnrollmentId(""); setAmount(""); setReason(""); setAgencyId(""); }).catch(() => undefined);
  const enrollmentOf = (id: string) => data.enrollments.find((x) => x.id === id);
  return <div className="cx-stack">
    <section className="portal-panel cx-panel">
      <div className="panel-heading"><div><h2>New discount request</h2></div></div>
      {msg && <Message kind={msg.kind} text={msg.text} />}
      <div className="portal-form cx-formpad">
        <label className="full">Enrollment<select value={enrollmentId} onChange={(ev) => setEnrollmentId(ev.target.value)}><option value="">Select a trainee with a balance</option>{open.map((x) => <option key={x.id} value={x.id}>{traineeName(x)} · {x.enrollment_number} · {courseCode(x)} · {pesos(balanceOf(x))}</option>)}</select></label>
        <label>Endorsing agency<select value={agencyId} onChange={(ev) => setAgencyId(ev.target.value)}><option value="">None</option>{data.agencies.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Discount amount (PHP){rebate != null ? <input value={(rebate / 100).toFixed(2)} readOnly /> : <input type="number" min="0.01" step="0.01" value={amount} onChange={(ev) => setAmount(ev.target.value)} />}</label>
        <label className="full">Reason<input value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>
        <div className="portal-form-actions full"><button type="button" className="portal-primary" disabled={busy || !e || centavos <= 0 || (e && centavos > balanceOf(e))} onClick={file}>{busy ? "Sending…" : "Request discount"}</button></div>
      </div>
    </section>
    <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>For approval</h2></div><span className="slot-count">{data.pendingDiscounts.length}</span></div>
      {data.pendingDiscounts.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Trainee</th><th>Reason</th><th>Filed</th><th className="r">Discount</th></tr></thead><tbody>
        {data.pendingDiscounts.map((d) => { const x = enrollmentOf(d.enrollment_id); return <tr key={d.id}><td data-l="" className="lead"><span className="cx-name">{x ? traineeName(x) : "Enrollment"}</span><span className="cx-id">{x?.enrollment_number}</span></td><td data-l="Reason">{d.description}</td><td data-l="Filed">{fmtDate(day(d.created_at))}</td><td data-l="Discount" className="r cx-amt">{pesos(d.amount_centavos)}</td></tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">No discount requests for approval.</p>}
    </section>
  </div>;
}

const STATUS_ORDER = ["Unpaid", "Partially paid", "Paid", "Cancelled"] as const;
/** Every enrollment with its payment status, filtered by status and enrolled date. */
export function CashierEnrollments({ data, onPay, reload }: { data: PortalData; onPay: (enrollmentId: string) => void; reload: () => Promise<void> }) {
  const today = manilaToday();
  const [filter, setFilter] = useState<"All" | (typeof STATUS_ORDER)[number]>("All");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`), [to, setTo] = useState(today);
  const dateOf = (e: Enrollment) => day(e.enrolled_at ?? e.created_at);
  const term = q.trim().toLowerCase();
  const base = data.enrollments.filter((e) => { const d = dateOf(e); return (!from || d >= from) && (!to || d <= to) && (!term || `${traineeName(e)} ${e.enrollment_number} ${first(e.courses)?.name ?? ""} ${courseCode(e)} ${data.applicationNumbers?.[e.trainee_id] ?? ""}`.toLowerCase().includes(term)); });
  const rows = base.filter((e) => filter === "All" || payState(e) === filter)
    .sort((a, b) => STATUS_ORDER.indexOf(payState(a) as (typeof STATUS_ORDER)[number]) - STATUS_ORDER.indexOf(payState(b) as (typeof STATUS_ORDER)[number]) || dateOf(b).localeCompare(dateOf(a))).slice(0, 300);
  const count = (f: string) => base.filter((e) => f === "All" || payState(e) === f).length;
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Enrollments</span><h1>Search trainee</h1></div></div>
    <div className="cx-status" role="tablist">{(["All", ...STATUS_ORDER] as const).map((f) => <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}<span>{count(f)}</span></button>)}</div>
    <div className="cx-bar"><input className="cx-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, NWMTACI number or course" aria-label="Search enrollments" />
      <label className="cx-dt">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="cx-dt">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
      {(from || to) && <button type="button" className="ghost-button" onClick={() => { setFrom(""); setTo(""); }}>Clear dates</button>}
    </div>
    <section className="portal-panel cx-panel">{rows.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Trainee</th><th>Enrolled</th><th>Course</th><th className="r">Total due</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th><th></th></tr></thead><tbody>
      {rows.map((e) => { const st = payState(e); return <tr key={e.id}><td data-l="" className="lead"><Who name={traineeName(e)} number={data.applicationNumbers?.[e.trainee_id] ?? first(e.trainees)?.trainee_number} /></td><td data-l="Enrolled">{fmtDate(dateOf(e))}</td><td data-l="Course"><span className="cx-code">{courseCode(e)}</span><small>{scheduleText(e)}</small></td><td data-l="Total due" className="r cx-amt">{pesos(dueCentavos(e))}</td><td data-l="Paid" className="r cx-amt">{pesos(paidOf(e))}</td><td data-l="Balance" className="r"><strong className="cx-amt">{pesos(e.enrollment_status === "Cancelled" ? 0 : balanceOf(e))}</strong></td><td data-l="Status"><Badge tone={PAY_TONE[st]}>{st}</Badge></td><td data-l=""><div className="cx-acts">{st !== "Paid" && st !== "Cancelled" && <button type="button" className="portal-primary" onClick={() => onPay(e.id)}>Record payment</button>}{st !== "Unpaid" && st !== "Cancelled" && <TarButton data={data} traineeId={e.trainee_id} reload={reload} />}</div></td></tr>; })}
    </tbody></table></div> : <p className="portal-empty-copy">No enrollments match these filters.</p>}</section>
  </div>;
}

/** The schedule of fees: miscellaneous items sold at the counter and service fees for change requests. */
export function ScheduleOfFees({ data }: { data: PortalData }) {
  const active = data.charges.filter((c) => c.active);
  const group = (kind: "item" | "fee", title: string) => { const list = active.filter((c) => ((c.kind ?? "fee") === "item" ? "item" : "fee") === kind); return <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>{title}</h2></div><span className="slot-count">{list.length}</span></div>
    {list.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Name</th><th className="r">Price</th></tr></thead><tbody>{list.map((c) => <tr key={c.id}><td data-l="" className="lead"><span className="cx-name">{c.name}</span></td><td data-l="Price" className="r"><strong className="cx-amt">{Number(c.default_amount_centavos) > 0 ? pesos(c.default_amount_centavos) : "Set by the Cashier"}</strong></td></tr>)}</tbody></table></div> : <p className="portal-empty-copy">None yet.</p>}</section>; };
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Schedule of fees</h1></div></div>
    {group("item", "Miscellaneous items")}
    {group("fee", "Service fees")}
  </div>;
}

/** TAR reprint requests and their approval status. */
export function TarReprints({ data }: { data: PortalData }) {
  const rows = data.requests.filter((r) => r.request_type === "TAR reprint").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const stageOf = (r: RequestRow) => (r.status !== "Pending" ? r.status : r.stage === "With cashier" ? "Add charge" : "For approval");
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Requests</span><h1>TAR reprints</h1></div></div>
    <section className="portal-panel cx-panel">{rows.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Request</th><th>Trainee</th><th>Reason</th><th>Status</th></tr></thead><tbody>
      {rows.map((r) => { const t = first(r.trainees); const st = stageOf(r); return <tr key={r.id}><td data-l="" className="lead"><span className="cx-name cx-mono">{r.request_number}</span><small>{fmtDate(day(r.created_at))}</small></td><td data-l="Trainee">{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</td><td data-l="Reason">{r.reason}</td><td data-l="Status"><Badge tone={st === "Approved" ? "active" : st === "Rejected" ? "cancelled" : "orange"}>{st}</Badge></td></tr>; })}
    </tbody></table></div> : <p className="portal-empty-copy">No TAR reprint requests.</p>}</section>
  </div>;
}

/** Start-of-day opening cash, recorded once per day; the closing below starts from it. */
export function CashierOpening({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const today = manilaToday();
  const opening = (data.cashierOpenings ?? []).find((o) => o.opening_date === today);
  const { busy, msg, post } = usePost(reload);
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  return <section className="portal-panel cx-panel">
    <div className="panel-heading"><div><h2>Opening</h2></div>{opening && <Badge tone="active">Recorded</Badge>}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {opening ? <dl className="cx-sum"><div><dt>Opening cash</dt><dd>{pesos(opening.opening_cash_centavos)}</dd></div><div><dt>Recorded at</dt><dd>{fmtClock(opening.created_at)}</dd></div>{opening.remarks && <div><dt>Remarks</dt><dd>{opening.remarks}</dd></div>}</dl>
      : <div className="portal-form cx-formpad">
        <label>Opening cash (PHP)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Remarks<input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
        <div className="portal-form-actions full"><button type="button" className="portal-primary" disabled={busy || amount === ""} onClick={() => void post({ action: "cashier-open", openingCashCentavos: Math.round(Number(amount) * 100), remarks: remarks.trim() || undefined }, "Opening recorded.").catch(() => undefined)}>{busy ? "Saving…" : "Record opening"}</button></div>
      </div>}
  </section>;
}

/** Summary report: collections by mode, expenses, net cash, the cash drawer and balances due after training. */
export function CashierSummaryReport({ data, embedded }: { data: PortalData; embedded?: boolean }) {
  const today = manilaToday();
  const [range, setRange] = useState<(typeof RANGES)[number]>("Today");
  const [from, setFrom] = useState(today), [to, setTo] = useState(today);
  const start = range === "Today" ? today : range === "This week" ? addDays(today, -6) : range === "This month" ? `${today.slice(0, 8)}01` : from;
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
  return <div className={embedded ? "" : "portal-page cx"}>
    {!embedded && <div className="cx-head"><div><span className="portal-eyebrow">{singleDay ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`}</span><h1>Summary report</h1></div></div>}
    <div className="cx-bar"><div className="cx-seg">{RANGES.map((r) => <button key={r} type="button" className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}</div>
      {range === "Custom" && <><label className="cx-dt">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label className="cx-dt">To<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label></>}</div>
    <div className="cx-tiles">
      <div className="cx-tile" style={{ ["--c" as string]: "#0571D0" }}><span>Collections</span><b>{pesos(collected)}</b><small>{payments.length} receipt{payments.length === 1 ? "" : "s"}</small></div>
      <div className="cx-tile" style={{ ["--c" as string]: "#F25615" }}><span>Expenses</span><b>{pesos(expenseTotal)}</b><small>{expenses.length} voucher{expenses.length === 1 ? "" : "s"}</small></div>
      <div className="cx-tile" style={{ ["--c" as string]: "#0a7a3e" }}><span>Net</span><b>{pesos(collected - expenseTotal)}</b></div>
      <div className="cx-tile" style={{ ["--c" as string]: "#b42318" }}><span>Unpaid after training</span><b>{pesos(unpaidTotal)}</b><small>{unpaid.length} trainee{unpaid.length === 1 ? "" : "s"}</small></div>
    </div>
    <div className="cx-two">
      <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>Collections by mode</h2></div></div>
        <div className="portal-table"><table><thead><tr><th>Mode</th><th className="r">Receipts</th><th className="r">Total</th></tr></thead><tbody>{byMode.map((m) => <tr key={m.mode}><td>{m.mode}</td><td className="r cx-mono">{m.count}</td><td className="r cx-amt">{pesos(m.total)}</td></tr>)}<tr><td><strong>Total</strong></td><td className="r cx-mono"><strong>{payments.length}</strong></td><td className="r cx-amt"><strong>{pesos(collected)}</strong></td></tr></tbody></table></div>
      </section>
      <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>Cash drawer</h2></div></div>
        {singleDay ? <dl className="cx-sum">
          <div><dt>Opening cash</dt><dd>{opening == null ? "Not recorded" : pesos(opening)}</dd></div>
          <div><dt>Cash received</dt><dd>+{pesos(cashIn)}</dd></div>
          <div><dt>Expenses paid</dt><dd>−{pesos(expenseTotal)}</dd></div>
          <div className="big"><dt>Expected cash</dt><dd>{pesos((opening ?? 0) + cashIn - expenseTotal)}</dd></div>
          <div><dt>Closing</dt><dd>{closing ? `${pesos(Number(closing.actual_cash_centavos ?? 0))} counted · variance ${pesos(Number(closing.variance_centavos ?? 0))}` : "Not yet closed"}</dd></div>
        </dl> : <p className="portal-empty-copy">Choose a single day.</p>}
      </section>
    </div>
    <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>Expenses</h2></div></div>
      {expenses.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Voucher</th><th>Payee</th><th>Purpose</th><th>Status</th><th className="r">Amount</th></tr></thead><tbody>{expenses.map((x) => <tr key={x.id}><td data-l="" className="lead"><span className="cx-name cx-mono">{x.expense_number}</span></td><td data-l="Payee">{x.payee}</td><td data-l="Purpose">{(x as { purpose?: string }).purpose ?? ""}</td><td data-l="Status">{x.status}</td><td data-l="Amount" className="r cx-amt">{pesos(x.amount_centavos)}</td></tr>)}</tbody></table></div> : <p className="portal-empty-copy">No expenses in this period.</p>}
    </section>
  </div>;
}

/* ====================================================== Expenses (Oct 2026) */

type ExpenseRow = PortalData["expenses"][number] & { purpose?: string; payment_channel?: string | null; reference_number?: string | null; request_number?: string | null; voucher_number?: string | null; approved_at?: string | null; decision_remarks?: string | null; released_at?: string | null; paid_at?: string | null; drive_link?: string | null; print_count?: number | null; reprints_approved?: number | null };
type ReprintRow = NonNullable<PortalData["expenseReprints"]>[number];
export const EXPENSE_STATUSES = ["All", "For approval", "Approved", "Released", "Rejected"] as const;
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
 * Accounting Manager's approval. "print" = can print now, "request" = used up,
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
const EXPENSE_TONE: Record<string, string> = { "For approval": "orange", Approved: "blue", Released: "active", Rejected: "cancelled" };

/** Print voucher, or the reprint step it needs (request, waiting, refused). */
function VoucherPrint({ e, reprints, onRequest, reload }: { e: ExpenseRow; reprints: ReprintRow[]; onRequest: (e: ExpenseRow) => void; reload: () => Promise<void> }) {
  const p = voucherPrintState(e, reprints);
  if (p.state === "print") return <a className="portal-secondary" href={`/api/documents/expense/${e.id}`} target="_blank" rel="noreferrer" onClick={() => window.setTimeout(() => void reload(), 2500)}>{p.used ? "Print reprint" : "Print voucher"}</a>;
  if (p.state === "pending") return <span className="cx-chip">Reprint awaiting approval</span>;
  return <button type="button" className="portal-secondary" onClick={() => onRequest(e)}>{p.state === "rejected" ? "Request reprint again" : "Request reprint"}</button>;
}

/**
 * Expenses (owner, 7–8 Oct 2026). Expenses: the Cashier records an expense
 * (ER-…), the Accounting Manager approves it (CV-…), the Cashier prints the
 * voucher once and marks it released; a dashboard per payment channel with a
 * summary PDF. Vouchers: every voucher filed by month, with file copies,
 * prints and reprint requests (approved by the Accounting Manager).
 */
export function ExpensesWorkspace({ data, role, reload }: { data: PortalData; role: string; reload: () => Promise<void> }) {
  const today = manilaToday();
  const canDecide = role === "accounting" || role === "admin";
  const isManager = role === "accounting";
  const [view, setView] = useState<"Expenses" | "Vouchers">("Expenses");
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`), [to, setTo] = useState(today);
  const [tab, setTab] = useState<(typeof EXPENSE_STATUSES)[number]>(canDecide ? "For approval" : "All");
  const [recording, setRecording] = useState(false);
  const [releasing, setReleasing] = useState<ExpenseRow | null>(null);
  const [rejecting, setRejecting] = useState<ExpenseRow | null>(null);
  const [reprinting, setReprinting] = useState<ExpenseRow | null>(null);
  const [deciding, setDeciding] = useState<ReprintRow | null>(null);
  const [reason, setReason] = useState("");
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { busy, msg, post } = usePost(reload);
  const reprints = data.expenseReprints ?? [];
  const rows = (data.expenses as ExpenseRow[]).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byId = new Map(rows.map((e) => [e.id, e]));
  const inRange = rows.filter((e) => { const d = day(e.created_at); return (!from || d >= from) && (!to || d <= to); });
  const shown = inRange.filter((e) => tab === "All" || expenseState(e) === tab);
  const channels = expenseTotalsByChannel(rows, from, to);
  const total = channels.reduce((s, c) => s + c.total, 0), vouchers = channels.reduce((s, c) => s + c.count, 0);
  const count = (t: string) => inRange.filter((e) => t === "All" || expenseState(e) === t).length;
  const months = vouchersByMonth(rows);
  const thisMonth = today.slice(0, 7);
  const monthsShown = month ? months.filter((m) => m.month === month) : months;
  const pendingReprints = reprints.filter((r) => r.status === "Pending");
  const approve = (e: ExpenseRow) => void post({ action: "expense-decide", id: e.id, decision: "Approved" }, "Approved. The voucher number is issued and the voucher is filed in Google Drive.").catch(() => undefined);
  const reject = () => { if (!rejecting) return; void post({ action: "expense-decide", id: rejecting.id, decision: "Rejected", remarks: reason.trim() || undefined }, "Rejected.").then(() => { setRejecting(null); setReason(""); }).catch(() => undefined); };
  const requestReprint = () => { if (!reprinting) return; void post({ action: "expense-reprint-request", id: reprinting.id, reason: reason.trim() }, "Reprint request sent to the Accounting Manager.").then(() => { setReprinting(null); setReason(""); }).catch(() => undefined); };
  const decideReprint = (r: ReprintRow, decision: "Approved" | "Rejected", remarks?: string) => void post({ action: "expense-reprint-decide", requestId: r.id, decision, remarks }, decision === "Approved" ? "Reprint approved. The voucher can be printed once more." : "Reprint request rejected.").then(() => { setDeciding(null); setReason(""); }).catch(() => undefined);
  const printCell = (e: ExpenseRow) => <VoucherPrint e={e} reprints={reprints} onRequest={(x) => { setReprinting(x); setReason(""); }} reload={reload} />;

  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Expenses</h1></div><button type="button" className="portal-primary" onClick={() => setRecording(true)}>Record expense</button></div>
    <div className="cx-status cx-views" role="tablist">{(["Expenses", "Vouchers"] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v}{v === "Vouchers" && pendingReprints.length ? <span>{pendingReprints.length}</span> : null}</button>)}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}

    {view === "Expenses" && <>
      <div className="cx-bar">
        <label className="cx-dt">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="cx-dt">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        {from && to && <a className="portal-secondary" href={`/api/documents/expenses-summary?from=${from}&to=${to}`} target="_blank" rel="noreferrer">Generate summary (PDF)</a>}
      </div>
      <div className="cx-tiles">
        <div className="cx-tile" style={{ ["--c" as string]: "#123F63" }}><span>Total expenses</span><b>{pesos(total)}</b><small>{vouchers} voucher{vouchers === 1 ? "" : "s"}</small></div>
        {channels.map((c) => <div className="cx-tile" key={c.channel} style={{ ["--c" as string]: MODE_COLORS[c.channel] ?? "#0571D0" }}><span>{c.channel}</span><b>{pesos(c.total)}</b><small>{c.count} voucher{c.count === 1 ? "" : "s"}</small></div>)}
      </div>
      <div className="cx-status" role="tablist">{EXPENSE_STATUSES.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}<span>{count(t)}</span></button>)}</div>
      <section className="portal-panel cx-panel">{shown.length ? <div className="portal-table cx-cards"><table><thead><tr><th>Number</th><th>Payee</th><th>Category</th><th>Channel</th><th className="r">Amount</th><th>Status</th><th></th></tr></thead><tbody>
        {shown.map((e) => { const st = expenseState(e); return <tr key={e.id}>
          <td data-l="" className="lead"><span className="cx-name cx-mono">{e.voucher_number ?? e.expense_number}</span><small>{e.voucher_number && e.request_number && e.request_number !== e.voucher_number ? `${e.request_number} · ` : ""}{fmtDate(day(e.created_at))}</small></td>
          <td data-l="Payee">{e.payee}<small>{e.purpose}</small></td>
          <td data-l="Category">{e.category}</td>
          <td data-l="Channel">{e.payment_channel || "—"}{e.reference_number ? <small className="cx-mono">{e.reference_number}</small> : null}</td>
          <td data-l="Amount" className="r"><strong className="cx-amt">{pesos(e.amount_centavos)}</strong></td>
          <td data-l="Status"><Badge tone={EXPENSE_TONE[st]}>{st}</Badge>{st === "Rejected" && e.decision_remarks ? <small>{e.decision_remarks}</small> : null}{st === "Released" && e.released_at ? <small>{fmtDate(day(e.released_at))}</small> : null}</td>
          <td data-l=""><div className="cx-acts">
            {st === "For approval" && canDecide && <><button type="button" className="portal-primary" disabled={busy} onClick={() => approve(e)}>Approve</button><button type="button" className="portal-secondary" disabled={busy} onClick={() => { setRejecting(e); setReason(""); }}>Reject</button></>}
            {(st === "Approved" || st === "Released") && printCell(e)}
            {st === "Approved" && <button type="button" className="portal-primary" onClick={() => setReleasing(e)}>Mark released</button>}
            {e.drive_link && <a className="ghost-button" href={e.drive_link} target="_blank" rel="noreferrer">Drive</a>}
          </div></td>
        </tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">No expenses in this view.</p>}</section>
    </>}

    {view === "Vouchers" && <>
      {pendingReprints.length > 0 && <section className="portal-panel cx-panel">
        <div className="panel-heading"><h2>Reprint requests</h2></div>
        <div className="portal-table cx-cards"><table><thead><tr><th>Voucher</th><th>Reason</th><th>Requested by</th><th></th></tr></thead><tbody>
          {pendingReprints.map((r) => { const e = byId.get(r.expense_id); return <tr key={r.id}>
            <td data-l="" className="lead"><span className="cx-name cx-mono">{e?.voucher_number ?? e?.expense_number ?? "—"}</span><small>{e ? `${e.payee} · ${pesos(e.amount_centavos)}` : ""}</small></td>
            <td data-l="Reason">{r.reason}</td>
            <td data-l="Requested by">{r.requested_by_name ?? "—"}<small>{fmtDate(day(r.requested_at))}</small></td>
            <td data-l=""><div className="cx-acts">{isManager
              ? <><button type="button" className="portal-primary" disabled={busy} onClick={() => decideReprint(r, "Approved")}>Approve reprint</button><button type="button" className="portal-secondary" disabled={busy} onClick={() => { setDeciding(r); setReason(""); }}>Reject</button></>
              : <span className="cx-chip">Waiting for the Accounting Manager</span>}</div></td>
          </tr>; })}
        </tbody></table></div>
      </section>}
      <div className="cx-bar">
        <label className="cx-dt">Month<select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">All months</option>{months.map((m) => <option key={m.month} value={m.month}>{m.label}</option>)}</select></label>
      </div>
      {monthsShown.length ? monthsShown.map((m) => { const isOpen = open[m.month] ?? (month ? true : m.month === thisMonth || m.month === months[0]?.month); return <section className="portal-panel cx-panel cx-month" key={m.month}>
        <button type="button" className="cx-month-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [m.month]: !isOpen }))}>
          <span className="cx-month-name">{m.label}</span><span className="cx-month-meta">{m.rows.length} voucher{m.rows.length === 1 ? "" : "s"}</span><b className="cx-mono">{pesos(m.total)}</b><span aria-hidden="true" className="cx-month-caret">{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen && <div className="portal-table cx-cards"><table><thead><tr><th>Voucher</th><th>Payee</th><th>Category</th><th>Channel</th><th className="r">Amount</th><th>Status</th><th>Prints</th><th></th></tr></thead><tbody>
          {m.rows.map((e) => { const st = expenseState(e), p = voucherPrintState(e, reprints); return <tr key={e.id}>
            <td data-l="" className="lead"><span className="cx-name cx-mono">{e.voucher_number ?? e.expense_number}</span><small>{fmtDate(day(e.approved_at ?? e.created_at))}</small></td>
            <td data-l="Payee">{e.payee}</td>
            <td data-l="Category">{e.category}</td>
            <td data-l="Channel">{e.payment_channel || "—"}</td>
            <td data-l="Amount" className="r"><strong className="cx-amt">{pesos(e.amount_centavos)}</strong></td>
            <td data-l="Status"><Badge tone={EXPENSE_TONE[st]}>{st}</Badge></td>
            <td data-l="Prints">{p.used} of {p.allowed}</td>
            <td data-l=""><div className="cx-acts">
              <a className="ghost-button" href={`/api/documents/expense/${e.id}?copy=1`} target="_blank" rel="noreferrer">View</a>
              {printCell(e)}
              {e.drive_link && <a className="ghost-button" href={e.drive_link} target="_blank" rel="noreferrer">Drive</a>}
            </div></td>
          </tr>; })}
        </tbody></table></div>}
      </section>; }) : <section className="portal-panel cx-panel"><p className="portal-empty-copy">No vouchers yet. A voucher is issued when the Accounting Manager approves an expense.</p></section>}
    </>}

    {recording && <RecordExpenseModal data={data} onClose={() => setRecording(false)} post={post} />}
    {releasing && <ReleaseExpenseModal data={data} expense={releasing} onClose={() => setReleasing(null)} post={post} />}
    {rejecting && <Modal title={`Reject ${rejecting.expense_number}`} onClose={() => setRejecting(null)}>
      <div className="portal-form">
        <label className="full">Reason<input autoFocus value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>
        <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={() => setRejecting(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy} onClick={reject}>Reject expense</button></div>
      </div>
    </Modal>}
    {reprinting && <Modal title={`Request reprint of ${reprinting.voucher_number ?? reprinting.expense_number}`} onClose={() => setReprinting(null)}>
      <div className="portal-form">
        <label className="full">Reason for reprinting<input autoFocus placeholder="e.g. Original was damaged" value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>
        <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={() => setReprinting(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || reason.trim().length < 3} onClick={requestReprint}>Send to Accounting</button></div>
      </div>
    </Modal>}
    {deciding && <Modal title="Reject reprint request" onClose={() => setDeciding(null)}>
      <div className="portal-form">
        <label className="full">Reason<input autoFocus value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>
        <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={() => setDeciding(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy} onClick={() => decideReprint(deciding, "Rejected", reason.trim() || undefined)}>Reject request</button></div>
      </div>
    </Modal>}
  </div>;
}

const expenseChannels = (data: PortalData) => { const all = data.paymentMethods.filter((m) => m.active); const payable = all.filter((m) => m.kind === "payable"); return (payable.length ? payable : all).map((m) => m.name); };

function RecordExpenseModal({ data, onClose, post }: { data: PortalData; onClose: () => void; post: (body: Record<string, unknown>, ok?: string) => Promise<Record<string, unknown>> }) {
  const categories = data.expenseCategories.filter((c) => c.active);
  const channels = expenseChannels(data);
  const [payee, setPayee] = useState(""), [category, setCategory] = useState(categories[0]?.name ?? "");
  const [channel, setChannel] = useState(channels[0] ?? "Cash"), [reference, setReference] = useState(""), [supporting, setSupporting] = useState("");
  // Voucher lines (Design 2): particulars, quantity and unit cost; the total is their sum.
  const [lines, setLines] = useState([{ description: "", quantity: "1", unit: "" }]);
  const setLine = (i: number, patch: Partial<{ description: string; quantity: string; unit: string }>) => setLines((all) => all.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const parsed = lines.map((l) => ({ description: l.description.trim(), quantity: Math.max(0, Math.floor(Number(l.quantity) || 0)), unitCentavos: toCentavos(l.unit) }));
  const filled = parsed.filter((l) => l.description || l.unitCentavos > 0);
  const total = filled.reduce((s, l) => s + l.quantity * l.unitCentavos, 0);
  const linesOk = filled.length > 0 && filled.every((l) => l.description && l.quantity > 0 && l.unitCentavos > 0);
  const ready = !!payee.trim() && !!category && linesOk && total > 0;
  const purpose = filled.map((l) => l.description).join("; ").slice(0, 300);
  return <Modal title="Record expense" onClose={onClose}>
    <div className="portal-form">
      <label>Payee<input value={payee} onChange={(e) => setPayee(e.target.value)} /></label>
      <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></label>
      <div className="full cx-lines">
        <div className="cx-lines-head"><span>Particulars</span><span>Qty</span><span>Unit cost (PHP)</span><span>Amount</span><span /></div>
        {lines.map((l, i) => <div className="cx-lines-row" key={i}>
          <input aria-label={`Particulars, line ${i + 1}`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
          <input aria-label={`Quantity, line ${i + 1}`} className="cx-mono" inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, "") })} />
          <input aria-label={`Unit cost, line ${i + 1}`} className="cx-mono" inputMode="decimal" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
          <span className="cx-mono cx-lines-amt" data-l="Amount">{pesos(parsed[i].quantity * parsed[i].unitCentavos)}</span>
          <button type="button" className="portal-secondary cx-lines-x" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((all) => all.filter((_, k) => k !== i))}>Remove</button>
        </div>)}
        <div className="cx-lines-foot">
          <button type="button" className="portal-secondary" disabled={lines.length >= 10} onClick={() => setLines((all) => [...all, { description: "", quantity: "1", unit: "" }])}>Add line</button>
          <span>Total <b className="cx-mono">{pesos(total)}</b></span>
        </div>
      </div>
      <label>Payment channel<select value={channel} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Receipt or reference number<input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
      <label className="full">Supporting document<input placeholder="e.g. Meralco bill and official receipt" value={supporting} onChange={(e) => setSupporting(e.target.value)} /></label>
      {!categories.length && <p className="portal-form-note full">The Accounting Manager adds expense categories in Configuration.</p>}
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={!ready} onClick={() => void post({ action: "expense-create", payee: payee.trim(), category, amountCentavos: total, purpose, lines: filled, paymentChannel: channel, referenceNumber: reference.trim(), supportingDocument: supporting.trim() }, "Expense recorded and sent for approval.").then(onClose).catch(() => undefined)}>Send for approval</button></div>
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
      <label>Released through<select value={channel} onChange={(e) => setChannel(e.target.value)}>{channels.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>{needsRef ? "Reference number (required)" : "Reference number"}<input className="cx-mono" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} /></label>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={needsRef && !reference.trim()} onClick={() => void post({ action: "expense-release", id: expense.id, paymentChannel: channel, referenceNumber: reference.trim() }, "Released and marked paid.").then(onClose).catch(() => undefined)}>Mark released</button></div>
    </div>
  </Modal>;
}
