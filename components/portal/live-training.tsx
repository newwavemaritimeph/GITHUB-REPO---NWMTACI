"use client";

import { useState } from "react";

type Classroom = { id: string; name: string; venue: string; capacity: number; active: boolean };
type CertEnrollment = { enrollment_number?: string; trainees?: unknown; courses?: unknown };
type Certificate = { id: string; enrollment_id: string; status: string; printed_at?: string | null; reprint_count: number; created_at: string; enrollments?: CertEnrollment | CertEnrollment[] | null };
type Batch = { id: string; batch_number: string; starts_on: string; ends_on: string; venue?: string | null; mode: string; capacity: number; confirmed_count: number; status: string; courses?: { name: string; code: string } | { name: string; code: string }[] | null };
export type TrainingData = { classrooms: Classroom[]; certificates: Certificate[]; batches: Batch[] };

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const day = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${value}T00:00:00+08:00`)) : "—");
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

export function LiveTraining({ data, role, reload, initialTab = "Overview" }: { data: TrainingData; role: string; reload: () => Promise<void>; initialTab?: "Overview" | "Classrooms" | "Certificates" }) {
  const [tab, setTab] = useState<"Overview" | "Classrooms" | "Certificates">(initialTab);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canManage = role === "admin" || role === "training_operations";
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
          <div className="certificate-lock">
            <span>◈</span>
            <div><strong>Certificate issuance is disabled</strong><p>Printing and release stay blocked until an approved New Wave template is uploaded and the issuance feature flag is enabled. This view is read-only.</p></div>
            <span className="portal-badge orange">Safety lock active</span>
          </div>
          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Certificate register</h2><p>Eligibility and status by enrollment</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Trainee</th><th>Course</th><th>Enrollment</th><th>Status</th><th>Printed</th></tr></thead><tbody>
              {data.certificates.map((cert) => {
                const e = one(cert.enrollments); const t = one(e?.trainees as { legal_first_name: string; legal_last_name: string } | { legal_first_name: string; legal_last_name: string }[] | null | undefined); const c = one(e?.courses as { name: string; code: string } | { name: string; code: string }[] | null | undefined);
                return <tr key={cert.id}><td><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</strong></td><td>{c?.name ?? "—"}</td><td>{e?.enrollment_number ?? "—"}</td><td>{cert.status}</td><td>{cert.printed_at ? day(cert.printed_at) : "—"}</td></tr>;
              })}
              {!data.certificates.length && <tr><td colSpan={5}><span className="portal-empty-copy">No certificate records yet. They appear once attendance completion generates eligibility.</span></td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}
    </div>
  );
}
