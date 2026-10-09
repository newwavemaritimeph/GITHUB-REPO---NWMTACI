"use client";

import { useState } from "react";
import type { PortalData, Enrollment } from "../portal-live-app";
import { first, manilaToday, dueCentavos, pesos2 } from "@/lib/portal-format";
import { automaticEndDate } from "@/lib/scheduling";
import { canPrint, canSetSeries, certificateState, formatCertificateNumber, isStcwCategory, type CertificateView } from "@/lib/certificate-rules";
import { Badge, Message, fmtDate, usePost } from "./shared-ui";
import { ReleaseConfirm } from "./live-releasing";
import { DeliveryAlert } from "./delivery-home";
import { tcl } from "@/lib/title-case";
import { photoFileName, type CertificateCorrections } from "@/lib/certificate-photo";
import { CertificatePhotoModal, openCertificatePhoto } from "./certificate-photo-modal";

/**
 * Releasing Officer (owner, 8 Oct 2026): certificates due to print, printed
 * once, reprinted only after a paid Reprinting request or an Admin-approved
 * void. The log is the formal certificate register (owner's choice, design C).
 * The Admin sets the numbering and decides void requests (AdminCertificateControls).
 */

type CertRow = { id: string; enrollment_id: string; status: string; certificate_number?: string | null; batch_label?: string | null; print_count?: number | null; reprints_allowed?: number | null; void_status?: string | null; void_reason?: string | null; void_requested_at?: string | null; soft_copy_sent_at?: string | null; snapshot?: Record<string, unknown> | null; claimant_name?: string | null; release_method?: string | null };
type Series = { course_id: string; prefix: string; next_number: number; pad: number; batch_prefix: string; next_batch: number; set_at: string; profiles?: { complete_name: string } | { complete_name: string }[] | null };
type Template = { id: string; course_id: string; version: number; active: boolean; drive_link?: string | null; storage_path?: string | null; approved_at?: string | null };
const stcwCourse = (c: { course_categories?: unknown }) => isStcwCategory((Array.isArray(c.course_categories) ? c.course_categories[0] : c.course_categories as { name?: string } | null)?.name);
type Photo = { enrollment_id: string; file_name: string; background_white: boolean; uploaded_at: string; replaced_at?: string | null; profiles?: { complete_name: string } | { complete_name: string }[] | null };
type CertData = PortalData & { certificateSeries?: Series[]; evaluationForms?: Record<string, string>; feedbackAt?: Record<string, string>; certificatePhotos?: Photo[] | null };

export type CertificateLine = { e: Enrollment; cert: CertRow | null; view: CertificateView; name: string; number: string; course: { id: string; name: string; code: string }; ended: string | null; evalNeeded: boolean; evalDone: boolean; balance: number; photo: Photo | null; fileName: string };

const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : null);
const short = (d: string | null) => (d ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`)) : "—");

/** Every New Wave enrollment whose training has ended, with its certificate state. */
export function certificateLines(data: PortalData): CertificateLine[] {
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
    // Google Classroom courses need the evaluation from their classwork; so does any course linked to a form.
    const evalNeeded = !!d.evaluationForms?.[c.id] || !!c.google_classroom_link;
    const fb = d.feedbackAt?.[e.id] ?? null;
    const balance = Math.max(0, dueCentavos(e) - Number(e.paid_centavos));
    const view = certificateState({ enrollmentStatus: e.enrollment_status, trainingEnd: ended, balanceCentavos: balance, evaluationRequired: evalNeeded, evaluationOn: day(fb), paidOn: lastPaid.get(e.trainee_id) ?? null, cert: cert ? { status: cert.status, printCount: Number(cert.print_count ?? (["Printed", "Released"].includes(cert.status) ? 1 : 0)), reprintsAllowed: Number(cert.reprints_allowed ?? 0), voidStatus: cert.void_status } : null, photoOnFile: photos ? photos.has(e.id) : undefined }, today);
    if (view.state === "Training not finished" || view.state === "Cancelled") continue;
    const t = first(e.trainees);
    const fileName = photoFileName({ lastName: t?.legal_last_name ?? "TRAINEE", firstName: t?.legal_first_name ?? "", middleName: (t as { legal_middle_name?: string | null } | null)?.legal_middle_name, courseCode: c.code, batchNumber: b?.batch_number ?? null, date: ended ?? today });
    lines.push({ e, cert, view, photo: photos?.get(e.id) ?? null, fileName, name: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : e.enrollment_number, number: data.applicationNumbers?.[e.trainee_id] ?? t?.trainee_number ?? e.enrollment_number, course: { id: c.id, name: c.name, code: c.code }, ended, evalNeeded, evalDone: !!fb, balance });
  }
  const rank = (l: CertificateLine) => (l.view.overdue ? 0 : l.view.state === "Due" ? 1 : l.view.state === "Waiting for photo" ? 2 : l.view.state === "Void requested" ? 2 : l.view.state === "Waiting for payment" || l.view.state === "Waiting for evaluation" ? 3 : 4);
  return lines.sort((a, b) => rank(a) - rank(b) || (a.ended ?? "").localeCompare(b.ended ?? ""));
}

const STATES: [string, string][] = [["Due", "#0571D0"], ["Waiting for photo", "#c2410c"], ["Waiting for evaluation", "#7a3fb8"], ["Waiting for payment", "#F25615"], ["Printed", "#0a7a3e"], ["Released", "#5d6f7e"], ["Void requested", "#b42318"]];
const tone = (l: CertificateLine) => (l.view.overdue ? "red" : l.view.state === "Due" ? "blue" : l.view.state === "Printed" ? "green" : l.view.state === "Void requested" ? "red" : l.view.state === "Waiting for payment" || l.view.state === "Waiting for photo" ? "orange" : undefined);
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
  if (!lines.length) return <p className="portal-empty-copy">Nothing here.</p>;
  return <>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Trainee · NWMTACI no.</th><th>Course · Ended</th><th>Certificate No.</th><th>Paid</th><th>Eval.</th>{tracked && <th>Photo</th>}<th>Prints</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {lines.map((l, i) => { const printable = canPrint(l.view) && l.view.state !== "Void requested"; const printed = l.view.printCount > 0; return [
        <tr key={l.e.id}>
          <td className="cl-no">{i + 1}</td>
          <td><b>{l.name}</b> <span className="cl-mono cl-sub">{l.number.replace(/^NWMTACI-/, "")}</span></td>
          <td title={l.course.name}>{l.course.code} <span className="cl-sub">· {short(l.ended)}</span></td>
          <td className="cl-mono">{l.cert?.certificate_number ?? <span className="cl-sub">—</span>}</td>
          <td>{l.balance > 0 ? <span className="cl-x" title={`Balance ${pesos2(l.balance)}`}>✗</span> : <span className="cl-y">✓</span>}</td>
          <td>{!l.evalNeeded ? <span className="cl-sub">—</span> : l.evalDone ? <span className="cl-y">✓</span> : <span className="cl-x">✗</span>}</td>
          {tracked && <td>{l.photo ? <button type="button" className="cl-photo" title={l.photo.file_name} onClick={() => void openCertificatePhoto(l.e.id)}>✓ On File</button> : <button type="button" className="portal-secondary cl-upload" onClick={() => setUploading(l)}>Upload Photo</button>}</td>}
          <td className="cl-mono">{l.view.printCount}/{l.view.printsAllowed}</td>
          <td><Badge tone={tone(l)}>{label(l)}</Badge>{l.view.state === "Waiting for payment" && <small className="cl-sub cl-block">{pesos2(l.balance)} due</small>}</td>
          <td><span className="cl-acts">
            {(l.view.state === "Due" || l.view.state === "Waiting for photo" || printed) && <span className="cl-split"><a href={pdf(l, true)} target="_blank" rel="noreferrer" onClick={afterPrint}>Preview</a>{printable && <a className="go" href={pdf(l, false)} target="_blank" rel="noreferrer" onClick={afterPrint}>{printed ? "Reprint" : "Print"}</a>}</span>}
            {printed && l.view.state !== "Void requested" && <details className="cl-more"><summary aria-label="More actions">▾</summary><div>
              <button type="button" disabled={busy} onClick={() => { setVoiding(l.e.id); setReason(""); }}>Request Void</button>
              <button type="button" disabled={busy} onClick={() => void post({ action: "certificate-soft-copy", enrollmentId: l.e.id }, "Soft copy emailed.").catch(() => undefined)}>Email Soft Copy</button>
              {l.view.state === "Printed" && <button type="button" onClick={() => setReleasing(l)}>Release</button>}
            </div></details>}
            {l.view.state === "Void requested" && <span className="cl-sub">With the Admin</span>}
          </span></td>
        </tr>,
        voiding === l.e.id && <tr key={`${l.e.id}-void`} className="cl-voidrow"><td /><td colSpan={tracked ? 9 : 8}><div className="cl-void">
          <label>Reason for Voiding<input value={reason} autoFocus onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Misprint — wrong spelling of the name" /></label>
          <button type="button" className="portal-secondary" onClick={() => setVoiding(null)}>Keep</button>
          <button type="button" className="cl-danger" disabled={busy || reason.trim().length < 3} onClick={() => void post({ action: "certificate-void-request", enrollmentId: l.e.id, reason: reason.trim() }, "Sent to the Admin for approval.").then(() => setVoiding(null)).catch(() => undefined)}>Send to the Admin</button>
        </div></td></tr>,
      ]; })}
    </tbody></table></div>
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
          <p className="ac-foot">Due means the training ended, the fee is settled and, for courses with a Google Form, the evaluation is in.</p>
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

/** Templates: the Google Drive link of each course's template and, for Google Classroom courses, the evaluation form. */
export function CertificateTemplates({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  // Every New Wave course, with an uploaded PDF template (owner, 9 Oct 2026). The newest upload is the active one.
  const d = data as CertData;
  const { busy, msg, setMsg, post } = usePost(reload);
  const [q, setQ] = useState(""), [missing, setMissing] = useState(false), [uploading, setUploading] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, string>>({});
  const templates = data.certificateTemplates as unknown as Template[];
  const active = new Map(templates.filter((t) => t.active).map((t) => [t.course_id, t]));
  const all = data.courses.filter((c) => c.delivery_type === "In-House" && (c as { active?: boolean }).active !== false);
  const term = q.trim().toLowerCase();
  const courses = all.filter((c) => (!term || `${c.code} ${c.name}`.toLowerCase().includes(term)) && (!missing || !active.has(c.id))).sort((a, b) => a.name.localeCompare(b.name));
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
  async function view(id: string) {
    const win = window.open("", "_blank");
    const r = await fetch(`/api/staff/certificate-templates/${id}`, { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (win) { if (body.url) win.location.href = body.url; else win.close(); }
    if (!body.url) setMsg({ kind: "error", text: body.error ?? "The template could not be opened." });
  }
  const group = (label: string, rows: typeof courses) => rows.length ? <div key={label}>
    <p className="tp-group"><b>{label} Courses</b><span>{rows.length}</span></p>
    <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>Course</th><th>Template (PDF)</th><th>Evaluation Form in Classroom (For Matching)</th><th /></tr></thead><tbody>
      {rows.map((c) => { const t = active.get(c.id); const uploaded = t && t.storage_path; const form = forms[c.id] ?? (d.evaluationForms?.[c.id] ? `https://docs.google.com/forms/d/${d.evaluationForms[c.id]}/edit` : ""); return <tr key={c.id}>
        <td><b>{c.name}</b><small className="cl-sub cl-block cl-mono">{c.code}</small></td>
        <td>{uploaded ? <Badge tone="green">{`Version ${t.version}${t.approved_at ? ` · ${fmtDate(day(t.approved_at) ?? "")}` : ""}`}</Badge> : t ? <Badge tone="orange">Drive link only · upload the PDF</Badge> : <Badge tone="orange">No template yet</Badge>}</td>
        <td><span className="cl-field"><input aria-label={`Evaluation form for ${c.name}`} value={form} onChange={(e) => setForms({ ...forms, [c.id]: e.target.value })} placeholder="https://docs.google.com/forms/d/…/edit (optional)" /><button type="button" className="portal-secondary" disabled={busy || forms[c.id] === undefined} onClick={() => void post({ action: "course-evaluation-form-save", courseId: c.id, formLink: forms[c.id] ?? "" }, forms[c.id] ? "Evaluation form saved. Certificates for this course now need it." : "Evaluation form removed.").then(() => setForms((f) => { const n = { ...f }; delete n[c.id]; return n; })).catch(() => undefined)}>Save</button></span>
          <small className="cl-sub cl-block">{d.evaluationForms?.[c.id] ? "Required before printing" : "Not required"}</small></td>
        <td><span className="cl-acts">{uploaded && <button type="button" className="portal-secondary" onClick={() => void view(t.id)}>View</button>}<label className={uploaded ? "portal-secondary tp-upload" : "portal-primary tp-upload"}>{uploading === c.id ? "Uploading…" : uploaded ? "Replace PDF" : "Upload PDF"}<input type="file" accept="application/pdf" hidden disabled={!!uploading} onChange={(e) => { void upload(c.id, e.target.files?.[0]); e.target.value = ""; }} /></label></span></td>
      </tr>; })}
    </tbody></table></div></div> : null;
  return <div className="portal-page cx ac">
    <Head title="Templates" note="Upload each course's certificate template as a PDF. A new upload replaces the one in use; earlier versions are kept." />
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Setup</h2></div>
          <dl className="ac-lines"><div><dt>Courses with a template</dt><dd>{withTemplate} of {all.length}</dd></div><div><dt>Courses with an evaluation form</dt><dd>{Object.keys(d.evaluationForms ?? {}).length}</dd></div><div><dt>Printing</dt><dd className={data.certificateIssuanceEnabled ? "plus" : "warn"}>{data.certificateIssuanceEnabled ? "On" : "Off"}</dd></div></dl>
          <p className="ac-foot">Trainees open the evaluation form from their Google Classroom classwork; nothing is sent from here. Paste the same form link so the portal knows which course a submission belongs to.</p>
        </section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search courses" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any course by name or code" /><label className="tp-filter"><input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} /> Without template</label></div>
        {group("STCW", courses.filter(stcwCourse))}
        {group("In-House", courses.filter((c) => !stcwCourse(c)))}
        {!courses.length && <p className="portal-empty-copy">No courses match.</p>}
      </section>
    </div>
  </div>;
}

/** Released: printed certificates waiting to be claimed, and those already released. */
export function ReleasedCertificates({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [releasing, setReleasing] = useState<CertificateLine | null>(null);
  const lines = certificateLines(data).filter((l) => l.view.state === "Printed" || l.view.state === "Released");
  const waiting = lines.filter((l) => l.view.state === "Printed");
  return <div className="portal-page cx ac">
    <Head title="Released" />
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Release</h2></div>
          <dl className="ac-lines"><div><dt>Ready for release</dt><dd>{waiting.length}</dd></div><div><dt>Released</dt><dd>{lines.length - waiting.length}</dd></div><div><dt>By courier</dt><dd>{lines.filter((l) => l.cert?.release_method === "Courier").length}</dd></div></dl>
        </section>
      </div>
      <section className="portal-panel cx-panel">
        {lines.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Trainee · NWMTACI no.</th><th>Course</th><th>Certificate No.</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {lines.map((l, i) => <tr key={l.e.id}><td className="cl-no">{i + 1}</td><td><b>{l.name}</b> <span className="cl-mono cl-sub">{l.number.replace(/^NWMTACI-/, "")}</span></td><td title={l.course.name}>{l.course.code}</td><td className="cl-mono">{l.cert?.certificate_number ?? "—"}</td><td><Badge tone={l.view.state === "Released" ? undefined : "green"}>{l.view.state === "Released" ? "Released" : "Ready for Release"}</Badge>{l.cert?.claimant_name && <small className="cl-sub cl-block">{l.cert.claimant_name}</small>}</td><td>{l.view.state === "Printed" && <button type="button" className="portal-primary" onClick={() => setReleasing(l)}>Release</button>}</td></tr>)}
        </tbody></table></div> : <p className="portal-empty-copy">No printed certificates yet.</p>}
      </section>
    </div>
    {releasing && <ReleaseConfirm target={{ enrollmentId: releasing.e.id, name: releasing.name, course: releasing.course.name, certNo: releasing.cert?.certificate_number ?? "" }} onClose={() => setReleasing(null)} onDone={async () => { setReleasing(null); await reload(); }} />}
  </div>;
}

/** Admin: certificate numbering per course, void requests, and the printing switch. */
function NumberingTable({ data, reload, scope }: { data: PortalData; reload: () => Promise<void>; scope: "in-house" | "stcw" }) {
  const d = data as CertData;
  const { busy, msg, post } = usePost(reload);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Record<string, { prefix: string; next: string; pad: string; batchPrefix: string; nextBatch: string }>>({});
  const roles = scope === "stcw" ? ["admin"] : ["releasing_officer"];
  const series = new Map((d.certificateSeries ?? []).map((s) => [s.course_id, s]));
  const used = new Set(data.enrollments.map((e) => e.course_id));
  const term = q.trim().toLowerCase();
  const courses = data.courses.filter((c) => c.delivery_type === "In-House" && (scope === "stcw" ? (term ? true : stcwCourse(c)) : !stcwCourse(c)) && (term ? `${c.code} ${c.name}`.toLowerCase().includes(term) : scope === "stcw" || used.has(c.id) || series.has(c.id))).sort((a, b) => a.name.localeCompare(b.name));
  const valueOf = (id: string) => { const s = series.get(id); return edit[id] ?? { prefix: s?.prefix ?? "", next: String(s?.next_number ?? 1), pad: String(s?.pad ?? 5), batchPrefix: s?.batch_prefix ?? "", nextBatch: String(s?.next_batch ?? 1) }; };
  const set = (id: string, k: string, v: string) => setEdit({ ...edit, [id]: { ...valueOf(id), [k]: v } });
  return <section className="portal-panel cx-panel"><div className="panel-heading"><h2>{scope === "stcw" ? "Certificate Numbering" : "In-House Certificate Numbering"}</h2></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search courses" value={q} onChange={(e) => setQ(e.target.value)} placeholder={scope === "stcw" ? "STCW courses shown; search any course" : "Search any In-House course by name or code"} /></div>
    <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>Course</th><th>Prefix</th><th>Next No.</th><th>Digits</th><th>Batch Prefix</th><th>Next Batch</th><th>Next Certificate</th><th /></tr></thead><tbody>
      {courses.map((c) => { const v = valueOf(c.id), s = series.get(c.id); const changed = !!edit[c.id]; const can = canSetSeries(roles, stcwCourse(c)); return <tr key={c.id}>
        <td><b>{c.name}</b><small className="cl-sub cl-block">{s ? `Set ${fmtDate(day(s.set_at) ?? "")}${first(s.profiles)?.complete_name ? ` by ${first(s.profiles)?.complete_name}` : ""}` : "Not set — certificates for this course cannot be numbered yet"}</small></td>
        <td><input className="cl-in" aria-label="Prefix" disabled={!can} value={v.prefix} onChange={(e) => set(c.id, "prefix", e.target.value)} placeholder="NWM-HPT-" /></td>
        <td><input className="cl-in cl-num" aria-label="Next certificate number" disabled={!can} type="number" min={1} value={v.next} onChange={(e) => set(c.id, "next", e.target.value)} /></td>
        <td><input className="cl-in cl-tiny" aria-label="Digits" disabled={!can} type="number" min={1} max={10} value={v.pad} onChange={(e) => set(c.id, "pad", e.target.value)} /></td>
        <td><input className="cl-in" aria-label="Batch prefix" disabled={!can} value={v.batchPrefix} onChange={(e) => set(c.id, "batchPrefix", e.target.value)} placeholder="HPT-" /></td>
        <td><input className="cl-in cl-num" aria-label="Next batch number" disabled={!can} type="number" min={1} value={v.nextBatch} onChange={(e) => set(c.id, "nextBatch", e.target.value)} /></td>
        <td className="cl-mono cl-next">{formatCertificateNumber(v.prefix, Number(v.next) || 1, Number(v.pad) || 5)}</td>
        <td>{can ? <button type="button" className="portal-primary" disabled={busy || !changed} onClick={() => void post({ action: "certificate-series-save", courseId: c.id, prefix: v.prefix.trim(), nextNumber: Math.max(1, Number(v.next) || 1), pad: Math.min(10, Math.max(1, Number(v.pad) || 5)), batchPrefix: v.batchPrefix.trim(), nextBatch: Math.max(1, Number(v.nextBatch) || 1) }, "Numbering saved. The next certificate continues from here.").then(() => setEdit((e) => { const n = { ...e }; delete n[c.id]; return n; })).catch(() => undefined)}>Save</button> : <span className="cl-sub">Set by the Admin</span>}</td>
      </tr>; })}
    </tbody></table></div>
    {!courses.length && <p className="portal-empty-copy">{term ? "No courses match." : "No In-House course has trainees yet. Search a course to set its numbering."}</p>}
  </section>;
}

/** Releasing Officer › Numbering (owner, 9 Oct 2026): starting Certificate No. and batch number for In-House courses. */
export function ReleasingNumbering({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  return <div className="portal-page cx ac">
    <Head title="Numbering" note="Set the starting Certificate No. and batch number for each In-House course; the system continues from there. STCW numbering is set by the Admin." />
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
      <CertificateCorrectionsPanel data={data} reload={reload} mode="number" />
      <NumberingTable data={data} reload={reload} scope="stcw" />
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
  const removePhoto = async () => { if (!line || !window.confirm("Remove this trainee's 2x2 photo? The certificate cannot print until a new photo is uploaded.")) return; const r = await fetch(`/api/staff/certificate-photo?enrollmentId=${line.e.id}`, { method: "DELETE" }); if (r.ok) await reload(); };
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
