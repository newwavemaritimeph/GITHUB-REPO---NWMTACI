"use client";

import { useState } from "react";
import { first, manilaToday } from "@/lib/portal-format";

/**
 * Schedule Officer workspace: dashboard, training calendar, trainee scheduling,
 * instructor assignment, and schedule changes. Instructor/room per batch come
 * from the batchStaffing payload (first resource assignment of each batch).
 */

type CourseRef = { name: string; code: string };
type Batch = { id: string; batch_number: string; course_id: string; starts_on: string; ends_on: string; daily_start?: string | null; daily_end?: string | null; mode: string; venue?: string | null; capacity: number; confirmed_count: number; enrollment_deadline: string; status: string; published_at?: string | null; courses?: CourseRef | CourseRef[] | null };
type TraineeRef = { trainee_number: string; legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; email: string; mobile: string };
type Enrollment = { id: string; enrollment_number: string; course_id: string; partner_offer_id?: string | null; batch_id?: string | null; scheduled_on?: string | null; enrollment_status: string; created_at: string; trainees?: TraineeRef | TraineeRef[] | null; courses?: CourseRef | CourseRef[] | null };
type RequestRow = { id: string; request_number: string; request_type: string; reason: string; status: string; created_at: string; decided_at?: string | null; trainees?: { legal_first_name: string; legal_last_name: string } | { legal_first_name: string; legal_last_name: string }[] | null };
type Staffing = { batch_id: string; instructor_name: string | null; room_name: string | null };
export type SchedulingData = { batches: Batch[]; enrollments: Enrollment[]; requests: RequestRow[]; batchStaffing: Staffing[]; courses: { id: string; code: string; name: string; delivery_type: string }[] };

const fmtDate = (v: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const fmtTime = (t?: string | null) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${String(m).padStart(2, "0")} ${ap}`; };
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00+08:00`); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d); };
const courseOf = (b: Batch) => first(b.courses)?.name ?? "Course";
const overlaps = (a: Batch, b: Batch) => a.starts_on <= b.ends_on && b.starts_on <= a.ends_on;
const PALETTE = ["#F25615", "#0571D0", "#0a7d3b", "#7c3aed", "#0e7490", "#123F63", "#b45309", "#be185d"];
const colorFor = (code: string) => { let h = 0; for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

async function submit(body: Record<string, unknown>) {
  const r = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "The action could not be completed.");
  return j;
}

function staffingMap(data: SchedulingData) { return new Map(data.batchStaffing.map((s) => [s.batch_id, s])); }

/** Everything the dashboard derives, shared with the stat cards and panels. */
function derive(data: SchedulingData) {
  const today = manilaToday();
  const horizon = addDays(today, 14);
  const staffing = staffingMap(data);
  const live = data.batches.filter((b) => b.status !== "Cancelled");
  const todays = live.filter((b) => b.starts_on <= today && today <= b.ends_on).sort((a, z) => (a.daily_start ?? "").localeCompare(z.daily_start ?? ""));
  const upcoming = live.filter((b) => b.starts_on > today && b.starts_on <= horizon).sort((a, z) => a.starts_on.localeCompare(z.starts_on));
  const window14 = live.filter((b) => b.ends_on >= today && b.starts_on <= horizon);
  const noInstructor = window14.filter((b) => !staffing.get(b.id)?.instructor_name);
  const conflicts: { kind: string; text: string }[] = [];
  for (let i = 0; i < window14.length; i++) for (let j = i + 1; j < window14.length; j++) {
    const a = window14[i], b = window14[j];
    if (!overlaps(a, b)) continue;
    const sa = staffing.get(a.id), sb = staffing.get(b.id);
    if (sa?.room_name && sa.room_name === sb?.room_name) conflicts.push({ kind: "Room conflict", text: `${courseOf(a)} and ${courseOf(b)} both in ${sa.room_name} — ${fmtDate(b.starts_on)}` });
    if (sa?.instructor_name && sa.instructor_name === sb?.instructor_name) conflicts.push({ kind: "Instructor double-booked", text: `${sa.instructor_name}: ${courseOf(a)} and ${courseOf(b)} overlap — ${fmtDate(b.starts_on)}` });
  }
  for (const b of window14) if (b.confirmed_count > b.capacity) conflicts.push({ kind: "Capacity issue", text: `${courseOf(b)} ${b.batch_number} — ${b.confirmed_count}/${b.capacity} enrolled` });
  const almostFull = window14.filter((b) => b.confirmed_count < b.capacity && b.capacity - b.confirmed_count <= 2);
  const unscheduled = data.enrollments.filter((e) => !e.batch_id && !e.partner_offer_id && e.enrollment_status !== "Cancelled");
  return { today, staffing, todays, upcoming, noInstructor, conflicts, almostFull, unscheduled };
}

export function ScheduleOfficerDashboard({ data, go, openBatch }: { data: SchedulingData; go: (module: string) => void; openBatch: () => void }) {
  const d = derive(data);
  const scheduledToday = d.todays.reduce((s, b) => s + b.confirmed_count, 0);
  const slotsToday = d.todays.reduce((s, b) => s + Math.max(0, b.capacity - b.confirmed_count), 0);
  const fullToday = d.todays.filter((b) => b.confirmed_count >= b.capacity).length;
  const stats: [string, number][] = [["Trainings today", d.todays.length], ["Trainees scheduled", scheduledToday], ["Available slots", slotsToday], ["Full classes", fullToday], ["Pending instructor assignments", d.noInstructor.length], ["Schedule conflicts", d.conflicts.length]];
  const dayN = (b: Batch) => { if (b.starts_on === b.ends_on || b.starts_on > d.today) return ""; const n = Math.round((new Date(`${d.today}T00:00:00+08:00`).getTime() - new Date(`${b.starts_on}T00:00:00+08:00`).getTime()) / 86400000) + 1; return n > 1 ? ` — Day ${n}` : ""; };
  const attention: { label: string; text: string; tone: "red" | "orange" }[] = [
    ...d.noInstructor.map((b) => ({ label: "Instructor not assigned", text: `${courseOf(b)} — ${fmtDate(b.starts_on)}${b.ends_on !== b.starts_on ? `–${fmtDate(b.ends_on)}` : ""}`, tone: "red" as const })),
    ...d.conflicts.map((c) => ({ label: c.kind, text: c.text, tone: "red" as const })),
    ...d.almostFull.map((b) => ({ label: "Batch almost full", text: `${courseOf(b)} ${b.batch_number} — ${b.confirmed_count}/${b.capacity} trainees`, tone: "orange" as const })),
    ...(d.unscheduled.length ? [{ label: "Unscheduled trainees", text: `${d.unscheduled.length} trainee${d.unscheduled.length === 1 ? "" : "s"} still need a schedule assignment`, tone: "orange" as const }] : []),
  ];
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Training operations</span><h1>Schedule officer</h1><p>Today&apos;s trainings, the next two weeks, and what needs attention.</p></div><button className="portal-primary" onClick={openBatch}>+ Create schedule</button></div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 16px" }}>
      {[["Training calendar", "Training calendar"], ["Trainee scheduling", "Trainee scheduling"], ["Instructor assignment", "Instructor assignment"], ["Schedule changes", "Schedule changes"], ["Schedules", "Schedules / batches"]].map(([m, label]) => <button key={m} type="button" className="portal-secondary" onClick={() => go(m)}>{label}</button>)}
    </div>
    <div className="metric-grid">{stats.map(([label, value], i) => <article key={label}><div className={`metric-symbol symbol-${i}`}>{["□", "◎", "▤", "◈", "♙", "⚠"][i]}</div><span>{label}</span><strong>{value}</strong><small>{i >= 4 && value > 0 ? "Needs attention" : "Today"}</small></article>)}</div>
    <section className="portal-panel live-list" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>Today — {fmtDate(d.today)}</h2><p>Running trainings with staffing and seats</p></div><span className="slot-count">{d.todays.length}</span></div>
      {d.todays.map((b) => { const s = d.staffing.get(b.id); const left = b.capacity - b.confirmed_count; return <div className="live-row-item" key={b.id}><div><strong>{courseOf(b)}{dayN(b)}</strong><small>{fmtTime(b.daily_start)} – {fmtTime(b.daily_end)} · {s?.room_name ?? b.venue ?? b.mode} · Instructor: {s?.instructor_name ?? "not assigned"}</small></div><span className="slot-count" style={{ color: left <= 0 ? "#a52020" : undefined }}>{b.confirmed_count} / {b.capacity}{left > 0 ? ` → ${left} slot${left === 1 ? "" : "s"}` : " — FULL"}</span></div>; })}
      {!d.todays.length && <p className="portal-empty-copy">No trainings running today.</p>}
    </section>
    <div className="dashboard-panels">
      <section className="portal-panel live-list">
        <div className="panel-heading"><div><h2>Upcoming trainings</h2><p>Next 14 days</p></div><span className="slot-count">{d.upcoming.length}</span></div>
        {d.upcoming.slice(0, 10).map((b) => { const s = d.staffing.get(b.id); return <div className="live-row-item" key={b.id}><div><strong>{courseOf(b)}</strong><small>{fmtDate(b.starts_on)}{b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""} · {s?.room_name ?? b.venue ?? b.mode} · {s?.instructor_name ?? "no instructor"}</small></div><span className="slot-count">{b.confirmed_count}/{b.capacity}</span></div>; })}
        {!d.upcoming.length && <p className="portal-empty-copy">Nothing scheduled in the next two weeks.</p>}
      </section>
      <section className="portal-panel live-list">
        <div className="panel-heading"><div><h2>Needs attention</h2><p>Conflicts, gaps and capacity</p></div><span className="slot-count">{attention.length}</span></div>
        {attention.slice(0, 12).map((a, i) => <div className="live-row-item" key={i}><div><strong>{a.label}</strong><small>{a.text}</small></div><span className={`portal-badge ${a.tone === "red" ? "cancelled" : "pending"}`}>{a.tone === "red" ? "Fix" : "Watch"}</span></div>)}
        {!attention.length && <p className="portal-empty-copy">All clear — no conflicts or gaps found.</p>}
      </section>
    </div>
  </div>;
}

export function TrainingCalendar({ data }: { data: SchedulingData }) {
  const today = manilaToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<"Month" | "Week">("Month");
  const [weekStart, setWeekStart] = useState(addDays(today, -((new Date(`${today}T00:00:00+08:00`).getDay() + 6) % 7)));
  const live = data.batches.filter((b) => b.status !== "Cancelled");
  const onDay = (day: string) => live.filter((b) => b.starts_on <= day && day <= b.ends_on);
  const shift = (n: number) => { if (view === "Week") { setWeekStart(addDays(weekStart, n * 7)); return; } const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const days: string[] = [];
  if (view === "Week") { for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i)); }
  else { const [y, m] = month.split("-").map(Number); const count = new Date(y, m, 0).getDate(); for (let i = 1; i <= count; i++) days.push(`${month}-${String(i).padStart(2, "0")}`); }
  const lead = view === "Month" ? (new Date(`${days[0]}T00:00:00+08:00`).getDay() + 6) % 7 : 0;
  const inView = new Map<string, string>();
  for (const day of days) for (const b of onDay(day)) { const c = first(b.courses); if (c) inView.set(c.code, c.name); }
  const label = view === "Week" ? `${fmtDate(days[0])} – ${fmtDate(days[6])}` : new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00+08:00`));
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Training operations</span><h1>Training calendar</h1><p>Color-coded by course. Cancelled schedules are excluded.</p></div></div>
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "0 0 12px" }}>
      <button type="button" className="portal-secondary" onClick={() => shift(-1)}>←</button>
      <strong style={{ fontSize: 17 }}>{label}</strong>
      <button type="button" className="portal-secondary" onClick={() => shift(1)}>→</button>
      <div className="portal-tabs" style={{ margin: 0 }}>{(["Month", "Week"] as const).map((v) => <button key={v} type="button" className={view === v ? "active" : ""} onClick={() => setView(v)}>{v}</button>)}</div>
    </div>
    <div className="portal-panel" style={{ padding: 12 }}>
      <div className="cal-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="cal-dow">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`lead${i}`} className="cal-cell empty" />)}
        {days.map((day) => { const items = onDay(day); return <div key={day} className={`cal-cell${day === today ? " today" : ""}`}><span className="cal-daynum">{Number(day.slice(8, 10))}</span>{items.slice(0, 3).map((b) => { const c = first(b.courses); const full = b.confirmed_count >= b.capacity; return <span key={b.id} className="cal-chip" style={{ background: colorFor(c?.code ?? "") }} title={`${c?.name ?? ""} ${b.confirmed_count}/${b.capacity}`}>{c?.code ?? "?"}{full ? " · FULL" : ""}</span>; })}{items.length > 3 && <span className="cal-more">+{items.length - 3}</span>}</div>; })}
      </div>
      {inView.size > 0 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>{[...inView.entries()].map(([code, name]) => <span key={code} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: colorFor(code), display: "inline-block" }} />{code} · {name}</span>)}</div>}
    </div>
  </div>;
}

export function TraineeScheduling({ data, reload }: { data: SchedulingData; reload: () => Promise<void> }) {
  const today = manilaToday();
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [choice, setChoice] = useState<Record<string, string>>({});
  const waiting = data.enrollments.filter((e) => !e.batch_id && !e.partner_offer_id && e.enrollment_status !== "Cancelled");
  const options = (courseId: string) => data.batches.filter((b) => b.course_id === courseId && b.status === "Open" && b.starts_on > today && b.confirmed_count < b.capacity).sort((a, z) => a.starts_on.localeCompare(z.starts_on));
  async function assign(enrollmentId: string) {
    const batchId = choice[enrollmentId]; if (!batchId) { setMsg("Pick a schedule first."); return; }
    setBusy(enrollmentId); setMsg("");
    try { await submit({ action: "enrollment-reschedule", enrollmentId, batchId }); await reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Could not assign the schedule."); }
    finally { setBusy(""); }
  }
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Training operations</span><h1>Trainee scheduling</h1><p>Enrollments waiting to be assigned to a batch.</p></div></div>
    {msg && <div className="portal-message error" role="alert">{msg}</div>}
    <section className="portal-panel live-list">
      <div className="panel-heading"><div><h2>Waiting for a schedule</h2><p>Open-schedule enrollments (endorsed trainings excluded)</p></div><span className="slot-count">{waiting.length}</span></div>
      {waiting.map((e) => { const t = first(e.trainees); const c = first(e.courses); const opts = options(e.course_id); return <div className="live-row-item" key={e.id}><div><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : e.enrollment_number}</strong><small>{c ? `${c.code} · ${c.name}` : ""} · {e.enrollment_number}</small></div><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><select value={choice[e.id] ?? ""} onChange={(ev) => setChoice((m) => ({ ...m, [e.id]: ev.target.value }))} style={{ maxWidth: 260 }}><option value="">{opts.length ? "Pick a schedule…" : "No open schedule for this course"}</option>{opts.map((b) => <option key={b.id} value={b.id}>{fmtDate(b.starts_on)}{b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""} · {b.capacity - b.confirmed_count} slots</option>)}</select><button type="button" className="portal-primary" disabled={busy === e.id || !choice[e.id]} onClick={() => assign(e.id)}>{busy === e.id ? "Assigning…" : "Assign"}</button></span></div>; })}
      {!waiting.length && <p className="portal-empty-copy">Every enrollment has a schedule.</p>}
    </section>
  </div>;
}

export function InstructorAssignment({ data, onEdit }: { data: SchedulingData; onEdit: (batchId: string) => void }) {
  const today = manilaToday();
  const staffing = staffingMap(data);
  const rows = data.batches.filter((b) => b.status !== "Cancelled" && b.ends_on >= today).sort((a, z) => a.starts_on.localeCompare(z.starts_on));
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Training operations</span><h1>Instructor assignment</h1><p>Who teaches each upcoming batch, and where. Edit a batch to assign or change.</p></div></div>
    <div className="portal-table portal-panel"><table><thead><tr><th>Schedule</th><th>Course</th><th>Instructor</th><th>Room / venue</th><th>Seats</th><th>Actions</th></tr></thead><tbody>
      {rows.map((b) => { const s = staffing.get(b.id); return <tr key={b.id}><td><strong>{fmtDate(b.starts_on)}</strong><small>{b.batch_number}</small></td><td>{courseOf(b)}</td><td>{s?.instructor_name ?? <span className="portal-badge cancelled">Not assigned</span>}</td><td>{s?.room_name ?? b.venue ?? b.mode}</td><td>{b.confirmed_count}/{b.capacity}</td><td className="document-actions"><button type="button" onClick={() => onEdit(b.id)}>Assign / edit</button></td></tr>; })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">No upcoming batches.</p>}</div>
  </div>;
}

export function ScheduleChanges({ data }: { data: SchedulingData }) {
  const today = manilaToday();
  const recent = addDays(today, -14);
  const added = data.batches.filter((b) => b.published_at && b.published_at.slice(0, 10) >= recent && b.status !== "Cancelled").sort((a, z) => (z.published_at ?? "").localeCompare(a.published_at ?? ""));
  const cancelled = data.batches.filter((b) => b.status === "Cancelled");
  const CHANGE_TYPES = ["Rescheduling", "Change Course", "Cancellation", "Make-up Class"];
  const requests = data.requests.filter((r) => CHANGE_TYPES.includes(r.request_type)).sort((a, z) => z.created_at.localeCompare(a.created_at));
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Training operations</span><h1>Schedule changes</h1><p>Newly added, cancelled, and change requests from the last 14 days.</p></div></div>
    <div className="dashboard-panels">
      <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Newly added</h2><p>Published in the last 14 days</p></div><span className="slot-count">{added.length}</span></div>{added.slice(0, 12).map((b) => <div className="live-row-item" key={b.id}><div><strong>{courseOf(b)}</strong><small>{fmtDate(b.starts_on)}{b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""} · {b.batch_number}</small></div><span className="portal-badge active">Added</span></div>)}{!added.length && <p className="portal-empty-copy">No new schedules published recently.</p>}</section>
      <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Cancelled schedules</h2><p>Batches marked cancelled</p></div><span className="slot-count">{cancelled.length}</span></div>{cancelled.slice(0, 12).map((b) => <div className="live-row-item" key={b.id}><div><strong>{courseOf(b)}</strong><small>{fmtDate(b.starts_on)} · {b.batch_number}</small></div><span className="portal-badge cancelled">Cancelled</span></div>)}{!cancelled.length && <p className="portal-empty-copy">No cancelled schedules.</p>}</section>
    </div>
    <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Change requests</h2><p>Rescheduling, course changes, cancellations and make-up classes</p></div><span className="slot-count">{requests.length}</span></div>{requests.slice(0, 15).map((r) => { const t = first(r.trainees); return <div className="live-row-item" key={r.id}><div><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : r.request_number}</strong><small>{r.request_type} · {r.reason}</small></div><span className={`portal-badge ${r.status === "Approved" ? "active" : r.status === "Rejected" ? "cancelled" : "pending"}`}>{r.status}</span></div>; })}{!requests.length && <p className="portal-empty-copy">No change requests on record.</p>}</section>
  </div>;
}
