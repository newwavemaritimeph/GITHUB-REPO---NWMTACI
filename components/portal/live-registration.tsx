"use client";

import { useMemo, useState } from "react";
import type { PortalData, Enrollment, Trainee, Batch } from "../portal-live-app";
import { first, manilaToday, dueCentavos, balanceOf, pesos, addDays } from "@/lib/portal-format";
import { Badge, Message, Modal, PageHead, Pager, Kpi, usePost, fullName, fmtDate, fmtClock } from "./shared-ui";
import { RequestActionModal, type RequestType } from "./payment-actions";
import { VALIDATION_MESSAGES, isEmail, isPhContactNumber, isSrn, normalizeEmail, normalizePhContactNumber, normalizeSrn } from "@/lib/validation";

/**
 * Registration Officer workspace (rebuilt Oct 2026 to MASTERPLAN §10 as
 * amended by the July 2026 addendum). Six modules: Dashboard, Registration
 * (intake), Trainees, Enrollments (with the request-a-change drawer), Courses &
 * centers, Instructions. The role reads payment status but never writes a
 * payment; the only server actions reachable from here are create-enrollment,
 * send-instructions and request-raise (plus the instruction-template actions on
 * the Instructions screen, which lives in the parent).
 */

type RequestRow = PortalData["requests"][number];

const fmtLong = (v: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");
const nameOf = (e: Enrollment) => { const t = first(e.trainees); return t ? fullName(t) : e.enrollment_number; };
const initials = (s: string) => s.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const STATUSES = ["Pending", "Open Schedule", "Enrolled", "Cancelled"] as const;
/** Request types a Registration Officer may raise (addendum: rescheduling, change of course, cancellation). */
const REG_REQUESTS: RequestType[] = ["Rescheduling", "Change Course", "Cancellation"];

const scheduleOf = (e: Enrollment) => { const b = first(e.batches); return b ? `${fmtDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""}` : e.scheduled_on ? fmtDate(e.scheduled_on) : "Open schedule"; };
const payState = (e: Enrollment) => { const paid = Number(e.paid_centavos), due = dueCentavos(e); if (e.enrollment_status === "Cancelled") return { text: "Cancelled", tone: "cancelled" }; if (due > 0 && paid >= due) return { text: "Paid", tone: "green" }; if (paid > 0) return { text: "Partially paid", tone: "orange" }; return { text: "Unpaid", tone: "red" }; };
const statusTone = (s: string) => (s === "Enrolled" ? "active" : s === "Cancelled" ? "cancelled" : "pending");
const requestsFor = (data: PortalData, e: Enrollment) => data.requests.filter((r) => first(r.enrollments)?.enrollment_number === e.enrollment_number);

/** Record completeness from fields that actually exist on a trainee. */
const MISSING_CHECKS: [string, (t: { srn?: string | null; email?: string; mobile?: string }) => boolean][] = [["SRN", (t) => !t.srn], ["Email", (t) => !t.email], ["Mobile", (t) => !t.mobile]];
const missingFor = (t: { srn?: string | null; email?: string; mobile?: string } | null | undefined) => (t ? MISSING_CHECKS.filter(([, f]) => f(t)).map(([l]) => l) : []);

/* ------------------------------------------------------------------ Dashboard */

export function RegistrationDashboard({ data, go, openEnrollment }: { data: PortalData; go: (module: string) => void; openEnrollment: () => void }) {
  const today = manilaToday();
  const weekAgo = addDays(today, -7);
  const [courseId, setCourseId] = useState(""), [sched, setSched] = useState(""), [status, setStatus] = useState("All status"), [q, setQ] = useState("");
  const [quick, setQuick] = useState(false);

  const live = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled");
  const batchOf = (e: Enrollment) => first(e.batches);
  const runsOn = (e: Enrollment, d: string) => { const b = batchOf(e); const s = b?.starts_on ?? e.scheduled_on; const t = b?.ends_on ?? e.scheduled_on; return !!s && !!t && s <= d && d <= t; };
  const todays = live.filter((e) => runsOn(e, today));
  const newToday = data.enrollments.filter((e) => day(e.created_at) === today);
  const byStatus = (s: string) => data.enrollments.filter((e) => e.enrollment_status === s);
  const upcomingTrainees = live.filter((e) => { const s = batchOf(e)?.starts_on ?? e.scheduled_on; return !!s && s > today; });
  const recentlyEnrolled = data.enrollments.filter((e) => e.enrollment_status === "Enrolled" && day(e.created_at) >= weekAgo);
  const pendingRequests = data.requests.filter((r) => r.status === "Pending" && REG_REQUESTS.includes(r.request_type as RequestType));
  // Slip generation is not tracked server-side; this estimates it from enrollments
  // recently created that have not yet been placed on a batch.
  const slipsPending = data.enrollments.filter((e) => ["Pending", "Open Schedule"].includes(e.enrollment_status) && day(e.created_at) >= weekAgo);
  const unverifiedTrainees = new Set(data.payments.filter((p) => p.verification_state !== "Verified").map((p) => p.trainee_id));
  const openBatches = data.batches.filter((b) => b.status !== "Cancelled" && b.starts_on >= today);
  const publicToday = newToday.filter((e) => e.source === "Public registration");

  const kpis: { icon: string; label: string; value: number; hint?: string; to: string }[] = [
    { icon: "✎", label: "New registrations today", value: newToday.length, to: "Enrollments" },
    { icon: "◷", label: "Pending enrollments", value: byStatus("Pending").length, to: "Enrollments" },
    { icon: "□", label: "Open schedule", value: byStatus("Open Schedule").length, to: "Enrollments" },
    { icon: "▦", label: "Upcoming trainees", value: upcomingTrainees.length, to: "Enrollments" },
    { icon: "◎", label: "Recently enrolled", value: recentlyEnrolled.length, hint: "Last 7 days →", to: "Enrollments" },
    { icon: "⊘", label: "Cancelled", value: byStatus("Cancelled").length, to: "Enrollments" },
    { icon: "↺", label: "Pending requests", value: pendingRequests.length, to: "Enrollments" },
    { icon: "▤", label: "Slips not yet generated", value: slipsPending.length, hint: "Estimate →", to: "Enrollments" },
  ];

  const reqBadge = (e: Enrollment) => { const m = missingFor(first(e.trainees)); return m.length ? { text: `Missing ${m[0]}`, cls: "cancelled" } : { text: "Complete", cls: "active" }; };
  const regBadge = (e: Enrollment) => { if (e.enrollment_status === "Cancelled") return { text: "Cancelled", cls: "cancelled" }; if (e.trainee_id && unverifiedTrainees.has(e.trainee_id)) return { text: "For review", cls: "pending" }; if (e.enrollment_status === "Enrolled") return { text: "Confirmed", cls: "active" }; return { text: e.enrollment_status, cls: "pending" }; };
  const rows = todays
    .filter((e) => !courseId || e.course_id === courseId)
    .filter((e) => !sched || (batchOf(e)?.batch_number ?? "") === sched)
    .filter((e) => status === "All status" || regBadge(e).text === status)
    .filter((e) => !q.trim() || nameOf(e).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const incomplete = data.trainees.filter((t) => missingFor(t).length > 0);
  const missingBreakdown = MISSING_CHECKS.map(([label, f]) => [label, data.trainees.filter((t) => f(t)).length] as [string, number]).filter(([, n]) => n > 0);
  const actions: [string, number, string][] = ([
    ["Incomplete records", incomplete.length, "trainees"],
    ["Schedule change requests", pendingRequests.filter((r) => r.request_type === "Rescheduling").length, "awaiting Accounting"],
    ["Course change requests", pendingRequests.filter((r) => r.request_type === "Change Course").length, "awaiting Accounting"],
    ["Cancellation requests", pendingRequests.filter((r) => r.request_type === "Cancellation").length, "awaiting Accounting"],
    ["Open schedule — no batch yet", byStatus("Open Schedule").length, "enrollments"],
  ] as [string, number, string][]).filter(([, n]) => n > 0);

  const upcoming = openBatches.filter((b) => b.starts_on <= addDays(today, 14)).sort((a, b) => a.starts_on.localeCompare(b.starts_on)).slice(0, 6);
  const capTone = (b: Batch) => { const left = b.capacity - b.confirmed_count; return left <= 0 ? { t: "Full", c: "cancelled" } : left <= 3 ? { t: "Nearly full", c: "pending" } : { t: "Open", c: "active" }; };
  const pipeline: [string, string, number, string][] = [
    ["Pending", "Created, not yet on a schedule", byStatus("Pending").length, "#0571d0"],
    ["Open schedule", "Waiting for a batch", byStatus("Open Schedule").length, "#f2a615"],
    ["Enrolled", "Placed on a batch", byStatus("Enrolled").length, "#0a7d3b"],
    ["Cancelled", "Approved cancellations", byStatus("Cancelled").length, "#8a3208"],
  ];
  const recent = [...data.enrollments].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
  const notices = data.announcements.filter((a) => !a.expires_at || a.expires_at > new Date().toISOString());
  const schedOptions = [...new Set(todays.map((e) => batchOf(e)?.batch_number).filter(Boolean))] as string[];

  return <div className="portal-page">
    <div className="portal-heading">
      <div><h1 style={{ margin: 0 }}>Registration dashboard</h1><p>{fmtLong(today)} · <span style={{ color: "#0a7d3b" }}>● Live operations</span></p></div>
      <span style={{ display: "inline-flex", gap: 10, position: "relative" }}>
        <button type="button" className="portal-secondary" onClick={() => go("Trainees")}>Search trainee</button>
        <button type="button" className="portal-secondary" onClick={() => setQuick((v) => !v)}>⚡ Quick actions ▾</button>
        {quick && <div className="quick-menu">{[["Register a trainee", "Registration"], ["Open enrollments", "Enrollments"], ["Courses & centers", "Courses & centers"], ["Send instructions", "Instructions"]].map(([label, mod]) => <button type="button" key={label} onClick={() => { setQuick(false); go(mod); }}>{label}</button>)}</div>}
        <button type="button" className="portal-primary" onClick={openEnrollment}>+ New enrollment</button>
      </span>
    </div>

    <div className="reg-kpis">{kpis.map((k) => <Kpi key={k.label} icon={k.icon} label={k.label} value={k.value} hint={k.hint} onClick={() => go(k.to)} />)}</div>

    {publicToday.length > 0 && <section className="portal-panel live-list" style={{ marginBottom: 16 }}>
      <div className="panel-heading"><div><h2>Public registrations today</h2><p>Submitted through the website — review the record and place on a schedule</p></div><span className="slot-count">{publicToday.length}</span></div>
      {publicToday.slice(0, 5).map((e) => <div className="live-row-item" key={e.id}><div><strong>{nameOf(e)}</strong><small>{first(e.courses)?.name ?? "—"} · {fmtClock(e.created_at)}</small></div><Badge tone={statusTone(e.enrollment_status)}>{e.enrollment_status}</Badge></div>)}
    </section>}

    <div className="reg-main">
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Today&apos;s trainees</h2><p>{rows.length} of {todays.length} scheduled today</p></div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "0 0 10px" }}>
          <label className="portal-field-inline">Course<select value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">All courses</option>{[...new Map(todays.map((e) => [e.course_id, first(e.courses)?.name ?? "Course"])).entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label className="portal-field-inline">Schedule<select value={sched} onChange={(e) => setSched(e.target.value)}><option value="">All schedules</option>{schedOptions.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="portal-field-inline">Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option>All status</option><option>Confirmed</option><option>For review</option><option>Pending</option></select></label>
          <label className="portal-field-inline" style={{ flex: 1, minWidth: 180 }}>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee" /></label>
        </div>
        <div className="portal-table"><table><thead><tr><th>Trainee</th><th>Course</th><th>Schedule</th><th>Modality</th><th>Record</th><th>Payment</th><th>Registration</th></tr></thead><tbody>
          {rows.slice(0, 10).map((e) => { const b = batchOf(e); const r = reqBadge(e), p = payState(e), g = regBadge(e); const nm = nameOf(e); return <tr key={e.id} className="row-clickable" onClick={() => go("Enrollments")}>
            <td><span className="avatar">{initials(nm)}</span><strong style={{ marginLeft: 8 }}>{nm}</strong></td>
            <td>{first(e.courses)?.code ?? first(e.courses)?.name ?? "—"}</td>
            <td>{scheduleOf(e)}</td>
            <td>{b?.mode ?? "—"}</td>
            <td><span className={`portal-badge ${r.cls}`}>{r.text}</span></td>
            <td><Badge tone={p.tone}>{p.text}</Badge></td>
            <td><span className={`portal-badge ${g.cls}`}>{g.text}</span></td>
          </tr>; })}
        </tbody></table>{!rows.length && <p className="portal-empty-copy">No trainees scheduled today.</p>}</div>
        <div className="pager"><span>Showing {Math.min(10, rows.length)} of {rows.length}</span><button type="button" className="ghost-button" onClick={() => go("Enrollments")}>Open enrollments →</button></div>
      </section>

      <section className="portal-panel live-list">
        <div className="panel-heading"><div><h2>⚠ Action required</h2><p>Items needing registration attention</p></div></div>
        {actions.map(([label, n, sub]) => <button type="button" className="needs-row" key={label} onClick={() => go(label.startsWith("Incomplete") ? "Trainees" : "Enrollments")}><span><b>{label}</b><small style={{ display: "block", color: "var(--muted)" }}>{n} {sub}</small></span><span className="portal-badge pending">{n}</span></button>)}
        {!actions.length && <p className="portal-empty-copy">Nothing needs action right now.</p>}
        {missingBreakdown.length > 0 && <div style={{ padding: "8px 4px 0" }}><small style={{ color: "var(--muted)", fontWeight: 700 }}>Incomplete breakdown</small>{missingBreakdown.map(([label, n]) => <div className="live-row-item" key={label}><div><strong>{label}</strong></div><span className="slot-count">{n} missing</span></div>)}</div>}
      </section>
    </div>

    <div className="reg-main">
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Upcoming schedules &amp; capacity</h2><p>Next 14 days</p></div><button type="button" className="ghost-button" onClick={() => go("Registration")}>Place a trainee →</button></div>
        <div className="portal-table"><table><thead><tr><th>Date</th><th>Course</th><th>Batch</th><th>Enrolled</th><th>Capacity</th><th>Available</th><th>Status</th></tr></thead><tbody>
          {upcoming.map((b) => { const s = capTone(b); return <tr key={b.id}><td>{fmtDate(b.starts_on)}{b.ends_on !== b.starts_on ? `–${b.ends_on.slice(8, 10)}` : ""}</td><td>{first(b.courses)?.name ?? "—"}</td><td>{b.batch_number}</td><td>{b.confirmed_count}</td><td>{b.capacity}</td><td>{Math.max(0, b.capacity - b.confirmed_count)}</td><td><span className={`portal-badge ${s.c}`}>{s.t}</span></td></tr>; })}
        </tbody></table>{!upcoming.length && <p className="portal-empty-copy">No schedules in the next two weeks.</p>}</div>
      </section>
      <section className="portal-panel live-list">
        <div className="panel-heading"><div><h2>Enrollment pipeline</h2><p>By enrollment status</p></div></div>
        {pipeline.map(([label, sub, n, c]) => <button type="button" className="needs-row" key={label} onClick={() => go("Enrollments")}><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><i style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block" }} /><span><b>{label}</b><small style={{ display: "block", color: "var(--muted)" }}>{sub}</small></span></span><span className="portal-badge">{n}</span></button>)}
      </section>
    </div>

    <div className="reg-main">
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Recent enrollments</h2><p>Latest registrations</p></div><button type="button" className="ghost-button" onClick={() => go("Enrollments")}>View all →</button></div>
        <div className="portal-table"><table><thead><tr><th>Time</th><th>Trainee</th><th>Course</th><th>Schedule</th><th>Source</th></tr></thead><tbody>
          {recent.map((e) => <tr key={e.id}><td>{fmtClock(e.created_at)}</td><td><strong>{nameOf(e)}</strong></td><td>{first(e.courses)?.code ?? "—"}</td><td>{scheduleOf(e)}</td><td>{e.source ?? "—"}</td></tr>)}
        </tbody></table>{!recent.length && <p className="portal-empty-copy">No enrollments yet.</p>}</div>
      </section>
      <section className="portal-panel live-list">
        <div className="panel-heading"><div><h2>Record completeness</h2><p>Trainee records missing SRN, email or mobile</p></div></div>
        <div className="pill-row"><div className="ok"><span>Complete</span><b>{data.trainees.length - incomplete.length}</b></div><div className="bad"><span>Incomplete</span><b>{incomplete.length}</b></div></div>
        {missingBreakdown.map(([label, n]) => <div className="live-row-item" key={label}><div><strong>{label}</strong></div><span className="slot-count">{n} missing</span></div>)}
        {!missingBreakdown.length && <p className="portal-empty-copy">Every trainee record is complete.</p>}
        <button type="button" className="ghost-button" style={{ marginTop: 6 }} onClick={() => go("Trainees")}>Review trainee records →</button>
      </section>
    </div>

    <section className="portal-panel live-list" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>📣 Staff announcement</h2></div><span className="slot-count">{notices.length}</span></div>
      {notices.slice(0, 2).map((a) => <div className="live-row-item" key={a.id}><div><strong>{a.title}</strong><small>{a.body}</small></div><span className="portal-badge">{a.published_at ? fmtClock(a.published_at) : "Draft"}</span></div>)}
      {!notices.length && <p className="portal-empty-copy">No active announcements.</p>}
    </section>
  </div>;
}

/* ------------------------------------------------------------- Registration */

type IntakeForm = { firstName: string; middleName: string; lastName: string; suffix: string; srn: string; email: string; presentAddress: string; mobile: string; placeOfBirth: string; birthDate: string; rank: string; company: string; emergencyContactName: string; emergencyContactMobile: string };
const EMPTY_FORM: IntakeForm = { firstName: "", middleName: "", lastName: "", suffix: "", srn: "", email: "", presentAddress: "", mobile: "", placeOfBirth: "", birthDate: "", rank: "", company: "", emergencyContactName: "", emergencyContactMobile: "" };

/** Validation mirrors app/api/public/registrations/route.ts so staff intake and public intake agree. */
function validateIntake(f: IntakeForm): Partial<Record<keyof IntakeForm, string>> {
  const err: Partial<Record<keyof IntakeForm, string>> = {};
  if (f.firstName.trim().length < 2) err.firstName = "First name is required.";
  if (f.lastName.trim().length < 2) err.lastName = "Last name is required.";
  if (!isSrn(f.srn)) err.srn = VALIDATION_MESSAGES.srn;
  if (!isEmail(f.email)) err.email = VALIDATION_MESSAGES.email;
  if (f.presentAddress.trim().length < 8) err.presentAddress = "Enter the present address.";
  if (!isPhContactNumber(f.mobile)) err.mobile = VALIDATION_MESSAGES.contact;
  if (f.placeOfBirth.trim().length < 2) err.placeOfBirth = "Place of birth is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate)) err.birthDate = "Enter the date of birth.";
  if (f.rank.trim().length < 2) err.rank = "Rank is required.";
  if (f.emergencyContactName.trim().length < 2) err.emergencyContactName = "Emergency contact person is required.";
  if (!isPhContactNumber(f.emergencyContactMobile)) err.emergencyContactMobile = VALIDATION_MESSAGES.contact;
  return err;
}

/** Batches a staff member may place a trainee on (MASTERPLAN §8: never Full, Cancelled, Ongoing, today, past, or past the deadline). */
function eligibleBatches(data: PortalData, courseId: string) {
  const today = manilaToday(), now = new Date().toISOString();
  return data.batches.filter((b) => b.course_id === courseId && !b.partner_offer_id && b.status === "Open" && b.starts_on > today && b.enrollment_deadline > now && b.confirmed_count < b.capacity)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

export function RegistrationIntake({ data, reload, go }: { data: PortalData; reload: () => Promise<void>; go: (module: string) => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [lookup, setLookup] = useState("");
  const [existing, setExisting] = useState<Trainee | null>(null);
  const [form, setForm] = useState<IntakeForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof IntakeForm, string>>>({});
  const [courseId, setCourseId] = useState(""), [offerId, setOfferId] = useState(""), [batchId, setBatchId] = useState(""), [scheduledOn, setScheduledOn] = useState("");
  const [created, setCreated] = useState<{ id: string; enrollment_number: string; enrollment_status: string } | null>(null);
  const { busy, msg, setMsg, post } = usePost(reload);

  const srnMatch = useMemo(() => { const n = normalizeSrn(lookup); return n ? data.trainees.find((t) => normalizeSrn(t.srn ?? "") === n) ?? null : null; }, [lookup, data.trainees]);
  const nameMatches = useMemo(() => { const q = lookup.trim().toLowerCase(); if (q.length < 3 || srnMatch) return []; return data.trainees.filter((t) => `${fullName(t)} ${t.email} ${t.mobile}`.toLowerCase().includes(q)).slice(0, 6); }, [lookup, data.trainees, srnMatch]);
  // Shared email/mobile is a warning only — never merged automatically (addendum §duplicates).
  const contactWarning = useMemo(() => { if (existing) return null; const em = normalizeEmail(form.email), mb = normalizePhContactNumber(form.mobile); const hit = data.trainees.find((t) => (em && normalizeEmail(t.email) === em) || (mb && normalizePhContactNumber(t.mobile) === mb)); return hit ? `${fullName(hit)} (${hit.trainee_number}) already uses this ${em && normalizeEmail(hit.email) === em ? "email" : "mobile number"}. Check before creating a second record.` : null; }, [form.email, form.mobile, data.trainees, existing]);

  const inHouse = data.courses.filter((c) => c.delivery_type === "In-House").sort((a, b) => a.name.localeCompare(b.name));
  const isStcw = (c: PortalData["courses"][number]) => (first(c.course_categories)?.name ?? "").toLowerCase().includes("stcw");
  const course = data.courses.find((c) => c.id === courseId) ?? null;
  const endorsed = course?.delivery_type !== "In-House" && !!course;
  const offers = data.offers.filter((o) => o.course_id === courseId);
  const offer = offers.find((o) => o.id === offerId) ?? null;
  const batches = courseId ? eligibleBatches(data, courseId) : [];
  const batch = batches.find((b) => b.id === batchId) ?? null;
  const fee = endorsed ? (offer?.training_fee_centavos ?? 0) : (course?.standard_price_centavos ?? 0);

  function set<K extends keyof IntakeForm>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined })); }
  function toStep2() { if (existing) { setStep(2); return; } const err = validateIntake(form); setErrors(err); if (Object.keys(err).length) { setMsg({ kind: "error", text: "Complete the highlighted fields." }); return; } setMsg(null); setStep(2); }
  function toStep3() { if (!courseId) { setMsg({ kind: "error", text: "Choose a course." }); return; } if (endorsed && !offerId) { setMsg({ kind: "error", text: "Choose the endorsed program." }); return; } setMsg(null); setStep(3); }
  function toStep4() { if (endorsed && !scheduledOn) { setMsg({ kind: "error", text: "Enter the training date for the endorsed program." }); return; } setMsg(null); setStep(4); }
  async function create() {
    try {
      const body: Record<string, unknown> = { action: "create-enrollment", existingTraineeId: existing?.id ?? null, courseId, partnerOfferId: endorsed ? offerId : null, batchId: endorsed ? null : (batchId || null), scheduledOn: endorsed ? scheduledOn : null };
      if (!existing) Object.assign(body, { firstName: form.firstName.trim(), middleName: form.middleName.trim(), lastName: form.lastName.trim(), suffix: form.suffix.trim(), srn: normalizeSrn(form.srn), email: normalizeEmail(form.email), mobile: normalizePhContactNumber(form.mobile), birthDate: form.birthDate, presentAddress: form.presentAddress.trim(), placeOfBirth: form.placeOfBirth.trim(), rank: form.rank.trim(), company: form.company.trim(), emergencyContactName: form.emergencyContactName.trim(), emergencyContactMobile: normalizePhContactNumber(form.emergencyContactMobile) });
      const result = await post(body);
      const e = result.enrollment as { id: string; enrollment_number: string; enrollment_status: string } | undefined;
      if (e) setCreated(e);
    } catch { /* message already shown */ }
  }
  function reset() { setStep(1); setLookup(""); setExisting(null); setForm(EMPTY_FORM); setErrors({}); setCourseId(""); setOfferId(""); setBatchId(""); setScheduledOn(""); setCreated(null); setMsg(null); }

  const field = (k: keyof IntakeForm, label: string, extra?: { type?: string; full?: boolean; placeholder?: string; lc?: boolean }) => <label className={extra?.full ? "full" : undefined}>{label}<input className={extra?.lc ? "lc" : undefined} type={extra?.type ?? "text"} value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={extra?.placeholder} />{errors[k] && <span className="field-error">{errors[k]}</span>}</label>;

  if (created) {
    const row = data.enrollments.find((e) => e.id === created.id);
    return <div className="portal-page">
      <PageHead eyebrow="Registration" title="Enrollment created" text="The trainee record and enrollment are saved. Generate the admission slip and send the training instructions." />
      {msg && <Message kind={msg.kind} text={msg.text} />}
      <section className="portal-panel">
        <div className="rate-preview" style={{ marginBottom: 14 }}><span>Enrollment</span><strong>{created.enrollment_number}</strong><small>{row ? nameOf(row) : "Trainee"} · {course?.name ?? "Course"} · <Badge tone={statusTone(created.enrollment_status)}>{created.enrollment_status}</Badge></small></div>
        <div className="document-actions" style={{ gap: 10, flexWrap: "wrap" }}>
          <a className="portal-primary" href={`/api/documents/admission-invoice/${created.id}`} target="_blank" rel="noreferrer">Generate admission slip</a>
          <button type="button" className="portal-secondary" disabled={busy || !!row?.instructions_sent_at} onClick={() => void post({ action: "send-instructions", enrollmentId: created.id }, "Training instructions sent.").catch(() => undefined)}>{row?.instructions_sent_at ? "Instructions sent" : "Send training instructions"}</button>
          <a className="portal-secondary" href={`/api/documents/training-instructions/${created.id}`} target="_blank" rel="noreferrer">Instructions PDF</a>
          <button type="button" className="ghost-button" onClick={() => go("Enrollments")}>Open in enrollments →</button>
          <button type="button" className="ghost-button" onClick={reset}>Register another</button>
        </div>
      </section>
    </div>;
  }

  return <div className="portal-page">
    <PageHead eyebrow="Registration" title="Register a trainee" text="Find or create the trainee record, choose the course, place them on an available schedule or save as Open Schedule, then generate the admission slip." />
    <div className="portal-tabs">{[["1", "Trainee"], ["2", "Course"], ["3", "Schedule"], ["4", "Review"]].map(([n, l]) => <button key={n} type="button" className={step === Number(n) ? "active" : ""} disabled={Number(n) > step} onClick={() => setStep(Number(n) as 1 | 2 | 3 | 4)}>{n}. {l}</button>)}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}

    {step === 1 && <section className="portal-panel">
      <div className="panel-heading"><div><h2>Trainee</h2><p>Search by SRN first — an exact SRN match is the same person. Shared email or mobile is flagged, never merged.</p></div></div>
      <div className="portal-form" style={{ padding: "0 0 8px" }}>
        <label className="full">SRN, name, email or mobile<input value={lookup} onChange={(e) => { setLookup(e.target.value); setExisting(null); }} placeholder="e.g. 1234567890 or Dela Cruz" /></label>
        {srnMatch && <div className="rate-preview full"><span>Existing record — SRN match</span><strong>{fullName(srnMatch)} · {srnMatch.trainee_number}</strong><small className="lc">{srnMatch.email} · {srnMatch.mobile}</small><div style={{ marginTop: 8 }}><button type="button" className="portal-primary" onClick={() => { setExisting(srnMatch); setMsg(null); }}>Use this record</button></div></div>}
        {nameMatches.length > 0 && <div className="full"><small style={{ color: "var(--muted)", fontWeight: 700 }}>Possible matches</small>{nameMatches.map((t) => <div className="live-row-item" key={t.id}><div><strong>{fullName(t)}</strong><small className="lc">{t.trainee_number} · SRN {t.srn ?? "—"} · {t.email}</small></div><button type="button" className="ghost-button" onClick={() => setExisting(t)}>Use</button></div>)}</div>}
        {existing && <div className="split-payment-note full"><strong>Enrolling an existing trainee</strong><span>{fullName(existing)} · {existing.trainee_number}. <button type="button" className="ghost-button" onClick={() => setExisting(null)}>Create a new record instead</button></span></div>}
      </div>
      {!existing && <div className="portal-form">
        <div className="full"><strong>New trainee</strong> <small style={{ color: "var(--muted)" }}>Same fields as the public enrollment form.</small></div>
        {field("firstName", "First name")}{field("middleName", "Middle name")}{field("lastName", "Last name")}{field("suffix", "Suffix", { placeholder: "Jr., III" })}
        {field("srn", "SRN (10 digits)", { placeholder: "1234567890" })}{field("email", "Email", { type: "email", lc: true })}
        {field("presentAddress", "Present address", { full: true })}
        {field("mobile", "Contact number", { placeholder: "09XX XXX XXXX" })}{field("placeOfBirth", "Place of birth")}{field("birthDate", "Date of birth", { type: "date" })}
        {field("rank", "Rank")}{field("company", "Company / manning agency")}
        {field("emergencyContactName", "Emergency contact person")}{field("emergencyContactMobile", "Emergency contact number")}
        {contactWarning && <div className="schedule-rule full"><strong>Possible duplicate</strong><span>{contactWarning}</span></div>}
      </div>}
      <div className="portal-form-actions"><button type="button" className="portal-primary" onClick={toStep2}>Continue to course →</button></div>
    </section>}

    {step === 2 && <section className="portal-panel">
      <div className="panel-heading"><div><h2>Course</h2><p>New Wave courses, or an endorsed program at a partner center</p></div></div>
      <div className="portal-form">
        <label className="full">Course<select value={courseId} onChange={(e) => { setCourseId(e.target.value); setOfferId(""); setBatchId(""); setScheduledOn(""); }}>
          <option value="">Select a course</option>
          <optgroup label="STCW courses">{inHouse.filter(isStcw).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</optgroup>
          <optgroup label="In-House courses">{inHouse.filter((c) => !isStcw(c)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</optgroup>
          <optgroup label="Endorsed programs (partner centers)">{data.courses.filter((c) => c.delivery_type !== "In-House").sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</optgroup>
        </select></label>
        {endorsed && <label className="full">Partner center &amp; rate<select value={offerId} onChange={(e) => setOfferId(e.target.value)}><option value="">Select</option>{offers.map((o) => <option key={o.id} value={o.id}>{first(o.partner_centers)?.name} · {o.duration_label} · {pesos(o.training_fee_centavos)}</option>)}</select></label>}
        {course && <div className="rate-preview full"><span>Training fee</span><strong>{pesos(fee)}</strong><small>{course.duration_label}{endorsed ? " · endorsed program" : " · New Wave"} · snapshotted on the enrollment</small></div>}
      </div>
      <div className="portal-form-actions"><button type="button" className="portal-secondary" onClick={() => setStep(1)}>← Back</button><button type="button" className="portal-primary" onClick={toStep3}>Continue to schedule →</button></div>
    </section>}

    {step === 3 && <section className="portal-panel">
      <div className="panel-heading"><div><h2>Schedule</h2><p>{endorsed ? "Endorsed programs carry a training date agreed with the partner center." : "Only open batches with free seats that start after today and are still within their enrollment deadline are offered."}</p></div></div>
      {endorsed ? <div className="portal-form"><label>Training date<input type="date" value={scheduledOn} min={addDays(manilaToday(), 1)} onChange={(e) => setScheduledOn(e.target.value)} /></label></div>
        : <>
          <div className="portal-table"><table><thead><tr><th></th><th>Batch</th><th>Dates</th><th>Modality</th><th>Available</th><th>Deadline</th></tr></thead><tbody>
            {batches.map((b) => <tr key={b.id} className="row-clickable" onClick={() => setBatchId(b.id)}><td><input type="radio" name="batch" checked={batchId === b.id} onChange={() => setBatchId(b.id)} /></td><td><strong>{b.batch_number}</strong></td><td>{fmtDate(b.starts_on)}{b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""}</td><td>{b.mode}{b.venue ? ` · ${b.venue}` : ""}</td><td>{b.capacity - b.confirmed_count} of {b.capacity}</td><td>{fmtDate(b.enrollment_deadline.slice(0, 10))}</td></tr>)}
          </tbody></table>{!batches.length && <p className="portal-empty-copy">No open batch for this course right now — save as Open Schedule and place the trainee when one opens.</p>}</div>
          <label className="portal-check" style={{ marginTop: 10 }}><input type="checkbox" checked={!batchId} onChange={(e) => { if (e.target.checked) setBatchId(""); }} /><span>Save as <strong>Open Schedule</strong> (no batch yet)</span></label>
        </>}
      <div className="portal-form-actions"><button type="button" className="portal-secondary" onClick={() => setStep(2)}>← Back</button><button type="button" className="portal-primary" onClick={toStep4}>Review →</button></div>
    </section>}

    {step === 4 && <section className="portal-panel">
      <div className="panel-heading"><div><h2>Review &amp; create</h2><p>Check the details, then create the enrollment</p></div></div>
      <div className="kv-grid">
        <div><span>Trainee</span><strong>{existing ? `${fullName(existing)} · ${existing.trainee_number}` : fullName({ legal_first_name: form.firstName, legal_middle_name: form.middleName, legal_last_name: form.lastName, suffix: form.suffix })}</strong></div>
        <div><span>SRN</span><strong>{existing ? existing.srn ?? "—" : normalizeSrn(form.srn)}</strong></div>
        <div><span>Course</span><strong>{course ? `${course.code} · ${course.name}` : "—"}</strong></div>
        <div><span>{endorsed ? "Partner center" : "Schedule"}</span><strong>{endorsed ? `${first(offer?.partner_centers)?.name ?? "—"} · ${scheduledOn ? fmtDate(scheduledOn) : "—"}` : batch ? `${batch.batch_number} · ${fmtDate(batch.starts_on)}` : "Open Schedule"}</strong></div>
        <div><span>Fee</span><strong>{pesos(fee)}</strong></div>
        <div><span>Status after creation</span><strong>{endorsed || !batch ? "Open Schedule" : "Enrolled"}</strong></div>
      </div>
      <div className="portal-form-actions"><button type="button" className="portal-secondary" onClick={() => setStep(3)}>← Back</button><button type="button" className="portal-primary" disabled={busy} onClick={() => void create()}>{busy ? "Creating…" : "Create enrollment"}</button></div>
    </section>}
  </div>;
}

/* -------------------------------------------------------------- Enrollments */

export function RegistrationEnrollments({ data, query, reload, go }: { data: PortalData; query: string; reload: () => Promise<void>; go: (module: string) => void }) {
  const [status, setStatus] = useState<string>("All");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Enrollment | null>(null);
  const term = (q || query).trim().toLowerCase();
  const rows = data.enrollments
    .filter((e) => status === "All" || e.enrollment_status === status)
    .filter((e) => !term || `${nameOf(e)} ${e.enrollment_number} ${first(e.courses)?.name ?? ""} ${first(e.trainees)?.trainee_number ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const PER = 12;
  const pageRows = rows.slice((page - 1) * PER, page * PER);
  const current = open ? data.enrollments.find((e) => e.id === open.id) ?? open : null;
  return <div className="portal-page">
    <PageHead eyebrow="Registration" title="Enrollments" text="Every enrollment with its schedule, record status and payment status. Open one to generate documents, send instructions or request a change." action="+ Register a trainee" onAction={() => go("Registration")} />
    <div className="portal-tabs">{["All", ...STATUSES].map((s) => <button key={s} type="button" className={status === s ? "active" : ""} onClick={() => { setStatus(s); setPage(1); }}>{s}{s !== "All" && <small style={{ marginLeft: 6, opacity: 0.7 }}>{data.enrollments.filter((e) => e.enrollment_status === s).length}</small>}</button>)}</div>
    <div style={{ display: "flex", gap: 10, padding: "0 0 10px" }}><label className="portal-field-inline" style={{ flex: 1, minWidth: 220 }}>Search<input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Trainee, enrollment number, course" /></label></div>
    <div className="portal-table portal-panel"><table><thead><tr><th>Trainee</th><th>Enrollment</th><th>Course</th><th>Schedule</th><th>Status</th><th>Payment</th><th>Balance</th></tr></thead><tbody>
      {pageRows.map((e) => { const t = first(e.trainees), c = first(e.courses), p = payState(e); return <tr key={e.id} className="row-clickable" onClick={() => setOpen(e)}>
        <td><strong>{t ? fullName(t) : "Unknown"}</strong><small>{t?.trainee_number}</small></td>
        <td><strong>{e.enrollment_number}</strong><small>{fmtDate(day(e.created_at))}</small></td>
        <td>{c?.name ?? "—"}<small>{first(first(e.partner_course_offers)?.partner_centers)?.name ?? "New Wave"}</small></td>
        <td>{scheduleOf(e)}</td>
        <td><Badge tone={statusTone(e.enrollment_status)}>{e.enrollment_status}</Badge></td>
        <td><Badge tone={p.tone}>{p.text}</Badge></td>
        <td><strong>{pesos(balanceOf(e))}</strong></td>
      </tr>; })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">No matching enrollments.</p>}</div>
    <Pager page={page} total={rows.length} perPage={PER} onPage={setPage} />
    {current && <EnrollmentDrawer data={data} enrollment={current} reload={reload} onClose={() => setOpen(null)} />}
  </div>;
}

/** Everything about one enrollment, read-only on money. Requests go to Accounting. */
function EnrollmentDrawer({ data, enrollment: e, reload, onClose }: { data: PortalData; enrollment: Enrollment; reload: () => Promise<void>; onClose: () => void }) {
  const { busy, msg, post } = usePost(reload);
  const [req, setReq] = useState<RequestType | null>(null);
  const t = first(e.trainees), c = first(e.courses), b = first(e.batches);
  const center = first(first(e.partner_course_offers)?.partner_centers)?.name;
  const paid = Number(e.paid_centavos), due = dueCentavos(e), balance = balanceOf(e), charges = Number(e.charges_centavos ?? 0), discounts = Number(e.discounts_centavos ?? 0);
  const payments = data.payments.filter((p) => p.trainee_id === e.trainee_id).sort((a, z) => z.received_at.localeCompare(a.received_at));
  const history = requestsFor(data, e).sort((a, z) => z.created_at.localeCompare(a.created_at));
  const pendingTypes = new Set(history.filter((r) => r.status === "Pending").map((r) => r.request_type));
  const canRequest = e.enrollment_status !== "Cancelled";
  const p = payState(e);
  return <Modal title={e.enrollment_number} onClose={onClose} wide>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      <div className="kv-grid full">
        <div><span>Trainee</span><strong>{t ? fullName(t) : "—"}</strong><small>{t?.trainee_number} · <span className="lc">{t?.email}</span> · {t?.mobile}</small></div>
        <div><span>Course</span><strong>{c?.name ?? "—"}</strong><small>{c?.code}{center ? ` · endorsed: ${center}` : " · New Wave"}</small></div>
        <div><span>Schedule</span><strong>{scheduleOf(e)}</strong><small>{b ? `${b.batch_number}${b.mode ? ` · ${b.mode}` : ""}${b.venue ? ` · ${b.venue}` : ""}` : e.scheduled_on ? "Endorsed training date" : "Not yet placed on a batch"}</small></div>
        <div><span>Status</span><strong><Badge tone={statusTone(e.enrollment_status)}>{e.enrollment_status}</Badge></strong><small>Created {fmtDate(day(e.created_at))}{e.source ? ` · ${e.source}` : ""}</small></div>
      </div>

      <div className="full"><strong>Payment status</strong> <small style={{ color: "var(--muted)" }}>read-only — payments are recorded by the Cashier</small></div>
      <div className="pill-row full">
        <div><span>Fee</span><b>{pesos(e.selling_price_centavos)}</b></div>
        {charges > 0 && <div className="warn"><span>Charges</span><b>+{pesos(charges)}</b></div>}
        {discounts > 0 && <div className="ok"><span>Discounts</span><b>−{pesos(discounts)}</b></div>}
        <div><span>Total due</span><b>{pesos(due)}</b></div>
        <div className={balance === 0 ? "ok" : paid > 0 ? "warn" : "bad"}><span>{p.text}</span><b>{pesos(paid)} paid · {pesos(balance)} balance</b></div>
      </div>
      {payments.length > 0 && <div className="full"><small style={{ color: "var(--muted)", fontWeight: 700 }}>Trainee&apos;s payments</small>{payments.slice(0, 6).map((pm) => <div className="live-row-item" key={pm.id}><div><strong>{pm.payment_number}</strong><small>{pm.method}{pm.reference_number ? ` · ${pm.reference_number}` : ""} · {fmtDate(day(pm.received_at))}</small></div><span className="slot-count">{pesos(pm.amount_centavos)}</span></div>)}<p className="portal-form-note">Payments are recorded per trainee; which enrollment each one covers is on the receipt.</p></div>}

      <div className="full"><strong>Documents &amp; instructions</strong></div>
      <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
        <a href={`/api/documents/admission-invoice/${e.id}`} target="_blank" rel="noreferrer">Admission slip</a>
        <a href={`/api/documents/training-instructions/${e.id}`} target="_blank" rel="noreferrer">Instructions PDF</a>
        <button type="button" disabled={busy || e.enrollment_status === "Cancelled"} onClick={() => void post({ action: "send-instructions", enrollmentId: e.id }, e.instructions_sent_at ? "Instructions re-sent." : "Instructions sent.").catch(() => undefined)}>{e.instructions_sent_at ? `Resend instructions (sent ${fmtDate(day(e.instructions_sent_at))})` : "Send instructions"}</button>
      </div>

      <div className="full"><strong>Request a change</strong> <small style={{ color: "var(--muted)" }}>decided by the Accounting Manager</small></div>
      <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
        {REG_REQUESTS.map((type) => <button key={type} type="button" disabled={!canRequest || pendingTypes.has(type)} title={pendingTypes.has(type) ? "A request of this type is already pending" : undefined} onClick={() => setReq(type)}>{type === "Rescheduling" ? "Change schedule" : type === "Change Course" ? "Change course" : "Cancel enrollment"}</button>)}
      </div>
      {history.length > 0 && <div className="full"><small style={{ color: "var(--muted)", fontWeight: 700 }}>Request history</small>{history.map((r: RequestRow) => <div className="live-row-item" key={r.id}><div><strong>{r.request_number} · {r.request_type}</strong><small>{r.reason} · filed {fmtDate(day(r.created_at))}{r.decided_at ? ` · decided ${fmtDate(day(r.decided_at))}` : ""}{r.decision_remarks ? ` · ${r.decision_remarks}` : ""}</small></div><Badge tone={r.status === "Approved" ? "active" : r.status === "Rejected" ? "cancelled" : "pending"}>{r.status}</Badge></div>)}</div>}

      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Close</button></div>
    </div>
    {req && <RequestActionModal data={data} enrollment={e} reqType={req} onClose={() => setReq(null)} post={(body) => post(body, "Request sent to the Accounting Manager.")} />}
  </Modal>;
}

/* ------------------------------------------------------- Courses & centers */

/** Read-only catalog for Registration: fees and durations only — no rebate or partner payable. */
export function CoursesAndCenters({ data, query }: { data: PortalData; query: string }) {
  const q = query.trim().toLowerCase();
  const inHouse = data.courses.filter((c) => c.delivery_type === "In-House" && (!q || `${c.code} ${c.name}`.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const isStcw = (c: PortalData["courses"][number]) => (first(c.course_categories)?.name ?? "").toLowerCase().includes("stcw");
  const centers = [...new Set(data.offers.map((o) => first(o.partner_centers)?.name).filter(Boolean))] as string[];
  const [center, setCenter] = useState(centers[0] ?? "");
  const offers = data.offers.map((o) => ({ offer: o, course: data.courses.find((c) => c.id === o.course_id) })).filter(({ offer, course }) => (first(offer.partner_centers)?.name ?? "") === center && (!q || `${course?.code ?? ""} ${course?.name ?? ""}`.toLowerCase().includes(q)));
  const table = (list: typeof inHouse) => <div className="portal-table"><table><thead><tr><th>Code</th><th>Course</th><th>Duration</th><th>Fee</th></tr></thead><tbody>{list.map((c) => <tr key={c.id}><td><strong>{c.code}</strong></td><td>{c.name}</td><td>{c.duration_label}</td><td>{pesos(c.standard_price_centavos)}</td></tr>)}</tbody></table>{!list.length && <p className="portal-empty-copy">No courses.</p>}</div>;
  return <div className="portal-page">
    <PageHead eyebrow="Registration" title="Courses & centers" text="New Wave's own courses and the endorsed programs offered through partner centers, with the fees quoted to trainees." />
    <section className="portal-panel" style={{ marginBottom: 16 }}><div className="panel-heading"><div><h2>STCW courses</h2><p>MARINA-approved, delivered by New Wave</p></div></div>{table(inHouse.filter(isStcw))}</section>
    <section className="portal-panel" style={{ marginBottom: 16 }}><div className="panel-heading"><div><h2>In-House courses</h2><p>Delivered by New Wave</p></div></div>{table(inHouse.filter((c) => !isStcw(c)))}</section>
    <section className="portal-panel">
      <div className="panel-heading"><div><h2>Endorsed programs</h2><p>Offered through partner centers</p></div><label className="portal-field-inline">Partner center<select value={center} onChange={(e) => setCenter(e.target.value)}>{centers.map((c) => <option key={c}>{c}</option>)}{!centers.length && <option value="">None yet</option>}</select></label></div>
      <div className="portal-table"><table><thead><tr><th>Code</th><th>Course</th><th>Duration</th><th>Training fee</th></tr></thead><tbody>{offers.map(({ offer, course }) => <tr key={offer.id}><td><strong>{course?.code}</strong></td><td>{course?.name}</td><td>{offer.duration_label}</td><td>{pesos(offer.training_fee_centavos)}</td></tr>)}</tbody></table>{!offers.length && <p className="portal-empty-copy">No programs for this center.</p>}</div>
    </section>
  </div>;
}
