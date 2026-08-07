"use client";

import { useState } from "react";
import { first, manilaToday, dueCentavos } from "@/lib/portal-format";

/**
 * Registration Officer workspace (owner layout, Aug 2026). A work dashboard,
 * not a display one: today's numbers, today's trainees, what needs action,
 * schedule capacity, the enrolment pipeline, recent activity, announcements.
 *
 * Requirements note: the schema has no per-trainee requirements checklist
 * (no valid-ID / 2x2 photo / PEME fields, and the 2x2 photo is deliberately
 * never stored). "Incomplete" is therefore computed from the trainee-record
 * fields that DO exist — SRN, email, mobile and emergency contact — and the
 * breakdown names exactly those. A real document checklist needs a migration.
 */

type CourseRef = { name?: string; code?: string };
type TraineeRef = { trainee_number?: string; legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; email?: string; mobile?: string; srn?: string | null; emergency_contact?: Record<string, unknown> | null };
type BatchRef = { batch_number?: string; starts_on: string; ends_on: string; mode?: string; venue?: string | null };
type Enrollment = { id: string; enrollment_number: string; trainee_id?: string; course_id: string; partner_offer_id?: string | null; batch_id?: string | null; scheduled_on?: string | null; enrollment_status: string; created_at: string; source?: string | null; selling_price_centavos: number; paid_centavos: number; charges_centavos?: number | null; discounts_centavos?: number | null; trainees?: TraineeRef | TraineeRef[] | null; courses?: CourseRef | CourseRef[] | null; batches?: BatchRef | BatchRef[] | null };
type Batch = { id: string; batch_number: string; course_id: string; starts_on: string; ends_on: string; mode: string; capacity: number; confirmed_count: number; status: string; published_at?: string | null; courses?: CourseRef | CourseRef[] | null };
type Trainee = { id: string; trainee_number: string; legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; email: string; mobile: string; srn?: string | null; registered_at: string };
type RequestRow = { id: string; request_number: string; request_type: string; reason: string; status: string; created_at: string; trainees?: { legal_first_name: string; legal_last_name: string } | { legal_first_name: string; legal_last_name: string }[] | null };
type Announcement = { id: string; title: string; body: string; published_at?: string | null; expires_at?: string | null };
export type RegistrationData = { profile: { complete_name: string }; enrollments: Enrollment[]; batches: Batch[]; trainees: Trainee[]; requests: RequestRow[]; announcements: Announcement[]; courses: { id: string; code: string; name: string; delivery_type: string }[]; payments: { trainee_id: string; verification_state: string }[] };

const fmtDate = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`)) : "—");
const fmtLong = (v: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const clock = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(v)) : "—");
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00+08:00`); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d); };
const nameOf = (e: Enrollment) => { const t = first(e.trainees); return t ? [t.legal_first_name, t.legal_last_name].filter(Boolean).join(" ") : e.enrollment_number; };
const initials = (s: string) => s.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** Record completeness from fields that actually exist on a trainee. */
const MISSING_CHECKS: [string, (t: TraineeRef | Trainee) => boolean][] = [
  ["SRN", (t) => !t.srn],
  ["Email", (t) => !t.email],
  ["Mobile", (t) => !t.mobile],
];
function missingFor(t: TraineeRef | Trainee | null | undefined) {
  if (!t) return [] as string[];
  return MISSING_CHECKS.filter(([, f]) => f(t)).map(([label]) => label);
}

export function RegistrationDashboard({ data, go, openEnrollment }: { data: RegistrationData; go: (module: string) => void; openEnrollment: () => void }) {
  const today = manilaToday();
  const tomorrow = addDays(today, 1);
  const [courseId, setCourseId] = useState(""), [sched, setSched] = useState(""), [status, setStatus] = useState("All status"), [q, setQ] = useState("");
  const [quick, setQuick] = useState(false);

  const live = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled");
  const batchOf = (e: Enrollment) => first(e.batches);
  const runsOn = (e: Enrollment, d: string) => { const b = batchOf(e); const s = b?.starts_on ?? e.scheduled_on; const t = b?.ends_on ?? e.scheduled_on; return !!s && !!t && s <= d && d <= t; };
  const todays = live.filter((e) => runsOn(e, today));
  const tomorrows = live.filter((e) => runsOn(e, tomorrow));
  const newToday = data.enrollments.filter((e) => day(e.created_at) === today);

  const unverifiedTrainees = new Set(data.payments.filter((p) => p.verification_state !== "Verified").map((p) => p.trainee_id));
  const incomplete = data.trainees.filter((t) => missingFor(t).length > 0);
  const pendingChanges = data.requests.filter((r) => r.status === "Pending" && ["Rescheduling", "Change Course", "Cancellation"].includes(r.request_type));
  const openBatches = data.batches.filter((b) => b.status !== "Cancelled" && b.starts_on >= today);
  const availableSlots = openBatches.reduce((s, b) => s + Math.max(0, b.capacity - b.confirmed_count), 0);

  // possible duplicates: same normalised name, or same mobile/email across trainees
  const dupKeys = new Map<string, number>();
  for (const t of data.trainees) {
    for (const k of [`${t.legal_first_name} ${t.legal_last_name}`.toLowerCase().replace(/\s+/g, " "), (t.mobile || "").replace(/\D/g, ""), (t.email || "").toLowerCase()]) {
      if (k && k.length > 3) dupKeys.set(k, (dupKeys.get(k) ?? 0) + 1);
    }
  }
  const duplicates = [...dupKeys.values()].filter((n) => n > 1).length;

  const kpis: [string, number, string, string][] = [
    ["New enrollments today", newToday.length, "Enrollments", "◎"],
    ["Training today", todays.length, "Enrollments", "▤"],
    ["Upcoming tomorrow", tomorrows.length, "Schedules", "▦"],
    ["Incomplete records", incomplete.length, "Trainees", "◷"],
    ["Pending changes", pendingChanges.length, "Registration changes", "↺"],
    ["Available slots", availableSlots, "Schedules", "◈"],
  ];

  // today's trainee table
  const reqBadge = (e: Enrollment) => { const m = missingFor(first(e.trainees)); return m.length ? { text: `Missing ${m[0]}`, cls: "cancelled" } : { text: "Complete", cls: "active" }; };
  const payBadge = (e: Enrollment) => { const paidAmt = Number(e.paid_centavos), due = dueCentavos(e); if (due > 0 && paidAmt >= due) return { text: "Paid", cls: "active" }; if (paidAmt > 0) return { text: "Partial", cls: "pending" }; return { text: "Unpaid", cls: "cancelled" }; };
  const regBadge = (e: Enrollment) => { if (e.enrollment_status === "Cancelled") return { text: "Cancelled", cls: "cancelled" }; if (e.trainee_id && unverifiedTrainees.has(e.trainee_id)) return { text: "For review", cls: "pending" }; if (e.enrollment_status === "Enrolled") return { text: "Confirmed", cls: "active" }; return { text: e.enrollment_status, cls: "pending" }; };
  const rows = todays
    .filter((e) => !courseId || e.course_id === courseId)
    .filter((e) => !sched || (batchOf(e)?.batch_number ?? "") === sched)
    .filter((e) => status === "All status" || regBadge(e).text === status)
    .filter((e) => !q.trim() || nameOf(e).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  // action required
  const missingBreakdown = MISSING_CHECKS.map(([label, f]) => [label, data.trainees.filter((t) => f(t)).length] as [string, number]).filter(([, n]) => n > 0);
  const actions: [string, number, string, string][] = [
    ["Incomplete records", incomplete.length, `${incomplete.length} trainees`, "Trainees"],
    ["Schedule changes", data.requests.filter((r) => r.status === "Pending" && r.request_type === "Rescheduling").length, "requests", "Registration changes"],
    ["Course changes", data.requests.filter((r) => r.status === "Pending" && r.request_type === "Change Course").length, "requests", "Registration changes"],
    ["Cancellation requests", data.requests.filter((r) => r.status === "Pending" && r.request_type === "Cancellation").length, "requests", "Registration changes"],
    ["Possible duplicate records", duplicates, "records", "Trainees"],
  ].filter(([, n]) => (n as number) > 0) as [string, number, string, string][];

  // capacity
  const upcoming = openBatches.filter((b) => b.starts_on <= addDays(today, 14)).sort((a, b) => a.starts_on.localeCompare(b.starts_on)).slice(0, 6);
  const capTone = (b: Batch) => { const left = b.capacity - b.confirmed_count; return left <= 0 ? { t: "Full", c: "cancelled" } : left <= 3 ? { t: "Nearly full", c: "pending" } : { t: "Open", c: "active" }; };

  // pipeline
  const pipeline: [string, string, number, string][] = [
    ["New", "Newly encoded enrollments", newToday.length, "#0571d0"],
    ["For requirements", "Waiting for record details", live.filter((e) => missingFor(first(e.trainees)).length > 0).length, "#f2a615"],
    ["For payment verification", "Pending payment verification", live.filter((e) => e.trainee_id && unverifiedTrainees.has(e.trainee_id)).length, "#f25615"],
    ["Registered", "Records complete", live.filter((e) => missingFor(first(e.trainees)).length === 0).length, "#0a7d3b"],
    ["Scheduled", "With confirmed schedules", live.filter((e) => !!e.batch_id).length, "#7c3aed"],
  ];

  const recent = [...data.enrollments].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
  const notices = data.announcements.filter((a) => !a.expires_at || a.expires_at > new Date().toISOString());
  const schedOptions = [...new Set(todays.map((e) => batchOf(e)?.batch_number).filter(Boolean))] as string[];

  return <div className="portal-page">
    <div className="portal-heading">
      <div><h1 style={{ margin: 0 }}>Registration dashboard</h1><p>{fmtLong(today)} · <span style={{ color: "#0a7d3b" }}>● Live operations</span></p></div>
      <span style={{ display: "inline-flex", gap: 10, position: "relative" }}>
        <button type="button" className="portal-secondary" onClick={() => go("Search trainee")}>Search trainee</button>
        <button type="button" className="portal-secondary" onClick={() => setQuick((v) => !v)}>⚡ Quick actions ▾</button>
        {quick && <div className="quick-menu">{[["Change schedule", "Registration changes"], ["Change course", "Registration changes"], ["Cancel enrollment", "Registration changes"], ["View schedules", "Schedules"], ["Print records", "Reports"]].map(([label, mod]) => <button type="button" key={label} onClick={() => { setQuick(false); go(mod); }}>{label}</button>)}</div>}
        <button type="button" className="portal-primary" onClick={openEnrollment}>+ New enrollment</button>
      </span>
    </div>

    <div className="reg-kpis">{kpis.map(([label, n, mod, icon]) => <button type="button" key={label} onClick={() => go(mod)}><i>{icon}</i><span>{label}</span><strong>{n}</strong><small>View all →</small></button>)}</div>

    <div className="reg-main">
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Today&apos;s trainees</h2><p>{rows.length} of {todays.length} scheduled today</p></div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "0 0 10px" }}>
          <label className="portal-field-inline">Course<select value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">All courses</option>{[...new Map(todays.map((e) => [e.course_id, first(e.courses)?.name ?? "Course"])).entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label className="portal-field-inline">Schedule<select value={sched} onChange={(e) => setSched(e.target.value)}><option value="">All schedules</option>{schedOptions.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="portal-field-inline">Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option>All status</option><option>Confirmed</option><option>For review</option><option>Pending</option></select></label>
          <label className="portal-field-inline" style={{ flex: 1, minWidth: 180 }}>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee" /></label>
        </div>
        <div className="portal-table"><table><thead><tr><th>Trainee</th><th>Course</th><th>Schedule</th><th>Modality</th><th>Requirements</th><th>Payment</th><th>Registration</th><th>Action</th></tr></thead><tbody>
          {rows.slice(0, 10).map((e) => { const b = batchOf(e); const r = reqBadge(e), p = payBadge(e), g = regBadge(e); const nm = nameOf(e); return <tr key={e.id}>
            <td><span className="avatar">{initials(nm)}</span><strong style={{ marginLeft: 8 }}>{nm}</strong></td>
            <td>{first(e.courses)?.code ?? first(e.courses)?.name ?? "—"}</td>
            <td>{fmtDate(b?.starts_on ?? e.scheduled_on)}{b && b.ends_on !== b.starts_on ? `–${fmtDate(b.ends_on).replace(/,.*/, "")}` : ""}</td>
            <td>{b?.mode ?? "—"}</td>
            <td><span className={`portal-badge ${r.cls}`}>{r.text}</span></td>
            <td><span className={`portal-badge ${p.cls}`}>{p.text}</span></td>
            <td><span className={`portal-badge ${g.cls}`}>{g.text}</span></td>
            <td className="document-actions"><button type="button" onClick={() => go("Enrollments")}>{r.text === "Complete" ? "View" : "Review"}</button></td>
          </tr>; })}
        </tbody></table>{!rows.length && <p className="portal-empty-copy">No trainees scheduled today.</p>}</div>
        <div className="pager"><span>Showing {Math.min(10, rows.length)} of {rows.length}</span><button type="button" className="ghost-button" onClick={() => go("Enrollments")}>View all trainees →</button></div>
      </section>

      <section className="portal-panel live-list">
        <div className="panel-heading"><div><h2>⚠ Action required</h2><p>Items needing registration action</p></div></div>
        {actions.map(([label, n, sub, mod]) => <button type="button" className="needs-row" key={label} onClick={() => go(mod)}><span><b>{label}</b><small style={{ display: "block", color: "var(--muted)" }}>{n} {sub}</small></span><span className="portal-badge pending">{n}</span></button>)}
        {!actions.length && <p className="portal-empty-copy">Nothing needs action right now.</p>}
        {missingBreakdown.length > 0 && <div style={{ padding: "8px 4px 0" }}><small style={{ color: "var(--muted)", fontWeight: 700 }}>Incomplete breakdown</small>{missingBreakdown.map(([label, n]) => <div className="live-row-item" key={label}><div><strong>{label}</strong></div><span className="slot-count">{n} missing</span></div>)}</div>}
      </section>
    </div>

    <div className="reg-main">
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Upcoming training schedules &amp; capacity</h2><p>Next 14 days</p></div><button type="button" className="ghost-button" onClick={() => go("Schedules")}>View all →</button></div>
        <div className="portal-table"><table><thead><tr><th>Date</th><th>Course</th><th>Batch</th><th>Enrolled</th><th>Capacity</th><th>Available</th><th>Status</th></tr></thead><tbody>
          {upcoming.map((b) => { const s = capTone(b); return <tr key={b.id}><td>{fmtDate(b.starts_on)}{b.ends_on !== b.starts_on ? `–${b.ends_on.slice(8, 10)}` : ""}</td><td>{first(b.courses)?.name ?? "—"}</td><td>{b.batch_number}</td><td>{b.confirmed_count}</td><td>{b.capacity}</td><td>{Math.max(0, b.capacity - b.confirmed_count)}</td><td><span className={`portal-badge ${s.c}`}>{s.t}</span></td></tr>; })}
        </tbody></table>{!upcoming.length && <p className="portal-empty-copy">No schedules in the next two weeks.</p>}</div>
      </section>
      <section className="portal-panel live-list">
        <div className="panel-heading"><div><h2>Enrollment pipeline</h2></div></div>
        {pipeline.map(([label, sub, n, c]) => <button type="button" className="needs-row" key={label} onClick={() => go("Enrollments")}><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><i style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block" }} /><span><b>{label}</b><small style={{ display: "block", color: "var(--muted)" }}>{sub}</small></span></span><span className="portal-badge">{n}</span></button>)}
      </section>
    </div>

    <div className="reg-main">
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Recent enrollments</h2><p>Latest registrations</p></div><button type="button" className="ghost-button" onClick={() => go("Enrollments")}>View all →</button></div>
        <div className="portal-table"><table><thead><tr><th>Time</th><th>Trainee</th><th>Course</th><th>Schedule</th><th>Source</th></tr></thead><tbody>
          {recent.map((e) => <tr key={e.id}><td>{clock(e.created_at)}</td><td><strong>{nameOf(e)}</strong></td><td>{first(e.courses)?.code ?? "—"}</td><td>{fmtDate(batchOf(e)?.starts_on ?? e.scheduled_on)}</td><td>{e.source ?? "—"}</td></tr>)}
        </tbody></table>{!recent.length && <p className="portal-empty-copy">No enrollments yet.</p>}</div>
      </section>
      <section className="portal-panel live-list">
        <div className="panel-heading"><div><h2>Requirements status</h2><p>Trainee record completeness</p></div></div>
        <div className="pill-row"><div className="ok"><span>Complete</span><b>{data.trainees.length - incomplete.length}</b></div><div className="bad"><span>Incomplete</span><b>{incomplete.length}</b></div></div>
        {missingBreakdown.map(([label, n]) => <div className="live-row-item" key={label}><div><strong>{label}</strong></div><span className="slot-count">{n} missing</span></div>)}
        {!missingBreakdown.length && <p className="portal-empty-copy">Every trainee record is complete.</p>}
        <button type="button" className="ghost-button" style={{ marginTop: 6 }} onClick={() => go("Trainees")}>View missing requirements →</button>
      </section>
    </div>

    <section className="portal-panel live-list" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>📣 Staff announcement</h2></div><span className="slot-count">{notices.length}</span></div>
      {notices.slice(0, 2).map((a) => <div className="live-row-item" key={a.id}><div><strong>{a.title}</strong><small>{a.body}</small></div><span className="portal-badge">{a.published_at ? clock(a.published_at) : "Draft"}</span></div>)}
      {!notices.length && <p className="portal-empty-copy">No active announcements. Announcements and reminders appear here.</p>}
    </section>
  </div>;
}

/** Schedule changes, course changes, cancellations and their history. */
export function RegistrationChanges({ data, go }: { data: RegistrationData; go?: (module: string) => void }) {
  const [tab, setTab] = useState<"Pending" | "Schedule change" | "Course change" | "Cancellation" | "History">("Pending");
  const TYPE: Record<string, string> = { "Schedule change": "Rescheduling", "Course change": "Change Course", Cancellation: "Cancellation" };
  const rows = data.requests.filter((r) => {
    if (tab === "Pending") return r.status === "Pending";
    if (tab === "History") return r.status !== "Pending";
    return r.request_type === TYPE[tab];
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Registration</span><h1>Registration changes</h1><p>Schedule changes, course changes, cancellations and their history.</p></div></div>
    <div className="portal-tabs">{(["Pending", "Schedule change", "Course change", "Cancellation", "History"] as const).map((t) => <button key={t} type="button" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
    <div className="portal-table portal-panel"><table><thead><tr><th>Request</th><th>Trainee</th><th>Type</th><th>Reason</th><th>Status</th><th>Filed</th></tr></thead><tbody>
      {rows.map((r) => { const t = first(r.trainees); return <tr key={r.id}><td><strong>{r.request_number}</strong></td><td>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</td><td>{r.request_type}</td><td>{r.reason}</td><td><span className={`portal-badge ${r.status === "Approved" ? "active" : r.status === "Rejected" ? "cancelled" : "pending"}`}>{r.status}</span></td><td>{fmtDate(day(r.created_at))}</td></tr>; })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">Nothing in this view.</p>}</div>
    {go && <button type="button" className="portal-secondary" style={{ marginTop: 12 }} onClick={() => go("Enrollments")}>Go to enrollments →</button>}
  </div>;
}
