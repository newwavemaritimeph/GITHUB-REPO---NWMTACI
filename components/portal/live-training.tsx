"use client";

import { useState } from "react";

type Classroom = { id: string; name: string; venue: string; capacity: number; active: boolean };
type CertEnrollment = { enrollment_number?: string; trainees?: unknown; courses?: unknown };
type Certificate = { id: string; enrollment_id: string; status: string; printed_at?: string | null; reprint_count: number; created_at: string; enrollments?: CertEnrollment | CertEnrollment[] | null };
type Batch = { id: string; batch_number: string; starts_on: string; ends_on: string; venue?: string | null; mode: string; capacity: number; confirmed_count: number; status: string; courses?: { name: string; code: string } | { name: string; code: string }[] | null };
type TEnrollment = { id: string; enrollment_number: string; enrollment_status: string; trainees?: unknown; courses?: unknown };
type TCourse = { id: string; code: string; name: string; delivery_type: string };
type CertTemplate = { id: string; course_id: string; version: number; active: boolean; fields: { key: string; label: string }[]; approved_at?: string | null; courses?: { name: string; code: string } | { name: string; code: string }[] | null };
export type TrainingData = { classrooms: Classroom[]; certificates: Certificate[]; batches: Batch[]; enrollments: TEnrollment[]; courses: TCourse[]; certificateTemplates: CertTemplate[] };
/** DB status value → friendly label shown in the Certificate register. */
const CERT_STATUSES: [string, string][] = [["Pending Attendance", "Draft"], ["Ready to Print", "For Printing"], ["Printed", "Printed"], ["Released", "Released"], ["Cancelled", "Cancelled"]];

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const day = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${value}T00:00:00+08:00`)) : "—");
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

export function LiveTraining({ data, role, reload, initialTab = "Overview" }: { data: TrainingData; role: string; reload: () => Promise<void>; initialTab?: "Overview" | "Classrooms" | "Certificates" }) {
  const [tab, setTab] = useState<"Overview" | "Classrooms" | "Certificates">(initialTab);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canManage = role === "admin" || role === "training_operations";
  const [tplCourse, setTplCourse] = useState("");
  const [tplFields, setTplFields] = useState("Certificate Number, Trainee Name, Completion Date, Course Name");
  const [tplFile, setTplFile] = useState<File | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplMsg, setTplMsg] = useState("");
  async function uploadTemplate() {
    if (!tplCourse || !tplFile) { setTplMsg("Pick a course and a file."); return; }
    setTplBusy(true); setTplMsg("");
    try {
      const fd = new FormData();
      fd.set("template", tplFile); fd.set("courseId", tplCourse);
      fd.set("fields", JSON.stringify(tplFields.split(",").map((s) => s.trim()).filter(Boolean).map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label }))));
      const r = await fetch("/api/staff/certificate-templates", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Upload failed.");
      setTplFile(null); setTplMsg("Template uploaded."); await reload();
    } catch (e) { setTplMsg(e instanceof Error ? e.message : "Upload failed."); } finally { setTplBusy(false); }
  }
  const today = todayIso();

  async function post(body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The action could not be completed.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action could not be completed.");
    } finally { setBusy(false); }
  }

  function saveClassroom(existing?: Classroom) {
    const name = window.prompt("Classroom name?", existing?.name ?? ""); if (!name) return;
    const venue = window.prompt("Venue / location?", existing?.venue ?? "New Wave training center"); if (!venue) return;
    const capRaw = window.prompt("Seating capacity?", existing ? String(existing.capacity) : "24");
    const capacity = capRaw == null ? NaN : Math.trunc(Number(capRaw));
    if (!Number.isInteger(capacity) || capacity <= 0) { setMessage("Enter a valid capacity."); return; }
    void post({ action: "classroom-save", id: existing?.id ?? null, name, venue, capacity });
  }

  const upcoming = data.batches.filter((b) => b.ends_on >= today).sort((a, b) => a.starts_on.localeCompare(b.starts_on));

  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div><span className="portal-eyebrow">Training operations</span><h1>Training delivery</h1><p>Upcoming batches, managed classrooms, and certificate status.</p></div>
      </div>
      <div className="portal-tabs">
        {(["Overview", "Classrooms", "Certificates"] as const).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {message && <div className="portal-message error" role="alert">{message}</div>}

      {tab === "Overview" && (
        <>
          <div className="finance-hero">
            <div><span>Upcoming batches</span><strong>{upcoming.length}</strong><small>Ending today or later</small></div>
            <article><span>Classrooms</span><strong>{data.classrooms.filter((c) => c.active).length}</strong><small>Active rooms</small></article>
            <article><span>Seats</span><strong>{data.classrooms.filter((c) => c.active).reduce((s, c) => s + c.capacity, 0)}</strong><small>Total active capacity</small></article>
            <article><span>Certificates</span><strong>{data.certificates.length}</strong><small>All statuses</small></article>
          </div>
          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Upcoming schedule</h2><p>Batches ending today or later</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Batch</th><th>Course</th><th>Dates</th><th>Venue</th><th>Seats</th><th>Status</th></tr></thead><tbody>
              {upcoming.map((b) => { const c = one(b.courses); return (
                <tr key={b.id}><td><strong>{b.batch_number}</strong></td><td>{c?.name ?? "—"}<small>{c?.code}</small></td><td>{day(b.starts_on)} – {day(b.ends_on)}</td><td>{b.venue ?? b.mode}</td><td>{b.confirmed_count}/{b.capacity}</td><td>{b.status}</td></tr>
              ); })}
              {!upcoming.length && <tr><td colSpan={6}><span className="portal-empty-copy">No upcoming batches.</span></td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}

      {tab === "Classrooms" && (
        <section className="portal-panel">
          <div className="panel-heading"><div><h2>Classrooms</h2><p>Rooms available for scheduling</p></div>{canManage && <button className="portal-primary" disabled={busy} onClick={() => saveClassroom()}>+ Add classroom</button>}</div>
          <div className="portal-table"><table><thead><tr><th>Name</th><th>Venue</th><th>Capacity</th><th>Status</th><th></th></tr></thead><tbody>
            {data.classrooms.map((c) => (
              <tr key={c.id} className={c.active ? "" : "row-muted"}>
                <td><strong>{c.name}</strong></td>
                <td>{c.venue}</td>
                <td>{c.capacity}</td>
                <td>{c.active ? "Active" : "Archived"}</td>
                <td className="document-actions">
                  {canManage && <button disabled={busy} onClick={() => saveClassroom(c)}>Edit</button>}
                  {canManage && <button disabled={busy} onClick={() => post({ action: "classroom-set-active", id: c.id, active: !c.active })}>{c.active ? "Archive" : "Restore"}</button>}
                </td>
              </tr>
            ))}
            {!data.classrooms.length && <tr><td colSpan={5}><span className="portal-empty-copy">No classrooms yet.</span></td></tr>}
          </tbody></table></div>
        </section>
      )}

      {tab === "Certificates" && (
        <>
          {canManage
            ? <div className="portal-message" role="status">Issue and update certificate status below. In-house certificates require the trainee&apos;s completed feedback before release.</div>
            : <div className="certificate-lock"><span>◈</span><div><strong>Read-only</strong><p>Only Admin and Training Operations can issue or update certificates.</p></div><span className="portal-badge orange">Read-only</span></div>}
          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Certificate register</h2><p>Move a certificate through Draft → For Printing → Released</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Trainee</th><th>Course</th><th>Enrollment</th><th>Certificate status</th><th>Printed</th></tr></thead><tbody>
              {data.enrollments.filter((e) => e.enrollment_status !== "Cancelled").map((e) => {
                const t = one(e.trainees as { legal_first_name: string; legal_last_name: string } | { legal_first_name: string; legal_last_name: string }[] | null | undefined);
                const c = one(e.courses as { name: string; code: string } | { name: string; code: string }[] | null | undefined);
                const cert = data.certificates.find((x) => x.enrollment_id === e.id) ?? null;
                return <tr key={e.id}><td><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</strong></td><td>{c?.name ?? "—"}</td><td>{e.enrollment_number}</td><td>{canManage
                  ? <select value={cert?.status ?? ""} disabled={busy} onChange={(ev) => { void post({ action: "certificate-status", enrollmentId: e.id, status: ev.target.value }); }}><option value="" disabled>Not issued</option>{CERT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : (cert ? (CERT_STATUSES.find(([v]) => v === cert.status)?.[1] ?? cert.status) : "Not issued")}</td><td>{cert?.printed_at ? day(cert.printed_at) : "—"}</td></tr>;
              })}
              {!data.enrollments.filter((e) => e.enrollment_status !== "Cancelled").length && <tr><td colSpan={5}><span className="portal-empty-copy">No enrollments to certify yet.</span></td></tr>}
            </tbody></table></div>
          </section>
          {canManage && <section className="portal-panel">
            <div className="panel-heading"><div><h2>Certificate templates</h2><p>Upload a sample template per course and set the fields to fill in (number, name, date…)</p></div></div>
            <div className="portal-form" style={{ padding: "4px 0 10px" }}>
              {tplMsg && <div className="portal-message full" role="status">{tplMsg}</div>}
              <label>Course<select value={tplCourse} onChange={(e) => setTplCourse(e.target.value)}><option value="">Select an in-house course…</option>{data.courses.filter((c) => c.delivery_type === "In-House").map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select><small className="portal-form-note">Only New Wave in-house courses (incl. STCW). Endorsed / partner trainings are excluded.</small></label>
              <label>Template file (PDF/PNG/JPEG)<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setTplFile(e.target.files?.[0] ?? null)} /></label>
              <label className="full">Editable fields (comma-separated)<input value={tplFields} onChange={(e) => setTplFields(e.target.value)} /></label>
              <div className="full"><button type="button" className="portal-primary" disabled={tplBusy || !tplCourse || !tplFile} onClick={uploadTemplate}>{tplBusy ? "Uploading…" : "Upload template"}</button></div>
            </div>
            <div className="portal-table"><table><thead><tr><th>Course</th><th>Version</th><th>Fields</th><th>Active</th></tr></thead><tbody>
              {data.certificateTemplates.map((tp) => <tr key={tp.id}><td><strong>{one(tp.courses as { name: string } | { name: string }[] | null | undefined)?.name ?? "—"}</strong></td><td>v{tp.version}</td><td>{(tp.fields ?? []).map((f) => f.label).join(", ") || "—"}</td><td>{tp.active ? "Active" : "—"}</td></tr>)}
              {!data.certificateTemplates.length && <tr><td colSpan={4}><span className="portal-empty-copy">No templates uploaded yet.</span></td></tr>}
            </tbody></table></div>
          </section>}
        </>
      )}
    </div>
  );
}
