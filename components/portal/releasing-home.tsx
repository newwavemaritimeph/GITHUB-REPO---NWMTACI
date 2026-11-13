"use client";

import { useRef, useState } from "react";
import { downloadCsv } from "@/lib/csv";
import type { PortalData, Enrollment } from "../portal-live-app";
import { addDays, first, manilaToday, dueCentavos, noFeeSet, pesos2 } from "@/lib/portal-format";
import { automaticEndDate } from "@/lib/scheduling";
import { CERTIFICATE_STAGES, canSetSeries, certificateStage, certificateState, evaluationRequiredFor, formatCertificateNumber, formatNumber, formatProblem, nextOf, isStcwCategory, matchTemplateFiles, releaseProblem, softCopyLine, type CertificateStage, type CertificateView } from "@/lib/certificate-rules";
import { ALL_DATES, Badge, Message, Modal, PeriodBar, ViewIcon, fmtDate, submit, useNeedSince, usePaged, usePeriod, usePost } from "./shared-ui";
import { ReleaseConfirm } from "./live-releasing";
import { DeliveryAlert, deliveriesOf, deliveryAddress } from "./delivery-home";
import { photoFileName, type CertificateCorrections } from "@/lib/certificate-photo";
import { CertificatePhotoModal, openCertificatePhoto } from "./certificate-photo-modal";
import { NO_REASON, REASONS, REJECT_REASONS, ReasonField, reasonReady, reasonText, type ReasonValue } from "./reject-inline";
import { legacyRowsFromCsv, type ImportResult, type LegacyRow } from "@/lib/legacy-certificates";
import { PRINTED_FILTERS, printedReportRows, type PrintedCert, type PrintedFilter } from "@/lib/printed-certificates";
import { askConfirm } from "./dialogs";

/**
 * Releasing Officer (owner, 8 Oct 2026): certificates due to print, printed
 * once, reprinted only after a paid Reprinting request or an Admin-approved
 * void.
 * The Admin sets the numbering and decides void requests (AdminCertificateControls).
 */

type CertRow = { id: string; enrollment_id: string; status: string; certificate_number?: string | null; batch_label?: string | null; print_count?: number | null; reprints_allowed?: number | null; void_status?: string | null; void_reason?: string | null; void_requested_at?: string | null; soft_copy_sent_at?: string | null; snapshot?: Record<string, unknown> | null; claimant_name?: string | null; release_method?: string | null; revoked_at?: string | null; revoked_reason?: string | null; sticker_no?: string | null };
type Series = { course_id: string; prefix: string; next_number: number; pad: number; batch_prefix: string; next_batch: number; set_at: string; cert_format?: string | null; reg_format?: string | null; reg_prefix?: string; reg_next?: number | null; reg_digits?: number; reg_style?: "month-number" | "number-month"; profiles?: { complete_name: string } | { complete_name: string }[] | null };
type Template = { id: string; course_id: string; version: number; active: boolean; drive_link?: string | null; storage_path?: string | null; approved_at?: string | null };
const stcwCourse = (c: { course_categories?: unknown }) => isStcwCategory((Array.isArray(c.course_categories) ? c.course_categories[0] : c.course_categories as { name?: string } | null)?.name);
type Photo = { enrollment_id: string; file_name: string; background_white: boolean; uploaded_at: string; replaced_at?: string | null; profiles?: { complete_name: string } | { complete_name: string }[] | null };
type CertData = PortalData & { certificateSeries?: Series[]; evaluationForms?: Record<string, string>; feedbackAt?: Record<string, string>; feedbackLinks?: Record<string, string>; certificatePhotos?: Photo[] | null; postTestResults?: Record<string, PostTestResult> };
type PostTestResult = { required: boolean; passed: boolean; best: { score: number; total: number; percent: number } | null; attempts: number };

export type CertificateLine = { e: Enrollment; noFee?: boolean; cert: CertRow | null; view: CertificateView; name: string; number: string; course: { id: string; name: string; code: string }; starts: string | null; ended: string | null; evalNeeded: boolean; evalDone: boolean; evalLink: string | null; postTest: PostTestResult | null; balance: number; photo: Photo | null; fileName: string };

const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : null);
const short = (d: string | null) => (d ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`)) : "—");

/**
 * Every New Wave enrollment whose training has ended, with its certificate state.
 * "inTrainingDays" also keeps trainings still running or starting soon that end
 * within that many days (the Waiting tab, owner 13 Oct 2026).
 */
export function certificateLines(data: PortalData, opts: { inTrainingDays?: number } = {}): CertificateLine[] {
  const d = data as CertData;
  const today = manilaToday();
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const certs = new Map((data.certificates as unknown as CertRow[]).map((c) => [c.enrollment_id, c]));
  // 2x2 photos (9 Oct 2026); null before migration 202610090034, when photos are not required yet.
  const photos = d.certificatePhotos ? new Map(d.certificatePhotos.map((p) => [p.enrollment_id, p])) : null;
  const lastPaid = new Map<string, string>();
  for (const p of data.payments) { const dd = day(p.received_at); if (dd && dd > (lastPaid.get(p.trainee_id) ?? "")) lastPaid.set(p.trainee_id, dd); }
  const lines: CertificateLine[] = [];
  for (const e of data.enrollments) {
    if (e.enrollment_status === "Cancelled" || e.partner_offer_id) continue;
    const c = courses.get(e.course_id);
    if (!c || c.delivery_type !== "In-House") continue;
    const b = first(e.batches);
    const ended = b?.ends_on ?? (e.scheduled_on ? automaticEndDate(e.scheduled_on, c.duration_label) : null);
    const cert = certs.get(e.id) ?? null;
    // The portal evaluation form (owner, 20 Oct 2026): every New Wave course needs it.
    const evalNeeded = evaluationRequiredFor(c.delivery_type, e.partner_offer_id);
    const fb = d.feedbackAt?.[e.id] ?? null;
    const balance = data.companyCharge?.[e.id] ? 0 : Math.max(0, dueCentavos(e) - Number(e.paid_centavos));
    // No course is free (owner, 13 Nov 2026): a ₱0 fee is not paid.
    const noFee = !data.companyCharge?.[e.id] && noFeeSet(e);
    const view = certificateState({ enrollmentStatus: e.enrollment_status, trainingEnd: ended, balanceCentavos: balance, noFee, paidCentavos: Number(e.paid_centavos), evaluationRequired: evalNeeded, evaluationOn: day(fb), paidOn: lastPaid.get(e.trainee_id) ?? null, cert: cert ? { status: cert.status, printCount: Number(cert.print_count ?? (["Printed", "Released"].includes(cert.status) ? 1 : 0)), reprintsAllowed: Number(cert.reprints_allowed ?? 0), voidStatus: cert.void_status, revoked: !!cert.revoked_at } : null, photoOnFile: photos ? photos.has(e.id) : undefined }, today);
    if (view.state === "Cancelled") continue;
    // Not paid: off every Releasing Officer list until the Cashier records a payment (owner, 5 Nov 2026).
    if (view.state === "Waiting for payment" && !view.printCount) continue;
    if (view.state === "Training not finished" && (opts.inTrainingDays === undefined || !ended || ended > addDays(today, opts.inTrainingDays))) continue;
    const t = first(e.trainees);
    const fileName = photoFileName({ lastName: t?.legal_last_name ?? "TRAINEE", firstName: t?.legal_first_name ?? "", middleName: (t as { legal_middle_name?: string | null } | null)?.legal_middle_name, courseCode: c.code, batchNumber: b?.batch_number ?? null, date: ended ?? today });
    lines.push({ e, noFee, cert, view, photo: photos?.get(e.id) ?? null, fileName, name: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : e.enrollment_number, number: data.applicationNumbers?.[e.trainee_id] ?? t?.trainee_number ?? e.enrollment_number, course: { id: c.id, name: c.name, code: c.code }, starts: b?.starts_on ?? e.scheduled_on ?? null, ended, evalNeeded, evalDone: !!fb, evalLink: d.feedbackLinks?.[e.id] ?? null, postTest: d.postTestResults?.[e.id] ?? null, balance });
  }
  const rank = (l: CertificateLine) => (l.view.overdue ? 0 : l.view.state === "Due" ? 1 : l.view.state === "Waiting for photo" ? 2 : l.view.state === "Void requested" ? 2 : l.view.state === "Waiting for payment" || l.view.state === "Waiting for evaluation" ? 3 : 4);
  return lines.sort((a, b) => rank(a) - rank(b) || (a.ended ?? "").localeCompare(b.ended ?? ""));
}


/** Red alarm: due certificates not printed by the end of their due day. */
export function CertificateAlarm({ data, admin, onOpen }: { data: PortalData; admin?: boolean; onOpen?: () => void }) {
  const overdue = certificateLines(data).filter((l) => l.view.overdue);
  const voids = (data.certificates as unknown as CertRow[]).filter((c) => c.void_status === "Requested").length;
  if (!overdue.length && !(admin && voids)) return null;
  return <div className="cl-alarm" role="alert">
    <span className="cl-pulse" aria-hidden="true" />
    {overdue.length > 0 && <b>{overdue.length} certificate{overdue.length === 1 ? "" : "s"} overdue to print</b>}
    {overdue.length > 0 && <span>{overdue.slice(0, 4).map((l) => l.name.split(",")[0]).join(", ")}{overdue.length > 4 ? ` and ${overdue.length - 4} more` : ""} · due since {short(overdue.map((l) => l.view.dueOn).filter(Boolean).sort()[0] ?? null)}</span>}
    {admin && voids > 0 && <span>{voids} void request{voids === 1 ? "" : "s"} waiting for you</span>}
    {onOpen && <button type="button" onClick={onOpen}>{admin ? "Open Certificate Controls" : "Print Now"}</button>}
  </div>;
}

/** STCW first, then In-House (owner, 20 Oct 2026): the course group of a certificate line. */
const courseGroupOf = (data: PortalData) => { const byId = new Map(data.courses.map((c) => [c.id, c])); return (l: CertificateLine) => { const c = byId.get(l.course.id); return c && stcwCourse(c) ? "STCW Courses" : "In-House Courses"; }; };
function byCourseGroup(data: PortalData, lines: CertificateLine[]) {
  const groupOf = courseGroupOf(data);
  return ["STCW Courses", "In-House Courses"].map((g) => ({ group: g, lines: lines.filter((l) => groupOf(l) === g) })).filter((x) => x.lines.length);
}
/** A printed reprint stays on To Print; a course post-test not passed waits, once the Admin approved it. */
const stageOfLine = (l: CertificateLine): CertificateStage | null => { const s = certificateStage(l.view); return s === "To Print" && !l.view.printCount && l.postTest?.required && !l.postTest.passed ? "Waiting" : s; };

function Head({ title, note }: { title: string; note?: string }) {
  return <><div className="cx-head"><div><span className="portal-eyebrow">Releasing Officer</span><h1>{title}</h1></div></div>{note && <p className="ac-note">{note}</p>}</>;
}

/** What a certificate still needs before it prints. */
const WAIT_DAYS = 14;

/**
 * Releasing Officer › Certificates, Design 1 · Stage Tabs (owner, 5 Nov 2026; design/releasing-officer-designs.html): one page in
 * place of the Dashboard, Certificates, Waiting, Released and Delivery tabs. A certificate moves by itself: Waiting, To Print,
 * To Release, Released. A trainee with no payment and no Company Charge is not listed. The Certificate No. shows once printed.
 */
export function ReleasingCertificates({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [stage, setStage] = useState<CertificateStage>("To Print"), [q, setQ] = useState("");
  const [uploading, setUploading] = useState<CertificateLine | null>(null), [releasing, setReleasing] = useState<CertificateLine | null>(null), [correcting, setCorrecting] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null), [why, setWhy] = useState<ReasonValue>(NO_REASON);
  const [shipping, setShipping] = useState<string | null>(null), [tracking, setTracking] = useState(""), [shippedOn, setShippedOn] = useState(manilaToday());
  const [contact, setContact] = useState<string | null>(null);
  const { busy, msg, post } = usePost(reload);
  const per = usePeriod();
  const term = q.trim().toLowerCase();
  useNeedSince(term ? ALL_DATES : "");
  const tracked = (data as CertData).certificatePhotos != null;
  const deliveries = deliveriesOf(data);
  const enrollmentOfCert = new Map((data.certificates as unknown as CertRow[]).map((c) => [c.id, c.enrollment_id]));
  const lines = certificateLines(data, { inTrainingDays: WAIT_DAYS }).filter((l) => !term || `${l.name} ${l.number} ${l.cert?.certificate_number ?? ""} ${l.course.name} ${l.course.code}`.toLowerCase().includes(term));
  const inStage = (s: CertificateStage) => lines.filter((l) => stageOfLine(l) === s);
  // Released: the release events of the picked date, or every date while searching.
  const released = releaseRows(data).filter((r) => (term ? `${r.name} ${r.course} ${r.courseName} ${r.certNo} ${r.sticker}`.toLowerCase().includes(term) : per.inRange(r.at)));
  const workPaged = usePaged(stage === "Released" ? [] : byCourseGroup(data, inStage(stage)).flatMap((x) => x.lines));
  const relPaged = usePaged(released);
  const days = [...new Set(relPaged.shown.map((r) => r.day))].sort().reverse();
  const count = (s: CertificateStage) => (s === "Released" ? (per.picked || term ? String(released.length) : "—") : String(inStage(s).length));
  const csv = () => downloadCsv(`released-${per.range.from || "search"}-to-${per.range.to || "search"}.csv`, [["Date", "Time", "Trainee", "Course", "Certificate No.", "Released To", "ID", "Method", "Sticker No."], ...released.map((r) => [r.day, clock(r.at), r.name, r.course, r.certNo, r.to, r.idType, r.method, r.sticker])]);
  const pdf = (l: CertificateLine, preview: boolean) => `/api/documents/certificate/${l.e.id}${preview ? "?preview=1" : ""}`;
  // The print opens in a new tab; refresh so the row moves on by itself.
  const afterPrint = () => window.setTimeout(() => void reload(), 2500);
  const pay = (l: CertificateLine) => data.companyCharge?.[l.e.id] ? <Badge tone="blue">Company Charge</Badge> : l.balance > 0 ? <Badge tone="orange">Balance {pesos2(l.balance)}</Badge> : <Badge tone="green">Paid</Badge>;
  const needs = (l: CertificateLine) => [l.view.state === "Training not finished" && `In Training · Ends ${short(l.ended)}`, l.postTest?.required && !l.postTest.passed && "Post-Test", l.evalNeeded && !l.evalDone && "Evaluation", tracked && !l.photo && "Photo"].filter(Boolean) as string[];
  const printedAt = (l: CertificateLine) => (l.cert as { printed_at?: string | null } | null)?.printed_at;
  const printedOn = (l: CertificateLine) => short(day(printedAt(l)));
  const softOf = (l: CertificateLine) => softCopyLine({ email: (first(l.e.trainees) as { email?: string | null } | null)?.email, sentAt: l.cert?.soft_copy_sent_at, printedAt: printedAt(l), job: data.softCopyEmails?.[l.e.id], balanceCentavos: l.balance, noFee: l.noFee, evaluationRequired: l.evalNeeded, evaluationOn: l.evalDone ? "in" : null, postTestRequired: l.postTest?.required, postTestPassed: l.postTest?.passed });
  const sendSoft = (l: CertificateLine) => void post({ action: "certificate-soft-copy", enrollmentId: l.e.id }, "Soft copy emailed.").catch(() => undefined);
  const softLine = (l: CertificateLine) => { if (l.view.state === "Void requested") return null; const s = softOf(l); return <span className={`st-soft ${s.tone}`} title={s.title}>{s.text}{s.on && ` · ${short(day(s.on))}`}{s.failed && <button type="button" className="st-b" disabled={busy} onClick={() => sendSoft(l)}>Resend</button>}</span>; };
  const more = (l: CertificateLine) => <details className="cl-more"><summary aria-label="More actions">▾</summary><div>
    <button type="button" onClick={() => setCorrecting(l.e.id)}>Correct Details</button>
    {l.photo && <button type="button" onClick={() => void openCertificatePhoto(l.e.id)}>View Photo</button>}
    {l.evalLink && <a href={l.evalLink} target="_blank" rel="noreferrer">Open Evaluation</a>}
    {l.view.printCount > 0 && l.view.state !== "Void requested" && <button type="button" disabled={busy} onClick={() => { setVoiding(l.e.id); setWhy(NO_REASON); }}>Request Void</button>}
    {l.view.printCount > 0 && l.view.state !== "Void requested" && softOf(l).canSend && <button type="button" disabled={busy} onClick={() => sendSoft(l)}>Resend Soft Copy</button>}
  </div></details>;
  const heads: Record<Exclude<CertificateStage, "Released">, string[]> = {
    Waiting: ["#", "Trainee · NWMTACI No.", "Course", "Payment", "Still Needs", "Action"],
    "To Print": ["#", "Trainee · NWMTACI No.", "Course", "Payment", "Action"],
    "To Release": ["#", "Trainee · NWMTACI No.", "Course", "Certificate No.", "Payment", "Action"],
  };
  const row = (l: CertificateLine, i: number, cols: number) => {
    const ship = deliveries.find((r) => r.status === "Paid" && r.enrollment_id === l.e.id), reprint = stage === "To Print" && l.view.printCount > 0, need = needs(l);
    return [<tr key={l.e.id}>
      <td className="cl-no st-no">{i + 1}</td>
      <td data-l="Trainee"><button type="button" className="rc-who" title="Contact details" onClick={() => setContact(l.e.id)}>{l.name}</button><small className="cl-mono cl-sub cl-block">{l.number.replace(/^NWMTACI-/, "")}</small>{l.view.overdue && <Badge tone="red">Overdue</Badge>}{reprint && <Badge tone="blue">Reprint</Badge>}{stage === "To Release" && ship && <Badge tone="blue">LBC · {ship.city}</Badge>}</td>
      <td data-l="Course" title={l.course.name}><b>{l.course.code}</b><small className="cl-sub cl-block">{stage === "To Release" ? `Printed ${printedOn(l)}` : l.view.state === "Training not finished" ? `Ends ${short(l.ended)}` : `Ended ${short(l.ended)}`}</small></td>
      {stage === "To Release" && <td data-l="Certificate No."><span className="cl-mono">{l.cert?.certificate_number ?? "—"}</span>{softLine(l)}</td>}
      <td data-l="Payment">{pay(l)}</td>
      {stage === "Waiting" && <td data-l="Still Needs">{need.map((n) => <span key={n} className="st-need">{n}</span>)}</td>}
      <td data-l=""><span className="cl-acts st-acts">
        {stage === "Waiting" && tracked && !l.photo && <button type="button" className={`st-b${need.length === 1 ? " p" : ""}`} title="Upload the trainee's 2x2 photo" onClick={() => setUploading(l)}>Upload</button>}
        {stage === "Waiting" && l.view.state !== "Training not finished" && (need.includes("Evaluation") || need.includes("Post-Test")) && <button type="button" className="st-b" disabled={busy} onClick={() => void post({ action: "training-end-email", enrollmentId: l.e.id }, `Post-test and evaluation email sent to ${l.name}.`).catch(() => undefined)}>Email Post-Test</button>}
        {stage === "To Print" && <a className="st-b p" href={pdf(l, false)} target="_blank" rel="noreferrer" onClick={afterPrint}>{reprint ? "Reprint" : "Print"}</a>}
        {stage !== "To Release" && <a className="st-b" href={pdf(l, true)} target="_blank" rel="noreferrer" title="Draft for checking; never counts as a print">Preview</a>}
        {stage === "To Release" && (l.view.state === "Void requested" ? <span className="cl-sub">With the Admin</span> : ship ? <button type="button" className="st-b p" disabled={busy || l.balance > 0} title={l.balance > 0 ? `Balance ${pesos2(l.balance)} must be settled first` : undefined} onClick={() => { setShipping(ship.id); setTracking(""); setShippedOn(manilaToday()); }}>Mark Shipped</button> : <ReleaseButton primary l={l} onRelease={() => setReleasing(l)} />)}
        {more(l)}
      </span></td>
    </tr>,
    voiding === l.e.id && <tr key={`${l.e.id}-void`} className="cl-voidrow"><td /><td colSpan={cols - 1}><div className="cl-void">
      <ReasonField reasons={REASONS.certificateVoid} label="Reason for Voiding" value={why} onChange={setWhy} autoFocus />
      <button type="button" className="portal-secondary" onClick={() => setVoiding(null)}>Keep</button>
      <button type="button" className="cl-danger" disabled={busy || !reasonReady(why)} onClick={() => void post({ action: "certificate-void-request", enrollmentId: l.e.id, reason: reasonText(why) }, "Sent to the Admin for approval.").then(() => setVoiding(null)).catch(() => undefined)}>Send to the Admin</button>
    </div></td></tr>,
    ship && shipping === ship.id && <tr key={`${l.e.id}-ship`} className="cl-voidrow"><td /><td colSpan={cols - 1}><div className="cl-void ms-ship">
      <p className="cl-sub">Deliver to {deliveryAddress(ship)} · {ship.recipient_name} · {ship.mobile}</p>
      <label>LBC Tracking Number (Required)<input value={tracking} autoFocus onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 1234 5678 9012" /></label>
      <label>Date Sent<input type="date" value={shippedOn} max={manilaToday()} onChange={(e) => setShippedOn(e.target.value)} /></label>
      <button type="button" className="portal-secondary" onClick={() => setShipping(null)}>Cancel</button>
      <button type="button" className="portal-primary" disabled={busy || tracking.trim().length < 4 || !shippedOn} onClick={() => void post({ action: "delivery-ship", id: ship.id, trackingNumber: tracking.trim(), shippedOn }, "Shipped. The trainee was emailed the tracking number.").then(() => setShipping(null)).catch(() => undefined)}>Mark Shipped</button>
    </div></td></tr>];
  };
  return <div className="portal-page cx ac">
    <Head title="Certificates" />
    <CertificateAlarm data={data} />
    <DeliveryAlert data={data} onOpen={() => setStage("To Release")} />
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="st-tabs" role="tablist" aria-label="Certificate stages">{CERTIFICATE_STAGES.map((s) => <button key={s} type="button" role="tab" aria-selected={stage === s} className={`st-tab${stage === s ? " on" : ""}`} onClick={() => setStage(s)}><span>{s}</span><b>{count(s)}</b></button>)}</div>
    <section className="portal-panel cx-panel st-panel">
      <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search certificates" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, NWMTACI number or certificate number" />{stage === "Released" && (per.picked || !!term) && <button type="button" className="st-b" disabled={!released.length} onClick={csv}>Download Excel</button>}</div>
      {stage === "Released" ? <>
        {term ? <p className="pd-label pd-pad">Searching all dates · {released.length} found</p> : <PeriodBar p={per} what="Released" count={`${released.length} certificate${released.length === 1 ? "" : "s"}`} />}
        {(per.picked || !!term) && (released.length ? <><div className="st-wrap"><table className="cl-log st-log"><thead><tr><th>Time</th><th>Trainee</th><th>Course</th><th>Certificate No.</th><th>Released To</th><th>Method</th><th>Sticker No.</th></tr></thead><tbody>
          {days.map((d) => { const g = relPaged.shown.filter((r) => r.day === d); return [<tr key={d} className="nb-group"><td colSpan={7}><b>{longDay(d)}</b> <span className="cl-sub">{g.length} released</span></td></tr>,
            ...g.map((r) => { const sent = deliveries.find((x) => x.status === "Shipped" && x.enrollment_id === enrollmentOfCert.get(r.certId)); return <tr key={r.id}><td data-l="Time" className="cl-mono">{clock(r.at)}</td><td data-l="Trainee">{enrollmentOfCert.get(r.certId) ? <button type="button" className="rc-who" title="Contact details" onClick={() => setContact(enrollmentOfCert.get(r.certId) ?? null)}>{r.name}</button> : <b>{r.name}</b>}</td><td data-l="Course" title={r.courseName}>{r.course}</td><td data-l="Certificate No." className="cl-mono">{r.certNo}</td><td data-l="Released To">{r.to}{r.idType && <small className="cl-sub cl-block">{r.idType}</small>}</td><td data-l="Method"><Badge tone={r.method === "Courier" ? undefined : "green"}>{r.method === "Pickup" ? "Picked Up" : r.method}</Badge>{sent && <><small className="cl-sub cl-block cl-mono">{sent.tracking_number}</small><button type="button" className="st-b" disabled={busy} onClick={() => void post({ action: "delivery-delivered", id: sent.id }, "Marked delivered.").catch(() => undefined)}>Mark Delivered</button></>}</td><td data-l="Sticker No." className="cl-mono">{r.sticker || "—"}</td></tr>; })]; })}
        </tbody></table></div>{relPaged.pager}</> : <p className="portal-empty-copy">Nothing released on these dates.</p>)}
      </> : workPaged.shown.length ? <><div className="st-wrap"><table className="cl-log st-log"><thead><tr>{heads[stage].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {byCourseGroup(data, workPaged.shown).flatMap(({ group, lines: g }) => [<tr key={group} className="nb-group"><td colSpan={heads[stage].length}><b>{group}</b> <span className="cl-sub">{g.length}</span></td></tr>, ...g.flatMap((l, i) => row(l, i, heads[stage].length))])}
      </tbody></table></div>{workPaged.pager}</> : <p className="portal-empty-copy">Nothing here.</p>}
      {data.certificateIssuanceEnabled === false && <p className="cl-legend cl-warn">Printing is turned off. The Admin turns it on in Certificate controls.</p>}
    </section>
    {uploading && <CertificatePhotoModal enrollmentId={uploading.e.id} traineeName={uploading.name} fileName={uploading.fileName} onClose={() => setUploading(null)} onDone={async () => { setUploading(null); await reload(); }} />}
    {contact && <TraineeContactCard data={data} enrollmentId={contact} onClose={() => setContact(null)} />}
    {releasing && <ReleaseConfirm target={{ enrollmentId: releasing.e.id, name: releasing.name, course: releasing.course.name, certNo: releasing.cert?.certificate_number ?? "" }} onClose={() => setReleasing(null)} onDone={async () => { setReleasing(null); await reload(); }} />}
    {correcting && <Modal title="Correct Details" wide onClose={() => setCorrecting(null)}><CertificateCorrectionsPanel data={data} reload={reload} mode="details" only={correcting} onClose={() => setCorrecting(null)} /></Modal>}
  </div>;
}

/** Certificate Templates (owner, 20 Oct 2026): one compact list; View shows the template with its description and blank details. */
type TemplateRead = { found: string[]; missing: string[]; covered?: boolean } | null;
/** What the portal read from an uploaded PDF. */
export function templateReadText(read: TemplateRead) {
  if (!read) return "";
  return [read.found.length ? `Found: ${read.found.join(", ")}.` : "", read.missing.length ? `Not Found: ${read.missing.join(", ")}. Open View to check.` : "", read.covered ? "Sample text that could not be removed is covered with white boxes." : ""].filter(Boolean).join(" ");
}
const readNeedsCheck = (read: TemplateRead) => !!read && (read.missing.length > 0 || !!read.covered);

export function CertificateTemplates({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  // Every New Wave course, with an uploaded PDF template (owner, 9 Oct 2026). The newest upload is the active one.
  const { msg, setMsg } = usePost(reload);
  const [q, setQ] = useState(""), [show, setShow] = useState<"All" | "With Template" | "No Template">("All"), [uploading, setUploading] = useState<string | null>(null);
  const templates = data.certificateTemplates as unknown as Template[];
  const active = new Map(templates.filter((t) => t.active).map((t) => [t.course_id, t]));
  const all = data.courses.filter((c) => c.delivery_type === "In-House" && c.code !== "CCI" && (c as { active?: boolean }).active !== false);
  const term = q.trim().toLowerCase();
  const courses = all.filter((c) => (!term || `${c.code} ${c.name}`.toLowerCase().includes(term)) && (show === "All" || (show === "With Template") === active.has(c.id))).sort((a, b) => a.name.localeCompare(b.name));
  const withTemplate = all.filter((c) => active.has(c.id)).length;
  async function upload(courseId: string, file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf") { setMsg({ kind: "error", text: "Choose a PDF file." }); return; }
    setUploading(courseId); setMsg(null);
    try {
      const form = new FormData(); form.set("courseId", courseId); form.set("template", file);
      const r = await fetch("/api/staff/certificate-templates", { method: "POST", body: form });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "The template could not be uploaded.");
      await reload();
      const read = body.layout as TemplateRead;
      const box = body.photoBox as { w: number; h: number } | null;
      setMsg({ kind: readNeedsCheck(read) ? "error" : "success", text: `Template version ${body.version} uploaded and now in use. ${read ? templateReadText(read) : box ? `2x2 photo box found (${(box.w / 72).toFixed(1)} × ${(box.h / 72).toFixed(1)} in): the photo prints inside it.` : "No 2x2 photo box was found on this PDF: the photo prints at the lower right. Preview a certificate to check."}` });
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "The template could not be uploaded." }); } finally { setUploading(null); }
  }
  // Upload Many (owner, 20 Oct 2026): pick the PDFs downloaded from the Drive folder; each is matched to its course by the file name.
  // Converted templates come with a "{CODE} - {Course}.json" of field positions, sent along as `layout`.
  const [bulk, setBulk] = useState<{ file: File; layout?: File; courseId: string; result?: string; read?: TemplateRead }[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  function pickMany(list: FileList | null) {
    const picked = [...(list ?? [])];
    const files = picked.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const layouts = new Map(picked.filter((f) => /\.json$/i.test(f.name) && !/\.word\.json$/i.test(f.name)).map((f) => [f.name.replace(/\.json$/i, "").toLowerCase(), f]));
    if (!files.length) { setMsg({ kind: "error", text: "Choose PDF files." }); return; }
    const pdfs = files.filter((f) => !/\.measure\.pdf$/i.test(f.name));
    const matched = matchTemplateFiles(pdfs.map((f) => f.name), all);
    setBulk(pdfs.map((file, i) => ({ file, layout: layouts.get(file.name.replace(/\.pdf$/i, "").toLowerCase()), courseId: matched[i].courseId ?? "" }))); setMsg(null);
  }
  async function uploadAll() {
    if (!bulk) return;
    setBulkBusy(true); setMsg(null);
    const rows = [...bulk];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.courseId || r.result === "Uploaded") continue;
      try {
        const form = new FormData(); form.set("courseId", r.courseId); form.set("template", r.file); if (r.layout) form.set("layout", await r.layout.text());
        const res = await fetch("/api/staff/certificate-templates", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        rows[i] = { ...r, result: res.ok ? "Uploaded" : body.error ?? "Not uploaded.", read: res.ok ? body.layout : null };
      } catch { rows[i] = { ...r, result: "Not uploaded." }; }
      setBulk([...rows]);
    }
    setBulkBusy(false);
    await reload();
    const done = rows.filter((r) => r.result === "Uploaded").length, failed = rows.filter((r) => r.courseId && r.result !== "Uploaded").length, skipped = rows.filter((r) => !r.courseId).length, check = rows.filter((r) => readNeedsCheck(r.read ?? null)).length;
    setMsg({ kind: failed || check ? "error" : "success", text: `${done} template${done === 1 ? "" : "s"} uploaded and now in use.${failed ? ` ${failed} failed: see the list.` : ""}${check ? ` ${check} to check: see the list.` : ""}${skipped ? ` ${skipped} skipped (no course).` : ""}` });
  }
  // The template with its course description; name, dates and numbers left blank.
  const view = (id: string) => window.open(`/api/staff/certificate-templates/${id}?view=1`, "_blank", "noopener");
  const group = (label: string, rows: typeof courses) => rows.length ? <div key={label}>
    <p className="tp-group"><b>{label} Courses</b><span>{rows.filter((c) => active.has(c.id)).length} of {rows.length} with template</span></p>
    <div className="tpl-list">{rows.map((c) => { const t = active.get(c.id); const uploaded = !!t?.storage_path; return <div key={c.id} className="tpl-row">
      <div className="tpl-name"><b>{c.name}</b><small className="cl-mono">{c.code}</small></div>
      <div>{uploaded ? <Badge tone="green">{`Template · v${t!.version}${t!.approved_at ? ` · ${fmtDate(day(t!.approved_at) ?? "")}` : ""}`}</Badge> : <Badge tone="orange">No Template Yet</Badge>}</div>
      <span className="cl-acts">{uploaded && <ViewIcon label="View Template" onClick={() => view(t!.id)} />}<label className={uploaded ? "portal-secondary tp-upload" : "portal-primary tp-upload"}>{uploading === c.id ? "Uploading…" : uploaded ? "Replace PDF" : "Upload PDF"}<input type="file" accept="application/pdf" hidden disabled={!!uploading} onChange={(e) => { void upload(c.id, e.target.files?.[0]); e.target.value = ""; }} /></label></span>
    </div>; })}</div></div> : null;
  return <div className="portal-page cx ac">
    <Head title="Templates" note="View shows each template with its course description; the trainee's name, training dates, issue date, Certificate No. and Registration No. are filled in when a certificate is printed. A new upload replaces the one in use; earlier versions are kept." />
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Setup</h2></div>
          <dl className="ac-lines"><div><dt>Courses with a template</dt><dd>{withTemplate} of {all.length}</dd></div><div><dt>Without a template</dt><dd className={all.length - withTemplate ? "warn" : undefined}>{all.length - withTemplate}</dd></div><div><dt>Printing</dt><dd className={data.certificateIssuanceEnabled ? "plus" : "warn"}>{data.certificateIssuanceEnabled ? "On" : "Off"}</dd></div></dl>
          <p className="ac-foot">The training evaluation is sent to trainees by email, so no form link is needed here.</p>
        </section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search courses" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any course by name or code" /><span className="cx-seg">{(["All", "With Template", "No Template"] as const).map((f) => <button key={f} type="button" className={show === f ? "on" : ""} onClick={() => setShow(f)}>{f}</button>)}</span>
          <label className="portal-primary tp-upload">Upload<input type="file" accept="application/pdf,application/json,.json" multiple hidden disabled={bulkBusy} onChange={(e) => { pickMany(e.target.files); e.target.value = ""; }} /></label></div>
        {bulk && <div className="tp-bulk">
          <p className="tp-group"><b>Check the Matches</b><span>{bulk.filter((r) => r.courseId).length} of {bulk.length} matched</span></p>
          <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>File</th><th>Course</th><th>Status</th></tr></thead><tbody>
            {bulk.map((r, i) => { const t = r.courseId ? active.get(r.courseId) : undefined; const twice = r.courseId && bulk.findIndex((x) => x.courseId === r.courseId) !== i; return <tr key={`${r.file.name}-${i}`}>
              <td className="cl-mono">{r.file.name}</td>
              <td><select className="cl-in" aria-label={`Course for ${r.file.name}`} disabled={bulkBusy || r.result === "Uploaded"} value={r.courseId} onChange={(e) => setBulk(bulk.map((x, j) => j === i ? { ...x, courseId: e.target.value, result: undefined } : x))}><option value="">Skip this file</option>{[...all].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></td>
              <td>{r.result === "Uploaded" ? <><Badge tone={readNeedsCheck(r.read ?? null) ? "orange" : "green"}>Uploaded</Badge>{r.read && <small className="cl-sub cl-block">{templateReadText(r.read)}</small>}</> : r.result ? <Badge tone="orange">{r.result}</Badge> : !r.courseId ? <span className="cl-sub">No course found · pick one or skip</span> : twice ? <Badge tone="orange">Same course as another file</Badge> : t ? <span className="cl-sub">Replaces Version {t.version}</span> : <span className="cl-sub">New template</span>}</td>
            </tr>; })}
          </tbody></table></div>
          <div className="cl-acts tp-bulk-acts"><button type="button" className="portal-secondary" disabled={bulkBusy} onClick={() => setBulk(null)}>Close</button><button type="button" className="portal-primary" disabled={bulkBusy || !bulk.some((r) => r.courseId && r.result !== "Uploaded")} onClick={() => void uploadAll()}>{bulkBusy ? "Uploading…" : `Upload All (${bulk.filter((r) => r.courseId && r.result !== "Uploaded").length})`}</button></div>
        </div>}
        {group("STCW", courses.filter(stcwCourse))}
        {group("In-House", courses.filter((c) => !stcwCourse(c)))}
        {!courses.length && <p className="portal-empty-copy">No courses match.</p>}
      </section>
    </div>
  </div>;
}

/** Release needs the fee paid and the evaluation in (owner, 20 Oct 2026); the server checks again. */
function ReleaseButton({ l, onRelease, primary }: { l: CertificateLine; onRelease: () => void; primary?: boolean }) {
  const why = releaseProblem({ balanceCentavos: l.balance, noFee: l.noFee, evaluationRequired: l.evalNeeded, evaluationOn: l.evalDone ? "in" : null, revoked: !!l.cert?.revoked_at, postTestRequired: l.postTest?.required, postTestPassed: l.postTest?.passed });
  return <button type="button" className={primary ? "st-b p" : undefined} disabled={!!why} title={why ?? undefined} onClick={onRelease}>{why ? `Release · ${why.replace(/:.*$/, "")}` : "Release"}</button>;
}

/** Post-test result (20 Oct 2026): "—" when the course has no approved post-test. */
/** Release events (newest 400) with the certificate's number, method and sticker, by Manila day. */
type ReleaseEvent = { id: string; certificate_id: string; event_type: string; recipient_name: string | null; recipient_id_type: string | null; created_at: string; certificates?: unknown };
/**
 * The trainee's contact card (owner, 10 Nov 2026, Design 3): the Releasing Officer clicks a name to see the mobile, the
 * email, the Meta thread link Registration recorded and the LBC address, to message the trainee about the certificate.
 * Read-only: only Registration adds or changes the link.
 */
export function TraineeContactCard({ data, enrollmentId, onClose }: { data: PortalData; enrollmentId: string; onClose: () => void }) {
  const e = data.enrollments.find((x) => x.id === enrollmentId);
  const t = e ? data.trainees.find((x) => x.id === e.trainee_id) : undefined;
  const c = e ? data.courses.find((x) => x.id === e.course_id) : undefined;
  const cert = (data.certificates as unknown as CertRow[]).find((x) => x.enrollment_id === enrollmentId);
  const ship = deliveriesOf(data).filter((r) => r.enrollment_id === enrollmentId && !/declin|cancel/i.test(r.status)).at(-1);
  const fb = (e && data.traineeFacebook?.[e.trainee_id]) || "";
  const name = t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : e?.enrollment_number ?? "Trainee";
  return <Modal title={name} onClose={onClose}><dl className="rc-card">
    <dt>NWMTACI No.</dt><dd className="cl-mono">{(e && data.applicationNumbers?.[e.trainee_id]) || t?.trainee_number || "—"}</dd>
    <dt>Course</dt><dd>{c?.code ?? "—"}{cert?.certificate_number ? <> · <span className="cl-mono">{cert.certificate_number}</span></> : null}</dd>
    <dt>Mobile</dt><dd className="cl-mono">{t?.mobile || "—"}</dd>
    <dt>Email</dt><dd>{t?.email || "—"}</dd>
    <dt>Meta Thread</dt><dd>{fb.startsWith("https://") ? <a className="st-b rc-meta" href={fb} target="_blank" rel="noreferrer">Open Conversation</a> : <span className="cl-sub">Not yet recorded. Registration adds it in the Trainee Account.</span>}</dd>
    {ship && <><dt>Deliver To</dt><dd>{deliveryAddress(ship)} (LBC · {ship.status})</dd></>}
  </dl></Modal>;
}

function releaseRows(data: PortalData) {
  const certs = new Map((data.certificates as unknown as (CertRow & { printed_at?: string | null })[]).map((c) => [c.id, c]));
  return ((data as unknown as { certificateReleases?: ReleaseEvent[] }).certificateReleases ?? []).filter((r) => r.event_type === "release").map((r) => {
    const c = first(r.certificates as { snapshot?: Record<string, unknown> | null; enrollments?: unknown } | null);
    const e = first(c?.enrollments as { enrollment_number?: string; trainees?: unknown; courses?: unknown } | null);
    const t = first(e?.trainees as { legal_first_name?: string; legal_last_name?: string } | null), co = first(e?.courses as { name?: string; code?: string } | null);
    const cert = certs.get(r.certificate_id);
    return { id: r.id, certId: r.certificate_id, day: day(r.created_at) ?? "", at: r.created_at, name: t ? `${(t.legal_last_name ?? "").toUpperCase()}, ${t.legal_first_name ?? ""}` : e?.enrollment_number ?? "Trainee", course: co?.code ?? "", courseName: co?.name ?? "",
      certNo: cert?.certificate_number ?? (c?.snapshot?.certificate_number as string | undefined) ?? "—", to: r.recipient_name ?? "", idType: r.recipient_id_type ?? "", method: cert?.release_method ?? "Pickup", sticker: cert?.sticker_no ?? "" };
  });
}
const clock = (iso: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const longDay = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));

/** The days a Daily / Weekly (Monday–Sunday) / Monthly report covers, from a picked date. */
export function reportRange(period: "Daily" | "Weekly" | "Monthly", date: string): { from: string; to: string; label: string } {
  if (period === "Daily") return { from: date, to: date, label: longDay(date) };
  if (period === "Monthly") { const [y, m] = date.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); const from = `${y}-${String(m).padStart(2, "0")}-01`; return { from, to: `${from.slice(0, 8)}${last}`, label: new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`)) }; }
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; const from = addDays(date, -dow), to = addDays(from, 6);
  return { from, to, label: `Week of ${fmtDate(from)} – ${fmtDate(to)}` };
}

/** Releasing Officer › Reports (owner, 20 Oct 2026): Daily, Weekly and Monthly certificate figures. */
export function ReleasingReports({ data }: { data: PortalData }) {
  const [period, setPeriod] = useState<"Daily" | "Weekly" | "Monthly">("Monthly"), [date, setDate] = useState(manilaToday());
  const r = reportRange(period, date);
  const inRange = (iso?: string | null) => { const d = day(iso ?? null); return !!d && d >= r.from && d <= r.to; };
  const certs = data.certificates as unknown as (CertRow & { printed_at?: string | null; course_id?: string })[];
  const lines = certificateLines(data);
  const lineByCert = new Map(lines.filter((l) => l.cert).map((l) => [l.cert!.id, l]));
  const printedRows = certs.filter((c) => inRange(c.printed_at));
  const firstPrints = printedRows.filter((c) => Number(c.print_count ?? 1) <= 1), reprints = printedRows.filter((c) => Number(c.print_count ?? 1) > 1);
  const released = releaseRows(data).filter((x) => x.day >= r.from && x.day <= r.to);
  const photos = ((data as CertData).certificatePhotos ?? []).filter((p) => inRange(p.uploaded_at));
  const waiting = lines.filter((l) => l.view.state === "Printed"), overdue = lines.filter((l) => l.view.overdue);
  const courseOf = (certId: string) => lineByCert.get(certId)?.course.code ?? "Other";
  const codes = [...new Set([...printedRows.map((c) => courseOf(c.id)), ...released.map((x) => x.course || "Other")])].sort();
  const perCourse = codes.map((code) => ({ code, printed: firstPrints.filter((c) => courseOf(c.id) === code).length, reprinted: reprints.filter((c) => courseOf(c.id) === code).length, released: released.filter((x) => (x.course || "Other") === code).length, waiting: waiting.filter((l) => l.course.code === code).length }));
  // Releases per hour (Daily), per day (Weekly) or per week of the month (Monthly).
  const buckets: { label: string; n: number }[] = period === "Daily" ? Array.from({ length: 10 }, (_, i) => ({ label: `${((i + 7) % 12) || 12}${i + 7 < 12 ? "AM" : "PM"}`, n: released.filter((x) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Manila" }).format(new Date(x.at))) === i + 7).length }))
    : period === "Weekly" ? Array.from({ length: 7 }, (_, i) => { const d = addDays(r.from, i); return { label: new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)), n: released.filter((x) => x.day === d).length }; })
    : Array.from({ length: 5 }, (_, i) => ({ label: `Wk ${i + 1}`, n: released.filter((x) => Math.floor((Number(x.day.slice(8, 10)) - 1) / 7) === i).length }));
  const max = Math.max(1, ...buckets.map((b) => b.n));
  const csv = () => downloadCsv(`certificate-report-${period.toLowerCase()}-${r.from}.csv`, [["Course", "Printed", "Reprinted", "Released", "Waiting for release"], ...perCourse.map((p) => [p.code, p.printed, p.reprinted, p.released, p.waiting]), ["Total", firstPrints.length, reprints.length, released.length, waiting.length], [], ["Released", "Time", "Trainee", "Course", "Certificate No.", "Released To", "Method", "Sticker No."], ...released.map((x) => [x.day, clock(x.at), x.name, x.course, x.certNo, x.to, x.method, x.sticker])]);
  return <div className="portal-page cx ac rr-report">
    <div className="cx-head"><div><span className="portal-eyebrow">Releasing Officer</span><h1>Certificate Report</h1></div>
      <div className="rl-bar"><span className="cx-seg">{(["Daily", "Weekly", "Monthly"] as const).map((p) => <button key={p} type="button" className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>{p}</button>)}</span>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Report date" />
        <button type="button" className="portal-secondary" onClick={() => setDate(addDays(r.from, period === "Daily" ? -1 : period === "Weekly" ? -7 : -1))}>‹</button><button type="button" className="portal-secondary" onClick={() => setDate(addDays(r.to, 1))}>›</button>
        <button type="button" className="portal-secondary" onClick={csv}>Download Excel</button><button type="button" className="portal-primary" onClick={() => window.print()}>Print / Save PDF</button></div></div>
    <p className="ac-note"><b>{r.label}</b>. Waiting for release and overdue are as of now.</p>
    <div className="cx-tiles ac-tiles">
      {[["Printed", firstPrints.length, "first prints"], ["Reprinted", reprints.length, "paid or Admin-approved"], ["Released", released.length, `${released.filter((x) => x.method === "Courier").length} by courier`], ["Waiting for Release", waiting.length, "printed, not claimed"], ["Overdue to Print", overdue.length, "due before today"], ["Photos Uploaded", photos.length, "2x2 photos"]].map(([label, n, sub]) => <div key={label as string} className="cx-tile ac-count"><span>{label}</span><b>{n}</b><small className="cl-sub">{sub}</small></div>)}
    </div>
    <PrintedCertificates data={data} lines={lines} from={r.from} to={r.to} label={r.label} />
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Released {period === "Daily" ? "by Hour" : period === "Weekly" ? "by Day" : "by Week"}</h2></div>
      <div className="rr-chart" aria-label="Certificates released">{buckets.map((b) => <div key={b.label} className="rr-col"><span className="rr-n">{b.n || ""}</span><div className="rr-bar" style={{ height: `${Math.max(3, (b.n / max) * 100)}%` }} /><span className="rr-x">{b.label}</span></div>)}</div>
      <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>Course</th><th className="r">Printed</th><th className="r">Reprinted</th><th className="r">Released</th><th className="r">Waiting</th></tr></thead><tbody>
        {perCourse.map((p) => <tr key={p.code}><td><b>{p.code}</b></td><td className="r cl-mono">{p.printed}</td><td className="r cl-mono">{p.reprinted}</td><td className="r cl-mono">{p.released}</td><td className="r cl-mono">{p.waiting}</td></tr>)}
        <tr className="nb-group"><td><b>Total</b></td><td className="r cl-mono"><b>{firstPrints.length}</b></td><td className="r cl-mono"><b>{reprints.length}</b></td><td className="r cl-mono"><b>{released.length}</b></td><td className="r cl-mono"><b>{waiting.length}</b></td></tr>
      </tbody></table></div>
      {!perCourse.length && <p className="portal-empty-copy">No certificates printed or released in this period.</p>}
    </section>
  </div>;
}

const PRINTED_STATUS: Record<PrintedCert["status"], string> = { Released: "Released", Waiting: "Waiting for Release", Void: "Void Requested", Revoked: "Revoked" };
const printedPay = (r: PrintedCert) => r.balance == null ? "—" : r.balance > 0 ? `Balance ${pesos2(r.balance)}` : "Paid";
const printedNote = (r: PrintedCert) => r.status === "Released" ? [r.releasedOn ? fmtDate(r.releasedOn) : "", r.method === "Pickup" ? "Picked Up" : r.method].filter(Boolean).join(" · ") : r.status === "Waiting" ? (r.ageDays ? `${r.ageDays} day${r.ageDays === 1 ? "" : "s"} since print` : "Printed today") : "";

/** Printed Certificates (owner, 20 Oct 2026; design/certificate-report-prototype.html): numbers, Document No. (sticker), payment and release per print. */
function PrintedCertificates({ data, lines, from, to, label }: { data: PortalData; lines: CertificateLine[]; from: string; to: string; label: string }) {
  const [f, setF] = useState<PrintedFilter>("All"), [q, setQ] = useState("");
  const today = manilaToday();
  const byCert = new Map(lines.filter((l) => l.cert).map((l) => [l.cert!.id, l]));
  const released = new Map(releaseRows(data).map((x) => [x.certId, x.day]));
  const certs = data.certificates as unknown as Parameters<typeof printedReportRows>[0];
  const who = (id: string) => { const l = byCert.get(id); return l ? { name: l.name, number: l.number.replace(/^NWMTACI-/, ""), course: l.course.code, courseName: l.course.name, balance: l.balance } : null; };
  const all = printedReportRows(certs, who, released, from, to, today);
  const stale = printedReportRows(certs, who, released, "0000-01-01", today, today).filter((r) => r.status === "Waiting" && r.ageDays > 7);
  const term = q.trim().toLowerCase();
  const rows = all.filter(PRINTED_FILTERS[f]).filter((r) => !term || `${r.name} ${r.number} ${r.course} ${r.courseName} ${r.regNo} ${r.certNo} ${r.docNo}`.toLowerCase().includes(term));
  const prPaged = usePaged(rows);
  const days = [...new Set(prPaged.shown.map((r) => r.printedOn))];
  const noDocReleased = all.filter((r) => r.status === "Released" && !r.docNo).length, withBalance = all.filter(PRINTED_FILTERS["With Balance"]).length;
  const alerts: [string, PrintedFilter][] = [];
  if (noDocReleased) alerts.push([`${noDocReleased} released without a Document No.`, "No Document No."]);
  if (withBalance) alerts.push([`${withBalance} printed with a balance`, "With Balance"]);
  if (stale.length) alerts.push([`${stale.length} printed over 7 days ago and not yet released`, "Waiting for Release"]);
  const csv = () => downloadCsv(`printed-certificates-${from}-to-${to}.csv`, [["Date", "Time", "Trainee", "NWMTACI No.", "Course", "Registration No.", "Certificate No.", "Document No.", "Copy", "Printed By", "Payment", "Status", "Note"], ...rows.map((r) => [r.printedOn, clock(r.printedAt), r.name, r.number, r.course, r.regNo, r.certNo, r.docNo, r.copy, r.printedBy, printedPay(r), PRINTED_STATUS[r.status], printedNote(r)])]);
  return <section className="portal-panel cx-panel pc-panel">
    <div className="panel-heading"><h2>Printed Certificates</h2><span className="cl-sub">{rows.length} of {all.length} · {label}</span></div>
    {alerts.length > 0 && <div className="pc-alerts">{alerts.map(([t, k]) => <button key={t} type="button" className="pc-alert" onClick={() => setF(k)}>⚠ {t}</button>)}</div>}
    <div className="cx-bar ac-bar rl-bar"><span className="cx-seg">{(Object.keys(PRINTED_FILTERS) as PrintedFilter[]).map((k) => <button key={k} type="button" className={f === k ? "on" : ""} onClick={() => setF(k)}>{k} <small className="cl-mono">{all.filter(PRINTED_FILTERS[k]).length}</small></button>)}</span>
      <input className="vx-search" aria-label="Search printed certificates" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, course, registration, certificate or document no." /><button type="button" className="portal-secondary" disabled={!rows.length} onClick={csv}>Download Excel</button></div>
    {rows.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Trainee</th><th>Course</th><th>Registration No.</th><th>Certificate No.</th><th>Document No.</th><th>Printed</th><th>Payment</th><th>Status</th></tr></thead><tbody>
      {days.map((d) => { const g = prPaged.shown.filter((r) => r.printedOn === d); return [<tr key={d} className="nb-group"><td colSpan={9}><b>{longDay(d)}</b> <span className="cl-sub">{g.length} printed</span></td></tr>,
        ...g.map((r) => <tr key={r.id}><td className="cl-no">{prPaged.offset + prPaged.shown.indexOf(r) + 1}</td><td><b>{r.name}</b>{r.number && <small className="cl-mono cl-sub cl-block">{r.number}</small>}</td><td title={r.courseName}><b>{r.course || "—"}</b></td>
          <td className="cl-mono">{r.regNo || "—"}</td><td className="cl-mono">{r.certNo || "—"}</td><td>{r.docNo ? <span className="cl-mono">{r.docNo}</span> : <span className="pc-miss">Not Encoded</span>}</td>
          <td>{clock(r.printedAt)}<small className="cl-sub cl-block">{r.printedBy}{r.copy > 1 && <> · <Badge tone="orange">{`Copy ${r.copy} · Reprint`}</Badge></>}</small></td>
          <td>{r.balance == null ? "—" : <Badge tone={r.balance > 0 ? "red" : "green"}>{printedPay(r)}</Badge>}</td>
          <td><Badge tone={r.status === "Released" ? "green" : r.status === "Void" ? "orange" : r.status === "Revoked" || r.ageDays > 7 ? "red" : undefined}>{PRINTED_STATUS[r.status]}</Badge><small className="cl-sub cl-block">{printedNote(r)}</small></td></tr>)]; })}
    </tbody></table>{prPaged.pager}</div> : <p className="portal-empty-copy">{all.length ? "No printed certificates match." : "No certificates printed in this period."}</p>}
    <p className="cl-legend pc-sign">Prepared by: Releasing Officer <span>Noted by: Admin</span></p>
  </section>;
}

/** Admin: certificate numbering per course, void requests, and the printing switch. */
/** STCW courses whose certificates New Wave numbers (owner, 13 Oct 2026): BT-PSSR, Safety, Crowd, Crisis, SATSDSD, Ship Security Officer. */
const ADMIN_STCW_CODES = ["UBT-PSSR", "STPPDSPPS", "PSCMT", "PSCMHBT", "SATSDSD", "SSO"];

function NumberingTable({ data, reload, scope }: { data: PortalData; reload: () => Promise<void>; scope: "in-house" | "stcw" | "all" }) {
  const d = data as CertData;
  const { busy, msg, post } = usePost(reload);
  const [q, setQ] = useState("");
  // Certificate No. from the last number used (owner, 20 Oct 2026); the Registration No. is one automatic series (202610200046).
  const [edit, setEdit] = useState<Record<string, { prefix: string; last: string; pad: string; batchPrefix: string; nextBatch: string }>>({});
  const roles = scope === "in-house" ? ["releasing_officer"] : ["admin"];
  const series = new Map((d.certificateSeries ?? []).map((s) => [s.course_id, s]));
  const term = q.trim().toLowerCase();
  // Admin (owner, 13 Oct 2026): the six STCW courses New Wave numbers itself first, then every In-House course.
  const featured = (c: { code: string }) => ADMIN_STCW_CODES.indexOf(c.code);
  const stcwRow = (c: { code: string; course_categories?: unknown }) => featured(c) >= 0 || stcwCourse(c);
  const courses = data.courses.filter((c, i, all) => c.delivery_type === "In-House" && c.code !== "CCI" && all.findIndex((x) => x.id === c.id) === i && (scope === "all" ? (term ? true : featured(c) >= 0 || !stcwCourse(c)) : scope === "stcw" ? (term ? true : stcwCourse(c)) : true) && (term ? `${c.code} ${c.name}`.toLowerCase().includes(term) : true))
    .sort((a, b) => scope === "all" ? ((featured(a) < 0 ? 99 : featured(a)) - (featured(b) < 0 ? 99 : featured(b)) || a.name.localeCompare(b.name)) : scope === "in-house" ? (Number(!stcwRow(a)) - Number(!stcwRow(b)) || a.name.localeCompare(b.name)) : a.name.localeCompare(b.name));
  // Releasing Officer (owner, 20 Oct 2026): New Wave STCW courses first, then every In-House course.
  const groupOf = (c: { code: string; course_categories?: unknown }) => scope === "all" ? (featured(c) >= 0 ? "STCW Courses" : "In-House Courses") : scope === "in-house" ? (stcwRow(c) ? "STCW Courses" : "In-House Courses") : "";
  const valueOf = (id: string) => { const s = series.get(id); return edit[id] ?? { prefix: s?.prefix ?? "", last: s && s.next_number > 1 ? String(s.next_number - 1) : "", pad: String(s?.pad ?? 5), batchPrefix: s?.batch_prefix ?? "", nextBatch: String(s?.next_batch ?? 1) }; };
  const set = (id: string, k: string, v: string) => setEdit({ ...edit, [id]: { ...valueOf(id), [k]: v } });
  return <section className="portal-panel cx-panel"><div className="panel-heading"><h2>{scope === "all" ? "Certificate No. per Course" : scope === "stcw" ? "Certificate Numbering" : "Certificate Numbering"}</h2></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search courses" value={q} onChange={(e) => setQ(e.target.value)} placeholder={scope === "stcw" ? "STCW courses shown; search any course" : "Search any In-House course by name or code"} /></div>
    <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>Course</th><th>Prefix</th><th>Last No. Used</th><th>Digits</th><th>Next Certificate</th><th /></tr></thead><tbody>
      {courses.map((c, i) => { const v = valueOf(c.id), s = series.get(c.id); const changed = !!edit[c.id]; const can = canSetSeries(roles, stcwCourse(c)); const head = groupOf(c) && groupOf(c) !== groupOf(courses[i - 1] ?? { code: "" }) ? groupOf(c) : ""; return [head && <tr key={`${head}-head`} className="nb-group"><td colSpan={6}><b>{head}</b> <span className="cl-sub">{courses.filter((x) => groupOf(x) === head).length}</span></td></tr>, <tr key={c.id}>
        <td className="nb-course"><b>{c.name}</b><small className="cl-sub cl-block"><span className="cl-mono">{c.code}</span> · {s ? `Set ${fmtDate(day(s.set_at) ?? "")}${first(s.profiles)?.complete_name ? ` by ${first(s.profiles)?.complete_name}` : ""}` : "Not set yet"}</small></td>
        <td><input className="cl-in" aria-label="Prefix" disabled={!can || !!s?.cert_format} value={v.prefix} onChange={(e) => set(c.id, "prefix", e.target.value)} placeholder="NWM-HPT-" /></td>
        <td><input className="cl-in cl-num" aria-label="Last certificate number used" disabled={!can} type="number" min={0} value={v.last} onChange={(e) => set(c.id, "last", e.target.value)} placeholder="e.g. 149" /></td>
        <td><input className="cl-in cl-tiny" aria-label="Digits" disabled={!can || !!s?.cert_format} type="number" min={1} max={10} value={v.pad} onChange={(e) => set(c.id, "pad", e.target.value)} /></td>
        <td className="cl-mono cl-next">{s?.cert_format ? formatNumber(s.cert_format, c.code, nextOf(v.last)) : formatCertificateNumber(v.prefix, nextOf(v.last), Number(v.pad) || 5)}</td>
        <td>{can ? <button type="button" className="portal-primary" disabled={busy || !changed} onClick={() => void post({ action: "certificate-series-save", courseId: c.id, prefix: v.prefix.trim(), nextNumber: nextOf(v.last), pad: Math.min(10, Math.max(1, Number(v.pad) || 5)), batchPrefix: v.batchPrefix.trim(), nextBatch: Math.max(1, Number(v.nextBatch) || 1) }, `Numbering saved. The next certificate is ${s?.cert_format ? formatNumber(s.cert_format, c.code, nextOf(v.last)) : formatCertificateNumber(v.prefix.trim(), nextOf(v.last), Number(v.pad) || 5)}; enrolled trainees without a number got theirs in enrollment order.`).then(() => setEdit((e) => { const n = { ...e }; delete n[c.id]; return n; })).catch(() => undefined)}>Save</button> : <span className="cl-sub">Set by the Admin</span>}</td>
      </tr>]; })}
    </tbody></table></div>
    {!courses.length && <p className="portal-empty-copy">{term ? "No courses match." : "No In-House courses."}</p>}
    <p className="cl-legend">Type the last Certificate No. already used for each course once; the portal continues from the next number, in enrollment order. Registration No. is given automatically from one New Wave series when a certificate is printed, and a trainee keeps it for re-prints and retakes of the same course.</p>
  </section>;
}


/** Releasing Officer › Numbering: the last Certificate No. used for every In-House course (owner, 20 Oct 2026: all courses, no batch numbers). */
export function ReleasingNumbering({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  return <div className="portal-page cx ac">
    <Head title="Numbering" note="Type the last Certificate No. used for each New Wave course once, STCW and In-House; the portal continues from there. Registration No. is automatic." />
    <NumberingTable data={data} reload={reload} scope="in-house" />
  </div>;
}

export function AdminCertificateControls({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload);
  const [rejecting, setRejecting] = useState<string | null>(null), [remarks, setRemarks] = useState<ReasonValue>(NO_REASON);
  const voids = certificateLines(data).filter((l) => l.view.state === "Void requested");
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Admin</span><h1>Certificate Controls</h1></div>
      <label className="cl-switch"><input type="checkbox" checked={!!data.certificateIssuanceEnabled} disabled={busy} onChange={(e) => void post({ action: "certificate-issuance-toggle", enabled: e.target.checked }, e.target.checked ? "Printing turned on." : "Printing turned off.").catch(() => undefined)} /><span>Certificate printing {data.certificateIssuanceEnabled ? "on" : "off"}</span></label></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <CertificateAlarm data={data} admin />
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Void Requests</h2><span className="slot-count">{voids.length}</span></div>
          {voids.length ? voids.map((l) => <div key={l.e.id} className="cl-vreq">
            <div><b>{l.name}</b> · <span className="cl-mono">{l.cert?.certificate_number}</span><small className="cl-sub cl-block">{l.course.code} · {l.cert?.void_reason}{l.cert?.void_requested_at ? ` · ${fmtDate(day(l.cert.void_requested_at) ?? "")}` : ""}</small></div>
            {rejecting === l.e.id ? <div className="cl-void"><ReasonField reasons={REJECT_REASONS.certificateVoid} label="Reason for Rejecting" value={remarks} onChange={setRemarks} autoFocus /><button type="button" className="portal-secondary" onClick={() => setRejecting(null)}>Keep</button><button type="button" className="cl-danger" disabled={busy || !reasonReady(remarks)} onClick={() => void post({ action: "certificate-void-decide", enrollmentId: l.e.id, approve: false, remarks: reasonText(remarks) }, "Void request rejected.").then(() => setRejecting(null)).catch(() => undefined)}>Reject</button></div>
              : <span className="cl-acts"><button type="button" className="portal-secondary" disabled={busy} onClick={() => { setRejecting(l.e.id); setRemarks(NO_REASON); }}>Reject</button><button type="button" className="portal-primary" disabled={busy} onClick={() => void post({ action: "certificate-void-decide", enrollmentId: l.e.id, approve: true }, "Void approved. One more print allowed with the same number.").catch(() => undefined)}>Approve Void</button></span>}
          </div>) : <p className="portal-empty-copy">No void requests.</p>}
          <p className="ac-foot">Approving voids the printed copy and allows one more print with the same certificate number.</p>
        </section>
      </div>
      <div className="ac-stack">
      <RevokePanel data={data} reload={reload} />
      </div>
    </div>
  </div>;
}

/**
 * The Releasing Officer corrects only the name that prints on a certificate (owner, 10 Nov 2026: "everything
 * should be systemized"), with a reason, and uploads, replaces or removes the 2x2 photo ("details"). Course,
 * batch, dates and issue date come from the system. Only the Admin changes the Certificate Number ("number").
 */
function CertificateCorrectionsPanel({ data, reload, mode, only, onClose }: { data: PortalData; reload: () => Promise<void>; mode: "details" | "number"; only?: string; onClose?: () => void }) {
  const { busy, msg, post } = usePost(reload);
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState(false);
  const lines = certificateLines(data, { inTrainingDays: WAIT_DAYS });
  const term = q.trim().toLowerCase();
  const found = term.length >= 2 ? lines.filter((l) => `${l.name} ${l.number} ${l.cert?.certificate_number ?? ""} ${l.course.code}`.toLowerCase().includes(term)).slice(0, 8) : [];
  const line = lines.find((l) => l.e.id === pickedId) ?? null;
  const tracked = (data as CertData).certificatePhotos != null;
  const pick = (l: CertificateLine) => { const c = ((l.cert as { corrections?: CertificateCorrections } | null)?.corrections ?? {}) as CertificateCorrections; setPickedId(l.e.id); setQ(""); setForm({ certificateNumber: l.cert?.certificate_number ?? "", name: c.name ?? "", courseName: c.courseName ?? "", batchLabel: c.batchLabel ?? "", startsOn: c.startsOn ?? "", endsOn: c.endsOn ?? "", issuedOn: c.issuedOn ?? "", reason: "" }); };
  // Opened from a row: that trainee, no search.
  if (only && pickedId !== only) { const l = lines.find((x) => x.e.id === only); if (l) pick(l); }
  const t = line ? first(line.e.trainees) : null, b = line ? first(line.e.batches) : null;
  const portal: Record<string, string> = line ? { name: t ? [t.legal_first_name, (t as { legal_middle_name?: string | null }).legal_middle_name, t.legal_last_name].filter(Boolean).join(" ") : "", courseName: line.course.name, batchLabel: line.cert?.batch_label ?? b?.batch_number ?? "", startsOn: b?.starts_on ?? line.e.scheduled_on ?? "", endsOn: line.ended ?? "", issuedOn: "Print date" } : {};
  const FIELDS: [string, string, string][] = [["name", "Name", "text"], ["courseName", "Course", "text"], ["batchLabel", "Batch", "text"], ["startsOn", "Training Start", "date"], ["endsOn", "Training End", "date"], ["issuedOn", "Issue Date", "date"]];
  const removePhoto = async () => { if (!line || !await askConfirm("Remove this trainee's 2x2 photo? The certificate cannot print until a new photo is uploaded.")) return; const r = await fetch(`/api/staff/certificate-photo?enrollmentId=${line.e.id}`, { method: "DELETE" }); if (r.ok) await reload(); };
  if (mode === "number") return <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Change a Certificate Number</h2></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search trainee" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, NWMTACI number or certificate number" /></div>
    {found.length > 0 && <div className="cc-found">{found.map((l) => <button type="button" key={l.e.id} onClick={() => pick(l)}><b>{l.name}</b><span>{l.course.code} · {l.cert?.certificate_number ?? "No number yet"}</span></button>)}</div>}
    {line ? <div className="cc-edit">
      <p className="cc-who"><b>{line.name}</b> · {line.course.code}<button type="button" className="ghost-button" onClick={() => setPickedId(null)}>Close</button></p>
      <div className="cl-void"><label>Certificate Number<input className="cl-mono" value={form.certificateNumber ?? ""} onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })} placeholder="NWM-BT-01245" /></label>
        <label>Reason<input value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Number series corrected" /></label>
        <button type="button" className="portal-primary" disabled={busy || (form.certificateNumber ?? "").trim().length < 2 || (form.reason ?? "").trim().length < 3 || (form.certificateNumber ?? "").trim() === (line.cert?.certificate_number ?? "")} onClick={() => void post({ action: "certificate-number-set", enrollmentId: line.e.id, certificateNumber: (form.certificateNumber ?? "").trim(), reason: (form.reason ?? "").trim() }, "Certificate Number changed.").catch(() => undefined)}>Save Number</button></div>
      <p className="ac-foot">Current: <span className="cl-mono">{line.cert?.certificate_number ?? "Not assigned yet"}</span>. Every change is recorded in the audit log. The Releasing Officer corrects the name, course, batch, dates and photo.</p>
    </div> : <p className="portal-empty-copy">Search a trainee to change their Certificate Number.</p>}
  </section>;
  return <section className="portal-panel cx-panel">{!only && <div className="panel-heading"><h2>Corrections and Photos</h2></div>}
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {!only && <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search trainee" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, NWMTACI number or certificate number" /></div>}
    {!only && found.length > 0 && <div className="cc-found">{found.map((l) => <button type="button" key={l.e.id} onClick={() => pick(l)}><b>{l.name}</b><span>{l.course.code} · {l.cert?.certificate_number ?? "No number yet"}</span></button>)}</div>}
    {line ? <div className="cc-edit">
      <p className="cc-who"><b>{line.name}</b> · {line.course.code}{line.cert?.certificate_number ? <> · <span className="cl-mono">{line.cert.certificate_number}</span></> : null}<button type="button" className="ghost-button" onClick={() => (onClose ? onClose() : setPickedId(null))}>Close</button></p>
      {tracked && <div className="cc-photo"><span>2x2 Photo: {line.photo ? <><b>On file</b> <small className="cl-sub">{line.photo.file_name}</small></> : <b className="cl-x">Not uploaded</b>}</span><span className="cl-acts">{line.photo && <ViewIcon label="View Photo" onClick={() => void openCertificatePhoto(line.e.id)} />}<button type="button" className="portal-secondary" onClick={() => setReplacing(true)}>{line.photo ? "Replace Photo" : "Upload Photo"}</button>{line.photo && <button type="button" className="cl-danger" onClick={() => void removePhoto()}>Remove Photo</button>}</span></div>}
      <div className="cl-wrap"><table className="cl-log cl-light cc-table"><thead><tr><th>Field</th><th>From the Portal</th><th>Prints As (Correction)</th></tr></thead><tbody>
        {FIELDS.map(([k, label, type]) => <tr key={k}><td>{label}</td><td>{type === "date" && portal[k] && portal[k] !== "Print date" ? fmtDate(portal[k]) : portal[k] || "—"}</td><td>{k === "name" ? <input className="cl-in" type={type} aria-label={`${label} correction`} value={form[k] ?? ""} placeholder="Same as the portal" onChange={(e) => setForm({ ...form, [k]: e.target.value })} /> : <span className="cl-sub">From the system</span>}</td></tr>)}
      </tbody></table></div>
      <div className="cl-void"><label>Reason for the Correction<input value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Name spelled as in the passport" /></label>
        <button type="button" className="portal-primary" disabled={busy || (form.reason ?? "").trim().length < 3} onClick={() => void post({ action: "certificate-correct", enrollmentId: line.e.id, name: (form.name ?? "").trim(), reason: (form.reason ?? "").trim() }, "Name saved.").catch(() => undefined)}>Save Name</button></div>
      <p className="ac-foot">Only the name is corrected here. Course, batch and dates come from the system: fix them at the enrollment or the batch. Leave the name blank to print the registered name. A certificate already printed needs an approved void or a paid Reprinting request for a corrected copy.</p>
    </div> : <p className="portal-empty-copy">Search a trainee to correct their certificate details or photo.</p>}
    {replacing && line && <CertificatePhotoModal enrollmentId={line.e.id} traineeName={line.name} fileName={line.fileName} replacing={!!line.photo} onClose={() => setReplacing(false)} onDone={async () => { setReplacing(false); await reload(); }} />}
  </section>;
}

/**
 * Admin › Certificate Numbers › Numbering (owner, 5 Nov 2026; design/ubt-pssr-certificate-prototype.html). The Admin types the
 * format of the numbers once, per course, with a live preview; after that the portal gives every number. Printed numbers never change.
 */
const NUMBER_TOKENS: [string, string][] = [["{CODE}", "Course Code"], ["{YYYY}", "Year"], ["{YY}", "Year, 2 Digits"], ["{MM}", "Month"], ["{M}", "Month, No Zero"], ["{N:6}", "Running Number, 6 Digits"]];
type FormatRow = { cert: string; reg: string; last: string };

function NumberFormats({ data, reload, settings }: { data: PortalData; reload: () => Promise<void>; settings: NumberSettings | null | undefined }) {
  const d = data as CertData;
  const series = new Map((d.certificateSeries ?? []).map((s) => [s.course_id, s]));
  const startReg = settings?.reg_format ?? `${settings?.reg_prefix ?? "NWMTC"}{N:${settings?.reg_digits ?? 6}}-{MM}{YYYY}`, startLast = String(settings?.reg_last ?? 0);
  const [regFormat, setRegFormat] = useState(startReg), [regLast, setRegLast] = useState(startLast);
  const [edit, setEdit] = useState<Record<string, FormatRow>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  // The box the token chips add to: the last one the cursor was in.
  const active = useRef<{ el: HTMLInputElement; set: (v: string) => void } | null>(null);
  const addToken = (token: string) => { const a = active.current; if (!a) return; const at = a.el.selectionStart ?? a.el.value.length, end = a.el.selectionEnd ?? at; a.set(a.el.value.slice(0, at) + token + a.el.value.slice(end)); requestAnimationFrame(() => { a.el.focus(); a.el.setSelectionRange(at + token.length, at + token.length); }); };
  const derived = (id: string) => { const s = series.get(id); return s?.prefix ? `${s.prefix}{N:${s.pad}}` : ""; };
  const saved = (id: string): FormatRow => { const s = series.get(id); return { cert: s?.cert_format ?? derived(id), reg: s?.reg_format ?? "", last: s && s.next_number > 1 ? String(s.next_number - 1) : "" }; };
  const valueOf = (id: string) => edit[id] ?? saved(id);
  const set = (id: string, k: keyof FormatRow, v: string) => setEdit((cur) => ({ ...cur, [id]: { ...(cur[id] ?? saved(id)), [k]: v } }));
  const term = q.trim().toLowerCase();
  const rank = (c: { code: string }) => { const i = ADMIN_STCW_CODES.indexOf(c.code); return i < 0 ? 99 : i; };
  const courses = data.courses.filter((c, i, all) => c.delivery_type === "In-House" && c.code !== "CCI" && all.findIndex((x) => x.id === c.id) === i && (term ? `${c.code} ${c.name}`.toLowerCase().includes(term) : rank(c) < 99 || !stcwCourse(c))).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const { shown, pager } = usePaged(courses, 10);
  const groupOf = (c: { code: string }) => (rank(c) < 99 ? "STCW Courses" : "In-House Courses");
  const nextRegNo = (Number(regLast) || 0) + 1;
  const changed = Object.keys(edit).filter((id) => JSON.stringify(edit[id]) !== JSON.stringify(saved(id)));
  const regChanged = regFormat.trim() !== startReg || regLast !== startLast;
  const problemOf = (v: string) => (v.trim() ? formatProblem(v.trim()) : null);
  const regProblem = formatProblem(regFormat.trim());
  const blocked = !!regProblem || changed.some((id) => problemOf(edit[id].cert) || problemOf(edit[id].reg));
  async function saveAll() {
    setBusy(true); setMsg(null);
    try {
      if (regChanged) await submit({ action: "certificate-number-settings-save", regPrefix: regFormat.trim().split("{")[0] || settings?.reg_prefix || "NWMTC", regLast: Number(regLast) || 0, regDigits: Number(regFormat.match(/\{N:(\d+)\}/)?.[1]) || settings?.reg_digits || 6, regFormat: regFormat.trim() });
      for (const id of changed) {
        const v = edit[id], typed = v.cert.trim();
        // A format that only repeats the old prefix and digits stays on them.
        await submit({ action: "certificate-format-save", courseId: id, certFormat: !typed || typed === derived(id) ? null : typed, regFormat: v.reg.trim() || null, lastUsed: Math.max(0, Math.trunc(Number(v.last) || 0)) });
      }
      await reload();
      setEdit({});
      setMsg({ kind: "success", text: "Saved. From now on the portal gives these numbers." });
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(false); }
  }
  const pending = changed.length + (regChanged ? 1 : 0);
  return <>
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Registration No., Default for Every Course</h2></div>
      <div className="portal-form cx-formpad"><label className="cn-wide">Format<input className={`cl-mono lc${regProblem ? " cn-bad" : ""}`} value={regFormat} onFocus={(e) => { active.current = { el: e.currentTarget, set: setRegFormat }; }} onChange={(e) => setRegFormat(e.target.value)} />{regProblem && <small className="cn-err">{regProblem}</small>}</label><label>Last Number Used<input type="number" min={0} className="cl-mono" value={regLast} onChange={(e) => setRegLast(e.target.value)} /></label></div>
      <div className="cn-next"><span>Next Registration No.</span><b className="cl-mono lc">{regProblem ? "—" : formatNumber(regFormat.trim(), "", nextRegNo)}</b></div>
    </section>
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Certificate No. per Course</h2></div>
      {msg && <Message kind={msg.kind} text={msg.text} />}
      <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search courses" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any In-House course by name or code" /></div>
      <div className="cn-chips"><span>Tap to Add:</span>{NUMBER_TOKENS.map(([t, label]) => <button type="button" key={t} className="cn-chip lc" onMouseDown={(e) => e.preventDefault()} onClick={() => addToken(t)}>{t}<small>{label}</small></button>)}</div>
      <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>Course</th><th>Certificate No. Format</th><th>Last No. Used</th><th>Registration No. Format</th><th>Next Numbers</th></tr></thead><tbody>
        {shown.map((c, i) => { const v = valueOf(c.id), certBad = problemOf(v.cert), regBad = problemOf(v.reg), head = i === 0 || groupOf(c) !== groupOf(shown[i - 1]) ? groupOf(c) : ""; const regShape = v.reg.trim() || regFormat.trim(); return [head && <tr key={`${head}-${c.id}`} className="nb-group"><td colSpan={5}><b>{head}</b></td></tr>, <tr key={c.id}>
          <td className="nb-course"><b>{c.code}</b><small className="cl-sub cl-block">{c.name}</small></td>
          <td><input className={`cl-in cn-fmt lc${certBad ? " cn-bad" : ""}`} aria-label={`Certificate No. format for ${c.code}`} value={v.cert} onFocus={(e) => { active.current = { el: e.currentTarget, set: (x) => set(c.id, "cert", x) }; }} onChange={(e) => set(c.id, "cert", e.target.value)} />{certBad && <small className="cn-err">{certBad}</small>}</td>
          <td><input className="cl-in cl-num" aria-label={`Last Certificate No. used for ${c.code}`} type="number" min={0} value={v.last} placeholder="0" onChange={(e) => set(c.id, "last", e.target.value)} /></td>
          <td><input className={`cl-in cn-fmt lc${regBad ? " cn-bad" : ""}`} aria-label={`Registration No. format for ${c.code}`} placeholder="Same as Default" value={v.reg} onFocus={(e) => { active.current = { el: e.currentTarget, set: (x) => set(c.id, "reg", x) }; }} onChange={(e) => set(c.id, "reg", e.target.value)} />{regBad && <small className="cn-err">{regBad}</small>}</td>
          <td className="cl-mono cl-next lc">{v.cert.trim() && !certBad ? formatNumber(v.cert.trim(), c.code, nextOf(v.last)) : <small className="cl-sub">Set a Format First</small>}<small className="cl-sub cl-block">{!regBad && !regProblem ? formatNumber(regShape, c.code, nextRegNo) : "—"}</small></td>
        </tr>]; })}
      </tbody></table></div>
      {!courses.length && <p className="portal-empty-copy">No courses match.</p>}
      {pager}
      {pending > 0 && <div className="cn-savebar"><span>{pending} Unsaved {pending === 1 ? "Change" : "Changes"}</span><span className="cl-acts"><button type="button" className="portal-secondary" disabled={busy} onClick={() => { setEdit({}); setRegFormat(startReg); setRegLast(startLast); }}>Discard</button><button type="button" className="portal-primary" disabled={busy || blocked} onClick={() => void saveAll()}>{busy ? "Saving…" : "Save Changes"}</button></span></div>}
      <p className="cl-legend">Numbers already printed never change. A number reserved for an enrolled trainee and not printed yet takes the new format. Each print takes the next number, and a trainee keeps their Registration No. for re-prints and retakes of the same course.</p>
    </section>
  </>;
}

/* ------------------------------------------------------------ certificate numbers (Admin) */

/** Admin › Certifications › Certificate Numbers (owner, 5 Nov 2026). */
export function AdminNumberFormats({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const settings = (data as CertData & { certificateNumberSettings?: NumberSettings | null }).certificateNumberSettings;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Admin</span><h1>Certificate Numbers</h1></div></div>
    <NumberFormats data={data} reload={reload} settings={settings} />
  </div>;
}

type NumberSettings = { reg_prefix: string; reg_last: number; reg_digits: number; set_at: string | null; reg_format?: string | null };
type LegacyCert = { id: string; trainee_name: string; nwmtaci_number: string | null; course_code: string | null; enrollment_id: string | null; certificate_number: string | null; registration_number: string | null; issued_on: string | null; recorded_at: string };
/**
 * Admin › Certificate Numbers (owner, 9 Oct 2026): continue New Wave's existing
 * series — Registration No. (new on every certificate, ending in the issue month
 * and year) and Certificate No. per course — and record certificates printed
 * before the portal so their numbers are never reused. The Doc. No. is written
 * on the printed certificate by hand.
 */
export function AdminCertificateNumbers({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const d = data as CertData & { certificateNumberSettings?: NumberSettings | null; legacyCertificates?: LegacyCert[] };
  const { busy, msg, setMsg, post } = usePost(reload);
  const [tab, setTab] = useState<"numbering" | "legacy">("numbering");
  const ns = d.certificateNumberSettings;
  const [one, setOne] = useState<LegacyRow>({ traineeName: "", nwmtaciNumber: "", courseCode: "", certificateNumber: "", registrationNumber: "", issuedOn: "" });
  const [preview, setPreview] = useState<{ file: string; rows: LegacyRow[]; missing: string[] } | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const legacy = d.legacyCertificates ?? [];
  const chooseCsv = async (file: File | undefined) => { setResults(null); if (!file) return; const parsed = legacyRowsFromCsv(await file.text()); setPreview({ file: file.name, ...parsed }); if (parsed.missing.length) setMsg({ kind: "error", text: `The spreadsheet needs these columns: ${parsed.missing.join(", ")}.` }); };
  const importRows = () => preview && void post({ action: "legacy-certificate-import", rows: preview.rows }).then((r) => { const res = (r as { results?: ImportResult[] }).results ?? []; setResults(res); setPreview(null); setMsg({ kind: "success", text: `${res.filter((x) => x.ok).length} of ${res.length} recorded · ${res.filter((x) => x.ok && x.matched).length} matched to a trainee's enrollment.` }); }).catch(() => undefined);
  const addOne = () => void post({ action: "legacy-certificate-add", row: one }, "Recorded. These numbers are reserved.").then(() => setOne({ traineeName: "", nwmtaciNumber: "", courseCode: "", certificateNumber: "", registrationNumber: "", issuedOn: "" })).catch(() => undefined);
  const field = (k: keyof LegacyRow, label: string, ph: string, type = "text") => <label>{label}<input type={type} className={type === "text" ? "cl-mono" : undefined} value={one[k]} placeholder={ph} onChange={(e) => setOne({ ...one, [k]: e.target.value })} /></label>;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Admin</span><h1>Certificate Numbers</h1></div>
      <span className="cn-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "numbering"} className={tab === "numbering" ? "on" : ""} onClick={() => setTab("numbering")}>Numbering</button><button type="button" role="tab" aria-selected={tab === "legacy"} className={tab === "legacy" ? "on" : ""} onClick={() => setTab("legacy")}>Issued Before the Portal{legacy.length ? ` · ${legacy.length}` : ""}</button></span></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {tab === "numbering" ? <>
      <NumberFormats data={data} reload={reload} settings={ns} />
    </> : <>
      <p className="ac-note">Record certificates you already printed, so their numbers are reserved and the trainees show as released. Upload your log as a CSV (save the Excel sheet as CSV), or add one at a time.</p>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Upload Your Log</h2><span className="muted-text">Columns: Trainee (LAST, FIRST) · NWMTACI No. · Course · Certificate No. · Registration No. · Date Issued</span></div>
        <div className="cn-drop"><label className="portal-secondary">Choose CSV File<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { void chooseCsv(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <span className="muted-text">Each row is matched to the trainee and course in the portal; rows that do not match still reserve their numbers.</span></div>
        {preview && <><div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Trainee</th><th>Course</th><th>Certificate No.</th><th>Registration No.</th><th>Issued</th></tr></thead><tbody>
          {preview.rows.slice(0, 50).map((r, i) => <tr key={i}><td className="cl-no">{i + 1}</td><td>{r.traineeName}<small className="cl-sub cl-block">{r.nwmtaciNumber}</small></td><td>{r.courseCode || "—"}</td><td className="cl-mono">{r.certificateNumber || "—"}</td><td className="cl-mono">{r.registrationNumber || "—"}</td><td>{r.issuedOn ? fmtDate(r.issuedOn) : "—"}</td></tr>)}
        </tbody></table></div>
          <div className="cn-save"><span className="muted-text">{preview.file}: {preview.rows.length} row{preview.rows.length === 1 ? "" : "s"}{preview.rows.length > 50 ? " (first 50 shown)" : ""}</span><span className="cl-acts"><button type="button" className="portal-secondary" onClick={() => setPreview(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !preview.rows.length || preview.missing.length > 0 || preview.rows.length > 500} onClick={importRows}>Record {preview.rows.length} Certificates</button></span></div></>}
        {results && results.some((r) => !r.ok || !r.matched) && <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Trainee</th><th>Certificate No.</th><th>Result</th></tr></thead><tbody>
          {results.filter((r) => !r.ok || !r.matched).map((r, i) => <tr key={i}><td>{r.traineeName}</td><td className="cl-mono">{r.certificateNumber || "—"}</td><td><Badge tone={r.ok ? "orange" : "red"}>{r.ok ? "Reserved · not matched" : "Not recorded"}</Badge><small className="cl-sub cl-block">{r.message}</small></td></tr>)}
        </tbody></table></div>}
      </section>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Add One Certificate</h2></div>
        <div className="portal-form cx-formpad cn-grid">
          {field("traineeName", "Trainee (LAST, FIRST)", "DELA CRUZ, Juan")}{field("nwmtaciNumber", "NWMTACI No. (optional)", "NWMTACI-0000411")}{field("courseCode", "Course Code", "FSH")}
          {field("certificateNumber", "Certificate No.", "FSH000053")}{field("registrationNumber", "Registration No.", "NWMTC007540-092026")}{field("issuedOn", "Date Issued", "", "date")}
          <div className="portal-form-actions full"><button type="button" className="portal-primary" disabled={busy || one.traineeName.trim().length < 2 || !(one.certificateNumber || one.registrationNumber)} onClick={addOne}>Record Certificate</button></div>
        </div></section>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Recorded</h2><span className="slot-count">{legacy.length}</span></div>
        {legacy.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Trainee</th><th>Course</th><th>Certificate No.</th><th>Registration No.</th><th>Issued</th><th>Portal Match</th></tr></thead><tbody>
          {legacy.map((r) => <tr key={r.id}><td>{r.trainee_name}<small className="cl-sub cl-block">{r.nwmtaci_number ?? ""}</small></td><td>{r.course_code ?? "—"}</td><td className="cl-mono">{r.certificate_number ?? "—"}</td><td className="cl-mono">{r.registration_number ?? "—"}</td><td>{r.issued_on ? fmtDate(r.issued_on) : "—"}</td><td>{r.enrollment_id ? <Badge tone="green">Matched · Released</Badge> : <Badge tone="orange">Numbers reserved</Badge>}</td></tr>)}
        </tbody></table></div> : <p className="portal-empty-copy">Nothing recorded yet.</p>}
      </section>
    </>}
  </div>;
}

/** Admin › Certificate Controls › Revoke (owner, 20 Oct 2026): the verification page shows REVOKED at once and printing stops. */
function RevokePanel({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload);
  const [q, setQ] = useState(""), [pickedId, setPickedId] = useState<string | null>(null), [reason, setReason] = useState(""), [asking, setAsking] = useState(false);
  const lines = certificateLines(data).filter((l) => l.cert?.certificate_number);
  const term = q.trim().toLowerCase();
  const found = term.length >= 2 ? lines.filter((l) => `${l.name} ${l.number} ${l.cert?.certificate_number ?? ""}`.toLowerCase().includes(term)).slice(0, 8) : [];
  const line = lines.find((l) => l.e.id === pickedId) ?? null;
  const revoked = !!line?.cert?.revoked_at;
  return <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Revoke a Certificate</h2></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search certificate to revoke" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search certificate number or trainee" /></div>
    {found.length > 0 && <div className="cc-found">{found.map((l) => <button type="button" key={l.e.id} onClick={() => { setPickedId(l.e.id); setQ(""); setReason(""); setAsking(false); }}><b>{l.name}</b><span>{l.course.code} · {l.cert?.certificate_number}</span></button>)}</div>}
    {line && <div className="cc-edit">
      <p><b>{line.name}</b> · {line.course.name} · <span className="cl-mono">{line.cert?.certificate_number}</span> <Badge tone={revoked ? "red" : "green"}>{revoked ? "Revoked" : "Valid"}</Badge></p>
      {revoked ? <p className="cl-sub">Revoked{line.cert?.revoked_reason ? `: ${line.cert.revoked_reason}` : ""}. {"The verification page shows: This certificate has been revoked."}</p> : <div className="cl-void">
        <label>Reason<input value={reason} onChange={(e) => { setReason(e.target.value); setAsking(false); }} placeholder="e.g. Issued in error: trainee did not complete the course" /></label>
        {asking ? <><span className="cl-sub">Revoke {line.cert?.certificate_number}? This shows on the verification page at once.</span><button type="button" className="portal-secondary" onClick={() => setAsking(false)}>Keep</button><button type="button" className="cl-danger" disabled={busy} onClick={() => void post({ action: "certificate-revoke", enrollmentId: line.e.id, reason: reason.trim() }, "Certificate revoked. Its QR page now shows REVOKED.").then(() => setAsking(false)).catch(() => undefined)}>Yes, Revoke</button></>
          : <button type="button" className="cl-danger" disabled={reason.trim().length < 5} onClick={() => setAsking(true)}>Revoke</button>}
      </div>}
    </div>}
  </section>;
}
