"use client";

import { useState, type ReactNode } from "react";
import type { PortalData, Enrollment, Batch } from "../portal-live-app";
import { first, manilaToday, dueCentavos, balanceOf, pesos, addDays } from "@/lib/portal-format";
import { Badge, Message, Modal, PageHead, Pager, Kpi, usePost, fullName, fmtDate, fmtClock } from "./shared-ui";
import { RequestActionModal, type RequestType } from "./payment-actions";

/**
 * Registration Officer workspace (rebuilt Oct 2026 to MASTERPLAN §10 as
 * amended by the July 2026 addendum and the owner's 7 Oct 2026 instruction).
 * Four sidebar modules: Dashboard, Courses, Instructions, and Trainees &
 * enrollments. New registrations come only from the website as Pending
 * applications; Registration screens them (three requirements, a verified
 * payment) and enrolls them. The role reads payment status but never writes a
 * payment; the only server actions reachable from here are requirement-check,
 * application-enroll, send-instructions and request-raise (plus the
 * instruction-template actions on the Instructions screen, in the parent).
 */

type RequestRow = PortalData["requests"][number];

const fmtLong = (v: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");
const nameOf = (e: Enrollment) => { const t = first(e.trainees); return t ? fullName(t) : e.enrollment_number; };
/** Request types a Registration Officer may raise (addendum: rescheduling, change of course, cancellation). */
const REG_REQUESTS: RequestType[] = ["Rescheduling", "Change Course", "Cancellation"];

const scheduleOf = (e: Enrollment) => { const b = first(e.batches); return b ? `${fmtDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""}` : e.scheduled_on ? fmtDate(e.scheduled_on) : "Open schedule"; };
const payState = (e: Enrollment) => { const paid = Number(e.paid_centavos), due = dueCentavos(e); if (e.enrollment_status === "Cancelled") return { text: "Cancelled", tone: "cancelled" }; if (due > 0 && paid >= due) return { text: "Paid", tone: "green" }; if (paid > 0) return { text: "Partially paid", tone: "orange" }; return { text: "Unpaid", tone: "red" }; };
const statusTone = (s: string) => (s === "Enrolled" ? "active" : s === "Cancelled" ? "cancelled" : "pending");
const requestsFor = (data: PortalData, e: Enrollment) => data.requests.filter((r) => first(r.enrollments)?.enrollment_number === e.enrollment_number);

/** Record completeness from fields that actually exist on a trainee. */
const MISSING_CHECKS: [string, (t: { srn?: string | null; email?: string; mobile?: string }) => boolean][] = [["SRN", (t) => !t.srn], ["Email", (t) => !t.email], ["Mobile", (t) => !t.mobile]];
const missingFor = (t: { srn?: string | null; email?: string; mobile?: string } | null | undefined) => (t ? MISSING_CHECKS.filter(([, f]) => f(t)).map(([l]) => l) : []);

/** STCW courses are the In-House courses filed under an STCW category. */
const isStcwCourse = (c?: PortalData["courses"][number] | null) => (first(c?.course_categories)?.name ?? "").toLowerCase().includes("stcw");
/** A New Wave batch a trainee can still be placed on: open, not started, before its deadline, with seats left. */
const isBookable = (b: Batch, today: string, now: string) => !b.partner_offer_id && b.status === "Open" && b.starts_on > today && b.enrollment_deadline > now && b.confirmed_count < b.capacity;

/* ------------------------------------------------------------------ Dashboard */

const fmtDay = (v: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const fmtShort = (v: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const dateRange = (s: string, e: string) => (s === e ? fmtShort(s) : s.slice(0, 7) === e.slice(0, 7) ? `${fmtShort(s)}–${Number(e.slice(8, 10))}` : `${fmtShort(s)} – ${fmtShort(e)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const seatsLeft = (b: Batch) => Math.max(0, b.capacity - b.confirmed_count);
function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
  return [...m.entries()];
}

/**
 * Four things, nothing else: who applied, who trains soon, where STCW seats are
 * still open, and who is in class today. Each tile jumps to its panel.
 * Applications come only from the website; trainings count enrolled trainees.
 */
export function RegistrationDashboard({ data, go }: { data: PortalData; go: (module: string) => void }) {
  const [allStcw, setAllStcw] = useState(false);
  const today = manilaToday(), now = new Date().toISOString();
  const weekStart = addDays(today, -6), horizon = addDays(today, 14);
  const courseById = new Map(data.courses.map((c) => [c.id, c]));
  const traineeById = new Map(data.trainees.map((t) => [t.id, t]));
  const batchById = new Map(data.batches.map((b) => [b.id, b]));
  const live = data.enrollments.filter((e) => e.enrollment_status === "Enrolled");
  const checks = data.requirementChecks ?? [];
  const startOf = (e: Enrollment) => first(e.batches)?.starts_on ?? e.scheduled_on ?? null;
  const endOf = (e: Enrollment) => first(e.batches)?.ends_on ?? e.scheduled_on ?? null;
  const courseLabel = (e: Enrollment) => first(e.courses)?.name ?? courseById.get(e.course_id)?.name ?? "Course";

  // New applications — last 7 days, newest first.
  const recent = data.enrollments.filter((e) => day(e.created_at) >= weekStart).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const newToday = recent.filter((e) => day(e.created_at) === today);
  const awaiting = applicationsOf(data).length;
  const stateFor = (e: Enrollment) => (e.enrollment_status === "Pending" ? stateOf(applicationReadiness(e, checks)) : { text: e.enrollment_status, tone: statusTone(e.enrollment_status) });

  // Upcoming trainings — trainees starting in the next 14 days, by start date.
  const upcoming = live.filter((e) => { const s = startOf(e); return !!s && s > today && s <= horizon; });
  const upcomingDays = groupBy([...upcoming].sort((a, b) => (startOf(a) ?? "").localeCompare(startOf(b) ?? "")), (e) => startOf(e) ?? "")
    .map(([date, rows]) => [date, groupBy(rows, (e) => e.batch_id ?? `${e.course_id}|${date}`)] as const);

  // STCW available slots — the next bookable batch per New Wave STCW course.
  const stcw = groupBy(data.batches.filter((b) => isBookable(b, today, now) && isStcwCourse(courseById.get(b.course_id))).sort((a, b) => a.starts_on.localeCompare(b.starts_on)), (b) => b.course_id);
  const stcwSeats = stcw.reduce((sum, [, list]) => sum + list.reduce((s, b) => s + seatsLeft(b), 0), 0);

  // Today's trainees — in class today, grouped by batch.
  const todays = live.filter((e) => { const s = startOf(e), t = endOf(e); return !!s && !!t && s <= today && today <= t; });
  const todayClasses = groupBy([...todays].sort((a, b) => nameOf(a).localeCompare(nameOf(b))), (e) => e.batch_id ?? `${e.course_id}|today`);

  const tiles = [
    { id: "rd-new", icon: "✎", label: "New applications", value: newToday.length, hint: `today · ${awaiting} awaiting screening` },
    { id: "rd-upcoming", icon: "◷", label: "Upcoming trainings", value: upcoming.length, hint: `${upcoming.length === 1 ? "trainee" : "trainees"} · next 14 days` },
    { id: "rd-stcw", icon: "⚓", label: "STCW slots open", value: stcwSeats, hint: `${plural(stcw.length, "course")} taking registrations` },
    { id: "rd-today", icon: "▦", label: "Today's trainees", value: todays.length, hint: `${plural(todayClasses.length, "class", "classes")} today` },
  ];
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const stcwShown = allStcw ? stcw : stcw.slice(0, 6);

  return <div className="portal-page">
    <div className="portal-heading">
      <div><h1 style={{ margin: 0 }}>Registration dashboard</h1><p>{fmtLong(today)}</p></div>
      <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="portal-secondary" onClick={() => go("Trainees")}>Search trainee</button>
        <button type="button" className="portal-primary" onClick={() => go("Applications")}>Screen applications{awaiting ? ` (${awaiting})` : ""}</button>
      </span>
    </div>

    <div className="reg-kpis rd-4">{tiles.map((t) => <Kpi key={t.id} icon={t.icon} label={t.label} value={t.value} hint={t.hint} onClick={() => jump(t.id)} />)}</div>

    <div className="rd-grid">
      <section className="portal-panel rd-panel" id="rd-new">
        <div className="panel-heading"><div><h2>New applications</h2><p>Submitted on the website · last 7 days</p></div><button type="button" className="ghost-button" onClick={() => go("Applications")}>Screen →</button></div>
        {recent.slice(0, 8).map((e) => { const c = first(e.courses), st = stateFor(e); return <button type="button" className="rd-row" key={e.id} onClick={() => go(e.enrollment_status === "Pending" ? "Applications" : "Enrollments")}>
          <span className="rd-main"><strong>{nameOf(e)}</strong><small>{c?.code ? `${c.code} · ` : ""}{courseLabel(e)}</small></span>
          <Badge tone={st.tone}>{st.text}</Badge>
          <span className="rd-time">{day(e.created_at) === today ? fmtClock(e.created_at) : fmtShort(day(e.created_at))}</span>
        </button>; })}
        {!recent.length && <p className="rd-empty">No applications in the last 7 days.</p>}
      </section>

      <section className="portal-panel rd-panel" id="rd-upcoming">
        <div className="panel-heading"><div><h2>Upcoming trainings</h2><p>Enrolled trainees · next 14 days</p></div></div>
        {upcomingDays.map(([date, classes]) => <div key={date}>
          <div className="rd-group"><b>{fmtDay(date)}</b></div>
          {classes.map(([key, rows]) => { const b = rows[0].batch_id ? batchById.get(rows[0].batch_id) : undefined; return <div className="rd-row" key={key}>
            <span className="rd-main"><strong>{first(rows[0].batches)?.batch_number ?? "Scheduled date"}</strong><small>{courseLabel(rows[0])}</small></span>
            {b && <span className="rd-time">{plural(seatsLeft(b), "seat")} left</span>}
            <span className="rd-tag">{plural(rows.length, "trainee")}</span>
          </div>; })}
        </div>)}
        {!upcoming.length && <p className="rd-empty">No trainings in the next 14 days.</p>}
      </section>

      <section className="portal-panel rd-panel" id="rd-stcw">
        <div className="panel-heading"><div><h2>STCW available slots</h2><p>Next batch open on the website, per course</p></div><button type="button" className="ghost-button" onClick={() => go("Courses")}>All courses →</button></div>
        {stcwShown.map(([courseId, list]) => { const c = courseById.get(courseId), b = list[0], left = seatsLeft(b); return <div className="rd-slot" key={courseId}>
          <span className="rd-main"><strong>{c?.code ?? "STCW"}</strong><small>{c?.name ?? ""}</small></span>
          <span className="rd-seat">
            <span>{dateRange(b.starts_on, b.ends_on)} · {b.batch_number}</span>
            <span className="rd-meter" aria-hidden="true"><i className={left <= 3 ? "low" : ""} style={{ width: `${Math.min(100, Math.round((b.confirmed_count / Math.max(1, b.capacity)) * 100))}%` }} /></span>
            <small>{left} of {b.capacity} seats left · closes {fmtShort(day(b.enrollment_deadline))}{list.length > 1 ? ` · +${plural(list.length - 1, "later batch", "later batches")}` : ""}</small>
          </span>
        </div>; })}
        {stcw.length > 6 && <button type="button" className="ghost-button rd-more" onClick={() => setAllStcw((v) => !v)}>{allStcw ? "Show fewer" : `Show all ${stcw.length} courses`}</button>}
        {!stcw.length && <p className="rd-empty">No STCW batches are open for registration.</p>}
      </section>

      <section className="portal-panel rd-panel" id="rd-today">
        <div className="panel-heading"><div><h2>Today&apos;s trainees</h2><p>{fmtDay(today)}</p></div></div>
        {todayClasses.map(([key, rows]) => { const b = first(rows[0].batches); return <div key={key}>
          <div className="rd-group"><b>{b?.batch_number ?? "Scheduled today"}</b><span>{[courseLabel(rows[0]), b?.venue, b?.mode].filter(Boolean).join(" · ")}</span><em>{rows.length}</em></div>
          {rows.map((e) => { const missing = missingFor(traineeById.get(e.trainee_id)); return <button type="button" className="rd-row" key={e.id} onClick={() => go("Enrollments")}>
            <span className="rd-main"><strong>{nameOf(e)}</strong></span>
            <span className={`rd-dot${missing.length ? " warn" : ""}`}>{missing.length ? `Missing ${missing.join(", ")}` : "Record complete"}</span>
          </button>; })}
        </div>; })}
        {!todays.length && <p className="rd-empty">No classes today.</p>}
      </section>
    </div>
  </div>;
}

/* ---------------------------------------------------------------- Screening */

/** The three requirements screened before a website application is enrolled. */
export const REQUIREMENTS = [
  { code: "valid_id", label: "Valid ID / passport" },
  { code: "seamans_book", label: "Seaman's book / SRN" },
  { code: "medical_certificate", label: "Medical certificate" },
] as const;
type RequirementCheck = NonNullable<PortalData["requirementChecks"]>[number];

/**
 * Where a Pending application stands: requirements verified, a verified payment,
 * a schedule. Only a hint for the screen — the database re-checks every rule
 * when the applicant is enrolled.
 */
export function applicationReadiness(e: Enrollment, checks: RequirementCheck[]) {
  const latest = new Map(checks.filter((c) => c.enrollment_id === e.id).map((c) => [c.requirement, c]));
  const missing = REQUIREMENTS.filter((r) => latest.get(r.code)?.status !== "Verified").map((r) => r.label);
  const rejected = REQUIREMENTS.filter((r) => latest.get(r.code)?.status === "Rejected").map((r) => r.label);
  const paidCentavos = Number(e.verified_paid_centavos ?? 0);
  const paid = paidCentavos > 0;
  const ready = !missing.length && paid && !!e.batch_id;
  const reason = !e.batch_id ? "No schedule chosen yet" : missing.length ? `Not verified yet: ${missing.join(", ")}` : !paid ? "No verified payment yet" : "Ready to enroll";
  return { latest, verified: REQUIREMENTS.length - missing.length, missing, rejected, paid, paidCentavos, ready, reason };
}
const stateOf = (r: ReturnType<typeof applicationReadiness>) => (r.ready ? { text: "Ready to enroll", tone: "active" } : r.rejected.length ? { text: "Needs attention", tone: "cancelled" } : { text: "Screening", tone: "pending" });
const applicationsOf = (data: PortalData) => data.enrollments.filter((e) => e.enrollment_status === "Pending");

const APP_FILTERS = ["All", "Ready", "Missing requirements", "Awaiting payment"] as const;

/** Website applications waiting to be screened, soonest training first. */
function ApplicationQueue({ data, query, reload }: { data: PortalData; query: string; reload: () => Promise<void> }) {
  const [filter, setFilter] = useState<(typeof APP_FILTERS)[number]>("All");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Enrollment | null>(null);
  const checks = data.requirementChecks ?? [];
  const term = (q || query).trim().toLowerCase();
  const all = applicationsOf(data).map((e) => ({ e, r: applicationReadiness(e, checks) }));
  const matches = (x: (typeof all)[number]) => filter === "All" || (filter === "Ready" ? x.r.ready : filter === "Missing requirements" ? x.r.missing.length > 0 : !x.r.paid);
  const rows = all
    .filter(matches)
    .filter(({ e }) => !term || `${nameOf(e)} ${e.enrollment_number} ${first(e.courses)?.name ?? ""} ${first(e.trainees)?.trainee_number ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => (first(a.e.batches)?.starts_on ?? "9999").localeCompare(first(b.e.batches)?.starts_on ?? "9999") || a.e.created_at.localeCompare(b.e.created_at));
  const PER = 12;
  const pageRows = rows.slice((page - 1) * PER, page * PER);
  const current = open ? data.enrollments.find((e) => e.id === open.id) ?? open : null;
  const count = (f: (typeof APP_FILTERS)[number]) => (f === "All" ? all.length : all.filter((x) => (f === "Ready" ? x.r.ready : f === "Missing requirements" ? x.r.missing.length > 0 : !x.r.paid)).length);
  return <>
    <div className="portal-tabs">{APP_FILTERS.map((f) => <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => { setFilter(f); setPage(1); }}>{f}<small style={{ marginLeft: 6, opacity: 0.7 }}>{count(f)}</small></button>)}</div>
    <div style={{ display: "flex", gap: 10, padding: "0 0 10px" }}><label className="portal-field-inline" style={{ flex: 1, minWidth: 220 }}>Search<input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Applicant, application number, course" /></label></div>
    <div className="portal-table portal-panel"><table><thead><tr><th>Applicant</th><th>Course &amp; schedule</th><th>Submitted</th><th>Requirements</th><th>Payment</th><th>State</th></tr></thead><tbody>
      {pageRows.map(({ e, r }) => { const t = first(e.trainees), s = stateOf(r); return <tr key={e.id} className="row-clickable" onClick={() => setOpen(e)}>
        <td><strong>{t ? fullName(t) : "Unknown"}</strong><small>{e.enrollment_number}</small></td>
        <td>{first(e.courses)?.name ?? "—"}<small>{scheduleOf(e)}</small></td>
        <td>{fmtDate(day(e.created_at))}<small>{e.source === "Public registration" ? "Website" : e.source ?? ""}</small></td>
        <td><span className={`req-count${r.missing.length ? "" : " ok"}`}>{r.verified} of {REQUIREMENTS.length}</span>{r.rejected.length > 0 && <small>Rejected: {r.rejected.join(", ")}</small>}</td>
        <td>{r.paid ? <><strong>{pesos(r.paidCentavos)}</strong><small>Verified</small></> : <span className="muted-text">Awaiting payment</span>}</td>
        <td><Badge tone={s.tone}>{s.text}</Badge></td>
      </tr>; })}
    </tbody></table>{!rows.length && <p className="portal-empty-copy">{all.length ? "No applications match." : "No applications waiting. New ones arrive from the website."}</p>}</div>
    <Pager page={page} total={rows.length} perPage={PER} onPage={setPage} />
    {current && <EnrollmentDrawer data={data} enrollment={current} reload={reload} onClose={() => setOpen(null)} />}
  </>;
}

/* -------------------------------------------------------------- Enrollments */

const ENROLLMENT_TABS = ["All", "Enrolled", "Open Schedule", "Cancelled"] as const;

/** Applications that have been decided: enrolled, open schedule, or cancelled. Pending lives in Applications. */
function EnrollmentList({ data, query, reload }: { data: PortalData; query: string; reload: () => Promise<void> }) {
  const [status, setStatus] = useState<string>("All");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Enrollment | null>(null);
  const term = (q || query).trim().toLowerCase();
  const decided = data.enrollments.filter((e) => e.enrollment_status !== "Pending");
  const rows = decided
    .filter((e) => status === "All" || e.enrollment_status === status)
    .filter((e) => !term || `${nameOf(e)} ${e.enrollment_number} ${first(e.courses)?.name ?? ""} ${first(e.trainees)?.trainee_number ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const PER = 12;
  const pageRows = rows.slice((page - 1) * PER, page * PER);
  const current = open ? data.enrollments.find((e) => e.id === open.id) ?? open : null;
  return <>
    <div className="portal-tabs">{ENROLLMENT_TABS.map((s) => <button key={s} type="button" className={status === s ? "active" : ""} onClick={() => { setStatus(s); setPage(1); }}>{s}<small style={{ marginLeft: 6, opacity: 0.7 }}>{s === "All" ? decided.length : decided.filter((e) => e.enrollment_status === s).length}</small></button>)}</div>
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
  </>;
}

/* ---------------------------------------------------- Trainees & enrollments */

export type RecordsView = "applications" | "enrollments" | "trainees";

/**
 * One sidebar tab for the people side of registration. Applications arrive only
 * from the website and are screened here; Enrollments holds the decided ones;
 * Trainees is the master record list, which lives in the parent with its
 * detail modal and so arrives as an element.
 */
export function RegistrationRecords({ data, query, reload, view, setView, trainees }: { data: PortalData; query: string; reload: () => Promise<void>; view: RecordsView; setView: (v: RecordsView) => void; trainees: ReactNode }) {
  const copy: Record<RecordsView, string> = {
    applications: "Applications submitted on the website. Verify the requirements; once the Cashier has a verified payment, enroll the applicant.",
    enrollments: "Enrolled, open-schedule and cancelled enrollments. Open one for documents, instructions or to request a change.",
    trainees: "Trainee master records. Open one to see their details and enrollment history.",
  };
  const tabs: [RecordsView, string, number][] = [["applications", "Applications", applicationsOf(data).length], ["enrollments", "Enrollments", data.enrollments.filter((e) => e.enrollment_status !== "Pending").length], ["trainees", "Trainees", data.trainees.length]];
  return <div className="portal-page">
    <div className="portal-heading"><div><span className="portal-eyebrow">Registration</span><h1>Trainees &amp; enrollments</h1><p>{copy[view]}</p></div></div>
    <div className="rr-switch" role="tablist" aria-label="Records">
      {tabs.map(([v, label, n]) => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{label}<small>{n}</small></button>)}
    </div>
    {view === "applications" && <ApplicationQueue data={data} query={query} reload={reload} />}
    {view === "enrollments" && <EnrollmentList data={data} query={query} reload={reload} />}
    {view === "trainees" && trainees}
  </div>;
}

/** Screening checklist for a Pending application, shown at the top of its drawer. */
function ScreeningPanel({ data, enrollment: e, busy, post }: { data: PortalData; enrollment: Enrollment; busy: boolean; post: (body: Record<string, unknown>, successText?: string) => Promise<Record<string, unknown>> }) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const r = applicationReadiness(e, data.requirementChecks ?? []);
  const s = stateOf(r);
  const check = (requirement: string, status: "Verified" | "Rejected", label: string) =>
    void post({ action: "requirement-check", enrollmentId: e.id, requirement, status, remarks: status === "Rejected" ? remarks.trim() : undefined }, `${label} ${status === "Verified" ? "verified" : "marked as rejected"}.`).then(() => { setRejecting(null); setRemarks(""); }).catch(() => undefined);
  return <div className="screen-box full">
    <div className="screen-head"><div><strong>Screening</strong><small>Check each document, then enroll once a verified payment is in.</small></div><Badge tone={s.tone}>{s.text}</Badge></div>
    <ul className="req-list">
      {REQUIREMENTS.map((req) => { const c = r.latest.get(req.code); return <li className="req-row" key={req.code}>
        <span className={`req-dot${c?.status === "Verified" ? " ok" : c?.status === "Rejected" ? " bad" : ""}`} aria-hidden="true" />
        <span className="req-main"><strong>{req.label}</strong><small>{c ? `${c.status} · ${c.checked_by_name ?? "Staff"} · ${fmtDate(day(c.checked_at))}${c.remarks ? ` · ${c.remarks}` : ""}` : "Not checked yet"}</small></span>
        <span className="req-actions">
          {c?.status !== "Verified" && <button type="button" className="portal-secondary" disabled={busy} onClick={() => check(req.code, "Verified", req.label)}>Verify</button>}
          <button type="button" className="ghost-button" disabled={busy} onClick={() => { setRejecting(rejecting === req.code ? null : req.code); setRemarks(""); }}>{c?.status === "Rejected" ? "Update reason" : "Reject"}</button>
        </span>
        {rejecting === req.code && <span className="req-reject">
          <input value={remarks} onChange={(ev) => setRemarks(ev.target.value)} placeholder="Reason, e.g. medical certificate expired" aria-label={`Reason for rejecting ${req.label}`} autoFocus />
          <button type="button" className="portal-primary" disabled={busy || !remarks.trim()} onClick={() => check(req.code, "Rejected", req.label)}>Save</button>
        </span>}
      </li>; })}
      <li className="req-row">
        <span className={`req-dot${r.paid ? " ok" : ""}`} aria-hidden="true" />
        <span className="req-main"><strong>Payment</strong><small>{r.paid ? `${pesos(r.paidCentavos)} verified` : "No verified payment yet — the Cashier records payments"}</small></span>
      </li>
    </ul>
    <div className="screen-foot"><small>{r.ready ? "Everything is in. Enrolling confirms the seat on this schedule." : r.reason}</small><button type="button" className="portal-primary" disabled={!r.ready || busy} onClick={() => void post({ action: "application-enroll", enrollmentId: e.id }, "Applicant enrolled.").catch(() => undefined)}>Enroll applicant</button></div>
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
  const isApplication = e.enrollment_status === "Pending";
  const hasDocuments = e.enrollment_status === "Enrolled" || e.enrollment_status === "Open Schedule";
  const p = payState(e);
  return <Modal title={isApplication ? `Application ${e.enrollment_number}` : e.enrollment_number} onClose={onClose} wide>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      {isApplication && <ScreeningPanel data={data} enrollment={e} busy={busy} post={post} />}
      <div className="kv-grid full">
        <div><span>{isApplication ? "Applicant" : "Trainee"}</span><strong>{t ? fullName(t) : "—"}</strong><small>{t?.trainee_number} · <span className="lc">{t?.email}</span> · {t?.mobile}</small></div>
        <div><span>Course</span><strong>{c?.name ?? "—"}</strong><small>{c?.code}{center ? ` · endorsed: ${center}` : " · New Wave"}</small></div>
        <div><span>Schedule</span><strong>{scheduleOf(e)}</strong><small>{b ? `${b.batch_number}${b.mode ? ` · ${b.mode}` : ""}${b.venue ? ` · ${b.venue}` : ""}` : e.scheduled_on ? "Endorsed training date" : "Not yet placed on a batch"}</small></div>
        <div><span>Status</span><strong><Badge tone={statusTone(e.enrollment_status)}>{e.enrollment_status}</Badge></strong><small>{isApplication ? "Submitted" : "Created"} {fmtDate(day(e.created_at))}{e.source ? ` · ${e.source}` : ""}</small></div>
      </div>

      <div className="full"><strong>Payment status</strong> <small style={{ color: "var(--muted)" }}>read-only — payments are recorded by the Cashier</small></div>
      <div className="pill-row full">
        <div><span>Fee</span><b>{pesos(e.selling_price_centavos)}</b></div>
        {charges > 0 && <div className="warn"><span>Charges</span><b>+{pesos(charges)}</b></div>}
        {discounts > 0 && <div className="ok"><span>Discounts</span><b>−{pesos(discounts)}</b></div>}
        <div><span>Total due</span><b>{pesos(due)}</b></div>
        <div className={balance === 0 ? "ok" : paid > 0 ? "warn" : "bad"}><span>{p.text}</span><b>{pesos(paid)} paid · {pesos(balance)} balance</b></div>
      </div>
      {payments.length > 0 && <div className="full"><small style={{ color: "var(--muted)", fontWeight: 700 }}>Trainee&apos;s payments</small>{payments.slice(0, 6).map((pm) => <div className="live-row-item" key={pm.id}><div><strong>{pm.payment_number}</strong><small>{pm.method}{pm.reference_number ? ` · ${pm.reference_number}` : ""} · {fmtDate(day(pm.received_at))} · {pm.verification_state}</small></div><span className="slot-count">{pesos(pm.amount_centavos)}</span></div>)}<p className="portal-form-note">Payments are recorded per trainee; which enrollment each one covers is on the receipt.</p></div>}

      <div className="full"><strong>Documents &amp; instructions</strong></div>
      {hasDocuments ? <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
        <a href={`/api/documents/admission-invoice/${e.id}`} target="_blank" rel="noreferrer">Admission slip</a>
        <a href={`/api/documents/training-instructions/${e.id}`} target="_blank" rel="noreferrer">Instructions PDF</a>
        <button type="button" disabled={busy} onClick={() => void post({ action: "send-instructions", enrollmentId: e.id }, e.instructions_sent_at ? "Instructions re-sent." : "Instructions sent.").catch(() => undefined)}>{e.instructions_sent_at ? `Resend instructions (sent ${fmtDate(day(e.instructions_sent_at))})` : "Send instructions"}</button>
      </div> : <p className="portal-form-note full">{isApplication ? "The admission slip and training instructions become available once the applicant is enrolled." : "No documents for a cancelled enrollment."}</p>}

      <div className="full"><strong>Request a change</strong> <small style={{ color: "var(--muted)" }}>decided by the Accounting Manager</small></div>
      <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
        {REG_REQUESTS.map((type) => <button key={type} type="button" disabled={!canRequest || pendingTypes.has(type)} title={pendingTypes.has(type) ? "A request of this type is already pending" : undefined} onClick={() => setReq(type)}>{type === "Rescheduling" ? "Change schedule" : type === "Change Course" ? "Change course" : isApplication ? "Decline application" : "Cancel enrollment"}</button>)}
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
  const centers = [...new Set(data.offers.map((o) => first(o.partner_centers)?.name).filter(Boolean))] as string[];
  const [center, setCenter] = useState(centers[0] ?? "");
  const offers = data.offers.map((o) => ({ offer: o, course: data.courses.find((c) => c.id === o.course_id) })).filter(({ offer, course }) => (first(offer.partner_centers)?.name ?? "") === center && (!q || `${course?.code ?? ""} ${course?.name ?? ""}`.toLowerCase().includes(q)));
  const table = (list: typeof inHouse) => <div className="portal-table"><table><thead><tr><th>Code</th><th>Course</th><th>Duration</th><th>Fee</th></tr></thead><tbody>{list.map((c) => <tr key={c.id}><td><strong>{c.code}</strong></td><td>{c.name}</td><td>{c.duration_label}</td><td>{pesos(c.standard_price_centavos)}</td></tr>)}</tbody></table>{!list.length && <p className="portal-empty-copy">No courses.</p>}</div>;
  return <div className="portal-page">
    <PageHead eyebrow="Registration" title="Courses" text="New Wave's own courses and the endorsed programs offered through partner centers, with the fees quoted to trainees." />
    <section className="portal-panel" style={{ marginBottom: 16 }}><div className="panel-heading"><div><h2>STCW courses</h2><p>MARINA-approved, delivered by New Wave</p></div></div>{table(inHouse.filter(isStcwCourse))}</section>
    <section className="portal-panel" style={{ marginBottom: 16 }}><div className="panel-heading"><div><h2>In-House courses</h2><p>Delivered by New Wave</p></div></div>{table(inHouse.filter((c) => !isStcwCourse(c)))}</section>
    <section className="portal-panel">
      <div className="panel-heading"><div><h2>Endorsed programs</h2><p>Offered through partner centers</p></div><label className="portal-field-inline">Partner center<select value={center} onChange={(e) => setCenter(e.target.value)}>{centers.map((c) => <option key={c}>{c}</option>)}{!centers.length && <option value="">None yet</option>}</select></label></div>
      <div className="portal-table"><table><thead><tr><th>Code</th><th>Course</th><th>Duration</th><th>Training fee</th></tr></thead><tbody>{offers.map(({ offer, course }) => <tr key={offer.id}><td><strong>{course?.code}</strong></td><td>{course?.name}</td><td>{offer.duration_label}</td><td>{pesos(offer.training_fee_centavos)}</td></tr>)}</tbody></table>{!offers.length && <p className="portal-empty-copy">No programs for this center.</p>}</div>
    </section>
  </div>;
}
