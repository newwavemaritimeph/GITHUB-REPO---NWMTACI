"use client";

import { FormEvent, useState } from "react";
import { CertificatePdfModal, type CertPdfTarget } from "./certificate-pdf-modal";
import { downloadCsv } from "@/lib/csv";

// Loose shapes for the releasing-officer slices of the staff-operations payload.
type NameRef = { legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string };
type CourseRef = { name?: string; code?: string };
type EnrollRef = { enrollment_number?: string; trainees?: NameRef | NameRef[] | null; courses?: CourseRef | CourseRef[] | null };
type Enrollment = { id: string; enrollment_number: string; course_id: string; partner_offer_id?: string | null; selling_price_centavos: number; paid_centavos: number; charges_centavos?: number; discounts_centavos?: number; enrollment_status: string; feedback_token?: string | null; feedback_submitted?: boolean; trainees?: NameRef | NameRef[] | null; courses?: CourseRef | CourseRef[] | null; batches?: { ends_on: string } | { ends_on: string }[] | null };
type Certificate = { id: string; enrollment_id: string; status: string; printed_at?: string | null; reprint_count?: number; snapshot?: Record<string, unknown> | null; number_pool_id?: string | null; template_id?: string | null };
type CertTemplate = { id: string; course_id: string; version: number; active: boolean; approved_at?: string | null; courses?: CourseRef | CourseRef[] | null };
type ReleaseEvent = { id: string; certificate_id: string; event_type: string; recipient_name?: string | null; recipient_id_type?: string | null; reason?: string | null; created_at: string; certificates?: { enrollment_id?: string; snapshot?: Record<string, unknown> | null; enrollments?: EnrollRef | EnrollRef[] | null } | { enrollment_id?: string; snapshot?: Record<string, unknown> | null; enrollments?: EnrollRef | EnrollRef[] | null }[] | null };
type Course = { id: string; code: string; name: string; delivery_type: string };
type Batch = { id: string; batch_number: string; course_id: string; starts_on: string; ends_on: string; confirmed_count: number; capacity: number; courses?: CourseRef | CourseRef[] | null };
export type ReleasingData = { profile: { complete_name: string }; enrollments: Enrollment[]; certificates: Certificate[]; certificateTemplates: CertTemplate[]; certificateReleases: ReleaseEvent[]; courses: Course[]; batches: Batch[]; certificateIssuanceEnabled: boolean };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaDay = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(value)) : "");
const fmtDate = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(value)) : "—");
const dueOf = (e: Enrollment) => Number(e.selling_price_centavos) + Number(e.charges_centavos ?? 0) - Number(e.discounts_centavos ?? 0);
const isPaid = (e: Enrollment) => dueOf(e) - Number(e.paid_centavos) <= 0;
const traineeName = (e: Enrollment) => { const t = one(e.trainees); return t ? [t.legal_first_name, t.legal_middle_name, t.legal_last_name].filter(Boolean).join(" ") : "Unknown trainee"; };

async function submit(body: Record<string, unknown>) {
  const r = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "The action could not be completed.");
  return j;
}

function inHouse(data: ReleasingData, e: Enrollment) { return data.courses.find((c) => c.id === e.course_id)?.delivery_type === "In-House"; }
function certOf(data: ReleasingData, enrollmentId: string) { return data.certificates.find((c) => c.enrollment_id === enrollmentId) ?? null; }

export function ReleasingDashboard({ data }: { data: ReleasingData }) {
  const today = manilaDay(new Date().toISOString());
  const weekAgo = manilaDay(new Date(Date.now() - 6 * 86400000).toISOString());
  const monthStart = today.slice(0, 8) + "01";
  const in7 = manilaDay(new Date(Date.now() + 7 * 86400000).toISOString());
  const released = data.certificateReleases.filter((r) => r.event_type === "release");
  const relDay = (r: ReleaseEvent) => manilaDay(r.created_at);
  const releasedToday = released.filter((r) => relDay(r) === today).length;
  const releasedWeek = released.filter((r) => relDay(r) >= weekAgo).length;
  const releasedMonth = released.filter((r) => relDay(r) >= monthStart).length;
  const unreleasedPaid = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && inHouse(data, e) && isPaid(e) && certOf(data, e.id)?.status !== "Released");
  const ending = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && inHouse(data, e)).map((e) => ({ e, end: one(e.batches)?.ends_on ?? "" })).filter((x) => x.end && x.end >= today && x.end <= in7).sort((a, z) => a.end.localeCompare(z.end));
  return (
    <>
      <div className="finance-hero">
        <div><span>Unreleased · paid</span><strong>{unreleasedPaid.length}</strong><small>In-house, fully paid, not yet released</small></div>
        <article><span>Ending trainings</span><strong>{ending.length}</strong><small>Trainees ending within 7 days</small></article>
        <article><span>Released today</span><strong>{releasedToday}</strong><small>{releasedWeek} this week</small></article>
        <article><span>Released this month</span><strong>{releasedMonth}</strong><small>Certificates handed over</small></article>
      </div>
      <div className="dashboard-panels">
        <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Unreleased certificates — paid</h2><p>Ready to process</p></div><span className="slot-count">{unreleasedPaid.length}</span></div>{unreleasedPaid.slice(0, 20).map((e) => { const c = certOf(data, e.id); return <div className="live-row-item" key={e.id}><div><strong>{traineeName(e)}</strong><small>{one(e.courses)?.name ?? ""} · {e.enrollment_number}</small></div><span className="slot-count">{c?.status ?? "Not issued"}</span></div>; })}{!unreleasedPaid.length && <p className="portal-empty-copy">Nothing awaiting release.</p>}</section>
        <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Trainees with ending trainings</h2><p>Ending within 7 days</p></div><span className="slot-count">{ending.length}</span></div>{ending.slice(0, 20).map(({ e, end }) => <div className="live-row-item" key={e.id}><div><strong>{traineeName(e)}</strong><small>{one(e.courses)?.name ?? ""}</small></div><span className="slot-count">{fmtDate(end)}</span></div>)}{!ending.length && <p className="portal-empty-copy">No trainings ending soon.</p>}</section>
      </div>
    </>
  );
}

export function LiveReleasing({ data, role, reload }: { data: ReleasingData; role: string; reload: () => Promise<void> }) {
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<"Register" | "Templates" | "Released report">("Register");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [release, setRelease] = useState<Enrollment | null>(null);
  const [edit, setEdit] = useState<Enrollment | null>(null);
  const [pdf, setPdf] = useState<CertPdfTarget | null>(null);
  const [span, setSpan] = useState<"Daily" | "Weekly" | "Monthly" | "All">("Weekly");

  async function act(body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try { await submit(body); await reload(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "The action could not be completed."); }
    finally { setBusy(false); }
  }
  function issue(e: Enrollment) {
    const override = window.prompt(`Certificate number for ${traineeName(e)}?\nLeave blank to auto-generate.`, "");
    if (override === null) return;
    void act({ action: "certificate-issue", enrollmentId: e.id, certificateNumber: override.trim() || undefined });
  }
  function activeTemplateFor(courseId: string) { return data.certificateTemplates.find((t) => t.course_id === courseId && t.active && t.approved_at) ?? null; }
  function copyLink(token: string) { const url = `${window.location.origin}/feedback/${token}`; if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => setMessage("Feedback link copied to clipboard.")).catch(() => window.prompt("Share this feedback link with the trainee:", url)); else window.prompt("Share this feedback link with the trainee:", url); }
  async function sendFeedback(e: Enrollment) { setBusy(true); setMessage(""); try { await submit({ action: "feedback-send-email", enrollmentId: e.id }); setMessage(`Feedback form emailed to ${traineeName(e)} (queued for delivery).`); } catch (err) { setMessage(err instanceof Error ? err.message : "Could not send the feedback form."); } finally { setBusy(false); } }
  function openPdf(e: Enrollment) {
    const c = certOf(data, e.id);
    const snap = (c?.snapshot ?? {}) as { certificate_number?: string; overrides?: Record<string, string> };
    const ov = snap.overrides ?? {};
    setPdf({ templateId: (c?.template_id ?? activeTemplateFor(e.course_id)?.id) ?? null, traineeName: ov.name || traineeName(e), courseName: ov.course_title || (one(e.courses)?.name ?? ""), enrollmentNumber: e.enrollment_number, certificateNumber: snap.certificate_number ?? null, conductedDate: ov.conducted_date || ov.completion_date || (one(e.batches)?.ends_on ?? null), issuedDate: ov.issued_date || null, registrationNumber: ov.registration_number || e.enrollment_number, courseContent: ov.course_content || null });
  }

  const rows = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && inHouse(data, e)).sort((a, z) => Number(isPaid(z)) - Number(isPaid(a)));
  const ownCourses = data.courses.filter((c) => c.delivery_type === "In-House");

  // Released report
  const today = manilaDay(new Date().toISOString());
  const from = span === "Daily" ? today : span === "Weekly" ? manilaDay(new Date(Date.now() - 6 * 86400000).toISOString()) : span === "Monthly" ? today.slice(0, 8) + "01" : "0000-01-01";
  const releaseRows = data.certificateReleases.filter((r) => r.event_type === "release").filter((r) => span === "All" || (manilaDay(r.created_at) >= from && manilaDay(r.created_at) <= today));
  function exportReleases() {
    const header = ["Date", "Trainee", "Course", "Enrollment", "Certificate #", "Recipient", "ID type"];
    const body = releaseRows.map((r) => { const cert = one(r.certificates); const enr = one(cert?.enrollments); const snap = (cert?.snapshot ?? {}) as { certificate_number?: string }; const t = one(enr?.trainees ?? null); return [manilaDay(r.created_at), t ? `${t.legal_first_name} ${t.legal_last_name}` : "—", one(enr?.courses ?? null)?.name ?? "—", enr?.enrollment_number ?? "—", snap.certificate_number ?? "—", r.recipient_name ?? "—", r.recipient_id_type ?? "—"]; });
    downloadCsv(`released-certificates-${span.toLowerCase()}.csv`, [header, ...body]);
  }

  return (
    <div className="portal-page">
      <div className="portal-heading"><div><span className="portal-eyebrow">Releasing officer</span><h1>Training certificates</h1><p>Issue, print, release, and monitor in-house training certificates.</p></div></div>
      <div className="portal-tabs">{(["Register", "Templates", "Released report"] as const).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
      {message && <div className="portal-message error" role="alert">{message}</div>}
      <div className="portal-panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "12px 14px", marginBottom: 12 }}>
        <div><strong>Certificate issuance: <span className={`portal-badge ${data.certificateIssuanceEnabled ? "green" : "orange"}`}>{data.certificateIssuanceEnabled ? "Enabled" : "Disabled"}</span></strong><small style={{ display: "block", color: "var(--muted)" }}>{data.certificateIssuanceEnabled ? "Numbers can be issued and certificates printed and released." : "Issue, print, and release are blocked until this is enabled."}</small></div>
        {isAdmin ? <button type="button" className="portal-secondary" disabled={busy} onClick={() => void act({ action: "certificate-issuance-toggle", enabled: !data.certificateIssuanceEnabled })}>{data.certificateIssuanceEnabled ? "Disable issuance" : "Enable issuance"}</button> : <small style={{ color: "var(--muted)" }}>Only an admin can change this.</small>}
      </div>

      {tab === "Register" && <div className="portal-table portal-panel"><table><thead><tr><th>Trainee</th><th>Course</th><th>Payment</th><th>Feedback (online attendance)</th><th>Certificate</th><th>Actions</th></tr></thead><tbody>
        {rows.map((e) => { const c = certOf(data, e.id); const snap = (c?.snapshot ?? {}) as { certificate_number?: string }; const paid = isPaid(e); const printed = c?.status === "Printed" || c?.status === "Released"; return <tr key={e.id}>
          <td><strong>{traineeName(e)}</strong><small>{e.enrollment_number}</small></td>
          <td>{one(e.courses)?.name}<small>{one(e.courses)?.code}</small></td>
          <td><span className={`portal-badge ${paid ? "green" : "red"}`}>{paid ? "Paid" : "Balance"}</span></td>
          <td><span className={`portal-badge ${e.feedback_submitted ? "green" : "orange"}`}>{e.feedback_submitted ? "Submitted" : "Pending"}</span>{e.feedback_token && <span className="document-actions" style={{ marginTop: 4 }}><button type="button" className="ghost-button" onClick={() => copyLink(e.feedback_token!)}>Copy link</button><button type="button" className="ghost-button" disabled={busy} onClick={() => void sendFeedback(e)}>Email form</button></span>}</td>
          <td><strong>{c?.status ?? "Not issued"}</strong><small>{snap.certificate_number ? `No. ${snap.certificate_number}` : "—"}{c?.reprint_count ? ` · ${c.reprint_count} reprint(s)` : ""}</small></td>
          <td className="document-actions">
            <button type="button" disabled={busy || !paid} onClick={() => issue(e)}>{c ? "Re-issue #" : "Issue #"}</button>
            <button type="button" disabled={busy || !c || !e.feedback_submitted} title={!e.feedback_submitted ? "The trainee must submit the feedback form before printing." : undefined} onClick={() => void act({ action: "certificate-print", enrollmentId: e.id })}>Print</button>
            {printed && <button type="button" disabled={busy} onClick={() => void act({ action: "certificate-print", enrollmentId: e.id, reprint: true })}>Reprint</button>}
            <button type="button" disabled={busy || !c || !printed || c?.status === "Released"} onClick={() => setRelease(e)}>Release</button>
            <button type="button" disabled={busy || !c || !e.feedback_submitted} title={!e.feedback_submitted ? "The trainee must submit the feedback form before the certificate can be printed." : undefined} onClick={() => openPdf(e)}>PDF</button>
            {isAdmin && <button type="button" disabled={busy || !c} onClick={() => setEdit(e)}>Edit</button>}
            {c && c.status !== "Released" && <button type="button" className="ghost-danger" disabled={busy} onClick={() => { const reason = window.prompt("Void this certificate? Reason:") ?? undefined; if (reason !== undefined) void act({ action: "certificate-void", enrollmentId: e.id, reason }); }}>Void</button>}
          </td></tr>; })}
        {!rows.length && <tr><td colSpan={6}><span className="portal-empty-copy">No in-house enrollments yet.</span></td></tr>}
      </tbody></table></div>}

      {tab === "Templates" && <TemplateUpload data={data} ownCourses={ownCourses} onSaved={reload} />}

      {tab === "Released report" && <div className="portal-page" style={{ padding: 0 }}>
        <div className="portal-tabs">{(["Daily", "Weekly", "Monthly", "All"] as const).map((s) => <button key={s} className={span === s ? "active" : ""} onClick={() => setSpan(s)}>{s}</button>)}</div>
        <div className="panel-heading" style={{ padding: "8px 0" }}><div><h2 style={{ margin: 0, fontSize: 16 }}>Released certificates</h2><p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 13 }}>{span === "All" ? "All time" : `${from} → ${today}`} · {releaseRows.length}</p></div><button type="button" className="portal-secondary" disabled={!releaseRows.length} onClick={exportReleases}>Export CSV</button></div>
        <div className="portal-table portal-panel"><table><thead><tr><th>Date</th><th>Trainee</th><th>Course</th><th>Certificate #</th><th>Recipient</th></tr></thead><tbody>
          {releaseRows.map((r) => { const cert = one(r.certificates); const enr = one(cert?.enrollments); const snap = (cert?.snapshot ?? {}) as { certificate_number?: string }; const t = one(enr?.trainees ?? null); return <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</strong><small>{enr?.enrollment_number ?? ""}</small></td><td>{one(enr?.courses ?? null)?.name ?? "—"}</td><td>{snap.certificate_number ?? "—"}</td><td>{r.recipient_name ?? "—"}<small>{r.recipient_id_type ?? ""}</small></td></tr>; })}
          {!releaseRows.length && <tr><td colSpan={5}><span className="portal-empty-copy">No certificates released in this period.</span></td></tr>}
        </tbody></table></div>
      </div>}

      {release && <ReleaseModal enrollment={release} onClose={() => setRelease(null)} onDone={async (body) => { await act(body); setRelease(null); }} busy={busy} />}
      {edit && <OverrideModal enrollment={edit} cert={certOf(data, edit.id)} onClose={() => setEdit(null)} onDone={async (body) => { await act(body); setEdit(null); }} busy={busy} />}
      {pdf && <CertificatePdfModal target={pdf} onClose={() => setPdf(null)} />}
    </div>
  );
}

function OverrideModal({ enrollment, cert, onClose, onDone, busy }: { enrollment: Enrollment; cert: Certificate | null; onClose: () => void; onDone: (body: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const snap = (cert?.snapshot ?? {}) as { certificate_number?: string; overrides?: Record<string, string> };
  const ov = snap.overrides ?? {};
  const [name, setName] = useState(ov.name || traineeName(enrollment));
  const [courseName, setCourseName] = useState(ov.course_title || (one(enrollment.courses)?.name ?? ""));
  const [courseContent, setCourseContent] = useState(ov.course_content || "");
  const [conductedDate, setConductedDate] = useState(ov.conducted_date || ov.completion_date || (one(enrollment.batches)?.ends_on ?? ""));
  const [issuedDate, setIssuedDate] = useState(ov.issued_date || "");
  const [certNo, setCertNo] = useState(snap.certificate_number || "");
  const [regNo, setRegNo] = useState(ov.registration_number || enrollment.enrollment_number || "");
  function go() { void onDone({ action: "certificate-override", enrollmentId: enrollment.id, certificateNumber: certNo.trim() || undefined, overrides: { name: name.trim(), course_title: courseName.trim(), course_content: courseContent.trim(), conducted_date: conductedDate.trim(), issued_date: issuedDate.trim(), registration_number: regNo.trim() } }); }
  return <div className="portal-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="portal-modal" role="dialog" aria-modal="true"><header><div><span className="portal-eyebrow">Admin override</span><h2>Edit certificate details</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
      <div className="portal-form">
        <p className="portal-form-note full">Admin-only. These values print on the certificate (they override the trainee/course defaults). Leave a field blank to keep the default.</p>
        <label className="full">Name on certificate<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="full">Course name<input value={courseName} onChange={(e) => setCourseName(e.target.value)} /></label>
        <label className="full">Course content<textarea rows={2} value={courseContent} onChange={(e) => setCourseContent(e.target.value)} placeholder="e.g. modules covered" /></label>
        <label>Conducted date<input value={conductedDate} onChange={(e) => setConductedDate(e.target.value)} placeholder="YYYY-MM-DD" /></label>
        <label>Issued date<input value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} placeholder="YYYY-MM-DD" /></label>
        <label>Certificate no.<input value={certNo} onChange={(e) => setCertNo(e.target.value)} placeholder="Keep issued" /></label>
        <label>Registration no.<input value={regNo} onChange={(e) => setRegNo(e.target.value)} /></label>
        <div className="portal-form-actions full"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy} onClick={go}>{busy ? "Saving…" : "Save overrides"}</button></div>
      </div></section>
  </div>;
}

function ReleaseModal({ enrollment, onClose, onDone, busy }: { enrollment: Enrollment; onClose: () => void; onDone: (body: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState(traineeName(enrollment));
  const [idType, setIdType] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  function go() { if (!name.trim()) { setErr("Enter the recipient's name."); return; } void onDone({ action: "certificate-release", enrollmentId: enrollment.id, recipientName: name.trim(), recipientIdType: idType.trim() || undefined, reason: reason.trim() || undefined }); }
  return <div className="portal-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="portal-modal" role="dialog" aria-modal="true"><header><div><span className="portal-eyebrow">Certificate</span><h2>Release certificate</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
      <div className="portal-form">{err && <div className="portal-message error full">{err}</div>}
        <p className="portal-form-note full">Records who received the certificate. This is logged and appears in the released report.</p>
        <label className="full">Recipient name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="full">ID presented (type)<input value={idType} onChange={(e) => setIdType(e.target.value)} placeholder="e.g. Driver's license, SRN, authorization letter" /></label>
        <label className="full">Remarks<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" /></label>
        <div className="portal-form-actions full"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy} onClick={go}>{busy ? "Releasing…" : "Confirm release"}</button></div>
      </div></section>
  </div>;
}

function TemplateUpload({ data, ownCourses, onSaved }: { data: ReleasingData; ownCourses: Course[]; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const form = event.currentTarget; const fd = new FormData(form);
    try {
      const response = await fetch("/api/staff/certificate-templates", { method: "POST", body: fd });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Upload failed.");
      setMessage({ kind: "success", text: "Template uploaded and set active." }); form.reset(); await onSaved();
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Upload failed." }); }
    finally { setBusy(false); }
  }
  return <div className="portal-panel" style={{ padding: 16 }}>
    <form className="portal-form" onSubmit={upload}>
      <div className="full"><h2 style={{ margin: 0, fontSize: 16 }}>Upload certificate template</h2><p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>In-house courses only (Safety, Crowd, Crisis, SATSDSD, BT-PSSR, Ship&apos;s Security Officer, etc.). PDF or PNG/JPEG, ≤ 50 MB. The newest upload becomes the active template.</p></div>
      {message && <div className={`portal-message ${message.kind === "error" ? "error" : ""} full`}>{message.text}</div>}
      <label className="full">Course<select name="courseId" required><option value="">Select an in-house course</option>{ownCourses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
      <label className="full">Template file<input name="template" type="file" accept="application/pdf,image/png,image/jpeg" required /></label>
      <label className="full">Overlay fields (comma-separated)<input name="fields" defaultValue="Certificate Number, Trainee Name, Completion Date, Course Name" /></label>
      <div className="portal-form-actions full"><button className="portal-primary" disabled={busy}>{busy ? "Uploading…" : "Upload template"}</button></div>
    </form>
    <div className="portal-table" style={{ marginTop: 12 }}><table><thead><tr><th>Course</th><th>Version</th><th>Active</th><th>Approved</th></tr></thead><tbody>
      {data.certificateTemplates.map((t) => <tr key={t.id}><td>{one(t.courses)?.name ?? t.course_id}</td><td>v{t.version}</td><td>{t.active ? "Active" : "—"}</td><td>{t.approved_at ? fmtDate(t.approved_at) : "—"}</td></tr>)}
      {!data.certificateTemplates.length && <tr><td colSpan={4}><span className="portal-empty-copy">No templates uploaded yet.</span></td></tr>}
    </tbody></table></div>
  </div>;
}
