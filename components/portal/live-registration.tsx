"use client";

import { useState, type ReactNode } from "react";
import type { PortalData, Enrollment, Batch, Trainee } from "../portal-live-app";
import { first, manilaToday, dueCentavos, balanceOf, pesos, pesos2, addDays } from "@/lib/portal-format";
import { LATE_ENROLLMENT_CODES, PUBLIC_STCW_CODES, automaticEndDate, fitsInWeek } from "@/lib/scheduling";
import { emailStatusText } from "@/lib/instruction-email-status";
import { Badge, Message, Modal, PageHead, Pager, usePost, fullName, fmtDate, fmtClock } from "./shared-ui";
import { RequestActionModal, type RequestType } from "./payment-actions";

/**
 * Registration Officer workspace (rebuilt Oct 2026 to MASTERPLAN §10 as
 * amended by the July 2026 addendum and the owner's 7 Oct 2026 instruction).
 * Four sidebar modules, in order: Dashboard, Registration, Courses and
 * Instructions. New registrations come only from the website as Pending
 * applications; Registration screens them (three requirements) and hands them
 * to the Cashier. A paid applicant on a batch is enrolled automatically by the
 * server. Registration generates training instructions (at most twice) but
 * never prints the Training Admission Record — the Cashier does. The role reads
 * payment status but never writes a payment; the server actions reachable from
 * here are requirement-check, application-handover, send-instructions and
 * request-raise (application-enroll stays as a fallback), plus the
 * instruction-template actions on the Instructions screen, in the parent.
 */

type RequestRow = PortalData["requests"][number];

const fmtLong = (v: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");
const nameOf = (e: Enrollment) => { const t = first(e.trainees); return t ? fullName(t) : e.enrollment_number; };
/** Request types a Registration Officer may raise (addendum: rescheduling, change of course, cancellation). */
const REG_REQUESTS: RequestType[] = ["Rescheduling", "Change Course", "Make-up Class", "Cancellation"];
/** Button label for each request type a Registration Officer can raise. */
const requestLabel = (type: RequestType, isApplication: boolean) => (type === "Rescheduling" ? "Change batch / reschedule" : type === "Change Course" ? "Change course" : type === "Make-up Class" ? "Make-up class" : isApplication ? "Decline application" : "Cancel enrollment");
/** Where a request is: with the Cashier for charges, with Accounting for approval, or decided. */
const requestStage = (r: RequestRow) => (r.status !== "Pending" ? { text: r.status, tone: r.status === "Approved" ? "active" : "cancelled" } : r.stage === "With cashier" ? { text: "With the Cashier", tone: "orange" } : { text: "Awaiting approval", tone: "pending" });

const scheduleOf = (e: Enrollment) => { const b = first(e.batches); return b ? `${fmtDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${fmtDate(b.ends_on)}` : ""}` : e.scheduled_on ? fmtDate(e.scheduled_on) : e.enrollment_status === "Pending" ? "No batch yet" : "Open schedule"; };
const payState = (e: Enrollment) => { const paid = Number(e.paid_centavos), due = dueCentavos(e); if (e.enrollment_status === "Cancelled") return { text: "Cancelled", tone: "cancelled" }; if (due > 0 && paid >= due) return { text: "Paid", tone: "green" }; if (paid > 0) return { text: "Partially Paid", tone: "orange" }; return { text: "Unpaid", tone: "red" }; };
const statusTone = (s: string) => (s === "Enrolled" ? "active" : s === "Cancelled" ? "cancelled" : "pending");
const requestsFor = (data: PortalData, e: Enrollment) => data.requests.filter((r) => first(r.enrollments)?.enrollment_number === e.enrollment_number);


/** One row per course: the catalog holds some courses twice (same code or same name). */
function uniqueCourses<T extends { code: string; name: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((c) => { const keys = ["code:" + c.code.trim().toUpperCase(), "name:" + c.name.trim().toLowerCase().replace(/\s+/g, " ")]; if (keys.some((k) => seen.has(k))) return false; keys.forEach((k) => seen.add(k)); return true; });
}
/** STCW courses are the In-House courses filed under an STCW category. */
const isStcwCourse = (c?: PortalData["courses"][number] | null) => (first(c?.course_categories)?.name ?? "").toLowerCase().includes("stcw");
/** A New Wave batch a trainee can still be placed on: open, not started (CCMD: not finished), before its deadline, with seats left. */
const isBookable = (b: Batch, today: string, now: string) => !b.partner_offer_id && b.status === "Open" && (b.starts_on >= today || (b.ends_on >= today && LATE_ENROLLMENT_CODES.includes(first(b.courses)?.code ?? ""))) && b.enrollment_deadline > now && b.confirmed_count < b.capacity;

/* ------------------------------------------------------------------ Dashboard */

const fmtDay = (v: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const fmtShort = (v: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const dateRange = (s: string, e: string) => (s === e ? fmtShort(s) : s.slice(0, 7) === e.slice(0, 7) ? `${fmtShort(s)}–${Number(e.slice(8, 10))}` : `${fmtShort(s)} – ${fmtShort(e)}`);
const seatsLeft = (b: Batch) => Math.max(0, b.capacity - b.confirmed_count);
function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
  return [...m.entries()];
}

/**
 * Registration dashboard (owner, 7 Oct 2026): two boxes.
 * - New Registrations: website applications not yet enrolled, newest first.
 * - Enrollments: pick a day to see who became enrolled (paid) that day.
 */
export function RegistrationDashboard({ data, go }: { data: PortalData; go: (module: string) => void }) {
  const today = manilaToday();
  const [picked, setPicked] = useState(today);
  const courseById = new Map(data.courses.map((c) => [c.id, c]));
  const courseLabel = (e: Enrollment) => first(e.courses)?.name ?? courseById.get(e.course_id)?.name ?? "Course";
  const applications = applicationsOf(data).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const noCourse = awaitingCourseOf(data);
  const newCount = applications.length + noCourse.length;
  const newToday = applications.filter((e) => day(e.created_at) === today).length + noCourse.filter((t) => day(t.registered_at) === today).length;
  // Enrolled on the picked day (enrolled_at, or the last update for older rows).
  const enrolledDay = (e: Enrollment) => day(e.enrolled_at ?? e.updated_at ?? e.created_at);
  const enrolled = data.enrollments.filter((e) => e.enrollment_status === "Enrolled" && enrolledDay(e) === picked)
    .sort((a, b) => (b.enrolled_at ?? b.updated_at ?? "").localeCompare(a.enrolled_at ?? a.updated_at ?? ""));
  const enrolledPaid = enrolled.reduce((sum, e) => sum + Number(e.verified_paid_centavos ?? e.paid_centavos ?? 0), 0);
  const shift = (days: number) => setPicked((d) => addDays(d, days));

  // Summary rail (owner, 8 Oct 2026): figures on the left, the two working lists on the right.
  const states = applications.map((e) => stateOf(readinessOf(data, e)).text);
  const stateCount = (t: string) => states.filter((x) => x === t).length;
  const queue: [string, string, number][] = [["Screening", "#0571D0", stateCount("Screening") + stateCount("Needs attention")], ["For payment", "#F25615", stateCount("For payment")], ["Paid · choose batch", "#7a3fb8", stateCount("Paid · choose batch") + stateCount("Paid · enrolling") + stateCount("Paid · requirements missing")], ["Course to assign", "#5d6f7e", noCourse.length]];
  const now = new Date().toISOString(), tomorrow = addDays(today, 1);
  const stcw = uniqueCourses(data.courses.filter((x) => x.delivery_type === "In-House" && isStcwCourse(x))).map((course) => ({ course, next: data.batches.filter((x) => x.course_id === course.id && isBookable(x, today, now)).sort((x, y) => x.starts_on.localeCompare(y.starts_on))[0] })).filter((x) => x.next);
  const tomorrowBatches = data.batches.filter((x) => x.starts_on === tomorrow && x.status !== "Cancelled");
  const tomorrowIds = new Set(tomorrowBatches.map((x) => x.id));
  const tomorrowEnr = data.enrollments.filter((e) => e.batch_id && tomorrowIds.has(e.batch_id) && e.enrollment_status === "Enrolled");
  const notSent = tomorrowEnr.filter((e) => instructionsCountOf(data, e) === 0).length;
  return <div className="portal-page cx ac">
    <div className="cx-head">
      <div><span className="portal-eyebrow">Registration</span><h1>Dashboard</h1></div>
      <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="portal-secondary" onClick={() => go("Trainees")}>Search trainee</button>
        <button type="button" className="portal-primary" onClick={() => go("Applications")}>Screen applications{newCount ? ` (${newCount})` : ""}</button>
      </span>
    </div>
    <p className="ac-note">{fmtLong(today)}</p>

    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Applications</h2><span className="muted-text">tap to open</span></div>
          <div className="cx-tiles ac-tiles ac-tiles-in">{queue.map(([label, color, n]) => <button type="button" key={label} className="cx-tile ac-pick ac-count" style={{ ["--c" as string]: color }} onClick={() => go("Applications")}><span>{label}</span><b>{n}</b></button>)}
            <div className="cx-tile ac-total ac-count"><span>New today</span><b>{newToday}</b></div></div>
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>STCW seats open</h2><span className="muted-text">next batch</span></div>
          {stcw.length ? <div className="cx-tiles ac-tiles ac-tiles-in">{stcw.map(({ course, next }) => { const left = seatsLeft(next!); return <div key={course.id} className="cx-tile ac-count ac-seat" style={{ ["--c" as string]: left <= 3 ? "#F25615" : "#0571D0" }}><span>{course.name}<small>{dateRange(next!.starts_on, next!.ends_on)} · {next!.batch_number}</small><i className="ac-meter"><i style={{ width: `${Math.round((next!.confirmed_count / Math.max(1, next!.capacity)) * 100)}%` }} /></i></span><b>{left}</b></div>; })}
            <div className="cx-tile ac-total ac-count"><span>Seats left</span><b>{stcw.reduce((sum, x) => sum + seatsLeft(x.next!), 0)}</b></div></div> : <p className="portal-empty-copy">No STCW batches open.</p>}
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Tomorrow</h2><span className="muted-text">{fmtShort(tomorrow)}</span></div>
          <dl className="ac-lines"><div><dt>Trainees in class</dt><dd>{tomorrowEnr.length}</dd></div><div><dt>Batches</dt><dd>{tomorrowBatches.length}</dd></div><div><dt>Instructions not yet sent</dt><dd className={notSent ? "warn" : ""}>{notSent}</dd></div></dl>
        </section>
      </div>
      <div className="ac-stack">
        <section className="portal-panel rd-panel" id="rd-new">
          <div className="panel-heading"><div><h2>New registrations</h2><p>From the website, not yet enrolled · {newToday} today</p></div><span className="rd-count">{newCount}</span></div>
          <div className="rd-scroll">
            {noCourse.map((t) => <button type="button" className="rd-row" key={t.id} onClick={() => go("Applications")}>
              <span className="rd-main"><strong>{fullName(t)}</strong><small>{appNoOf(data, t.id) ? <span className="app-no">{appNoOf(data, t.id)}</span> : null}Course to be assigned</small></span>
              <Badge tone="pending">No course yet</Badge>
              <span className="rd-time">{day(t.registered_at) === today ? fmtClock(t.registered_at) : fmtShort(day(t.registered_at))}</span>
            </button>)}
            {applications.map((e) => { const st = stateOf(readinessOf(data, e)), c = first(e.courses); return <button type="button" className="rd-row" key={e.id} onClick={() => go("Applications")}>
              <span className="rd-main"><strong>{nameOf(e)}</strong><small>{appNoOf(data, e.trainee_id) ? <span className="app-no">{appNoOf(data, e.trainee_id)}</span> : null}{c?.code ? `${c.code} · ` : ""}{scheduleOf(e)}</small></span>
              <Badge tone={st.tone}>{st.text}</Badge>
              <span className="rd-time">{day(e.created_at) === today ? fmtClock(e.created_at) : fmtShort(day(e.created_at))}</span>
            </button>; })}
            {!newCount && <p className="rd-empty">No new registrations waiting.</p>}
          </div>
          <button type="button" className="ghost-button rd-more" onClick={() => go("Applications")}>View all →</button>
        </section>

        <section className="portal-panel rd-panel" id="rd-enrolled">
          <div className="panel-heading"><div><h2>Enrollments</h2><p>Trainees enrolled (paid) on the selected day</p></div><span className="rd-count">{enrolled.length}</span></div>
          <div className="rd-datebar">
            <button type="button" className="ghost-button" aria-label="Previous day" onClick={() => shift(-1)}>‹</button>
            <input type="date" value={picked} max={today} onChange={(ev) => ev.target.value && setPicked(ev.target.value)} aria-label="Enrollment date" />
            <button type="button" className="ghost-button" aria-label="Next day" disabled={picked >= today} onClick={() => shift(1)}>›</button>
            {picked !== today && <button type="button" className="ghost-button" onClick={() => setPicked(today)}>Today</button>}
            <span className="rd-datesum">{fmtDay(picked)} · {pesos(enrolledPaid)} paid</span>
          </div>
          <div className="rd-scroll">
            {enrolled.map((e) => { const t = first(e.trainees); return <button type="button" className="rd-row" key={e.id} onClick={() => go("Enrollments")}>
              <span className="rd-main"><strong>{nameOf(e)}</strong><small>{appNoOf(data, e.trainee_id) ? <span className="app-no">{appNoOf(data, e.trainee_id)}</span> : null}{courseLabel(e)} · {scheduleOf(e)}</small></span>
              <span className="rd-time">{pesos(Number(e.verified_paid_centavos ?? e.paid_centavos ?? 0))}<small>{t?.trainee_number ?? e.enrollment_number}</small></span>
            </button>; })}
            {!enrolled.length && <p className="rd-empty">No trainees were enrolled on {fmtDay(picked)}.</p>}
          </div>
          <button type="button" className="ghost-button rd-more" onClick={() => go("Enrollments")}>All enrollments →</button>
        </section>
      </div>
    </div>
  </div>;
}

/* ---------------------------------------------------------------- Screening */

/**
 * The four documents Registration ticks before handing a trainee to the Cashier
 * (owner, 7 Oct 2026). "Other" is an optional, noted extra and never blocks.
 */
export const REQUIREMENTS = [
  { code: "valid_id", label: "Valid ID / passport" },
  { code: "medical_peme", label: "Medical certificate (PEME format)" },
  { code: "photo_2x2", label: "2x2 photo" },
  { code: "seamans_book", label: "Seaman's book / SRN" },
] as const;
const OTHER_REQUIREMENT = { code: "other", label: "Other" } as const;
/** A legacy "medical_certificate" tick counts as the PEME medical. */
const requirementCode = (code: string) => (code === "medical_certificate" ? "medical_peme" : code);
type RequirementCheck = NonNullable<PortalData["requirementChecks"]>[number];

/**
 * Where a Pending application stands: requirements verified, a verified payment,
 * a schedule. Only a hint for the screen — the database re-checks every rule
 * when the applicant is enrolled.
 */
export function applicationReadiness(e: Enrollment, checks: RequirementCheck[], handedAt?: string | null) {
  const latest = new Map(checks.filter((c) => c.enrollment_id === e.id).map((c) => [requirementCode(c.requirement), c]));
  const missing = REQUIREMENTS.filter((r) => latest.get(r.code)?.status !== "Verified").map((r) => r.label);
  const rejected = REQUIREMENTS.filter((r) => latest.get(r.code)?.status === "Rejected").map((r) => r.label);
  const paidCentavos = Number(e.verified_paid_centavos ?? 0);
  const paid = paidCentavos > 0;
  const scheduled = !!e.batch_id || !!e.scheduled_on;
  const ready = !missing.length && paid && scheduled;
  const reason = missing.length ? `Not verified yet: ${missing.join(", ")}` : !paid ? "No verified payment yet" : !scheduled ? "Paid — choose a batch to enroll" : "Paid — enrolling";
  const handed = !!handedAt;
  return { latest, verified: REQUIREMENTS.length - missing.length, missing, rejected, paid, paidCentavos, ready, reason, handed, handedAt: handedAt ?? null };
}
/** Screening state of a Pending application. Paid and on a batch means the server enrolls it. */
const stateOf = (r: ReturnType<typeof applicationReadiness>) => (r.ready ? { text: "Paid · enrolling", tone: "active" } : r.paid && !r.missing.length ? { text: "Paid · choose batch", tone: "active" } : r.paid ? { text: "Paid · requirements missing", tone: "cancelled" } : r.handed ? { text: "For payment", tone: "orange" } : r.rejected.length ? { text: "Needs attention", tone: "cancelled" } : { text: "Screening", tone: "pending" });
/** Waiting at the Cashier: handed over and not yet paid. */
const forPayment = (r: ReturnType<typeof applicationReadiness>) => r.handed && !r.paid;
const readinessOf = (data: PortalData, e: Enrollment) => applicationReadiness(e, data.requirementChecks ?? [], data.handedToCashier?.[e.id] ?? null);
/** The website enrollment number (NWMTACI-0000001) the applicant quotes on Facebook, if any. */
const appNoOf = (data: PortalData, traineeId?: string | null) => (traineeId ? data.applicationNumbers?.[traineeId] ?? null : null);
const applicationsOf = (data: PortalData) => data.enrollments.filter((e) => e.enrollment_status === "Pending");
/** Website applicants with no course yet — Registration assigns one while screening. */
const awaitingCourseOf = (data: PortalData) => (data.awaitingCourseIds ?? []).map((id) => data.trainees.find((t) => t.id === id)).filter((t): t is Trainee => !!t).sort((a, b) => (b.registered_at ?? "").localeCompare(a.registered_at ?? ""));

/** The three tabs of the Registration list (owner, 7 Oct 2026). */
export const RECORD_FILTERS = ["All enrollments", "Screening", "For payment"] as const;
type RecordFilter = (typeof RECORD_FILTERS)[number];
const inFilter = (f: RecordFilter, r: ReturnType<typeof applicationReadiness> | null) => (f === "All enrollments" ? true : !r ? false : f === "For payment" ? forPayment(r) : !forPayment(r));
/** Times instructions were generated for an enrollment (limit 2 for Registration). */
export const INSTRUCTION_LIMIT = 2;
const instructionsCountOf = (data: PortalData, e: Enrollment) => data.instructionsCount?.[e.id] ?? (e.instructions_sent_at ? 1 : 0);

const NO_BATCH = "none";

const tileMonth = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", timeZone: "Asia/Manila" }).format(new Date(`${iso}T00:00:00+08:00`)).toUpperCase();
const weekdayOf = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "Asia/Manila" }).format(new Date(`${iso}T00:00:00+08:00`));
const closesAt = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));

/**
 * Batch cards ("Schedule picker" design 01): a date tile, the day pattern and
 * dates, batch number with room and instructor, and a seat meter that turns
 * orange when nearly full. The "No batch yet" card is optional.
 */
export function BatchCards({ data, batches, selected, onSelect, allowNone }: { data: PortalData; batches: Batch[]; selected: string; onSelect: (id: string) => void; allowNone?: boolean }) {
  const staffing = new Map((data.batchStaffing ?? []).map((x) => [x.batch_id, x]));
  return <div className="bc-list" role="radiogroup" aria-label="Batch">
    <div className="bc-head"><b>Choose a batch</b><span>{batches.length ? `${batches.length} open · 24 seats each` : "No open batch for this course yet"}</span></div>
    {batches.map((x) => {
      const left = seatsLeft(x), on = selected === x.id, low = left <= 3, st = staffing.get(x.id);
      const days = x.starts_on === x.ends_on ? weekdayOf(x.starts_on) : `${weekdayOf(x.starts_on)}–${weekdayOf(x.ends_on)}`;
      return <button type="button" role="radio" aria-checked={on} key={x.id} className={`bc-card${on ? " on" : ""}`} onClick={() => onSelect(x.id)}>
        <span className="bc-radio" aria-hidden="true" />
        <span className="bc-tile"><small>{tileMonth(x.starts_on)}</small><b>{Number(x.starts_on.slice(8, 10))}</b></span>
        <span className="bc-main"><b>{days} · {dateRange(x.starts_on, x.ends_on)}</b><small>{x.batch_number} · {st?.room_name ?? x.venue ?? "Room not set"} · {st?.instructor_name ?? "Instructor not assigned"}</small></span>
        <span className="bc-seats"><span><b className={low ? "low" : ""}>{left} of {x.capacity} left</b><small>{closesAt(x.enrollment_deadline)}</small></span><span className="bc-meter"><i className={low ? "low" : ""} style={{ width: `${Math.round(((x.capacity - left) / Math.max(1, x.capacity)) * 100)}%` }} /></span></span>
      </button>;
    })}
    {allowNone && <button type="button" role="radio" aria-checked={selected === NO_BATCH} className={`bc-card bc-none${selected === NO_BATCH ? " on" : ""}`} onClick={() => onSelect(NO_BATCH)}>
      <span className="bc-radio" aria-hidden="true" />
      <span className="bc-main"><b>No batch yet — place later</b><small>{batches.length ? "Screen and take payment now; choose the batch from the application later." : "Screen and take payment now; place on a batch once one opens."}</small></span>
    </button>}
  </div>;
}
/** One-line summary of the chosen batch, shown beside the confirm button. */
const batchSummary = (data: PortalData, b: Batch | undefined) => b ? `${dateRange(b.starts_on, b.ends_on)} · ${b.batch_number} · ${seatsLeft(b)} seats left` : "";

/**
 * Assign a New Wave course to an applicant (course now, batch later). Any active
 * in-house course can be chosen; open batches for it are offered, and "No batch
 * yet" lets screening and payment go ahead before a batch opens.
 */
export function AssignCourseModal({ data, trainee, reload, onClose }: { data: PortalData; trainee: Trainee; reload: () => Promise<void>; onClose: () => void }) {
  const { busy, msg, post } = usePost(reload);
  const [courseId, setCourseId] = useState("");
  const [batchId, setBatchId] = useState(NO_BATCH);
  const today = manilaToday(), now = new Date().toISOString();
  const courses = uniqueCourses(data.courses.filter((c) => c.delivery_type === "In-House")).sort((x, y) => x.name.localeCompare(y.name));
  const batches = data.batches.filter((x) => x.course_id === courseId && isBookable(x, today, now)).sort((x, y) => x.starts_on.localeCompare(y.starts_on));
  const course = courses.find((c) => c.id === courseId);
  const withBatch = batchId !== NO_BATCH;
  // Non-STCW in-house courses run on a picked start date (Sundays skipped,
  // consecutive within the week) instead of a batch.
  const [startDate, setStartDate] = useState("");
  const dated = !!course && !isStcwCourse(course) && !batches.length;
  const dateOk = !startDate || (startDate > today && fitsInWeek(startDate, course?.duration_label ?? "1"));
  const assign = () => void post({ action: "application-assign", traineeId: trainee.id, courseId, batchId: withBatch ? batchId : null, scheduledOn: dated && startDate ? startDate : null }, withBatch ? "Course and batch assigned. Screening can start." : dated && startDate ? "Course and start date assigned. Screening can start." : "Course assigned. Screening can start; place on a batch once one opens.").then(onClose).catch(() => undefined);
  return <Modal title={`Assign a course · ${fullName(trainee)}`} onClose={onClose}>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      <label className="full">Course<select value={courseId} onChange={(e) => { setCourseId(e.target.value); setBatchId(NO_BATCH); }}>
        <option value="">Select a course</option>
        <optgroup label="STCW courses">{courses.filter(isStcwCourse).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} · {pesos(c.standard_price_centavos)}</option>)}</optgroup>
        <optgroup label="Other courses">{courses.filter((c) => !isStcwCourse(c)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} · {pesos(c.standard_price_centavos)}</option>)}</optgroup>
      </select></label>
      {course && !dated && <div className="full"><BatchCards data={data} batches={batches} selected={batchId} onSelect={setBatchId} allowNone /></div>}
      {dated && course && <label className="full">Start date (optional)<input type="date" value={startDate} min={addDays(today, 1)} onChange={(e) => setStartDate(e.target.value)} /><small style={{ color: dateOk ? "var(--muted)" : "var(--red, #b42318)" }}>{!startDate ? `${course.duration_label} · Monday to Saturday, consecutive days in one week. Leave empty to set later.` : dateOk ? `Runs ${fmtDate(startDate)} to ${fmtDate(automaticEndDate(startDate, course.duration_label))}` : "Pick a later date that is not a Sunday and lets the course finish by Saturday of the same week."}</small></label>}
      <div className="bc-foot full"><span>{course ? (withBatch ? batchSummary(data, batches.find((x) => x.id === batchId)) : `${course.code} · fee ${pesos(course.standard_price_centavos)} · no batch yet`) : "Choose a course first."}</span><span className="bc-foot-actions"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={!courseId || busy || !dateOk} onClick={assign}>{busy ? "Assigning…" : withBatch ? "Assign course and batch" : "Assign course"}</button></span></div>
    </div>
  </Modal>;
}

/** Put a Pending application that has no batch yet onto an open batch of its course. */
function ChooseBatchModal({ data, enrollment, reload, onClose }: { data: PortalData; enrollment: Enrollment; reload: () => Promise<void>; onClose: () => void }) {
  const { busy, msg, post } = usePost(reload);
  const [batchId, setBatchId] = useState("");
  const today = manilaToday(), now = new Date().toISOString();
  const batches = data.batches.filter((x) => x.course_id === enrollment.course_id && isBookable(x, today, now)).sort((x, y) => x.starts_on.localeCompare(y.starts_on));
  const place = () => void post({ action: "application-place-batch", enrollmentId: enrollment.id, batchId }, "Placed on the batch.").then(onClose).catch(() => undefined);
  return <Modal title={`Choose batch · ${first(enrollment.courses)?.name ?? "Course"}`} onClose={onClose}>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      <div className="full"><BatchCards data={data} batches={batches} selected={batchId} onSelect={setBatchId} /></div>
      {!batches.length && <p className="portal-form-note full">The application stays ready; place it once a batch opens.</p>}
      <div className="bc-foot full"><span>{batchSummary(data, batches.find((x) => x.id === batchId)) || "Choose a batch."}</span><span className="bc-foot-actions"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={!batchId || busy} onClick={place}>{busy ? "Placing…" : "Place on batch"}</button></span></div>
    </div>
  </Modal>;
}

/**
 * Every enrollment in one list with three tabs: All enrollments, Screening
 * (Pending applications Registration is working on, including paid ones that
 * still need a batch) and For payment (handed to the Cashier, not yet paid).
 * Applicants without a course sit above the table under All and Screening.
 */
function EnrollmentQueue({ data, query, reload, initial }: { data: PortalData; query: string; reload: () => Promise<void>; initial: RecordFilter }) {
  const [filter, setFilter] = useState<RecordFilter>(initial);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Enrollment | null>(null);
  const [assigning, setAssigning] = useState<Trainee | null>(null);
  const term = (q || query).trim().toLowerCase();
  const all = data.enrollments.map((e) => ({ e, r: e.enrollment_status === "Pending" ? readinessOf(data, e) : null }));
  const awaiting = awaitingCourseOf(data);
  const noCourse = awaiting.filter((t) => !term || `${fullName(t)} ${t.trainee_number} ${appNoOf(data, t.id) ?? ""} ${t.email} ${t.mobile}`.toLowerCase().includes(term));
  const rank = (x: (typeof all)[number]) => (x.r ? 0 : 1);
  const rows = all
    .filter((x) => inFilter(filter, x.r))
    .filter(({ e }) => !term || `${nameOf(e)} ${e.enrollment_number} ${appNoOf(data, e.trainee_id) ?? ""} ${first(e.courses)?.name ?? ""} ${first(e.trainees)?.trainee_number ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => rank(a) - rank(b) || (a.r ? (first(a.e.batches)?.starts_on ?? "9999").localeCompare(first(b.e.batches)?.starts_on ?? "9999") || a.e.created_at.localeCompare(b.e.created_at) : b.e.created_at.localeCompare(a.e.created_at)));
  const PER = 12;
  const pageRows = rows.slice((page - 1) * PER, page * PER);
  const current = open ? data.enrollments.find((e) => e.id === open.id) ?? open : null;
  const count = (f: RecordFilter) => all.filter((x) => inFilter(f, x.r)).length + (f === "For payment" ? 0 : awaiting.length);
  // Summary rail (owner, 8 Oct 2026): the filters, requirement counts and enrollment types on the left; the list on the right.
  const pending = all.filter((x) => x.r);
  const types = ["Online enrollment", "Walk-in", "Agency"].map((k) => [k, data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && (enrollmentTypeOf(data, e) || "").startsWith(k)).length] as const);
  const FILTER_COLORS: Record<RecordFilter, string> = { "All enrollments": "#123F63", Screening: "#0571D0", "For payment": "#F25615" };
  return <>
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Queue</h2><span className="muted-text">tap to filter</span></div>
          <div className="cx-tiles ac-tiles ac-tiles-in" role="tablist" aria-label="Enrollment filter">{RECORD_FILTERS.map((f) => <button key={f} type="button" role="tab" aria-selected={filter === f} className={`cx-tile ac-pick ac-count${filter === f ? " on" : ""}`} style={{ ["--c" as string]: FILTER_COLORS[f] }} onClick={() => { setFilter(f); setPage(1); }}><span>{f}</span><b>{count(f)}</b></button>)}</div>
          {awaiting.length > 0 && <p className="ac-foot">{awaiting.length} applicant{awaiting.length === 1 ? "" : "s"} still need a course.</p>}
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Requirements</h2><span className="muted-text">applications</span></div>
          <dl className="ac-lines">{REQUIREMENTS.map((req) => <div key={req.code}><dt>{req.label}</dt><dd>{pending.filter((x) => x.r!.latest.get(req.code)?.status === "Verified").length} of {pending.length}</dd></div>)}</dl>
          <p className="ac-foot">Hand to the Cashier once all four are ticked.</p>
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>By enrollment type</h2></div>
          <dl className="ac-lines">{types.map(([k, n]) => <div key={k}><dt>{k}</dt><dd>{n}</dd></div>)}</dl>
        </section>
      </div>
      <div className="ac-stack">
        <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search enrollments" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, NWMTACI number, SRN, course" /></div>
        {filter !== "For payment" && noCourse.length > 0 && <section className="portal-panel nc-panel">
          <div className="panel-heading"><div><h2>No course yet</h2><p>Assign a course and schedule, then screen the application</p></div><span className="slot-count">{noCourse.length}</span></div>
          {noCourse.map((t) => <div className="rd-row" key={t.id}>
            <span className="rd-main"><strong>{fullName(t)}</strong><small>{appNoOf(data, t.id) ? <span className="app-no">{appNoOf(data, t.id)}</span> : null}{t.trainee_number} · <span className="lc">{t.email}</span> · {t.mobile}</small></span>
            <span className="rd-time">{t.registered_at ? fmtShort(day(t.registered_at)) : ""}</span>
            <button type="button" className="portal-primary" onClick={() => setAssigning(t)}>Assign course</button>
          </div>)}
        </section>}
        <div className="portal-table portal-panel"><table><thead><tr><th>Trainee</th><th>Enrollment no.</th><th>Course and schedule</th><th>Requirements</th><th>Payment</th><th>Status</th></tr></thead><tbody>
          {pageRows.map(({ e, r }) => { const t = first(e.trainees), s = r ? stateOf(r) : { text: e.enrollment_status, tone: statusTone(e.enrollment_status) }, p = payState(e); return <tr key={e.id} className="row-clickable" onClick={() => setOpen(e)}>
            <td><strong>{t ? fullName(t) : "Unknown"}</strong><small>{t?.trainee_number}</small>{enrollmentTypeOf(data, e) && <span className="et-chip">{enrollmentTypeOf(data, e)}</span>}</td>
            <td><strong className="app-no-cell">{appNoOf(data, e.trainee_id) ?? e.enrollment_number}</strong><small>{appNoOf(data, e.trainee_id) ? e.enrollment_number : fmtDate(day(e.created_at))}</small></td>
            <td>{first(e.courses)?.name ?? "—"}<small>{scheduleOf(e)}</small></td>
            <td>{r ? <><span className={`req-count${r.missing.length ? "" : " ok"}`}>{r.verified} of {REQUIREMENTS.length}</span>{r.rejected.length > 0 && <small>Rejected: {r.rejected.join(", ")}</small>}</> : <span className="muted-text">{e.enrollment_status === "Cancelled" ? "—" : "Complete"}</span>}</td>
            <td>{r ? (r.paid ? <><strong>{pesos(r.paidCentavos)}</strong><small>Verified</small></> : <span className="muted-text">{r.handed ? "With cashier" : "Not yet"}</span>) : <><Badge tone={p.tone}>{p.text}</Badge><small>{pesos(balanceOf(e))} balance</small></>}</td>
            <td><Badge tone={s.tone}>{s.text}</Badge></td>
          </tr>; })}
        </tbody></table>{!rows.length && <p className="portal-empty-copy">{filter === "For payment" ? "Nobody is waiting at the Cashier." : filter === "Screening" ? (noCourse.length ? "Applicants without a course are listed above." : "No applications to screen. New ones arrive from the website.") : "No matching enrollments."}</p>}</div>
        <Pager page={page} total={rows.length} perPage={PER} onPage={setPage} />
      </div>
    </div>
    {current && <EnrollmentDrawer data={data} enrollment={current} reload={reload} onClose={() => setOpen(null)} />}
    {assigning && <AssignCourseModal data={data} trainee={assigning} reload={reload} onClose={() => setAssigning(null)} />}
  </>;
}

/* -------------------------------------------------------------- Registration */

/** Enrollment type (8 Oct 2026): Online enrollment, Walk-in, or Agency with the partner's name. */
function enrollmentTypeOf(data: PortalData, e: Enrollment) {
  const agencyId = data.referralByEnrollment?.[e.id];
  const agency = agencyId ? data.agencies.find((a) => a.id === agencyId)?.name : null;
  if (agency) return `Agency · ${agency}`;
  return e.source === "Online enrollment" || e.source === "Walk-in" || e.source === "Agency" ? e.source : e.source === "Public registration" ? "Online enrollment" : "";
}

/** "applications" opens the list on Screening, "enrollments" on All enrollments. */
export type RecordsView = "applications" | "enrollments" | "trainees";

/**
 * One sidebar tab for the people side of registration: the enrollment list
 * (All enrollments · Screening · For payment) and the trainee master records,
 * which live in the parent with their detail modal and so arrive as an element.
 */
export function RegistrationRecords({ data, query, reload, view, setView, trainees }: { data: PortalData; query: string; reload: () => Promise<void>; view: RecordsView; setView: (v: RecordsView) => void; trainees: ReactNode }) {
  const onList = view !== "trainees";
  const tabs: [RecordsView, string, number, boolean][] = [["enrollments", "Enrollments", data.enrollments.length + awaitingCourseOf(data).length, onList], ["trainees", "Trainees", data.trainees.length, !onList]];
  const weekAgo = addDays(manilaToday(), -6);
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Registration</span><h1>{onList ? "Enrollments" : "Trainees"}</h1></div></div>
    <div className="rr-switch" role="tablist" aria-label="Records">
      {tabs.map(([v, label, n, on]) => <button key={v} type="button" role="tab" aria-selected={on} className={on ? "active" : ""} onClick={() => setView(v)}>{label}<small>{n}</small></button>)}
    </div>
    {onList && <EnrollmentQueue key={view} data={data} query={query} reload={reload} initial={view === "applications" ? "Screening" : "All enrollments"} />}
    {view === "trainees" && <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Trainee records</h2></div>
          <dl className="ac-lines"><div><dt>All trainees</dt><dd>{data.trainees.length}</dd></div><div><dt>Registered this week</dt><dd>{data.trainees.filter((t) => day(t.registered_at) >= weekAgo).length}</dd></div><div><dt>Missing SRN</dt><dd className="warn">{data.trainees.filter((t) => !t.srn).length}</dd></div><div><dt>Waiting for a course</dt><dd>{awaitingCourseOf(data).length}</dd></div></dl>
        </section>
      </div>
      <div className="ac-stack">{trainees}</div>
    </div>}
  </div>;
}

/**
 * Application screening (owner's choice, 8 Oct 2026): the Screening sheet
 * combined with the Checklist with remarks — navy header, the applicant,
 * training and payment first, then one requirements table (received, status,
 * remarks, who received it), signature lines and the hand-over button.
 */
function ScreeningPanel({ data, enrollment: e, busy, post }: { data: PortalData; enrollment: Enrollment; busy: boolean; post: (body: Record<string, unknown>, successText?: string) => Promise<Record<string, unknown>> }) {
  const [unticking, setUnticking] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const r = readinessOf(data, e);
  const s = stateOf(r);
  const allTicked = r.missing.length === 0;
  const t = first(e.trainees), c = first(e.courses), b = first(e.batches);
  const appNo = appNoOf(data, e.trainee_id) ?? e.enrollment_number;
  const balance = balanceOf(e);
  const check = (requirement: string, status: "Verified" | "Rejected", label: string, note?: string) =>
    void post({ action: "requirement-check", enrollmentId: e.id, requirement, status, remarks: note ?? (status === "Rejected" ? remarks.trim() : undefined) }, `${label} ${status === "Verified" ? "marked received" : "marked not received"}.`).then(() => { setUnticking(null); setRemarks(""); setNotes((n) => ({ ...n, [requirement]: "" })); }).catch(() => undefined);
  const rows = [...REQUIREMENTS.map((q) => ({ ...q, optional: false })), { ...OTHER_REQUIREMENT, label: "Other (optional)", optional: true }];
  const lastChecker = [...r.latest.values()].filter((x) => x.status === "Verified").sort((a, z) => z.checked_at.localeCompare(a.checked_at))[0];
  return <div className="sc full">
    <div className="sc-band"><div className="sc-seal" aria-hidden="true">NW</div><div><b>Application screening</b><small>New Wave Maritime Training and Assessment Center, Inc.</small></div><div className="sc-no"><span>Application</span><b>{appNo}</b></div></div>
    <div className="sc-stripe" aria-hidden="true" />
    <div className="sc-ident">
      <div><span className="sc-cap">Applicant{enrollmentTypeOf(data, e) ? ` · ${enrollmentTypeOf(data, e)}` : ""}</span><h3>{t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "—"}</h3><p>{t?.trainee_number}{t?.mobile ? ` · ${t.mobile}` : ""}</p>{t?.email && <p className="lc">{t.email}</p>}</div>
      <div><span className="sc-cap">Training</span><b>{c?.name ?? "—"}</b><p>{scheduleOf(e)}{b ? ` · ${b.batch_number}` : ""}</p><p>{b?.mode ?? (c?.code ?? "")}</p></div>
      <div><span className="sc-cap">Payment</span><b className={r.paid ? "sc-good" : ""}>{r.paid ? `${pesos2(r.paidCentavos)} paid` : r.handed ? "With the Cashier" : "Not paid yet"}</b><p>Balance {pesos2(balance)}</p><p><Badge tone={s.tone}>{s.text}</Badge></p></div>
    </div>
    <div className="sc-table"><table><thead><tr><th>Requirement</th><th>Received</th><th>Remarks</th><th>Received by</th></tr></thead><tbody>
      {rows.map((q) => { const ck = r.latest.get(q.code); const ticked = ck?.status === "Verified"; const note = notes[q.code] ?? ""; const needsNote = q.optional && !ticked && !note.trim();
        return <tr key={q.code} className={ticked ? "ok" : ""}>
          <td><b>{q.label}</b>{!ticked && ck?.status === "Rejected" && <small className="sc-bad">Not accepted{ck.remarks ? `: ${ck.remarks}` : ""}</small>}</td>
          <td><label className="sc-rec"><input type="checkbox" checked={ticked} disabled={busy || needsNote} onChange={() => { if (ticked) { if (q.optional) check(q.code, "Rejected", q.label, "Removed"); else { setUnticking(q.code); setRemarks(""); } } else check(q.code, "Verified", q.label, note.trim() || undefined); }} />{ticked ? "Received" : q.optional ? "Optional" : "Not yet"}</label></td>
          <td>{ticked ? <span className="sc-note">{ck?.remarks || "—"}</span>
            : unticking === q.code ? null
            : <input className="sc-input" value={note} onChange={(ev) => setNotes((n) => ({ ...n, [q.code]: ev.target.value }))} placeholder={q.optional ? "What is it? e.g. COP for BT-PSSR" : q.code === "valid_id" ? "e.g. Passport, expires 2030" : q.code === "medical_peme" ? "Clinic and date" : "Optional"} aria-label={`Remarks for ${q.label}`} />}
            {unticking === q.code && <span className="sc-untick"><input className="sc-input" value={remarks} onChange={(ev) => setRemarks(ev.target.value)} placeholder="Reason, e.g. medical certificate expired" aria-label={`Reason for ${q.label}`} autoFocus /><button type="button" className="portal-primary" disabled={busy || !remarks.trim()} onClick={() => check(q.code, "Rejected", q.label)}>Mark not received</button><button type="button" className="ghost-button" onClick={() => setUnticking(null)}>Keep</button></span>}</td>
          <td>{ck ? <><span>{ck.checked_by_name ?? "Staff"}</span><small>{fmtDate(day(ck.checked_at))}</small></> : <span className="muted-text">—</span>}</td>
        </tr>; })}
      <tr className="sc-total"><td>Received</td><td colSpan={3}>{r.verified} of {REQUIREMENTS.length}</td></tr>
    </tbody></table></div>
    <div className="sc-sig"><div><b>{lastChecker?.checked_by_name ?? " "}</b><span>Checked by · Registration officer</span></div><div><b>{lastChecker ? fmtDate(day(lastChecker.checked_at)) : " "}</b><span>Date</span></div></div>
    <div className="sc-foot">
      <small>{!allTicked ? `Still to tick: ${r.missing.join(", ")}` : !r.handed && !r.paid ? "All requirements received. Hand the trainee to the Cashier for payment." : !r.paid ? "With the Cashier — waiting for payment." : !e.batch_id && !e.scheduled_on ? "Paid. Choose a batch and the trainee is enrolled automatically." : "Paid — enrolling. Refresh if the status has not changed."}</small>
      <span className="sc-acts">
        {!r.handed && !r.paid && <button type="button" className="portal-primary" disabled={busy || !allTicked} onClick={() => void post({ action: "application-handover", enrollmentId: e.id }, "Handed to the Cashier for payment.").catch(() => undefined)}>Hand to Cashier</button>}
        {r.ready && <button type="button" className="portal-primary" disabled={busy} onClick={() => void post({ action: "application-enroll", enrollmentId: e.id }, "Trainee enrolled.").catch(() => undefined)}>Enroll now</button>}
      </span>
    </div>
  </div>;
}

/** Everything about one enrollment, read-only on money. Requests go to Accounting. */
export function EnrollmentDrawer({ data, enrollment: e, reload, onClose }: { data: PortalData; enrollment: Enrollment; reload: () => Promise<void>; onClose: () => void }) {
  const { busy, msg, post } = usePost(reload);
  const generated = instructionsCountOf(data, e), atLimit = generated >= INSTRUCTION_LIMIT;
  const [req, setReq] = useState<RequestType | null>(null);
  const [addingCourse, setAddingCourse] = useState(false);
  const [choosingBatch, setChoosingBatch] = useState(false);
  const t = first(e.trainees), c = first(e.courses), b = first(e.batches);
  const traineeRecord = data.trainees.find((x) => x.id === e.trainee_id) ?? null;
  const center = first(first(e.partner_course_offers)?.partner_centers)?.name;
  const paid = Number(e.paid_centavos), due = dueCentavos(e), balance = balanceOf(e), charges = Number(e.charges_centavos ?? 0), discounts = Number(e.discounts_centavos ?? 0);
  const payments = data.payments.filter((p) => p.trainee_id === e.trainee_id).sort((a, z) => z.received_at.localeCompare(a.received_at));
  const history = requestsFor(data, e).sort((a, z) => z.created_at.localeCompare(a.created_at));
  const pendingTypes = new Set(history.filter((r) => r.status === "Pending").map((r) => r.request_type));
  const canRequest = e.enrollment_status !== "Cancelled";
  const isApplication = e.enrollment_status === "Pending";
  const hasDocuments = e.enrollment_status === "Enrolled" || e.enrollment_status === "Open Schedule";
  const p = payState(e);
  return <Modal title={isApplication ? `Application ${appNoOf(data, e.trainee_id) ?? e.enrollment_number}` : e.enrollment_number} onClose={onClose} wide>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      {isApplication && <ScreeningPanel data={data} enrollment={e} busy={busy} post={post} />}
      {!isApplication && <div className="kv-grid kv-stack full">
        <div><span>{isApplication ? "Applicant" : "Trainee"}</span><strong>{t ? fullName(t) : "—"}</strong><small>{appNoOf(data, e.trainee_id) ? <span className="app-no">{appNoOf(data, e.trainee_id)}</span> : null}{t?.trainee_number} · <span className="lc">{t?.email}</span> · {t?.mobile}</small></div>
        <div><span>Course</span><strong>{c?.name ?? "—"}</strong><small>{c?.code}{center ? ` · endorsed: ${center}` : " · New Wave"}</small></div>
        <div><span>Schedule</span><strong>{scheduleOf(e)}</strong><small>{b ? `${b.batch_number}${b.mode ? ` · ${b.mode}` : ""}${b.venue ? ` · ${b.venue}` : ""}` : e.scheduled_on ? (c && first(e.partner_course_offers) ? "Endorsed training date" : `Start date picked · ends ${fmtDate(automaticEndDate(e.scheduled_on, data.courses.find((x) => x.id === e.course_id)?.duration_label ?? "1"))}`) : "Not yet placed on a batch"}</small></div>
        <div><span>Status</span><strong><Badge tone={statusTone(e.enrollment_status)}>{e.enrollment_status}</Badge></strong><small>{isApplication ? "Submitted" : "Created"} {fmtDate(day(e.created_at))}{e.source ? ` · ${e.source}` : ""}</small></div>
      </div>}

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
      {hasDocuments ? <>
        <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
          {!atLimit && <button type="button" disabled={busy} onClick={() => void post({ action: "send-instructions", enrollmentId: e.id }, generated ? "Instructions generated again and emailed to the trainee." : "Instructions generated and emailed to the trainee.").catch(() => undefined)}>Generate instructions</button>}
          {generated > 0 && <a href={`/api/documents/training-instructions/${e.id}`} target="_blank" rel="noreferrer">Instructions PDF</a>}
        </div>
        <p className="portal-form-note full">{emailStatusText(data.instructionEmails?.[e.id]) ? `${emailStatusText(data.instructionEmails?.[e.id])}. ` : t?.email ? `Generating emails the PDF and Google Classroom link to ${t.email}. ` : ""}{e.instructions_sent_at ? `Last generated ${fmtDate(day(e.instructions_sent_at))}. ` : ""}Instructions can be generated twice. The Training Admission Record is printed by the Cashier.</p>
      </> : <p className="portal-form-note full">{isApplication ? "Training instructions become available once the trainee is paid and enrolled." : "No documents for a cancelled enrollment."}</p>}

      {isApplication && <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>{!e.batch_id && !e.scheduled_on && <button type="button" className="portal-primary" onClick={() => setChoosingBatch(true)}>Choose batch</button>}{traineeRecord && <button type="button" onClick={() => setAddingCourse(true)}>+ Add another course</button>}</div>}

      <div className="full"><strong>Request a change</strong> <small style={{ color: "var(--muted)" }}>goes to the Cashier for charges, then the Accounting Manager for approval</small></div>
      <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
        {REG_REQUESTS.filter((type) => !(isApplication && type === "Make-up Class")).map((type) => <button key={type} type="button" disabled={!canRequest || pendingTypes.has(type)} title={pendingTypes.has(type) ? "A request of this type is already pending" : undefined} onClick={() => setReq(type)}>{requestLabel(type, isApplication)}</button>)}
      </div>
      {history.length > 0 && <div className="full"><small style={{ color: "var(--muted)", fontWeight: 700 }}>Request history</small>{history.map((r: RequestRow) => { const st = requestStage(r); const charge = first(r.enrollment_charges); return <div className="live-row-item" key={r.id}><div><strong>{r.request_number} · {r.request_type === "Rescheduling" ? "Change batch / reschedule" : r.request_type}</strong><small>{r.reason} · filed {fmtDate(day(r.created_at))}{charge ? ` · charge ${pesos(charge.amount_centavos)}` : r.stage === "For approval" && r.status === "Pending" ? " · no charge" : ""}{r.decided_at ? ` · decided ${fmtDate(day(r.decided_at))}` : ""}{r.decision_remarks ? ` · ${r.decision_remarks}` : ""}</small></div><Badge tone={st.tone}>{st.text}</Badge></div>; })}</div>}

      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Close</button></div>
    </div>
    {req && <RequestActionModal data={data} enrollment={e} reqType={req} onClose={() => setReq(null)} post={(body) => post(body, "Request sent to the Cashier for charges.")} />}
    {addingCourse && traineeRecord && <AssignCourseModal data={data} trainee={traineeRecord} reload={reload} onClose={() => setAddingCourse(false)} />}
    {choosingBatch && <ChooseBatchModal data={data} enrollment={e} reload={reload} onClose={() => setChoosingBatch(false)} />}
  </Modal>;
}

/* ------------------------------------------------------- Courses & centers */

/**
 * Registration's Courses screen — the public Courses page layout (STCW cards
 * with their open dates, In-House courses by category), plus what only staff
 * see: seats left per batch and the fees. Endorsed programs keep their own tab.
 * No rebate or partner payable figures.
 */
const COURSE_TABS = ["STCW schedules", "In-House courses", "Endorsed programs"] as const;
export function CoursesAndCenters({ data, query }: { data: PortalData; query: string }) {
  const [tab, setTab] = useState<(typeof COURSE_TABS)[number]>("STCW schedules");
  const q = query.trim().toLowerCase();
  const today = manilaToday(), now = new Date().toISOString();
  const inHouse = uniqueCourses(data.courses.filter((c) => c.delivery_type === "In-House" && (!q || `${c.code} ${c.name}`.toLowerCase().includes(q)))).sort((a, b) => a.name.localeCompare(b.name));
  const byCode = new Map(inHouse.map((c) => [c.code, c]));
  const stcw = PUBLIC_STCW_CODES.map((code) => byCode.get(code)).filter((c): c is NonNullable<typeof c> => !!c);
  const stcwCodes = new Set<string>(PUBLIC_STCW_CODES);
  const others = inHouse.filter((c) => !stcwCodes.has(c.code));
  const categories = [...new Set(others.map((c) => first(c.course_categories)?.name ?? "In-House"))];
  const [category, setCategory] = useState("");
  const centers = [...new Set(data.offers.map((o) => first(o.partner_centers)?.name).filter(Boolean))] as string[];
  const [center, setCenter] = useState(centers[0] ?? "");
  const offers = data.offers.map((o) => ({ offer: o, course: data.courses.find((c) => c.id === o.course_id) })).filter(({ offer, course }) => (first(offer.partner_centers)?.name ?? "") === center && (!q || `${course?.code ?? ""} ${course?.name ?? ""}`.toLowerCase().includes(q)));
  // Open and full batches still taking (or just closed to) enrollment, by course code.
  const batchesOf = (code: string) => data.batches.filter((b) => first(b.courses)?.code === code && !b.partner_offer_id && (b.status === "Open" || b.status === "Full") && (b.starts_on >= today || (LATE_ENROLLMENT_CODES.includes(code) && b.ends_on >= today)))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const counts = { "STCW schedules": stcw.length, "In-House courses": others.length, "Endorsed programs": offers.length };
  return <div className="portal-page">
    <PageHead eyebrow="Registration" title="Courses" text="The courses trainees see on the website, with the seats left in each batch and the fees. Enrollment for STCW batches closes at 7:00 AM on the training date (CCM Domestic: on the last day)." />
    <div className="rr-switch" role="tablist" aria-label="Courses">{COURSE_TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}<small>{counts[t]}</small></button>)}</div>

    {tab === "STCW schedules" && <div className="course-grid">{stcw.map((c) => { const list = batchesOf(c.code); const open = list.filter((b) => b.status === "Open" && b.enrollment_deadline > now && seatsLeft(b) > 0).length; return <article key={c.id} className="course-card-public">
      <span className="course-badge stcw">STCW</span>
      <h3>{c.name}</h3>
      <small className="course-code">{c.code}</small>
      <dl className="course-facts"><div><dt>Duration</dt><dd>{c.duration_label}{list[0] ? ` · ${list[0].starts_on === list[0].ends_on ? weekdayOf(list[0].starts_on) : `${weekdayOf(list[0].starts_on)}–${weekdayOf(list[0].ends_on)}`}` : ""}</dd></div><div><dt>Fee</dt><dd>{pesos(c.standard_price_centavos)}</dd></div></dl>
      {list.length ? <div className="course-schedules">
        <span className="schedule-status open">● {open} open batch{open === 1 ? "" : "es"}</span>
        <div className="slot-months">{groupBy(list, (b) => b.starts_on.slice(0, 7)).map(([month, rows]) => <div key={month}>
          <span className="schedule-month-label">{tileMonth(rows[0].starts_on)} {rows[0].starts_on.slice(0, 4)}</span>
          <ul className="slot-list">{rows.map((b) => { const left = seatsLeft(b), closed = b.enrollment_deadline <= now, full = b.status === "Full" || left === 0; return <li key={b.id} className={full || closed ? "full" : ""} title={`${b.batch_number} · closes ${closesAt(b.enrollment_deadline)}`}><b>{dateRange(b.starts_on, b.ends_on)} <span className="slot-batch">{b.batch_number}</span></b><i className={full ? "full" : closed ? "" : left <= 3 ? "low" : ""}>{full ? "Full · 24 of 24" : closed ? "Closed" : `${left} of ${b.capacity} left`}</i></li>; })}</ul>
        </div>)}</div>
      </div> : <span className="schedule-status soon">No batch opened yet</span>}
      <p className="slot-foot">{LATE_ENROLLMENT_CODES.includes(c.code) ? "Late enrollment until 7:00 AM on the last training day" : "Enrollment closes 7:00 AM on the training date"}</p>
    </article>; })}{!stcw.length && <p className="portal-empty-copy">No STCW courses match.</p>}</div>}

    {tab === "In-House courses" && <section className="portal-panel">
      <div className="panel-heading"><div><h2>In-House courses</h2><p>Online · trainees pick a start date; training runs on consecutive days, Monday to Saturday</p></div><label className="portal-field-inline">Category<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label></div>
      <div className="portal-table"><table><thead><tr><th>Code</th><th>Course</th><th>Category</th><th>Duration</th><th>Modality</th><th>Fee</th></tr></thead><tbody>{others.filter((c) => !category || (first(c.course_categories)?.name ?? "In-House") === category).map((c) => <tr key={c.id}><td><strong>{c.code}</strong></td><td>{c.name}</td><td>{first(c.course_categories)?.name ?? "In-House"}</td><td>{c.duration_label}</td><td>Online</td><td>{pesos(c.standard_price_centavos)}</td></tr>)}</tbody></table>{!others.length && <p className="portal-empty-copy">No courses.</p>}</div>
    </section>}

    {tab === "Endorsed programs" && <section className="portal-panel">
      <div className="panel-heading"><div><h2>Endorsed programs</h2><p>Offered through partner centers</p></div><label className="portal-field-inline">Partner center<select value={center} onChange={(e) => setCenter(e.target.value)}>{centers.map((c) => <option key={c}>{c}</option>)}{!centers.length && <option value="">None yet</option>}</select></label></div>
      <div className="portal-table"><table><thead><tr><th>Code</th><th>Course</th><th>Duration</th><th>Training fee</th></tr></thead><tbody>{offers.map(({ offer, course }) => <tr key={offer.id}><td><strong>{course?.code}</strong></td><td>{course?.name}</td><td>{offer.duration_label}</td><td>{pesos(offer.training_fee_centavos)}</td></tr>)}</tbody></table>{!offers.length && <p className="portal-empty-copy">No programs for this center.</p>}</div>
    </section>}
  </div>;
}
