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
type CertTemplate = { id: string; course_id: string; version: number; active: boolean; approved_at?: string | null; fields?: { key: string; label: string }[] | null; courses?: CourseRef | CourseRef[] | null };
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

/**
 * Releasing Officer dashboard (owner spec, Aug 2026): pipeline counts, the
 * ready-for-release queue, today's pickup queue, courier monitoring,
 * corrections, needs-attention and search — with a release confirmation modal
 * that records claimant, ID/SPA checks and courier details for the audit trail.
 */
type CertX = Certificate & { release_method?: string | null; expected_pickup_on?: string | null; claimant_name?: string | null; claimant_relationship?: string | null; id_checked?: boolean; authorization_checked?: boolean; courier_name?: string | null; tracking_number?: string | null; shipping_fee_status?: string | null; shipping_address?: string | null; courier_status?: string | null; issue_status?: string | null; issue_note?: string | null; issue_reported_on?: string | null };

export function ReleasingDashboard({ data, reload }: { data: ReleasingData; reload?: () => Promise<void> }) {
  const today = manilaDay(new Date().toISOString());
  const [query, setQuery] = useState("");
  const [release, setRelease] = useState<{ enrollmentId: string; name: string; course: string; certNo: string } | null>(null);
  const [msg, setMsg] = useState("");
  const certs = data.certificates as CertX[];
  const enrolById = new Map(data.enrollments.map((e) => [e.id, e]));
  const nameOf = (c: CertX) => { const e = enrolById.get(c.enrollment_id); return e ? traineeName(e) : "Unknown trainee"; };
  const courseOf = (c: CertX) => one(enrolById.get(c.enrollment_id)?.courses)?.name ?? "—";
  const certNo = (c: CertX) => String((c.snapshot as { certificate_number?: string } | null)?.certificate_number ?? "—");
  const trainingEnd = (c: CertX) => one(enrolById.get(c.enrollment_id)?.batches)?.ends_on ?? null;
  const method = (c: CertX) => c.release_method ?? "Pickup";

  const byStatus = (s: string) => certs.filter((c) => c.status === s);
  const forProcessing = byStatus("Pending Attendance"), forPrinting = byStatus("Ready to Print"), ready = byStatus("Printed");
  const releasedToday = certs.filter((c) => c.status === "Released" && manilaDay(c.printed_at ?? "") === today);
  const pickupToday = ready.filter((c) => method(c) !== "Courier" && (c.expected_pickup_on ?? today) === today);
  const forCourier = ready.filter((c) => method(c) === "Courier");
  const corrections = certs.filter((c) => c.issue_status === "For Correction");

  const needs: { label: string; items: CertX[] }[] = [
    { label: "Missing authorization / SPA", items: ready.filter((c) => method(c) === "Representative" && !c.authorization_checked) },
    { label: "Missing shipping details", items: forCourier.filter((c) => !c.shipping_address) },
    { label: "Missing courier payment", items: forCourier.filter((c) => (c.shipping_fee_status ?? "Pending") !== "Paid") },
    { label: "Returned for correction", items: corrections },
    { label: "No certificate number", items: ready.filter((c) => certNo(c) === "—") },
  ].filter((n) => n.items.length > 0);
  const needsTotal = needs.reduce((s, n) => s + n.items.length, 0);

  const stats: [string, number, string][] = [
    ["For processing", forProcessing.length, "Training done, not yet ready"],
    ["For printing", forPrinting.length, "Ready to print"],
    ["Ready for release", ready.length, "Can be claimed"],
    ["For pickup today", pickupToday.length, "Expected at the office"],
    ["For courier / LBC", forCourier.length, "To be shipped"],
    ["Released today", releasedToday.length, "Completed today"],
  ];
  const pipeline: [string, number][] = [["Training completed", forProcessing.length], ["For printing", forPrinting.length], ["Ready for release", ready.length], ["Released", certs.filter((c) => c.status === "Released").length]];

  const hit = query.trim().toLowerCase();
  const found = hit.length >= 2 ? certs.filter((c) => `${nameOf(c)} ${courseOf(c)} ${certNo(c)} ${enrolById.get(c.enrollment_id)?.enrollment_number ?? ""}`.toLowerCase().includes(hit)).slice(0, 8) : [];

  async function post(body: Record<string, unknown>) {
    setMsg("");
    try { await submit(body); if (reload) await reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "The action could not be completed."); }
  }
  const statusChip = (c: CertX) => {
    if (c.issue_status === "For Correction") return { text: "For correction", cls: "cancelled" };
    if (method(c) === "Representative" && !c.authorization_checked) return { text: "Check authorization", cls: "pending" };
    if (method(c) === "Courier") return { text: c.courier_status ?? "For booking", cls: "pending" };
    return { text: "Ready", cls: "active" };
  };

  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Releasing officer</span><h1>Certificate releasing</h1><p>{fmtDate(today)} · pipeline, pickup queue, courier and corrections</p></div></div>
    {msg && <div className="portal-message error" role="alert">{msg}</div>}
    <div className="portal-panel" style={{ padding: 14, marginBottom: 16 }}>
      <label className="portal-field-inline" style={{ width: "100%" }}>Search trainee, SRN, certificate number, course or reference
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type at least 2 characters" />
      </label>
      {found.map((c) => <div className="live-row-item" key={c.id}><div><strong>{nameOf(c)}</strong><small>{courseOf(c)} · Cert {certNo(c)} · {c.status} · {method(c)}</small></div>{c.status === "Printed" && <button type="button" className="portal-primary" onClick={() => setRelease({ enrollmentId: c.enrollment_id, name: nameOf(c), course: courseOf(c), certNo: certNo(c) })}>Release</button>}</div>)}
      {hit.length >= 2 && !found.length && <p className="portal-empty-copy">No certificate matches that search.</p>}
    </div>
    <div className="metric-grid">{stats.map(([label, value, note], i) => <article key={label}><div className={`metric-symbol symbol-${i}`}>{["◷", "▤", "◈", "◎", "▦", "✓"][i]}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>
    {needsTotal > 0 && <div className="portal-message" role="status" style={{ marginTop: 12 }}>⚠ {needsTotal} record{needsTotal === 1 ? "" : "s"} need attention</div>}
    <section className="portal-panel" style={{ marginTop: 16, padding: 14 }}>
      <div className="panel-heading"><div><h2>Certificate pipeline</h2><p>Where every certificate currently sits</p></div></div>
      <div className="pipeline">{pipeline.map(([label, n], i) => <span key={label}><b>{n}</b>{label}{i < pipeline.length - 1 && <i aria-hidden>→</i>}</span>)}</div>
    </section>
    <section className="portal-panel" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>Ready for release</h2><p>Printed certificates that can be claimed</p></div><span className="slot-count">{ready.length}</span></div>
      <div className="portal-table"><table><thead><tr><th>Trainee</th><th>Course</th><th>Training date</th><th>Certificate</th><th>Release method</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {ready.slice(0, 25).map((c) => { const ch = statusChip(c); return <tr key={c.id}><td><strong>{nameOf(c)}</strong></td><td>{courseOf(c)}</td><td>{trainingEnd(c) ? fmtDate(trainingEnd(c) as string) : "—"}</td><td>{certNo(c)}</td><td>{method(c)}</td><td><span className={`portal-badge ${ch.cls}`}>{ch.text}</span></td><td className="document-actions"><button type="button" onClick={() => setRelease({ enrollmentId: c.enrollment_id, name: nameOf(c), course: courseOf(c), certNo: certNo(c) })}>View / release</button></td></tr>; })}
      </tbody></table>{!ready.length && <p className="portal-empty-copy">Nothing ready for release.</p>}</div>
    </section>
    <div className="dashboard-panels">
      <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Needs attention</h2><p>Blocked or incomplete releases</p></div><span className="slot-count">{needsTotal}</span></div>
        {needs.map((n) => <div className="live-row-item" key={n.label}><div><strong>{n.items.length} — {n.label}</strong><small>{n.items.slice(0, 3).map((c) => nameOf(c)).join(", ")}{n.items.length > 3 ? "…" : ""}</small></div><span className="portal-badge pending">Review</span></div>)}
        {!needs.length && <p className="portal-empty-copy">Nothing blocked.</p>}
      </section>
      <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Today&apos;s pickup queue</h2><p>Expected at the office today</p></div><span className="slot-count">{pickupToday.length}</span></div>
        {pickupToday.slice(0, 12).map((c) => <div className="live-row-item" key={c.id}><div><strong>{nameOf(c)}</strong><small>{courseOf(c)} · claimant: {c.claimant_name ?? (method(c) === "Representative" ? "representative" : "self")}</small></div><span className={`portal-badge ${method(c) === "Representative" && !c.authorization_checked ? "pending" : "active"}`}>{method(c) === "Representative" && !c.authorization_checked ? "Verify SPA" : "Waiting"}</span></div>)}
        {!pickupToday.length && <p className="portal-empty-copy">No pickups expected today.</p>}
      </section>
    </div>
    <section className="portal-panel" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>Courier / LBC</h2><p>Certificates to be shipped</p></div><span className="slot-count">{forCourier.length}</span></div>
      <div className="portal-table"><table><thead><tr><th>Trainee</th><th>Destination</th><th>Courier</th><th>Payment</th><th>Tracking</th><th>Status</th></tr></thead><tbody>
        {forCourier.slice(0, 20).map((c) => <tr key={c.id}><td><strong>{nameOf(c)}</strong></td><td>{c.shipping_address ?? <span className="portal-badge cancelled">Missing</span>}</td><td>{c.courier_name ?? "LBC"}</td><td>{(c.shipping_fee_status ?? "Pending") === "Paid" ? <span className="portal-badge active">Paid</span> : <span className="portal-badge pending">Pending</span>}</td><td>{c.tracking_number ?? "—"}</td><td>{c.courier_status ?? "For Booking"}</td></tr>)}
      </tbody></table>{!forCourier.length && <p className="portal-empty-copy">No courier releases queued.</p>}</div>
    </section>
    <div className="dashboard-panels">
      <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Released today</h2><p>Most recent completed releases</p></div><span className="slot-count">{releasedToday.length}</span></div>
        {releasedToday.slice(0, 15).map((c) => <div className="live-row-item" key={c.id}><div><strong>{nameOf(c)}</strong><small>{courseOf(c)} · to {c.claimant_name ?? "self"}{c.release_method ? ` · ${c.release_method}` : ""}</small></div><span className="portal-badge active">Released</span></div>)}
        {!releasedToday.length && <p className="portal-empty-copy">No certificates released today.</p>}
      </section>
      <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Certificate corrections</h2><p>Returned for correction</p></div><span className="slot-count">{corrections.length}</span></div>
        {corrections.slice(0, 12).map((c) => <div className="live-row-item" key={c.id}><div><strong>{nameOf(c)}</strong><small>{courseOf(c)} · {c.issue_note ?? "Correction requested"}{c.issue_reported_on ? ` · ${fmtDate(c.issue_reported_on)}` : ""}</small></div><button type="button" className="ghost-button" onClick={() => void post({ action: "certificate-issue-report", enrollmentId: c.enrollment_id, issueStatus: "Resolved" })}>Mark resolved</button></div>)}
        {!corrections.length && <p className="portal-empty-copy">No certificates flagged for correction.</p>}
      </section>
    </div>
    {release && <ReleaseConfirm target={release} onClose={() => setRelease(null)} onDone={async () => { setRelease(null); if (reload) await reload(); }} />}
  </div>;
}

/** Release confirmation: records who claimed it, the checks performed, and courier details. */
function ReleaseConfirm({ target, onClose, onDone }: { target: { enrollmentId: string; name: string; course: string; certNo: string }; onClose: () => void; onDone: () => Promise<void> }) {
  const [method, setMethod] = useState<"Pickup" | "Representative" | "Courier">("Pickup");
  const [name, setName] = useState(target.name), [rel, setRel] = useState(""), [idType, setIdType] = useState("");
  const [idOk, setIdOk] = useState(false), [spaOk, setSpaOk] = useState(false);
  const [courier, setCourier] = useState("LBC"), [tracking, setTracking] = useState(""), [fee, setFee] = useState("Paid"), [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const ready = method === "Pickup" ? name.trim().length > 1 && idOk : method === "Representative" ? name.trim().length > 1 && rel.trim().length > 1 && idOk && spaOk : address.trim().length > 4;
  async function confirm() {
    setBusy(true); setErr("");
    try {
      if (method === "Courier") await submit({ action: "certificate-release-plan", enrollmentId: target.enrollmentId, releaseMethod: "Courier", courierName: courier, trackingNumber: tracking, shippingFeeStatus: fee, shippingAddress: address, courierStatus: tracking ? "Shipped" : "Booked" });
      await submit({ action: "certificate-release", enrollmentId: target.enrollmentId, recipientName: method === "Courier" ? `${courier}${tracking ? ` · ${tracking}` : ""}` : name.trim(), recipientIdType: idType || undefined, releaseMethod: method, claimantRelationship: rel || undefined, idChecked: idOk, authorizationChecked: spaOk });
      await onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not release the certificate."); }
    finally { setBusy(false); }
  }
  return <div className="portal-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="portal-modal" role="dialog" aria-modal="true" aria-labelledby="rel-title">
      <header><div><span className="portal-eyebrow">Secure staff action</span><h2 id="rel-title">Release certificate</h2></div><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
      <div className="portal-form">
        {err && <div className="portal-message error full" role="alert">{err}</div>}
        <p className="full" style={{ margin: 0 }}><strong>{target.name}</strong><br />{target.course} · Certificate {target.certNo}</p>
        <label className="full">Released to<select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="Pickup">Trainee / self</option><option value="Representative">Authorized representative</option><option value="Courier">Courier / LBC</option></select></label>
        {method !== "Courier" && <>
          <label className="full">{method === "Pickup" ? "Trainee name" : "Representative name"}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          {method === "Representative" && <label className="full">Relationship to trainee<input value={rel} onChange={(e) => setRel(e.target.value)} placeholder="e.g. spouse, parent" /></label>}
          <label className="full">ID presented<input value={idType} onChange={(e) => setIdType(e.target.value)} placeholder="e.g. driver's license" /></label>
          <label className="portal-check full"><input type="checkbox" checked={idOk} onChange={(e) => setIdOk(e.target.checked)} /><span>Valid ID checked</span></label>
          {method === "Representative" && <label className="portal-check full"><input type="checkbox" checked={spaOk} onChange={(e) => setSpaOk(e.target.checked)} /><span>Authorization letter / SPA checked</span></label>}
        </>}
        {method === "Courier" && <>
          <label>Courier<input value={courier} onChange={(e) => setCourier(e.target.value)} /></label>
          <label>Tracking number<input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Optional until booked" /></label>
          <label>Shipping fee<select value={fee} onChange={(e) => setFee(e.target.value)}><option>Paid</option><option>Pending</option></select></label>
          <label className="full">Shipping address<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        </>}
        <p className="portal-form-note full">Released by, date and time are recorded automatically for the audit trail.</p>
        <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !ready} onClick={confirm}>{busy ? "Releasing…" : "Confirm release"}</button></div>
      </div>
    </section>
  </div>;
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
  // Add/remove/edit + preview go through the /certificate-templates/[id] endpoint.
  async function tplRequest(id: string, method: string, body?: unknown) {
    const response = await fetch(`/api/staff/certificate-templates/${id}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "The action could not be completed.");
    return result;
  }
  async function preview(id: string) {
    setMessage(null);
    try { const j = await tplRequest(id, "GET"); if (j.url) window.open(j.url, "_blank", "noopener,noreferrer"); else throw new Error("No preview link was returned."); }
    catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not open the template." }); }
  }
  async function editFields(t: CertTemplate) {
    const current = (t.fields ?? []).map((f) => f.label).join(", ");
    const next = window.prompt("Overlay fields to fill on the certificate (comma-separated labels):", current);
    if (next == null) return;
    setMessage(null);
    try { await tplRequest(t.id, "PATCH", { fields: next }); setMessage({ kind: "success", text: "Template fields updated." }); await onSaved(); }
    catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Update failed." }); }
  }
  async function setActive(id: string) {
    setMessage(null);
    try { await tplRequest(id, "PATCH", { active: true }); setMessage({ kind: "success", text: "Template set active." }); await onSaved(); }
    catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Update failed." }); }
  }
  async function removeTemplate(t: CertTemplate) {
    if (!window.confirm(`Remove the ${one(t.courses)?.name ?? "selected"} certificate template (v${t.version})? This cannot be undone.`)) return;
    setMessage(null);
    try { await tplRequest(t.id, "DELETE"); setMessage({ kind: "success", text: "Template removed." }); await onSaved(); }
    catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Remove failed." }); }
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
    <div className="portal-table" style={{ marginTop: 12 }}><table><thead><tr><th>Course</th><th>Version</th><th>Active</th><th>Approved</th><th>Fields</th><th>Actions</th></tr></thead><tbody>
      {data.certificateTemplates.map((t) => <tr key={t.id}>
        <td>{one(t.courses)?.name ?? t.course_id}</td><td>v{t.version}</td><td>{t.active ? "Active" : "—"}</td><td>{t.approved_at ? fmtDate(t.approved_at) : "—"}</td>
        <td>{(t.fields ?? []).map((f) => f.label).join(", ") || "—"}</td>
        <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="portal-secondary" onClick={() => preview(t.id)}>Preview</button>
          <button type="button" className="ghost-button" onClick={() => editFields(t)}>Edit</button>
          {!t.active && <button type="button" className="ghost-button" onClick={() => setActive(t.id)}>Set active</button>}
          <button type="button" className="ghost-button" onClick={() => removeTemplate(t)}>Remove</button>
        </div></td>
      </tr>)}
      {!data.certificateTemplates.length && <tr><td colSpan={6}><span className="portal-empty-copy">No templates uploaded yet.</span></td></tr>}
    </tbody></table></div>
  </div>;
}
