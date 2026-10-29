"use client";

import { useState } from "react";
import { downloadCsv } from "@/lib/csv";
import type { PortalData, Enrollment } from "../portal-live-app";
import { addDays, first, manilaToday, dueCentavos, pesos2 } from "@/lib/portal-format";
import { automaticEndDate } from "@/lib/scheduling";
import { canPrint, canSetSeries, certificateState, evaluationRequiredFor, formatCertificateNumber, nextOf, isStcwCategory, matchTemplateFiles, releaseProblem, type CertificateView } from "@/lib/certificate-rules";
import { Badge, Message, fmtDate, usePaged, usePost } from "./shared-ui";
import { ReleaseConfirm } from "./live-releasing";
import { DeliveryAlert } from "./delivery-home";
import { tcl } from "@/lib/title-case";
import { photoFileName, type CertificateCorrections } from "@/lib/certificate-photo";
import { CertificatePhotoModal, openCertificatePhoto } from "./certificate-photo-modal";
import { legacyRowsFromCsv, type ImportResult, type LegacyRow } from "@/lib/legacy-certificates";
import { PRINTED_FILTERS, printedReportRows, type PrintedCert, type PrintedFilter } from "@/lib/printed-certificates";
import { askConfirm } from "./dialogs";

/**
 * Releasing Officer (owner, 8 Oct 2026): certificates due to print, printed
 * once, reprinted only after a paid Reprinting request or an Admin-approved
 * void. The log is the formal certificate register (owner's choice, design C).
 * The Admin sets the numbering and decides void requests (AdminCertificateControls).
 */

type CertRow = { id: string; enrollment_id: string; status: string; certificate_number?: string | null; batch_label?: string | null; print_count?: number | null; reprints_allowed?: number | null; void_status?: string | null; void_reason?: string | null; void_requested_at?: string | null; soft_copy_sent_at?: string | null; snapshot?: Record<string, unknown> | null; claimant_name?: string | null; release_method?: string | null; revoked_at?: string | null; revoked_reason?: string | null; sticker_no?: string | null };
type Series = { course_id: string; prefix: string; next_number: number; pad: number; batch_prefix: string; next_batch: number; set_at: string; reg_prefix?: string; reg_next?: number | null; reg_digits?: number; reg_style?: "month-number" | "number-month"; profiles?: { complete_name: string } | { complete_name: string }[] | null };
type Template = { id: string; course_id: string; version: number; active: boolean; drive_link?: string | null; storage_path?: string | null; approved_at?: string | null };
const stcwCourse = (c: { course_categories?: unknown }) => isStcwCategory((Array.isArray(c.course_categories) ? c.course_categories[0] : c.course_categories as { name?: string } | null)?.name);
type Photo = { enrollment_id: string; file_name: string; background_white: boolean; uploaded_at: string; replaced_at?: string | null; profiles?: { complete_name: string } | { complete_name: string }[] | null };
type CertData = PortalData & { certificateSeries?: Series[]; evaluationForms?: Record<string, string>; feedbackAt?: Record<string, string>; feedbackLinks?: Record<string, string>; certificatePhotos?: Photo[] | null; postTestResults?: Record<string, PostTestResult> };
type PostTestResult = { required: boolean; passed: boolean; best: { score: number; total: number; percent: number } | null; attempts: number };

export type CertificateLine = { e: Enrollment; cert: CertRow | null; view: CertificateView; name: string; number: string; course: { id: string; name: string; code: string }; starts: string | null; ended: string | null; evalNeeded: boolean; evalDone: boolean; evalLink: string | null; postTest: PostTestResult | null; balance: number; photo: Photo | null; fileName: string };

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
    const view = certificateState({ enrollmentStatus: e.enrollment_status, trainingEnd: ended, balanceCentavos: balance, evaluationRequired: evalNeeded, evaluationOn: day(fb), paidOn: lastPaid.get(e.trainee_id) ?? null, cert: cert ? { status: cert.status, printCount: Number(cert.print_count ?? (["Printed", "Released"].includes(cert.status) ? 1 : 0)), reprintsAllowed: Number(cert.reprints_allowed ?? 0), voidStatus: cert.void_status, revoked: !!cert.revoked_at } : null, photoOnFile: photos ? photos.has(e.id) : undefined }, today);
    if (view.state === "Cancelled") continue;
    if (view.state === "Training not finished" && (opts.inTrainingDays === undefined || !ended || ended > addDays(today, opts.inTrainingDays))) continue;
    const t = first(e.trainees);
    const fileName = photoFileName({ lastName: t?.legal_last_name ?? "TRAINEE", firstName: t?.legal_first_name ?? "", middleName: (t as { legal_middle_name?: string | null } | null)?.legal_middle_name, courseCode: c.code, batchNumber: b?.batch_number ?? null, date: ended ?? today });
    lines.push({ e, cert, view, photo: photos?.get(e.id) ?? null, fileName, name: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : e.enrollment_number, number: data.applicationNumbers?.[e.trainee_id] ?? t?.trainee_number ?? e.enrollment_number, course: { id: c.id, name: c.name, code: c.code }, starts: b?.starts_on ?? e.scheduled_on ?? null, ended, evalNeeded, evalDone: !!fb, evalLink: d.feedbackLinks?.[e.id] ?? null, postTest: d.postTestResults?.[e.id] ?? null, balance });
  }
  const rank = (l: CertificateLine) => (l.view.overdue ? 0 : l.view.state === "Due" ? 1 : l.view.state === "Waiting for photo" ? 2 : l.view.state === "Void requested" ? 2 : l.view.state === "Waiting for payment" || l.view.state === "Waiting for evaluation" ? 3 : 4);
  return lines.sort((a, b) => rank(a) - rank(b) || (a.ended ?? "").localeCompare(b.ended ?? ""));
}

const STATES: [string, string][] = [["Due", "#0571D0"], ["Waiting for photo", "#c2410c"], ["Waiting for evaluation", "#7a3fb8"], ["Waiting for payment", "#F25615"], ["Printed", "#0a7a3e"], ["Released", "#5d6f7e"], ["Void requested", "#b42318"], ["Revoked", "#8a1c12"]];
const tone = (l: CertificateLine) => (l.view.overdue ? "red" : l.view.state === "Due" ? "blue" : l.view.state === "Printed" ? "green" : l.view.state === "Void requested" || l.view.state === "Revoked" ? "red" : l.view.state === "Waiting for payment" || l.view.state === "Waiting for photo" ? "orange" : undefined);
const label = (l: CertificateLine) => (l.view.overdue ? "Overdue" : l.view.state === "Waiting for evaluation" ? "Evaluation" : l.view.state === "Waiting for photo" ? "Photo needed" : l.view.state === "Waiting for payment" ? "Payment" : l.view.state === "Printed" && l.view.printsLeft > 0 ? "Reprint ready" : l.view.state);

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

function StateColumn({ lines, pick, onPick }: { lines: CertificateLine[]; pick?: string; onPick?: (s: string) => void }) {
  const overdue = lines.filter((l) => l.view.overdue).length;
  return <div className="cx-tiles ac-tiles ac-tiles-in">
    {STATES.map(([s, c]) => { const n = lines.filter((l) => l.view.state === s).length; return onPick
      ? <button type="button" key={s} className={`cx-tile ac-pick ac-count${pick === s ? " on" : ""}`} style={{ ["--c" as string]: c }} onClick={() => onPick(pick === s ? "" : s)}><span>{tcl(s)}</span><b>{n}</b></button>
      : <div key={s} className="cx-tile ac-count" style={{ ["--c" as string]: c }}><span>{tcl(s)}</span><b>{n}</b></div>; })}
    <div className={`cx-tile ac-count${overdue ? " cl-overdue" : ""}`} style={{ ["--c" as string]: "#b42318" }}><span>Overdue to print</span><b>{overdue}</b></div>
  </div>;
}

/** STCW first, then In-House (owner, 20 Oct 2026): the course group of a certificate line. */
const courseGroupOf = (data: PortalData) => { const byId = new Map(data.courses.map((c) => [c.id, c])); return (l: CertificateLine) => { const c = byId.get(l.course.id); return c && stcwCourse(c) ? "STCW Courses" : "In-House Courses"; }; };
function byCourseGroup(data: PortalData, lines: CertificateLine[]) {
  const groupOf = courseGroupOf(data);
  return ["STCW Courses", "In-House Courses"].map((g) => ({ group: g, lines: lines.filter((l) => groupOf(l) === g) })).filter((x) => x.lines.length);
}
type Dot = { label: string; k: "y" | "n" | "w"; onClick?: () => void; href?: string; title?: string };
/** Progress Steps (owner, 20 Oct 2026): ✓ done, ✗ missing, ◷ not yet due. A done Photo or Evaluation opens its file. */
function ProgressDots({ dots }: { dots: Dot[] }) {
  return <ol className="wt-prog" aria-label="Progress">{dots.map((d) => <li key={d.label} className={d.k} title={d.title ?? `${d.label}: ${d.k === "y" ? "done" : d.k === "w" ? "not yet" : "missing"}`}>
    {d.href ? <a className="wt-dot" href={d.href} target="_blank" rel="noreferrer">✓</a> : d.onClick ? <button type="button" className="wt-dot" onClick={d.onClick}>✓</button> : <span className="wt-dot">{d.k === "y" ? "✓" : d.k === "w" ? "◷" : "✗"}</span>}<span>{d.label}</span></li>)}</ol>;
}
function certificateDots(l: CertificateLine, tracked: boolean, training = false): Dot[] {
  const after = (done: boolean): "y" | "n" | "w" => done ? "y" : training ? "w" : "n";
  return [
    ...(training ? [{ label: "Training", k: "w" as const }] : []),
    { label: "Paid", k: l.balance > 0 ? "n" : "y", title: l.balance > 0 ? `Balance ${pesos2(l.balance)}` : "Paid" },
    ...(l.postTest?.required ? [{ label: "Post-Test", k: after(!!l.postTest.passed), title: l.postTest.best ? `Best ${l.postTest.best.score}/${l.postTest.best.total}` : undefined }] : []),
    ...(l.evalNeeded ? [{ label: "Evaluation", k: after(l.evalDone), href: l.evalLink ?? undefined, title: l.evalLink ? "Open the evaluation PDF in Google Drive" : undefined }] : []),
    ...(tracked ? [{ label: "Photo", k: (l.photo ? "y" : "n") as "y" | "n", onClick: l.photo ? () => void openCertificatePhoto(l.e.id) : undefined, title: l.photo?.file_name }] : []),
  ];
}

/** The formal certificate log (design C): numbered lines, one line per certificate, one split action. */
function CertificateLog({ data, lines, reload }: { data: PortalData; lines: CertificateLine[]; reload: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [releasing, setReleasing] = useState<CertificateLine | null>(null);
  const [uploading, setUploading] = useState<CertificateLine | null>(null);
  const tracked = (data as CertData).certificatePhotos != null;
  const pdf = (l: CertificateLine, preview: boolean) => `/api/documents/certificate/${l.e.id}${preview ? "?preview=1" : ""}`;
  // The print opens in a new tab; refresh so the counter (and the button) update.
  const afterPrint = () => window.setTimeout(() => void reload(), 2500);
  const paged = usePaged(byCourseGroup(data, lines).flatMap((x) => x.lines));
  if (!lines.length) return <p className="portal-empty-copy">Nothing here.</p>;
  return <>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cl-wrap"><table className="cl-log cl-cert"><thead><tr><th>#</th><th>Trainee · NWMTACI No.</th><th>Course · Ended</th><th>Certificate No.</th><th>Progress</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {byCourseGroup(data, paged.shown).flatMap(({ group, lines: g }) => [<tr key={group} className="nb-group"><td colSpan={7}><b>{group}</b> <span className="cl-sub">{g.length}</span></td></tr>, ...g.map((l, i) => { const printable = canPrint(l.view) && l.view.state !== "Void requested"; const printed = l.view.printCount > 0; return [
        <tr key={l.e.id}>
          <td className="cl-no">{i + 1}</td>
          <td><b>{l.name}</b><small className="cl-mono cl-sub cl-block">{l.number.replace(/^NWMTACI-/, "")}</small></td>
          <td title={l.course.name}><b>{l.course.code}</b><small className="cl-sub cl-block">Ended {short(l.ended)}</small></td>
          <td><span className="cl-mono">{l.cert?.certificate_number ?? "—"}</span><small className="cl-sub cl-block">Prints {l.view.printCount}/{l.view.printsAllowed}</small></td>
          <td><ProgressDots dots={certificateDots(l, tracked)} /></td>
          <td><Badge tone={tone(l)}>{label(l)}</Badge>{l.view.state === "Waiting for payment" && <small className="cl-sub cl-block">{pesos2(l.balance)} due</small>}</td>
          <td><span className="cl-acts">
            {tracked && !l.photo && <button type="button" className={l.view.state === "Waiting for photo" ? "portal-primary cl-upload" : "portal-secondary cl-upload"} onClick={() => setUploading(l)}>Upload Photo</button>}
            {l.view.state !== "Cancelled" && <span className="cl-split"><a href={pdf(l, true)} target="_blank" rel="noreferrer" onClick={afterPrint} title="Draft for checking; never counts as a print">Preview Draft</a>{printable && <a className="go" href={pdf(l, false)} target="_blank" rel="noreferrer" onClick={afterPrint}>{printed ? "Reprint" : "Print"}</a>}</span>}
            {printed && l.view.state !== "Void requested" && <details className="cl-more"><summary aria-label="More actions">▾</summary><div>
              <button type="button" disabled={busy} onClick={() => { setVoiding(l.e.id); setReason(""); }}>Request Void</button>
              <button type="button" disabled={busy} onClick={() => void post({ action: "certificate-soft-copy", enrollmentId: l.e.id }, "Soft copy emailed.").catch(() => undefined)}>Email Soft Copy</button>
              {l.view.state === "Printed" && <ReleaseButton l={l} onRelease={() => setReleasing(l)} />}
            </div></details>}
            {l.view.state === "Void requested" && <span className="cl-sub">With the Admin</span>}
          </span></td>
        </tr>,
        voiding === l.e.id && <tr key={`${l.e.id}-void`} className="cl-voidrow"><td /><td colSpan={6}><div className="cl-void">
          <label>Reason for Voiding<input value={reason} autoFocus onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Misprint — wrong spelling of the name" /></label>
          <button type="button" className="portal-secondary" onClick={() => setVoiding(null)}>Keep</button>
          <button type="button" className="cl-danger" disabled={busy || reason.trim().length < 3} onClick={() => void post({ action: "certificate-void-request", enrollmentId: l.e.id, reason: reason.trim() }, "Sent to the Admin for approval.").then(() => setVoiding(null)).catch(() => undefined)}>Send to the Admin</button>
        </div></td></tr>,
      ]; })])}
    </tbody></table></div>
    {paged.pager}
    <p className="cl-legend">Prints shows copies used out of copies allowed: one, plus one for each paid Reprinting request or Admin-approved void. Preview never counts.{tracked ? " A certificate prints only once the trainee's 2x2 photo is on file." : ""}</p>
    {uploading && <CertificatePhotoModal enrollmentId={uploading.e.id} traineeName={uploading.name} fileName={uploading.fileName} onClose={() => setUploading(null)} onDone={async () => { setUploading(null); await reload(); }} />}
    {releasing && <ReleaseConfirm target={{ enrollmentId: releasing.e.id, name: releasing.name, course: releasing.course.name, certNo: releasing.cert?.certificate_number ?? "" }} onClose={() => setReleasing(null)} onDone={async () => { setReleasing(null); await reload(); }} />}
    {data.certificateIssuanceEnabled === false && <p className="cl-legend cl-warn">Printing is turned off. The Admin turns it on in Certificate controls.</p>}
  </>;
}

function Head({ title, note }: { title: string; note?: string }) {
  return <><div className="cx-head"><div><span className="portal-eyebrow">Releasing Officer</span><h1>{title}</h1></div></div>{note && <p className="ac-note">{note}</p>}</>;
}

export function ReleasingHome({ data, reload, go }: { data: PortalData; reload: () => Promise<void>; go: (m: string) => void }) {
  const lines = certificateLines(data);
  const due = lines.filter((l) => l.view.state === "Due");
  const today = manilaToday();
  const certs = data.certificates as unknown as CertRow[];
  return <div className="portal-page cx ac">
    <Head title="Dashboard" note={new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date())} />
    <CertificateAlarm data={data} onOpen={() => go("Certificates")} />
    <DeliveryAlert data={data} onOpen={() => go("Delivery")} />
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Certificates</h2></div><StateColumn lines={lines} /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Today</h2></div>
          <dl className="ac-lines"><div><dt>Printed today</dt><dd>{certs.filter((c) => day((c as { printed_at?: string | null }).printed_at) === today).length}</dd></div><div><dt>Reprints approved, not printed</dt><dd>{lines.filter((l) => l.view.printCount > 0 && l.view.printsLeft > 0).length}</dd></div><div><dt>Soft copies emailed</dt><dd>{certs.filter((c) => day(c.soft_copy_sent_at) === today).length}</dd></div></dl>
          <p className="ac-foot">Due means the training ended and the fee is settled. {"Release also needs the trainee's evaluation, submitted on the Trainee Status page."}</p>
        </section>
      </div>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Due to Print</h2><span className="slot-count">{due.length}</span></div><CertificateLog data={data} lines={due} reload={reload} /></section>
    </div>
  </div>;
}

export function CertificatesWorkspace({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [pick, setPick] = useState(""), [q, setQ] = useState("");
  const lines = certificateLines(data);
  const term = q.trim().toLowerCase();
  const shown = lines.filter((l) => (!pick || l.view.state === pick) && (!term || `${l.name} ${l.number} ${l.cert?.certificate_number ?? ""} ${l.course.name} ${l.course.code}`.toLowerCase().includes(term)));
  return <div className="portal-page cx ac">
    <Head title="Certificates" />
    <CertificateAlarm data={data} />
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Status</h2><span className="muted-text">tap to filter</span></div><StateColumn lines={lines} pick={pick} onPick={setPick} /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Rules</h2></div>
          <dl className="ac-lines"><div><dt>2x2 Photo</dt><dd>Before printing</dd></div><div><dt>Certificate No.</dt><dd>Admin only</dd></div><div><dt>Print</dt><dd>Once</dd></div><div><dt>Reprint</dt><dd>Paid request</dd></div><div><dt>Void for reprint</dt><dd>Admin approval</dd></div></dl>
        </section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search certificates" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, NWMTACI number or certificate number" />{pick && <button type="button" className="portal-secondary" onClick={() => setPick("")}>Show All</button>}</div>
        <CertificateLog data={data} lines={shown} reload={reload} />
      </section>
    </div>
    <CertificateCorrectionsPanel data={data} reload={reload} mode="details" />
  </div>;
}

/** What each waiting certificate is held up by, in the order the rules check them. */
// Unpaid trainees are not listed (owner, 20 Oct 2026): they reach Waiting once paid.
const WAITING: [CertificateView["state"], string, string][] = [["Training not finished", "In Training", "#64748b"], ["Waiting for evaluation", "Evaluation", "#7a3fb8"], ["Waiting for photo", "Photo Needed", "#c2410c"]];
const WAIT_DAYS = 14;

/**
 * Waiting (owner, 13 Oct 2026; design/releasing-waiting-prototype.html):
 * certificates that cannot print yet — training still running (ending within
 * two weeks), balance, evaluation or photo — each with a checklist and the
 * next step. A line moves to Certificates › Due by itself once every check passes.
 */
export function WaitingCertificates({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [pick, setPick] = useState(""), [q, setQ] = useState("");
  const [uploading, setUploading] = useState<CertificateLine | null>(null);
  const { busy, msg, post } = usePost(reload);
  const today = manilaToday(), tomorrow = addDays(today, 1);
  const tracked = (data as CertData).certificatePhotos != null;
  const lines = certificateLines(data, { inTrainingDays: WAIT_DAYS }).filter((l) => l.balance === 0 && WAITING.some(([s]) => s === l.view.state)).sort((a, b) => (a.ended ?? "").localeCompare(b.ended ?? ""));
  const term = q.trim().toLowerCase();
  const shown = lines.filter((l) => (!pick || l.view.state === pick) && (!term || `${l.name} ${l.number} ${l.course.name} ${l.course.code}`.toLowerCase().includes(term)));
  const waitPaged = usePaged(byCourseGroup(data, shown).flatMap((x) => x.lines));
  const range = (l: CertificateLine) => !l.starts || l.starts === l.ended ? short(l.ended) : `${short(l.starts)} – ${short(l.ended)}`;
  const missing = (l: CertificateLine) => [l.balance > 0 && "payment", l.evalNeeded && !l.evalDone && "evaluation", tracked && !l.photo && "photo"].filter(Boolean) as string[];
  const next = (l: CertificateLine): [string, string] => {
    const m = missing(l);
    if (l.view.state === "Training not finished") return [`Training ends ${short(l.ended)}`, m.length ? `Also needs: ${m.join(", ")}` : "Nothing else missing"];
    if (l.view.state === "Waiting for payment") return [`Cashier collects ${pesos2(l.balance)}`, m.length > 1 ? `Then: ${m.slice(1).join(", ")}` : "Then it is Due"];
    if (l.view.state === "Waiting for evaluation") return ["Trainee submits the evaluation", m.includes("photo") ? "Then: photo" : "From the Trainee Status page"];
    return ["Upload the 2x2 photo", "White background"];
  };
  return <div className="portal-page cx ac">
    <Head title="Waiting" note="Certificates that cannot print yet and what each one still needs. Shaded lines can be ready by tomorrow." />
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Waiting For</h2><span className="muted-text">tap to filter</span></div>
          <div className="cx-tiles ac-tiles ac-tiles-in">
            {WAITING.map(([s, text, c]) => <button type="button" key={s} className={`cx-tile ac-pick ac-count${pick === s ? " on" : ""}`} style={{ ["--c" as string]: c }} onClick={() => setPick(pick === s ? "" : s)}><span>{text}</span><b>{lines.filter((l) => l.view.state === s).length}</b></button>)}
            <div className="cx-tile ac-count" style={{ ["--c" as string]: "#123F63" }}><span>Waiting</span><b>{lines.length}</b></div>
          </div>
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Ready Soon</h2></div>
          <dl className="ac-lines"><div><dt>Training ends today</dt><dd>{lines.filter((l) => l.ended === today).length}</dd></div><div><dt>Ends tomorrow</dt><dd>{lines.filter((l) => l.ended === tomorrow).length}</dd></div>{tracked && <div><dt>Photos missing</dt><dd>{lines.filter((l) => !l.photo).length}</dd></div>}</dl>
          <p className="ac-foot">Trainings ending within {WAIT_DAYS} days are listed. A certificate moves to Certificates › Due by itself once every check is green.</p>
        </section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search waiting certificates" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, NWMTACI number or course" />{pick && <button type="button" className="portal-secondary" onClick={() => setPick("")}>Show All</button>}</div>
        {!shown.length ? <p className="portal-empty-copy">Nothing waiting.</p> : <div className="cl-wrap"><table className="cl-log cl-cert wt-log"><thead><tr><th>#</th><th>Trainee · NWMTACI No.</th><th>Course · Training</th><th>Certificate No.</th><th>Progress</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {byCourseGroup(data, waitPaged.shown).flatMap(({ group, lines: g }) => [<tr key={group} className="nb-group"><td colSpan={7}><b>{group}</b> <span className="cl-sub">{g.length}</span></td></tr>, ...g.map((l, i) => { const [step, then] = next(l); const label = WAITING.find(([s]) => s === l.view.state)?.[1] ?? l.view.state; return <tr key={l.e.id} className={l.ended && l.ended <= tomorrow ? "wt-soon" : undefined}>
            <td className="cl-no">{i + 1}</td>
            <td><b>{l.name}</b><small className="cl-mono cl-sub cl-block">{l.number.replace(/^NWMTACI-/, "")}</small></td>
            <td title={l.course.name}><b>{l.course.code}</b><small className="cl-sub cl-block">{range(l)}</small></td>
            <td><span className="cl-mono">{l.cert?.certificate_number ?? "—"}</span><small className="cl-sub cl-block">Not printed yet</small></td>
            <td><ProgressDots dots={certificateDots(l, tracked, l.view.state === "Training not finished")} /></td>
            <td><Badge tone={l.view.state === "Waiting for photo" ? "orange" : undefined}>{label}</Badge><small className="cl-sub cl-block" title={then}>{step}</small></td>
            <td><span className="cl-acts">
              {(l.view.state === "Waiting for evaluation" || (l.postTest?.required && !l.postTest.passed)) && l.view.state !== "Training not finished" && <button type="button" className="portal-secondary cl-upload" disabled={busy} onClick={() => void post({ action: "training-end-email", enrollmentId: l.e.id }, `Post-test and evaluation email sent to ${l.name}.`).catch(() => undefined)}>Email Post-Test and Evaluation</button>}
              {tracked && !l.photo && <button type="button" className={l.view.state === "Waiting for photo" ? "portal-primary cl-upload" : "portal-secondary cl-upload"} onClick={() => setUploading(l)}>Upload Photo</button>}
              <a className="portal-secondary cl-upload" href={`/api/documents/certificate/${l.e.id}?preview=1`} target="_blank" rel="noreferrer" title="Draft for checking; never counts as a print">Preview Draft</a></span></td>
          </tr>; })])}
        </tbody></table></div>}
      </section>
    </div>
    {uploading && <CertificatePhotoModal enrollmentId={uploading.e.id} traineeName={uploading.name} fileName={uploading.fileName} onClose={() => setUploading(null)} onDone={async () => { setUploading(null); await reload(); }} />}
  </div>;
}

/** Certificate Templates (owner, 20 Oct 2026): one compact list; View shows the template with its description and blank details. */
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
      const box = body.photoBox as { w: number; h: number } | null;
      setMsg({ kind: "success", text: `Template version ${body.version} uploaded and now in use. ${box ? `2x2 photo box found (${(box.w / 72).toFixed(1)} × ${(box.h / 72).toFixed(1)} in): the photo prints inside it.` : "No 2x2 photo box was found on this PDF: the photo prints at the lower right. Preview a certificate to check."}` });
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "The template could not be uploaded." }); } finally { setUploading(null); }
  }
  // Upload Many (owner, 20 Oct 2026): pick the PDFs downloaded from the Drive folder; each is matched to its course by the file name.
  // Converted templates come with a "{CODE} - {Course}.json" of field positions, sent along as `layout`.
  const [bulk, setBulk] = useState<{ file: File; layout?: File; courseId: string; result?: string }[] | null>(null);
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
        rows[i] = { ...r, result: res.ok ? "Uploaded" : body.error ?? "Not uploaded." };
      } catch { rows[i] = { ...r, result: "Not uploaded." }; }
      setBulk([...rows]);
    }
    setBulkBusy(false);
    await reload();
    const done = rows.filter((r) => r.result === "Uploaded").length, failed = rows.filter((r) => r.courseId && r.result !== "Uploaded").length, skipped = rows.filter((r) => !r.courseId).length;
    setMsg({ kind: failed ? "error" : "success", text: `${done} template${done === 1 ? "" : "s"} uploaded and now in use.${failed ? ` ${failed} failed: see the list.` : ""}${skipped ? ` ${skipped} skipped (no course).` : ""}` });
  }
  // The template with its course description; name, dates, numbers and QR left blank.
  const view = (id: string) => window.open(`/api/staff/certificate-templates/${id}?view=1`, "_blank", "noopener");
  const group = (label: string, rows: typeof courses) => rows.length ? <div key={label}>
    <p className="tp-group"><b>{label} Courses</b><span>{rows.filter((c) => active.has(c.id)).length} of {rows.length} with template</span></p>
    <div className="tpl-list">{rows.map((c) => { const t = active.get(c.id); const uploaded = !!t?.storage_path; return <div key={c.id} className="tpl-row">
      <div className="tpl-name"><b>{c.name}</b><small className="cl-mono">{c.code}</small></div>
      <div>{uploaded ? <Badge tone="green">{`Template · v${t!.version}${t!.approved_at ? ` · ${fmtDate(day(t!.approved_at) ?? "")}` : ""}`}</Badge> : <Badge tone="orange">No Template Yet</Badge>}</div>
      <span className="cl-acts">{uploaded && <button type="button" className="portal-secondary" onClick={() => view(t!.id)}>View</button>}<label className={uploaded ? "portal-secondary tp-upload" : "portal-primary tp-upload"}>{uploading === c.id ? "Uploading…" : uploaded ? "Replace PDF" : "Upload PDF"}<input type="file" accept="application/pdf" hidden disabled={!!uploading} onChange={(e) => { void upload(c.id, e.target.files?.[0]); e.target.value = ""; }} /></label></span>
    </div>; })}</div></div> : null;
  return <div className="portal-page cx ac">
    <Head title="Templates" note="View shows each template with its course description; the trainee's name, training dates, issue date, Certificate No., Registration No. and QR are filled in when a certificate is printed. A new upload replaces the one in use; earlier versions are kept." />
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
              <td>{r.result === "Uploaded" ? <Badge tone="green">Uploaded</Badge> : r.result ? <Badge tone="orange">{r.result}</Badge> : !r.courseId ? <span className="cl-sub">No course found · pick one or skip</span> : twice ? <Badge tone="orange">Same course as another file</Badge> : t ? <span className="cl-sub">Replaces Version {t.version}</span> : <span className="cl-sub">New template</span>}</td>
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
  const why = releaseProblem({ balanceCentavos: l.balance, evaluationRequired: l.evalNeeded, evaluationOn: l.evalDone ? "in" : null, revoked: !!l.cert?.revoked_at, postTestRequired: l.postTest?.required, postTestPassed: l.postTest?.passed });
  return <button type="button" className={primary ? "portal-primary" : undefined} disabled={!!why} title={why ?? undefined} onClick={onRelease}>{why ? `Release · ${why.replace(/:.*$/, "")}` : "Release"}</button>;
}

/** Post-test result (20 Oct 2026): "—" when the course has no approved post-test. */
/** Release events (newest 400) with the certificate's number, method and sticker, by Manila day. */
type ReleaseEvent = { id: string; certificate_id: string; event_type: string; recipient_name: string | null; recipient_id_type: string | null; created_at: string; certificates?: unknown };
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

/** Released (owner, 20 Oct 2026): ready to claim on top; released certificates by date, newest day first. */
export function ReleasedCertificates({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [releasing, setReleasing] = useState<CertificateLine | null>(null);
  const today = manilaToday();
  const [from, setFrom] = useState(today), [to, setTo] = useState(today), [q, setQ] = useState("");
  const waiting = certificateLines(data).filter((l) => l.view.state === "Printed");
  const term = q.trim().toLowerCase();
  const rows = releaseRows(data).filter((r) => r.day >= from && r.day <= to && (!term || `${r.name} ${r.course} ${r.courseName} ${r.certNo} ${r.sticker}`.toLowerCase().includes(term)));
  const relPaged = usePaged(rows);
  const days = [...new Set(relPaged.shown.map((r) => r.day))].sort().reverse();
  const quick = (f: string) => { setTo(today); setFrom(f); };
  const csv = () => downloadCsv(`released-${from}-to-${to}.csv`, [["Date", "Time", "Trainee", "Course", "Certificate No.", "Released To", "ID", "Method", "Sticker No."], ...rows.map((r) => [r.day, clock(r.at), r.name, r.course, r.certNo, r.to, r.idType, r.method, r.sticker])]);
  return <div className="portal-page cx ac">
    <Head title="Released" />
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Release</h2></div>
          <dl className="ac-lines"><div><dt>Ready for release</dt><dd>{waiting.length}</dd></div><div><dt>Released in range</dt><dd>{rows.length}</dd></div><div><dt>By courier</dt><dd>{rows.filter((r) => r.method === "Courier").length}</dd></div><div><dt>Days</dt><dd>{days.length}</dd></div></dl>
        </section>
      </div>
      <div className="ac-stack">
        {waiting.length > 0 && <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Ready for Release</h2><span className="slot-count">{waiting.length}</span></div>
          <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Trainee · NWMTACI no.</th><th>Course</th><th>Certificate No.</th><th>Action</th></tr></thead><tbody>
            {waiting.map((l, i) => <tr key={l.e.id}><td className="cl-no">{i + 1}</td><td><b>{l.name}</b> <span className="cl-mono cl-sub">{l.number.replace(/^NWMTACI-/, "")}</span></td><td title={l.course.name}>{l.course.code}</td><td className="cl-mono">{l.cert?.certificate_number ?? "—"}</td><td><ReleaseButton primary l={l} onRelease={() => setReleasing(l)} /></td></tr>)}
          </tbody></table></div></section>}
        <section className="portal-panel cx-panel">
          <div className="cx-bar ac-bar rl-bar"><label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label>To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
            <span className="cx-seg"><button type="button" onClick={() => quick(today)}>Today</button><button type="button" onClick={() => quick(addDays(today, -6))}>Last 7 Days</button><button type="button" onClick={() => quick(`${today.slice(0, 8)}01`)}>This Month</button></span>
            <input className="vx-search" aria-label="Search released" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, course, certificate or sticker no." /><button type="button" className="portal-secondary" disabled={!rows.length} onClick={csv}>Download Excel</button></div>
          {rows.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Time</th><th>Trainee</th><th>Course</th><th>Certificate No.</th><th>Released To</th><th>Method</th><th>Sticker No.</th></tr></thead><tbody>
            {days.map((d) => { const g = relPaged.shown.filter((r) => r.day === d); return [<tr key={d} className="nb-group"><td colSpan={7}><b>{longDay(d)}</b> <span className="cl-sub">{g.length} released</span></td></tr>,
              ...g.map((r) => <tr key={r.id}><td className="cl-mono">{clock(r.at)}</td><td><b>{r.name}</b></td><td title={r.courseName}>{r.course}</td><td className="cl-mono">{r.certNo}</td><td>{r.to}{r.idType && <small className="cl-sub cl-block">{r.idType}</small>}</td><td><Badge tone={r.method === "Courier" ? undefined : "green"}>{r.method === "Pickup" ? "Picked Up" : r.method}</Badge></td><td className="cl-mono">{r.sticker || "—"}</td></tr>)]; })}
          </tbody></table>{relPaged.pager}</div> : <p className="portal-empty-copy">Nothing released in this range.</p>}
        </section>
      </div>
    </div>
    {releasing && <ReleaseConfirm target={{ enrollmentId: releasing.e.id, name: releasing.name, course: releasing.course.name, certNo: releasing.cert?.certificate_number ?? "" }} onClose={() => setReleasing(null)} onDone={async () => { setReleasing(null); await reload(); }} />}
  </div>;
}

/** The days a Daily / Weekly (Monday–Sunday) / Monthly report covers, from a picked date. */
export function reportRange(period: "Daily" | "Weekly" | "Monthly", date: string): { from: string; to: string; label: string } {
  if (period === "Daily") return { from: date, to: date, label: longDay(date) };
  if (period === "Monthly") { const [y, m] = date.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); const from = `${y}-${String(m).padStart(2, "0")}-01`; return { from, to: `${from.slice(0, 8)}${last}`, label: new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`)) }; }
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; const from = addDays(date, -dow), to = addDays(from, 6);
  return { from, to, label: `Week of ${fmtDate(from)} – ${fmtDate(to)}` };
}

/** Releasing Officer › Reports (owner, 20 Oct 2026): Daily, Weekly and Monthly certificate figures. */
export function ReleasingReports({ data }: { data: PortalData }) {
  const [period, setPeriod] = useState<"Daily" | "Weekly" | "Monthly">("Daily"), [date, setDate] = useState(manilaToday());
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
        <td><input className="cl-in" aria-label="Prefix" disabled={!can} value={v.prefix} onChange={(e) => set(c.id, "prefix", e.target.value)} placeholder="NWM-HPT-" /></td>
        <td><input className="cl-in cl-num" aria-label="Last certificate number used" disabled={!can} type="number" min={0} value={v.last} onChange={(e) => set(c.id, "last", e.target.value)} placeholder="e.g. 149" /></td>
        <td><input className="cl-in cl-tiny" aria-label="Digits" disabled={!can} type="number" min={1} max={10} value={v.pad} onChange={(e) => set(c.id, "pad", e.target.value)} /></td>
        <td className="cl-mono cl-next">{formatCertificateNumber(v.prefix, nextOf(v.last), Number(v.pad) || 5)}</td>
        <td>{can ? <button type="button" className="portal-primary" disabled={busy || !changed} onClick={() => void post({ action: "certificate-series-save", courseId: c.id, prefix: v.prefix.trim(), nextNumber: nextOf(v.last), pad: Math.min(10, Math.max(1, Number(v.pad) || 5)), batchPrefix: v.batchPrefix.trim(), nextBatch: Math.max(1, Number(v.nextBatch) || 1) }, `Numbering saved. The next certificate is ${formatCertificateNumber(v.prefix.trim(), nextOf(v.last), Number(v.pad) || 5)}; enrolled trainees without a number got theirs in enrollment order.`).then(() => setEdit((e) => { const n = { ...e }; delete n[c.id]; return n; })).catch(() => undefined)}>Save</button> : <span className="cl-sub">Set by the Admin</span>}</td>
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
  const [rejecting, setRejecting] = useState<string | null>(null), [remarks, setRemarks] = useState("");
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
            {rejecting === l.e.id ? <div className="cl-void"><label>Reason for Rejecting<input value={remarks} autoFocus onChange={(e) => setRemarks(e.target.value)} /></label><button type="button" className="portal-secondary" onClick={() => setRejecting(null)}>Keep</button><button type="button" className="cl-danger" disabled={busy || remarks.trim().length < 3} onClick={() => void post({ action: "certificate-void-decide", enrollmentId: l.e.id, approve: false, remarks: remarks.trim() }, "Void request rejected.").then(() => setRejecting(null)).catch(() => undefined)}>Reject</button></div>
              : <span className="cl-acts"><button type="button" className="portal-secondary" disabled={busy} onClick={() => { setRejecting(l.e.id); setRemarks(""); }}>Reject</button><button type="button" className="portal-primary" disabled={busy} onClick={() => void post({ action: "certificate-void-decide", enrollmentId: l.e.id, approve: true }, "Void approved. One more print allowed with the same number.").catch(() => undefined)}>Approve Void</button></span>}
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
 * Owner, 9 Oct 2026: the Releasing Officer corrects what prints on a certificate
 * — name, course, batch or dates — with a reason, and uploads, replaces or
 * removes the 2x2 photo ("details"). Only the Admin changes the Certificate
 * Number ("number"). Blank fields print the portal's registered value.
 */
function CertificateCorrectionsPanel({ data, reload, mode }: { data: PortalData; reload: () => Promise<void>; mode: "details" | "number" }) {
  const { busy, msg, post } = usePost(reload);
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState(false);
  const lines = certificateLines(data);
  const term = q.trim().toLowerCase();
  const found = term.length >= 2 ? lines.filter((l) => `${l.name} ${l.number} ${l.cert?.certificate_number ?? ""} ${l.course.code}`.toLowerCase().includes(term)).slice(0, 8) : [];
  const line = lines.find((l) => l.e.id === pickedId) ?? null;
  const tracked = (data as CertData).certificatePhotos != null;
  const pick = (l: CertificateLine) => { const c = ((l.cert as { corrections?: CertificateCorrections } | null)?.corrections ?? {}) as CertificateCorrections; setPickedId(l.e.id); setQ(""); setForm({ certificateNumber: l.cert?.certificate_number ?? "", name: c.name ?? "", courseName: c.courseName ?? "", batchLabel: c.batchLabel ?? "", startsOn: c.startsOn ?? "", endsOn: c.endsOn ?? "", issuedOn: c.issuedOn ?? "", reason: "" }); };
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
  return <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Corrections and Photos</h2></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search trainee" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, NWMTACI number or certificate number" /></div>
    {found.length > 0 && <div className="cc-found">{found.map((l) => <button type="button" key={l.e.id} onClick={() => pick(l)}><b>{l.name}</b><span>{l.course.code} · {l.cert?.certificate_number ?? "No number yet"}</span></button>)}</div>}
    {line ? <div className="cc-edit">
      <p className="cc-who"><b>{line.name}</b> · {line.course.code}{line.cert?.certificate_number ? <> · <span className="cl-mono">{line.cert.certificate_number}</span></> : null}<button type="button" className="ghost-button" onClick={() => setPickedId(null)}>Close</button></p>
      {tracked && <div className="cc-photo"><span>2x2 Photo: {line.photo ? <><b>On file</b> <small className="cl-sub">{line.photo.file_name}</small></> : <b className="cl-x">Not uploaded</b>}</span><span className="cl-acts">{line.photo && <button type="button" className="portal-secondary" onClick={() => void openCertificatePhoto(line.e.id)}>View</button>}<button type="button" className="portal-secondary" onClick={() => setReplacing(true)}>{line.photo ? "Replace Photo" : "Upload Photo"}</button>{line.photo && <button type="button" className="cl-danger" onClick={() => void removePhoto()}>Remove Photo</button>}</span></div>}
      <div className="cl-wrap"><table className="cl-log cl-light cc-table"><thead><tr><th>Field</th><th>From the Portal</th><th>Prints As (Correction)</th></tr></thead><tbody>
        {FIELDS.map(([k, label, type]) => <tr key={k}><td>{label}</td><td>{type === "date" && portal[k] && portal[k] !== "Print date" ? fmtDate(portal[k]) : portal[k] || "—"}</td><td><input className="cl-in" type={type} aria-label={`${label} correction`} value={form[k] ?? ""} placeholder="Same as the portal" onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></td></tr>)}
      </tbody></table></div>
      <div className="cl-void"><label>Reason for the Correction<input value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Name spelled as in the passport" /></label>
        <button type="button" className="portal-primary" disabled={busy || (form.reason ?? "").trim().length < 3} onClick={() => void post({ action: "certificate-correct", enrollmentId: line.e.id, ...form }, "Correction saved.").catch(() => undefined)}>Save Correction</button></div>
      <p className="ac-foot">Leave a field blank to print the portal&apos;s registered value. A certificate already printed needs an approved void or a paid Reprinting request for a corrected copy.</p>
    </div> : <p className="portal-empty-copy">Search a trainee to correct their certificate details or photo.</p>}
    {replacing && line && <CertificatePhotoModal enrollmentId={line.e.id} traineeName={line.name} fileName={line.fileName} replacing={!!line.photo} onClose={() => setReplacing(false)} onDone={async () => { setReplacing(false); await reload(); }} />}
  </section>;
}

/* ------------------------------------------------------------ certificate numbers (Admin) */

type NumberSettings = { reg_prefix: string; reg_last: number; reg_digits: number; set_at: string | null };
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
  const [form, setForm] = useState({ regPrefix: ns?.reg_prefix ?? "NWMTC", regLast: String(ns?.reg_last ?? 0), regDigits: String(ns?.reg_digits ?? 6) });
  const [one, setOne] = useState<LegacyRow>({ traineeName: "", nwmtaciNumber: "", courseCode: "", certificateNumber: "", registrationNumber: "", issuedOn: "" });
  const [preview, setPreview] = useState<{ file: string; rows: LegacyRow[]; missing: string[] } | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date()).split("-");
  const nextReg = `${form.regPrefix.toUpperCase()}${String((Number(form.regLast) || 0) + 1).padStart(Number(form.regDigits) || 6, "0")}-${month[1]}${month[0]}`;
  const legacy = d.legacyCertificates ?? [];
  const saveSeries = () => void post({ action: "certificate-number-settings-save", regPrefix: form.regPrefix.trim() || "NWMTC", regLast: Number(form.regLast) || 0, regDigits: Number(form.regDigits) || 6 }, `Saved. The next certificate prints Registration No. ${nextReg}.`).catch(() => undefined);
  const chooseCsv = async (file: File | undefined) => { setResults(null); if (!file) return; const parsed = legacyRowsFromCsv(await file.text()); setPreview({ file: file.name, ...parsed }); if (parsed.missing.length) setMsg({ kind: "error", text: `The spreadsheet needs these columns: ${parsed.missing.join(", ")}.` }); };
  const importRows = () => preview && void post({ action: "legacy-certificate-import", rows: preview.rows }).then((r) => { const res = (r as { results?: ImportResult[] }).results ?? []; setResults(res); setPreview(null); setMsg({ kind: "success", text: `${res.filter((x) => x.ok).length} of ${res.length} recorded · ${res.filter((x) => x.ok && x.matched).length} matched to a trainee's enrollment.` }); }).catch(() => undefined);
  const addOne = () => void post({ action: "legacy-certificate-add", row: one }, "Recorded. These numbers are reserved.").then(() => setOne({ traineeName: "", nwmtaciNumber: "", courseCode: "", certificateNumber: "", registrationNumber: "", issuedOn: "" })).catch(() => undefined);
  const field = (k: keyof LegacyRow, label: string, ph: string, type = "text") => <label>{label}<input type={type} className={type === "text" ? "cl-mono" : undefined} value={one[k]} placeholder={ph} onChange={(e) => setOne({ ...one, [k]: e.target.value })} /></label>;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Admin</span><h1>Certificate Numbers</h1></div>
      <span className="cn-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "numbering"} className={tab === "numbering" ? "on" : ""} onClick={() => setTab("numbering")}>Numbering</button><button type="button" role="tab" aria-selected={tab === "legacy"} className={tab === "legacy" ? "on" : ""} onClick={() => setTab("legacy")}>Issued Before the Portal{legacy.length ? ` · ${legacy.length}` : ""}</button></span></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {tab === "numbering" ? <>
      <p className="ac-note">Enter the <b>last Registration No. you already used</b> on paper. The portal continues from the next one at the moment a certificate is printed, and never reuses a number recorded under Issued Before the Portal. The Doc. No. is written on the certificate by hand.</p>
      <div className="cn-series">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Registration No.</h2><span className="muted-text">One automatic series for every course</span></div>
          <div className="portal-form cx-formpad"><label>Prefix<input className="cl-mono" value={form.regPrefix} onChange={(e) => setForm({ ...form, regPrefix: e.target.value })} /></label><label>Last Number Used<input type="number" min={0} className="cl-mono" value={form.regLast} onChange={(e) => setForm({ ...form, regLast: e.target.value })} /></label><label>Digits<input type="number" min={1} max={12} value={form.regDigits} onChange={(e) => setForm({ ...form, regDigits: e.target.value })} /></label></div>
          <div className="cn-next"><span>Next certificate prints (issued this month)</span><b className="cl-mono">{nextReg}</b></div></section>
      </div>
      <div className="cn-save"><span className="muted-text">{ns?.set_at ? `Last saved ${fmtDate(day(ns.set_at) ?? "")}` : "Not set yet — the series starts from 1 until this is saved."}</span><button type="button" className="portal-primary" disabled={busy} onClick={saveSeries}>Save Registration No.</button></div>
      <NumberingTable data={data} reload={reload} scope="all" />
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

/** Admin › Certificate Controls › Revoke (owner, 20 Oct 2026): the QR page shows REVOKED at once and printing stops. */
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
      {revoked ? <p className="cl-sub">Revoked{line.cert?.revoked_reason ? `: ${line.cert.revoked_reason}` : ""}. {"The QR page shows: This certificate has been revoked."}</p> : <div className="cl-void">
        <label>Reason<input value={reason} onChange={(e) => { setReason(e.target.value); setAsking(false); }} placeholder="e.g. Issued in error: trainee did not complete the course" /></label>
        {asking ? <><span className="cl-sub">Revoke {line.cert?.certificate_number}? This shows on the QR page at once.</span><button type="button" className="portal-secondary" onClick={() => setAsking(false)}>Keep</button><button type="button" className="cl-danger" disabled={busy} onClick={() => void post({ action: "certificate-revoke", enrollmentId: line.e.id, reason: reason.trim() }, "Certificate revoked. Its QR page now shows REVOKED.").then(() => setAsking(false)).catch(() => undefined)}>Yes, Revoke</button></>
          : <button type="button" className="cl-danger" disabled={reason.trim().length < 5} onClick={() => setAsking(true)}>Revoke</button>}
      </div>}
    </div>}
  </section>;
}
