"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import type { PortalData, Enrollment, Batch, Trainee } from "../portal-live-app";
import { first, manilaToday, dueCentavos, balanceOf, pesos, pesos2, addDays } from "@/lib/portal-format";
import { LATE_ADD_REASONS, LATE_ENROLLMENT_CODES, PUBLIC_STCW_CODES, automaticEndDate, directBatchChange, fitsInWeek, isLateAddable, lateDayLabel } from "@/lib/scheduling";
import { RegistrationForm } from "../registration-form";
import { askReason } from "./dialogs";
import { isPackageCourse, packageWeeks } from "@/lib/packages";
import { ALL_DATES, Badge, Message, Modal, PageHead, PeriodBar, ViewIcon, useNeedSince, usePaged, usePost, usePeriod, submit, fullName, fmtDate, fmtClock } from "./shared-ui";
import { RequestActionModal, type RequestType } from "./payment-actions";
import { TarButton, WorkRow } from "./live-cashier";
import { InstructionsButton, instructionsCountOf } from "./instructions-window";
import { tcl } from "@/lib/title-case";
import { shrinkProof } from "@/lib/proof-shrink";
import { COMPANY_CHARGE, isEndorsedEnrollment, itemAllowed, sourceLabel } from "@/lib/company-charge";
import { VALIDATION_MESSAGES, isMetaThreadUrl } from "@/lib/validation";

/**
 * Registration Officer workspace (rebuilt Oct 2026 to MASTERPLAN §10 as
 * amended by the July 2026 addendum and the owner's 7 Oct 2026 instruction).
 * Four sidebar modules, in order: Dashboard, Registration, Courses and
 * Instructions. New registrations come only from the website as Pending
 * applications; Registration screens them (three requirements) and hands them
 * to the Cashier. A paid applicant on a batch is enrolled automatically by the
 * server. Registration sends training instructions (no limit, 5 Nov 2026) but
 * never prints the Training Admission Record — the Cashier does. The role reads
 * payment status but never writes a payment; the server actions reachable from
 * here are requirement-check, application-handover, send-instructions and
 * request-raise (application-enroll stays as a fallback), plus the
 * instruction-template actions on the Instructions screen, in the parent.
 */

type RequestRow = PortalData["requests"][number];
/** Opens the Trainee Account from an application window; the portal shell renders it. */
type TraineeAccount = (traineeId: string, onClose: () => void) => ReactNode;

const fmtLong = (v: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${v}T00:00:00+08:00`));
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");
const nameOf = (e: Enrollment) => { const t = first(e.trainees); return t ? fullName(t) : e.enrollment_number; };
/** Request types a Registration Officer may raise (addendum: rescheduling, change of course, cancellation). */
const REG_REQUESTS: RequestType[] = ["Rescheduling", "Change Course", "Make-up Class", "Reprinting", "TAR reprint", "Cancellation"];
/** Button label for each request type a Registration Officer can raise. */
const requestLabel = (type: RequestType, isApplication: boolean) => (type === "Rescheduling" ? "Change batch / reschedule" : type === "Change Course" ? "Change course" : type === "Make-up Class" ? "Make-up class" : type === "Reprinting" ? "Certificate reprint" : type === "TAR reprint" ? "TAR reprint" : isApplication ? "Decline application" : "Cancel");
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
/** A started batch Registration may still add to (late add, owner, 10 Nov 2026): not bookable the normal way, up to its last day. */
const lateBatchesOf = (data: PortalData, courseId: string, today: string, now: string, skip?: string | null) => data.batches.filter((x) => x.course_id === courseId && x.id !== skip && !isBookable(x, today, now) && isLateAddable(x, today, now)).sort((x, y) => x.starts_on.localeCompare(y.starts_on));
const askLateReason = (b: Batch) => askReason(`Batch ${b.batch_number} has started (${lateDayLabel(b.starts_on, b.ends_on, manilaToday())}). Choose the reason for the late add; it is saved in the audit log.`, LATE_ADD_REASONS, { title: "Late Add", okLabel: "Add to Batch" });
/** The Late Add chip, with the reason on hover. */
const LateChip = ({ e }: { e: Enrollment }) => (e.late_add_reason ? <span title={e.late_add_reason}><Badge tone="orange">Late Add</Badge></span> : null);
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

/** The enrollments of one Manila day, with its date picker (owner, 7 Oct 2026). */
export function EnrolledDayPanel({ data, onOpen }: { data: PortalData; onOpen: (e: Enrollment) => void }) {
  const today = manilaToday();
  const [picked, setPicked] = useState(today);
  useNeedSince(picked);
  const rows = enrolledOn(data, picked);
  const paid = rows.reduce((sum, e) => sum + Number(e.verified_paid_centavos ?? e.paid_centavos ?? 0), 0);
  return <section className="portal-panel cx-panel">
    <div className="panel-heading"><h2>Enrollments</h2><button type="button" className="portal-secondary" onClick={() => setPicked(today)} disabled={picked === today}>Today</button></div>
    <div className="rd-datebar nu-pad">
      <button type="button" className="ghost-button" aria-label="Previous Day" onClick={() => setPicked((d) => addDays(d, -1))}>‹</button>
      <input type="date" value={picked} max={today} onChange={(ev) => ev.target.value && setPicked(ev.target.value)} aria-label="Enrollment Date" />
      <button type="button" className="ghost-button" aria-label="Next Day" disabled={picked >= today} onClick={() => setPicked((d) => addDays(d, 1))}>›</button>
      <span className="rd-datesum">{fmtDay(picked)} · {rows.length} Enrolled · {pesos(paid)} Paid</span>
    </div>
    {rows.length ? <div className="portal-table cx-cards nu-table"><table><tbody>{rows.map((e) => <tr key={e.id}>
      <td data-l="" className="lead"><button type="button" className="pv-open" onClick={() => onOpen(e)}><span className="cx-name">{nameOf(e)}</span><span className="cx-id">{appNoOf(data, e.trainee_id) ?? first(e.trainees)?.trainee_number ?? e.enrollment_number}</span></button></td>
      <td data-l="Course">{first(e.courses)?.code ?? "—"}<small>{scheduleOf(e)}</small></td>
      <td data-l="Paid" className="r"><strong className="cx-amt">{pesos(Number(e.verified_paid_centavos ?? e.paid_centavos ?? 0))}</strong></td>
    </tr>)}</tbody></table></div> : <p className="portal-empty-copy">Nobody enrolled on {fmtDay(picked)}.</p>}
  </section>;
}

/** The next bookable batch of each STCW course, with its seats. */
export function StcwSeatsPanel({ seats, go }: { seats: StcwSeat[]; go: (module: string) => void }) {
  return <section className="portal-panel cx-panel">
    <div className="panel-heading"><h2>STCW Seats</h2><button type="button" className="portal-secondary" onClick={() => go("Batch schedules")}>View Schedules</button></div>
    {seats.length ? seats.map(({ course, next }) => { const left = seatsLeft(next); return <div className="nu-seat" key={course.id}>
      <span className="nu-seatname"><b>{course.code}</b><small>{dateRange(next.starts_on, next.ends_on)} · {next.batch_number}</small></span>
      <span className={`nu-meter${left <= 3 ? " low" : ""}`} role="img" aria-label={`${next.confirmed_count} of ${next.capacity} seats taken`}><i style={{ width: `${Math.round((next.confirmed_count / Math.max(1, next.capacity)) * 100)}%` }} /></span>
      <span className="nu-left"><strong className="cx-amt">{left}</strong> Left</span>
    </div>; }) : <p className="portal-empty-copy">No STCW batches open.</p>}
  </section>;
}

/**
 * Registration Dashboard, Design 3 · Work and Classes (owner, 10 Nov 2026): the work on the left as one panel with tabs
 * (Next Up, Screening, No Course or Batch, With the Cashier), 5 rows a page, and Enrolled Today folded under it; on the
 * right, the upcoming classes with their instructions, the STCW seats and the Team: the enrollments each employee
 * handed to the Cashier today, this week or this month. Each step opens the window that already does it.
 */
export function RegistrationDashboard({ data, go, reload, account }: { data: PortalData; go: (module: string) => void; reload: () => Promise<void>; account?: TraineeAccount }) {
  const today = manilaToday(), now = new Date().toISOString(), tomorrow = addDays(today, 1);
  const [tab, setTab] = useState<"next" | "screening" | "setup" | "cashier">("next"), [showEnrolled, setShowEnrolled] = useState(false);
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [open, setOpen] = useState<Enrollment | null>(null);
  const [placing, setPlacing] = useState<Enrollment | null>(null);
  const [assigning, setAssigning] = useState<Trainee | null>(null);
  const [accountOf, setAccountOf] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false), [registered, setRegistered] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const items: NextUpItem[] = [
    ...awaitingCourseOf(data).map((t) => ({ key: t.id, t, step: "Assign", chip: "No Course Yet", tone: "pending", rank: 2, at: t.registered_at ?? "" }) as NextUpItem),
    ...applicationsOf(data).map((e) => ({ key: e.id, e, ...nextUpOf(readinessOf(data, e), !!chargeTo(data, e)), at: e.created_at }) as NextUpItem),
  ];
  const work = items.filter((x) => x.step).sort((a, b) => a.rank - b.rank || a.at.localeCompare(b.at));
  const withCashier = items.filter((x) => !x.step).sort((a, b) => a.at.localeCompare(b.at));
  const setup = work.filter((x) => x.step === "Assign" || x.step === "Choose Batch"), screening = work.filter((x) => !setup.includes(x));
  const lists = { next: work, screening, setup, cashier: withCashier };
  const page = usePaged(lists[tab], 5);
  const current = open ? data.enrollments.find((e) => e.id === open.id) ?? open : null;

  const row = (x: NextUpItem) => { const e = x.e, id = e?.trainee_id ?? x.t?.id, c = e ? first(e.courses) : null; return <WorkRow key={x.key}
    who={<button type="button" className="pv-open" onClick={() => (e ? setOpen(e) : setAssigning(x.t!))}><span className="cx-name">{e ? nameOf(e) : fullName(x.t!)}</span></button>}
    meta={`${appNoOf(data, id) ?? x.t?.trainee_number ?? e?.enrollment_number ?? ""} · ${e ? `${c?.code ?? c?.name ?? "Course"} · ${scheduleOf(e)}` : "Course to Assign"}`}
    mid={<><Badge tone={x.tone}>{x.chip}</Badge>{e && <LateChip e={e} />}</>}
    acts={x.step ? <button type="button" className="portal-primary row-act" data-short={x.step === "Choose Batch" ? "Batch" : undefined} onClick={() => (!e ? setAssigning(x.t!) : x.step === "Choose Batch" ? setPlacing(e) : setOpen(e))}>{x.step}</button> : null} />; };

  const seats = stcwSeatsOf(data, today, now);
  const seatsOpen = seats.reduce((sum, x) => sum + seatsLeft(x.next), 0);
  // Upcoming classes: tomorrow and the next two days, with the instructions still to send.
  const soon = data.batches.filter((x) => x.starts_on >= tomorrow && x.starts_on <= addDays(today, 3) && x.status !== "Cancelled" && !x.partner_offer_id).sort((x, y) => x.starts_on.localeCompare(y.starts_on));
  const classes = soon.map((b) => { const enr = data.enrollments.filter((e) => e.batch_id === b.id && e.enrollment_status === "Enrolled"); return { b, n: enr.length, notSent: enr.filter((e) => instructionsCountOf(data, e) === 0).length }; }).filter((x) => x.n > 0);
  const enrolledToday = enrolledOn(data, today).length;
  const team = data.registrationTeam ?? [], teamMax = Math.max(1, ...team.map((m) => m[period])), teamTotal = team.reduce((s, m) => s + m[period], 0);
  const TABS: [typeof tab, string][] = [["next", "Next Up"], ["screening", "Screening"], ["setup", "No Course or Batch"], ["cashier", "With the Cashier"]];

  return <div className="portal-page cx ac">
    <div className="cx-head">
      <div><span className="portal-eyebrow">{fmtLong(today)}</span><h1>Dashboard</h1></div>
      <span className="bc-foot-actions"><button type="button" className="portal-secondary" onClick={() => go("Trainees")}>Search Trainee</button><button type="button" className="portal-primary" onClick={() => { setRegistered(null); setRegistering(true); }}>Register Trainee</button></span>
    </div>
    {registered && <Message kind={registered.kind} text={registered.text} />}
    {registering && <Modal wide title="Register Trainee" onClose={() => setRegistering(false)}>
      <RegistrationForm staff={{ onDone: (r) => { setRegistering(false); setRegistered({ kind: r.warnings?.length ? "error" : "success", text: `Registered · ${r.applicationNumber ?? r.reference}.${r.warnings?.length ? ` ${r.warnings.join(" ")}` : ""}` }); void reload(); } }} />
    </Modal>}
    <div className="cx-dash">
      <div className="ac-stack">
        <section className="portal-panel cx-panel" id="rd-next">
          <div className="panel-heading"><h2>Work</h2><span className="cx-sum">{work.length} Waiting on You</span></div>
          <div className="cx-tabs" role="tablist">{TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}<b>{lists[k].length}</b></button>)}</div>
          {lists[tab].length ? <div className="wr-list">{page.shown.map(row)}{page.pager}</div> : <p className="portal-empty-copy">{tab === "cashier" ? "Nobody is with the Cashier." : "Nobody is waiting on you."}</p>}
        </section>
        <button type="button" className="pe-fold" aria-expanded={showEnrolled} onClick={() => setShowEnrolled((v) => !v)}><span>Enrolled Today · {enrolledToday}</span><span>{showEnrolled ? "Hide ▴" : "Show ▾"}</span></button>
        {showEnrolled && <EnrolledDayPanel data={data} onOpen={setOpen} />}
      </div>
      <aside className="cx-cashcol" aria-label="Classes and Team">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Upcoming Classes</h2><span className="cx-sum">{classes.reduce((s, x) => s + x.n, 0)} Trainees</span></div>
          {classes.length ? <div className="wr-list">{classes.map(({ b, n, notSent }) => <WorkRow key={b.id} who={<span className="cx-name">{first(b.courses)?.code ?? "Course"} <span className="cx-id">{b.batch_number}</span></span>} meta={`${b.starts_on === tomorrow ? "Tomorrow" : fmtShort(b.starts_on)} · ${n} trainee${n === 1 ? "" : "s"}`}
            mid={notSent ? <Badge tone="orange">{`${notSent} Not Sent`}</Badge> : <Badge tone="active">All Sent</Badge>} acts={notSent ? <button type="button" className="portal-secondary row-act" onClick={() => go("Batch schedules")}>Open</button> : null} />)}</div> : <p className="portal-empty-copy">No classes in the next three days.</p>}
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>STCW Seats · Next Batch</h2><span className="cx-sum">{seatsOpen} Open</span></div>
          <dl className="ac-lines">{seats.map((x) => <div key={x.course.id}><dt>{x.course.code}<small className="cl-sub cl-block">{fmtShort(x.next.starts_on)}</small></dt><dd>{seatsLeft(x.next)} of {x.next.capacity}</dd></div>)}</dl>
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Team · Enrollments</h2>
          <span className="cx-period">{([["today", "Today"], ["week", "This Week"], ["month", "This Month"]] as const).map(([k, label]) => <button key={k} type="button" className={period === k ? "on" : ""} aria-pressed={period === k} onClick={() => setPeriod(k)}>{label}</button>)}</span></div>
          {team.length ? <div className="rd-team">{team.map((m) => <div key={m.id} className="rd-member"><span className="rd-av">{m.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span><div><strong>{m.name}</strong><span className="rd-bar"><i style={{ width: `${Math.round((m[period] / teamMax) * 100)}%` }} /></span></div><b>{m[period]}</b></div>)}
            <div className="rd-member rd-total"><span /><div>Total Enrollments</div><b>{teamTotal}</b></div></div> : <p className="portal-empty-copy">No hand-overs to the Cashier yet this month.</p>}
        </section>
      </aside>
    </div>
    {current && <EnrollmentDrawer data={data} enrollment={current} reload={reload} onClose={() => setOpen(null)} onOpenAccount={account ? () => setAccountOf(current.trainee_id) : undefined} />}
    {accountOf && account?.(accountOf, () => setAccountOf(null))}
    {assigning && <AssignCourseModal data={data} trainee={assigning} reload={reload} onClose={() => setAssigning(null)} />}
    {placing && <ChooseBatchModal data={data} enrollment={placing} reload={reload} onClose={() => setPlacing(null)} />}
  </div>;
}

/* ---------------------------------------------------------------- Screening */

/**
 * The four documents Registration ticks before handing a trainee to the Cashier
 * (owner, 7 Oct 2026). "Other" is an optional, noted extra and never blocks.
 */
export const REQUIREMENTS = [
  { code: "valid_id", label: "Valid ID / passport", short: "Valid ID" },
  { code: "medical_peme", label: "Medical certificate (PEME format)", short: "Medical" },
  { code: "photo_2x2", label: "2x2 photo", short: "2x2 Photo" },
  { code: "seamans_book", label: "Seaman's book / SRN", short: "Seaman's Book" },
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
/**
 * Next Up (owner, 6 Nov 2026): the one thing Registration does next on an
 * application, or no step when it waits on the Cashier. Lower rank comes first.
 */
export function nextUpOf(r: ReturnType<typeof applicationReadiness>, companyCharge = false): { step: string | null; chip: string; tone: string; rank: number } {
  if (r.handed && !r.paid) return { step: null, chip: "With the Cashier", tone: "orange", rank: 9 };
  if (r.ready) return { step: "Open", chip: "Paid · Enrolling", tone: "active", rank: 1 };
  if (r.paid && !r.missing.length) return { step: "Choose Batch", chip: "Paid", tone: "active", rank: 1 };
  if (r.paid) return { step: "Requirements", chip: "Paid · Requirements Missing", tone: "cancelled", rank: 0 };
  const rejected = REQUIREMENTS.filter((x) => r.latest.get(x.code)?.status === "Rejected");
  if (rejected.length) return { step: "Requirements", chip: rejected.length === 1 ? `${rejected[0].short} Rejected` : `${rejected.length} Requirements Rejected`, tone: "cancelled", rank: 0 };
  if (!r.missing.length) return { step: companyCharge ? "Enroll · Company Charge" : "Cashier", chip: "Requirements Complete", tone: "active", rank: 1 };
  return { step: "Requirements", chip: `${r.verified} of ${REQUIREMENTS.length} Requirements`, tone: "pending", rank: 3 };
}
type NextUpItem = ReturnType<typeof nextUpOf> & { key: string; at: string; e?: Enrollment; t?: Trainee };
type StcwSeat = { course: PortalData["courses"][number]; next: Batch };
const stcwSeatsOf = (data: PortalData, today: string, now: string): StcwSeat[] => uniqueCourses(data.courses.filter((x) => x.delivery_type === "In-House" && isStcwCourse(x))).flatMap((course) => { const next = data.batches.filter((x) => x.course_id === course.id && isBookable(x, today, now)).sort((x, y) => x.starts_on.localeCompare(y.starts_on))[0]; return next ? [{ course, next }] : []; });
/** Enrolled on a Manila day (enrolled_at, or the last update for older rows), newest first. */
const enrolledOn = (data: PortalData, d: string) => data.enrollments.filter((e) => e.enrollment_status === "Enrolled" && day(e.enrolled_at ?? e.updated_at ?? e.created_at) === d).sort((a, b) => (b.enrolled_at ?? b.updated_at ?? "").localeCompare(a.enrolled_at ?? a.updated_at ?? ""));
/** Waiting at the Cashier: handed over and not yet paid. */
const forPayment = (r: ReturnType<typeof applicationReadiness>) => r.handed && !r.paid;
const readinessOf = (data: PortalData, e: Enrollment) => applicationReadiness(e, data.requirementChecks ?? [], data.handedToCashier?.[e.id] ?? null);
/** The website enrollment number (NWMTACI-0000001) the applicant quotes on Facebook, if any. */
const appNoOf = (data: PortalData, traineeId?: string | null) => (traineeId ? data.applicationNumbers?.[traineeId] ?? null : null);
const applicationsOf = (data: PortalData) => data.enrollments.filter((e) => e.enrollment_status === "Pending");
/** Website applicants with no course yet — Registration assigns one while screening. */
const awaitingCourseOf = (data: PortalData) => (data.awaitingCourseIds ?? []).map((id) => data.trainees.find((t) => t.id === id)).filter((t): t is Trainee => !!t).sort((a, b) => (b.registered_at ?? "").localeCompare(a.registered_at ?? ""));

/** The three tabs of the Registration list (owner, 7 Oct 2026). */
export const RECORD_FILTERS = ["Screening", "For payment", "Enrolled", "Cancelled", "All enrollments"] as const;
type RecordFilter = (typeof RECORD_FILTERS)[number];
const inFilter = (f: RecordFilter, r: ReturnType<typeof applicationReadiness> | null, status?: string) => (f === "All enrollments" ? true : f === "Enrolled" || f === "Cancelled" ? !r && status === f : !r ? false : f === "For payment" ? forPayment(r) : !forPayment(r));
/** Requirement tags (owner, 10 Nov 2026, Minimal · Letter Tags): received filled, missing dashed, rejected red. No check marks. */
const REQ_TAGS: Record<string, string> = { valid_id: "ID", medical_peme: "MED", photo_2x2: "2X2", seamans_book: "SRN" };

const NO_BATCH = "none";

const tileMonth = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", timeZone: "Asia/Manila" }).format(new Date(`${iso}T00:00:00+08:00`)).toUpperCase();
const weekdayOf = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "Asia/Manila" }).format(new Date(`${iso}T00:00:00+08:00`));
const closesAt = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));

/**
 * Batch cards ("Schedule picker" design 01): a date tile, the day pattern and
 * dates, batch number with room and instructor, and a seat meter that turns
 * orange when nearly full. The "No batch yet" card is optional.
 */
export function BatchCards({ data, batches, selected, onSelect, allowNone, late = [] }: { data: PortalData; batches: Batch[]; selected: string; onSelect: (id: string) => void; allowNone?: boolean; late?: Batch[] }) {
  const today = manilaToday();
  const staffing = new Map((data.batchStaffing ?? []).map((x) => [x.batch_id, x]));
  return <div className="bc-list" role="radiogroup" aria-label="Batch">
    <div className="bc-head"><b>Choose a Batch</b><span>{batches.length ? `${batches.length} open · 24 seats each` : "No open batch for this course yet"}</span></div>
    {[...batches, ...late].map((x, i) => {
      const left = seatsLeft(x), on = selected === x.id, low = left <= 3, st = staffing.get(x.id);
      const days = x.starts_on === x.ends_on ? weekdayOf(x.starts_on) : `${weekdayOf(x.starts_on)}–${weekdayOf(x.ends_on)}`;
      return <Fragment key={x.id}>{i === batches.length && <div className="bc-head bc-late-h"><b>Started: Late Add</b><span>Open to Registration until the last day · a reason is required</span></div>}<button type="button" role="radio" aria-checked={on} className={`bc-card${on ? " on" : ""}${late.includes(x) ? " bc-late" : ""}`} onClick={() => onSelect(x.id)}>
        <span className="bc-radio" aria-hidden="true" />
        <span className="bc-tile"><small>{tileMonth(x.starts_on)}</small><b>{Number(x.starts_on.slice(8, 10))}</b></span>
        <span className="bc-main"><b>{days} · {dateRange(x.starts_on, x.ends_on)}</b><small>{x.batch_number} · {st?.room_name ?? x.venue ?? "Room not set"} · {st?.instructor_name ?? "Instructor not assigned"}</small></span>
        <span className="bc-seats"><span><b className={low ? "low" : ""}>{left} of {x.capacity} left</b><small>{late.includes(x) ? lateDayLabel(x.starts_on, x.ends_on, today) : closesAt(x.enrollment_deadline)}</small></span><span className="bc-meter"><i className={low ? "low" : ""} style={{ width: `${Math.round(((x.capacity - left) / Math.max(1, x.capacity)) * 100)}%` }} /></span></span>
      </button></Fragment>;
    })}
    {allowNone && <button type="button" role="radio" aria-checked={selected === NO_BATCH} className={`bc-card bc-none${selected === NO_BATCH ? " on" : ""}`} onClick={() => onSelect(NO_BATCH)}>
      <span className="bc-radio" aria-hidden="true" />
      <span className="bc-main"><b>No Batch Yet — Place Later</b><small>{batches.length ? "Screen and take payment now; choose the batch from the application later." : "Screen and take payment now; place on a batch once one opens."}</small></span>
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
  // Other STCW Courses (owner, 20 Oct 2026): courses a partnered center offers; the center sets the fee.
  const otherCourses = uniqueCourses(data.courses.filter((c) => c.delivery_type === "Partner or Endorsed" && data.offers.some((o) => o.course_id === c.id))).sort((x, y) => x.name.localeCompare(y.name));
  const otherCourse = otherCourses.find((c) => c.id === courseId);
  const centers = otherCourse ? data.offers.filter((o) => o.course_id === otherCourse.id) : [];
  const [offerId, setOfferId] = useState(""), [otherDate, setOtherDate] = useState("");
  const offer = centers.find((o) => o.id === offerId);
  const batches = data.batches.filter((x) => x.course_id === courseId && isBookable(x, today, now)).sort((x, y) => x.starts_on.localeCompare(y.starts_on));
  const late = courseId ? lateBatchesOf(data, courseId, today, now) : [];
  const lateBatch = late.find((x) => x.id === batchId);
  const course = courses.find((c) => c.id === courseId);
  const withBatch = batchId !== NO_BATCH;
  // Non-STCW in-house courses run on a picked start date (Sundays skipped,
  // consecutive within the week) instead of a batch.
  const [startDate, setStartDate] = useState("");
  const dated = !!course && !isStcwCourse(course) && !batches.length && !late.length;
  // Backdating is allowed (owner, 13 Oct 2026): a course already held can be recorded on its real dates.
  const dateOk = !startDate || fitsInWeek(startDate, course?.duration_label ?? "1");
  // CCI Package (owner, 21 Oct 2026): pick a week; the week's Safety, Crowd and Crisis batches are taken together.
  const isPackage = !!course && isPackageCourse(course.code);
  const codeOf = new Map(data.courses.map((c) => [c.id, c.code]));
  const weeks = isPackage ? packageWeeks(data.batches.filter((x) => x.starts_on >= today).map((x) => ({ code: codeOf.get(x.course_id) ?? "", startsOn: x.starts_on, full: !isBookable(x, today, now) }))) : [];
  const [week, setWeek] = useState("");
  // Referral per course (owner, 3 Nov 2026): the new course does not inherit an earlier course's partner.
  const [src, setSrc] = useState("Walk-in"), [srcPartner, setSrcPartner] = useState("");
  const srcBody = { source: src, agencyId: src === "Agency" ? srcPartner || null : null };
  const srcPartners = data.agencies.filter((a) => a.active).sort((a, z) => a.name.localeCompare(z.name));
  const assignPackage = () => void post({ action: "package-assign", traineeId: trainee.id, weekStart: week, ...srcBody }, "CCI Package assigned: Safety, Crowd and Crisis seats held. Screening can start.").then(onClose).catch(() => undefined);
  const assignLate = async (b: Batch) => { const reason = await askLateReason(b); if (!reason) return; await post({ action: "application-late-add", traineeId: trainee.id, courseId, batchId: b.id, reason, ...srcBody }, `Added late to Batch ${b.batch_number}. The reason is saved.`).then(onClose).catch(() => undefined); };
  const assign = () => lateBatch ? void assignLate(lateBatch) : isPackage ? assignPackage() : otherCourse ? void post({ action: "application-assign", traineeId: trainee.id, courseId, batchId: null, offerId: offerId && otherDate ? offerId : null, scheduledOn: offerId && otherDate ? otherDate : null, ...srcBody }, offerId && otherDate ? "Other STCW course, center and date assigned. Screening can start." : "Other STCW course assigned. Set the training center and date in the record.").then(onClose).catch(() => undefined) : void post({ action: "application-assign", traineeId: trainee.id, courseId, batchId: withBatch ? batchId : null, scheduledOn: dated && startDate ? startDate : null, ...srcBody }, withBatch ? "Course and batch assigned. Screening can start." : dated && startDate ? "Course and start date assigned. Screening can start." : "Course assigned. Screening can start; place on a batch once one opens.").then(onClose).catch(() => undefined);
  return <Modal title={`Assign a course · ${fullName(trainee)}`} onClose={onClose}>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      <label className="full">Course<select value={courseId} onChange={(e) => { setCourseId(e.target.value); setBatchId(NO_BATCH); setOfferId(""); }}>
        <option value="">Select a Course</option>
        <optgroup label="STCW Courses">{courses.filter(isStcwCourse).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} · {pesos(c.standard_price_centavos)}</option>)}</optgroup>
        {otherCourses.length > 0 && <optgroup label="Other STCW Courses">{otherCourses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</optgroup>}
        <optgroup label="Other Courses">{courses.filter((c) => !isStcwCourse(c)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} · {pesos(c.standard_price_centavos)}</option>)}</optgroup>
      </select></label>
      {otherCourse && <>
        <label>Training Center<select value={offerId} onChange={(e) => setOfferId(e.target.value)}><option value="">Choose the center</option>{centers.map((o) => <option key={o.id} value={o.id}>{first(o.partner_centers)?.name ?? "Partnered center"} · {pesos(Number(o.training_fee_centavos))} · {o.duration_label}</option>)}</select></label>
        <label>Training Date<input type="date" value={otherDate} onChange={(e) => setOtherDate(e.target.value)} /></label>
        <p className="portal-form-note full">{offer ? `Fee to collect: ${pesos(Number(offer.training_fee_centavos))}.` : "You can also set the center and date later in the record."}</p>
      </>}
      {isPackage && <label className="full">Week<select value={week} onChange={(e) => setWeek(e.target.value)}><option value="">Choose a week</option>{weeks.map((w) => <option key={w.monday} value={w.monday} disabled={w.full}>{fmtDate(w.monday)} – {fmtDate(w.ends)}{w.full ? " · Full" : ""}</option>)}</select></label>}
      {isPackage && !weeks.length && <p className="portal-form-note full">No week has open Safety, Crowd and Crisis batches yet.</p>}
      {course && !dated && !isPackage && <div className="full"><BatchCards data={data} batches={batches} late={late} selected={batchId} onSelect={setBatchId} allowNone /></div>}
      {dated && course && <label className="full">Start Date (Optional)<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /><small style={{ color: dateOk ? "var(--muted)" : "var(--red, #b42318)" }}>{!startDate ? `${course.duration_label} · Monday to Saturday, consecutive days in one week. Leave empty to set later.` : dateOk ? `${startDate < today ? "Backdated · ran" : "Runs"} ${fmtDate(startDate)} to ${fmtDate(automaticEndDate(startDate, course.duration_label))}` : "Pick a date that is not a Sunday and lets the course finish by Saturday of the same week."}</small></label>}
      {courseId && <div className="full tp"><div className="tp-source"><span className="tp-cap">Where the Trainee Came From · This Course</span>
        <label><span>Source</span><select value={src} onChange={(ev) => setSrc(ev.target.value)}><option value="Walk-in">Walk-In</option><option value="Online enrollment">Online</option><option value="Agency">Agency / Consultancy</option></select></label>
        {src === "Agency" && <label><span>Partner</span><select value={srcPartner} onChange={(ev) => setSrcPartner(ev.target.value)}><option value="">Choose the partner…</option>{(["Agency", "Consultancy"] as const).map((k) => { const list = srcPartners.filter((a) => (a.kind === "Consultancy" ? "Consultancy" : "Agency") === k); return list.length ? <optgroup key={k} label={k === "Agency" ? "Agencies" : "Consultancies"}>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup> : null; })}</select></label>}
      </div></div>}
      <div className="bc-foot full"><span>{otherCourse ? `${otherCourse.code} · Other STCW${offer ? ` · ${first(offer.partner_centers)?.name ?? ""} · fee ${pesos(Number(offer.training_fee_centavos))}` : " · center not set yet"}` : course ? (withBatch ? batchSummary(data, batches.find((x) => x.id === batchId) ?? lateBatch) : `${course.code} · fee ${pesos(course.standard_price_centavos)} · no batch yet`) : "Choose a course first."}</span><span className="bc-foot-actions"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={!courseId || busy || (isPackage && !week) || (!otherCourse && !dateOk) || (!!offerId !== !!otherDate && !!otherCourse) || (src === "Agency" && !srcPartner)} onClick={assign}>{busy ? "Assigning…" : isPackage ? "Assign CCI Package" : withBatch ? "Assign Course and Batch" : "Assign Course"}</button></span></div>
    </div>
  </Modal>;
}

/** Put a Pending application that has no batch yet onto an open batch of its course. */
/** Choose Batch for an application without one; with `change`, Change Schedule for an enrollment with no payment yet (owner, 9 Nov 2026). */
function ChooseBatchModal({ data, enrollment, reload, onClose, change = false }: { data: PortalData; enrollment: Enrollment; reload: () => Promise<void>; onClose: () => void; change?: boolean }) {
  const { busy, msg, post } = usePost(reload);
  const [batchId, setBatchId] = useState("");
  const today = manilaToday(), now = new Date().toISOString();
  const batches = data.batches.filter((x) => x.course_id === enrollment.course_id && x.id !== enrollment.batch_id && isBookable(x, today, now)).sort((x, y) => x.starts_on.localeCompare(y.starts_on));
  // Late add only places an application without a batch; a schedule change keeps its own rules.
  const late = change ? [] : lateBatchesOf(data, enrollment.course_id, today, now, enrollment.batch_id);
  const lateBatch = late.find((x) => x.id === batchId);
  const placeLate = async (b: Batch) => { const reason = await askLateReason(b); if (!reason) return; await post({ action: "application-late-add", enrollmentId: enrollment.id, batchId: b.id, reason }, `Added late to Batch ${b.batch_number}. The reason is saved.`).then(onClose).catch(() => undefined); };
  const place = () => lateBatch ? void placeLate(lateBatch) : void (change
    ? post({ action: "registration-change-batch", enrollmentId: enrollment.id, batchId }, `Schedule changed to Batch ${batches.find((x) => x.id === batchId)?.batch_number ?? ""}.`)
    : post({ action: "application-place-batch", enrollmentId: enrollment.id, batchId }, "Placed on the batch.")).then(onClose).catch(() => undefined);
  return <Modal title={`${change ? "Change Schedule" : "Choose Batch"} · ${first(enrollment.courses)?.name ?? "Course"}`} onClose={onClose}>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      <div className="full"><BatchCards data={data} batches={batches} late={late} selected={batchId} onSelect={setBatchId} /></div>
      {!batches.length && !late.length && <p className="portal-form-note full">The application stays ready; place it once a batch opens.</p>}
      <div className="bc-foot full"><span>{batchSummary(data, batches.find((x) => x.id === batchId) ?? lateBatch) || "Choose a batch."}</span><span className="bc-foot-actions"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={!batchId || busy} onClick={place}>{busy ? (change ? "Saving…" : "Placing…") : change ? "Save Schedule" : "Place on Batch"}</button></span></div>
    </div>
  </Modal>;
}

/**
 * Every enrollment in one list with three tabs: All enrollments, Screening
 * (Pending applications Registration is working on, including paid ones that
 * still need a batch) and For payment (handed to the Cashier, not yet paid).
 * Applicants without a course sit above the table under All and Screening.
 */
function EnrollmentQueue({ data, query, reload, initial, account }: { data: PortalData; query: string; reload: () => Promise<void>; initial: RecordFilter; account?: TraineeAccount }) {
  const [accountOf, setAccountOf] = useState<string | null>(null);
  const [filter, setFilter] = useState<RecordFilter>(initial);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Enrollment | null>(null);
  const [assigning, setAssigning] = useState<Trainee | null>(null);
  const term = (q || query).trim().toLowerCase();
  // Applications still to work on always show; enrolled and cancelled records wait for a date (owner, 5 Nov 2026). A search looks across all dates.
  const per = usePeriod();
  useNeedSince(term ? ALL_DATES : "");
  const all = data.enrollments.filter((e) => term || e.enrollment_status === "Pending" || per.inRange(e.created_at)).map((e) => ({ e, r: e.enrollment_status === "Pending" ? readinessOf(data, e) : null }));
  const awaiting = awaitingCourseOf(data);
  const noCourse = awaiting.filter((t) => !term || `${fullName(t)} ${t.trainee_number} ${appNoOf(data, t.id) ?? ""} ${t.email} ${t.mobile}`.toLowerCase().includes(term));
  const rank = (x: (typeof all)[number]) => (x.r ? 0 : x.e.enrollment_status === "Cancelled" ? 2 : 1);
  const rows = all
    .filter((x) => inFilter(filter, x.r, x.e.enrollment_status))
    .filter(({ e }) => !term || `${nameOf(e)} ${e.enrollment_number} ${appNoOf(data, e.trainee_id) ?? ""} ${first(e.courses)?.name ?? ""} ${first(e.courses)?.code ?? ""} ${first(e.trainees)?.trainee_number ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => rank(a) - rank(b) || b.e.created_at.localeCompare(a.e.created_at));
  const paged = usePaged(rows), pageRows = paged.shown;
  const current = open ? data.enrollments.find((e) => e.id === open.id) ?? open : null;
  const withCourse = filter === "Screening" || filter === "All enrollments";
  const count = (f: RecordFilter) => all.filter((x) => inFilter(f, x.r, x.e.enrollment_status)).length + (f === "Screening" || f === "All enrollments" ? awaiting.length : 0);
  const dated = filter === "Enrolled" || filter === "Cancelled" || filter === "All enrollments";
  const pending = all.filter((x) => x.r);
  const label = (f: RecordFilter) => tcl(f);
  /** Status with the payment folded in: "Paid · Enrolling · ₱1,000", "Company Charge", "Enrolled". */
  const statusOf = (e: Enrollment, r: ReturnType<typeof applicationReadiness> | null) => {
    if (e.enrollment_status !== "Cancelled" && chargeTo(data, e)) return <Badge tone="pending">{`Company Charge · ${chargeTo(data, e)!.name}`}</Badge>;
    if (!r) return <Badge tone={e.enrollment_status === "Cancelled" ? "cancelled" : "active"}>{e.enrollment_status}</Badge>;
    const s = stateOf(r);
    return <Badge tone={s.tone}>{`${tcl(s.text)}${r.paid ? ` · ${pesos(r.paidCentavos)}` : ""}`}</Badge>;
  };
  const tags = (r: ReturnType<typeof applicationReadiness>) => <span className="rq-tags">{REQUIREMENTS.map((req) => { const st = r.latest.get(req.code)?.status; return <span key={req.code} title={`${req.label}: ${st === "Verified" ? "Received" : st === "Rejected" ? "Rejected" : "Not yet"}`} className={`rq-tag${st === "Verified" ? " got" : st === "Rejected" ? " bad" : ""}`}>{REQ_TAGS[req.code]}</span>; })}</span>;
  return <>
    {/* Minimal · Letter Tags (owner, 10 Nov 2026): one tools line, a Show dropdown with the counts, five columns. */}
    <div className="rq-tools">
      <input className="vx-search" aria-label="Search enrollments" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, NWMTACI number, SRN or course" />
      <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as RecordFilter)}>{RECORD_FILTERS.map((f) => <option key={f} value={f}>{`Show: ${label(f)} (${count(f)})`}</option>)}</select>
    </div>
    {dated && <div className="portal-panel rq-period">{term ? <p className="pd-label pd-pad">Searching all dates · {rows.length} found</p> : <PeriodBar p={per} what="Enrolled" count={`${rows.length} enrollment${rows.length === 1 ? "" : "s"}`} waitText="Pick a date to show enrolled and cancelled records." />}</div>}
    <div className="portal-panel rq-panel"><div className="rq-wrap"><table className="rq-table"><colgroup><col style={{ width: "32%" }} /><col /><col style={{ width: 190 }} /><col style={{ width: 260 }} /><col style={{ width: 150 }} /></colgroup>
      <thead><tr><th>Trainee</th><th>Course · Schedule</th><th>Requirements</th><th>Status</th><th className="r">Action</th></tr></thead><tbody>
      {withCourse && paged.offset === 0 && noCourse.map((t) => <tr key={t.id}>
        <td><strong>{fullName(t)}</strong> <span className="rq-no">{appNoOf(data, t.id) ?? t.trainee_number}</span></td>
        <td className="muted-text">No course yet · registered {t.registered_at ? fmtShort(day(t.registered_at)) : ""}</td><td></td>
        <td><Badge tone="orange">No Course Yet</Badge></td>
        <td className="r"><button type="button" className="portal-primary row-act" onClick={() => setAssigning(t)}>Assign</button></td></tr>)}
      {pageRows.map(({ e, r }) => { const t = first(e.trainees), c = first(e.courses), type = enrollmentTypeOf(data, e), step = r ? nextUpOf(r, !!chargeTo(data, e)).step : null; return <tr key={e.id} title={e.enrollment_number}>
        <td><button type="button" className="pv-open rq-name" onClick={() => setOpen(e)}><strong>{t ? fullName(t) : "Unknown"}</strong> <span className="rq-no">{appNoOf(data, e.trainee_id) ?? e.enrollment_number}</span></button>{type && <span className="et-chip">{type}</span>}</td>
        <td>{c?.code ?? c?.name ?? "—"} <span className="muted-text">· {scheduleOf(e)}</span><span className="rq-enr">{e.enrollment_number}</span></td>
        <td>{r ? tags(r) : <span className="muted-text">{e.enrollment_status === "Cancelled" ? "—" : "Complete"}</span>}</td>
        <td>{statusOf(e, r)}</td>
        <td className="r"><button type="button" className={step && step !== "Open" ? "portal-primary row-act" : "portal-secondary row-act"} onClick={() => setOpen(e)}>{step ?? "Open"}</button></td></tr>; })}
      </tbody></table></div>
      {!rows.length && !(withCourse && noCourse.length) && <p className="portal-empty-copy">{filter === "For payment" ? "Nobody is waiting at the Cashier." : filter === "Screening" ? "No applications to screen. New ones arrive from the website." : term ? "No matching enrollments." : dated && !per.picked ? "Pick a date to show enrolled and cancelled records." : "No enrollments in this range."}</p>}
      {paged.pager}
    </div>
    {pending.length > 0 && <p className="rq-totals">Requirements · {REQUIREMENTS.map((req) => `${req.short} ${pending.filter((x) => x.r!.latest.get(req.code)?.status === "Verified").length}/${pending.length}`).join(" · ")}</p>}
    {current && <EnrollmentDrawer data={data} enrollment={current} reload={reload} onClose={() => setOpen(null)} onOpenAccount={account ? () => setAccountOf(current.trainee_id) : undefined} />}
    {accountOf && account?.(accountOf, () => setAccountOf(null))}
    {assigning && <AssignCourseModal data={data} trainee={assigning} reload={reload} onClose={() => setAssigning(null)} />}
  </>;
}

/* -------------------------------------------------------------- Registration */

/** Enrollment type (8 Oct 2026): Online enrollment, Walk-in, or Agency with the partner's name. */
/** Where the trainee came from (owner, 29 Oct 2026): Online (Meta included), Walk-In, or the agency or consultancy, plus Company Charge. */
export function partnerOf(data: PortalData, e: Enrollment) {
  const agencyId = data.companyCharge?.[e.id] ?? data.referralByEnrollment?.[e.id];
  return agencyId ? data.agencies.find((a) => a.id === agencyId) ?? null : null;
}
export const chargeTo = (data: PortalData, e: Enrollment) => { const p = partnerOf(data, e); return p && (data.companyCharge?.[e.id] || p.rebate_mode === COMPANY_CHARGE) ? p : null; };
function enrollmentTypeOf(data: PortalData, e: Enrollment) {
  const label = sourceLabel(e.source, partnerOf(data, e));
  return chargeTo(data, e) ? `${label} · Company Charge` : label;
}

/**
 * Where the trainee came from (owner, 29 Oct 2026): Registration picks it, the website no
 * longer asks. Agency / Consultancy opens a partner dropdown; the server locks it once paid.
 */
/** Registration records the Meta conversation in the Trainee Account (owner, 4 Nov 2026), before the hand-over; saves on blur or Enter. */
export function MetaThreadField({ traineeId, saved, onSaved }: { traineeId: string; saved: string; onSaved: (url: string) => void }) {
  const [v, setV] = useState(saved), [saving, setSaving] = useState(false), [err, setErr] = useState("");
  const value = v.trim(), good = isMetaThreadUrl(value), dirty = value !== saved;
  const save = async () => {
    if (!dirty || !good || saving) return;
    setSaving(true); setErr("");
    try { const r = await submit({ action: "trainee-facebook", traineeId, url: value }) as { url?: string }; const url = r.url ?? value; setV(url); onSaved(url); }
    catch (x) { setErr(x instanceof Error ? x.message : "Not saved."); }
    finally { setSaving(false); }
  };
  const hint = err || (!value ? "Paste the link of the conversation with the trainee." : !good ? VALIDATION_MESSAGES.metaThread : saving ? "Saving…" : dirty ? "Press Enter or click outside the box to save." : "✓ Saved to the trainee record");
  const tone = err || (value && !good) ? "bad" : value && !dirty ? "ok" : "";
  return <label className="tp-fb"><span>Meta Thread Link (Required)</span>
    <input className={tone} value={v} inputMode="url" placeholder="https://business.facebook.com/latest/inbox/…" onChange={(ev) => { setV(ev.target.value); setErr(""); }} onBlur={() => void save()} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); void save(); } }} />
    <small className={tone}>{hint}</small></label>;
}

/**
 * Referral Design 01 (owner, 3 Nov 2026): the source is set right in each course row of the Trainee Account.
 * Paid or Company Charge courses are locked; picking Agency / Consultancy asks for the partner.
 */
export function CourseSourceCell({ data, enrollment: e, busy, post }: { data: PortalData; enrollment: Enrollment; busy: boolean; post: (body: Record<string, unknown>, successText?: string) => Promise<unknown> }) {
  const current = partnerOf(data, e);
  const label = sourceLabel(e.source, current) || "Online";
  const locked = Number(e.paid_centavos ?? 0) > 0 || !!data.companyCharge?.[e.id] || e.enrollment_status === "Cancelled";
  const initial = current ? "Agency" : e.source === "Walk-in" ? e.source : "Online enrollment";
  const [src, setSrc] = useState(initial);
  if (locked) return <span className="cs-chip-wrap"><span className={`cs-chip ${current ? "ag" : "wk"}`}>{label}</span><small className="muted-text">Locked</small></span>;
  const partners = data.agencies.filter((a) => a.active || a.id === current?.id).sort((a, z) => a.name.localeCompare(z.name));
  const save = (source: string, agencyId: string | null = null) => void post({ action: "enrollment-source", traineeId: e.trainee_id, enrollmentId: e.id, source, agencyId }, `Source saved for ${first(e.courses)?.code ?? "this course"}.`).catch(() => setSrc(initial));
  return <span className="cs-edit" onClick={(ev) => ev.stopPropagation()}>
    <select value={src} disabled={busy} aria-label={`Source of ${first(e.courses)?.code ?? "this course"}`} onChange={(ev) => { const v = ev.target.value; setSrc(v); if (v !== "Agency") save(v); }}>
      <option value="Walk-in">Walk-In</option><option value="Online enrollment">Online</option><option value="Agency">Agency / Consultancy</option>
    </select>
    {src === "Agency" && <select value={current?.id ?? ""} disabled={busy} aria-label="Partner" onChange={(ev) => { if (ev.target.value) save("Agency", ev.target.value); }}>
      <option value="">Choose the partner…</option>
      {(["Agency", "Consultancy", "Freelance"] as const).map((k) => { const list = partners.filter((a) => (a.kind === "Consultancy" ? "Consultancy" : a.kind === "Freelance" ? "Freelance" : "Agency") === k); return list.length ? <optgroup key={k} label={k === "Agency" ? "Agencies" : k === "Freelance" ? "Freelance" : "Consultancies"}>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup> : null; })}
    </select>}
  </span>;
}

export function SourcePicker({ data, enrollment: e, busy, post }: { data: PortalData; enrollment: Enrollment; busy: boolean; post: (body: Record<string, unknown>, successText?: string) => Promise<unknown> }) {
  const current = partnerOf(data, e);
  const initial = current ? "Agency" : e.source === "Walk-in" ? e.source : "Online enrollment";
  const [src, setSrc] = useState(initial);
  const partners = data.agencies.filter((a) => a.active || a.id === current?.id).sort((a, z) => a.name.localeCompare(z.name));
  const save = (source: string, agencyId: string | null = null) => void post({ action: "enrollment-source", traineeId: e.trainee_id, enrollmentId: e.id, source, agencyId }, "Source saved for this course.").catch(() => setSrc(initial));
  return <div className="tp-source">
    <span className="tp-cap">Where the Trainee Came From · {first(e.courses)?.code ?? "This Course"}</span>
    <label><span>Source</span><select value={src} disabled={busy} onChange={(ev) => { const v = ev.target.value; setSrc(v); if (v !== "Agency") save(v); }}>
      <option value="Online enrollment">Online</option><option value="Walk-in">Walk-In</option><option value="Agency">Agency / Consultancy</option>
    </select></label>
    {src === "Agency" && <label><span>Partner</span><select value={current?.id ?? ""} disabled={busy} onChange={(ev) => { if (ev.target.value) save("Agency", ev.target.value); }}>
      <option value="">Choose the partner…</option>
      {(["Agency", "Consultancy", "Freelance"] as const).map((k) => { const list = partners.filter((a) => (a.kind === "Consultancy" ? "Consultancy" : a.kind === "Freelance" ? "Freelance" : "Agency") === k); return list.length ? <optgroup key={k} label={k === "Agency" ? "Agencies" : k === "Freelance" ? "Freelance" : "Consultancies"}>{list.map((a) => <option key={a.id} value={a.id}>{a.name}{a.rebate_mode === COMPANY_CHARGE ? " · Company Charge" : ""}</option>)}</optgroup> : null; })}
    </select></label>}
  </div>;
}

/** "applications" opens the list on Screening, "enrollments" on All enrollments. */
export type RecordsView = "applications" | "enrollments" | "trainees";

/**
 * One sidebar tab for the people side of registration: the enrollment list
 * (All enrollments · Screening · For payment) and the trainee master records,
 * which live in the parent with their detail modal and so arrive as an element.
 */
export function RegistrationRecords({ data, query, reload, view, setView, trainees, account }: { data: PortalData; query: string; reload: () => Promise<void>; view: RecordsView; setView: (v: RecordsView) => void; trainees: ReactNode; account?: TraineeAccount }) {
  const onList = view !== "trainees";
  const tabs: [RecordsView, string, boolean][] = [["enrollments", "Enrollments", onList], ["trainees", "Trainees", !onList]];
  const weekAgo = addDays(manilaToday(), -6);
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Registration</span><h1>{onList ? "Enrollments" : "Trainees"}</h1></div></div>
    <div className="rr-switch" role="tablist" aria-label="Records">
      {tabs.map(([v, label, on]) => <button key={v} type="button" role="tab" aria-selected={on} className={on ? "active" : ""} onClick={() => setView(v)}>{tcl(label)}</button>)}
    </div>
    {onList && <EnrollmentQueue key={view} data={data} query={query} reload={reload} initial={view === "applications" ? "Screening" : "All enrollments"} account={account} />}
    {view === "trainees" && <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Trainee Records</h2></div>
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
function ScreeningPanel({ data, enrollment: e, busy, post, reload, onOpenAccount }: { data: PortalData; enrollment: Enrollment; busy: boolean; post: (body: Record<string, unknown>, successText?: string) => Promise<Record<string, unknown>>; reload: () => Promise<void>; onOpenAccount?: () => void }) {
  const [unticking, setUnticking] = useState<string | null>(null), [changing, setChanging] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Ticks show at once and save in the background (owner, 20 Oct 2026: ticking was slow);
  // one portal refresh follows the last save instead of one per tick.
  const [opt, setOpt] = useState<Record<string, { status: "Verified" | "Rejected"; remarks?: string }>>({});
  const [saving, setSaving] = useState<Record<string, true>>({});
  const [tickError, setTickError] = useState("");
  const inFlight = useRef(0), refresh = useRef<number | undefined>(undefined);
  const r = readinessOf(data, e);
  const s = stateOf(r);
  const statusOf = (code: string) => opt[code]?.status ?? r.latest.get(code)?.status;
  const missingNow = REQUIREMENTS.filter((q) => statusOf(q.code) !== "Verified");
  const allTicked = missingNow.length === 0, anySaving = Object.keys(saving).length > 0;
  const t = first(e.trainees), c = first(e.courses), b = first(e.batches);
  const appNo = appNoOf(data, e.trainee_id) ?? e.enrollment_number;
  const billTo = chargeTo(data, e);
  // Hand to Cashier with the mode of payment (owner, 29 Oct 2026): Cash goes in one click;
  // GCash and other channels needing a reference upload the proof first (Drive only).
  const payModes = data.paymentMethods.filter((m) => m.active && (m.kind ?? "receivable") === "receivable");
  const [payMode, setPayMode] = useState(billTo ? COMPANY_CHARGE : payModes.find((m) => m.name === "Cash")?.name ?? payModes[0]?.name ?? "Cash");
  // Company Charge (owner, 29 Oct 2026): Registration picks the company; no Cashier, no receipt, just the TAR.
  const [ccAgency, setCcAgency] = useState(billTo?.id ?? partnerOf(data, e)?.id ?? "");
  const isCC = payMode === COMPANY_CHARGE, ccName = data.agencies.find((a) => a.id === ccAgency)?.name ?? "";
  const companies = data.agencies.filter((a) => a.active || a.id === ccAgency).sort((a, z) => a.name.localeCompare(z.name));
  const [payAmount, setPayAmount] = useState(""), [payRef, setPayRef] = useState(""), [payFile, setPayFile] = useState<File | null>(null);
  const [handing, setHanding] = useState(false), [payError, setPayError] = useState("");
  const needsProof = !!payModes.find((m) => m.name === payMode)?.requires_reference;
  const proofReady = !needsProof || (Number(payAmount) > 0 && payRef.trim().length >= 3 && !!payFile);
  // The Meta thread link is required before the hand-over or Company Charge (owner, 4 Nov 2026).
  const fbSaved = data.traineeFacebook?.[e.trainee_id] ?? "";
  const threadNote = <small>Add the Meta thread link in the Trainee Account{onOpenAccount && <> · <button type="button" className="cx-textbtn" onClick={onOpenAccount}>Open Trainee Account</button></>}</small>;
  // Items to Collect (owner, 10 Nov 2026, Design 2): Uniform and any other Miscellaneous item in the Schedule of Fees, ticked here,
  // wait as unpaid charges and the Cashier collects them. Nothing is ticked until the trainee asks for it.
  const endorsed = isEndorsedEnrollment(e, data.courses.find((c) => c.id === e.course_id)?.delivery_type);
  const itemList = data.charges.filter((c) => c.active && c.kind === "item" && Number(c.default_amount_centavos) > 0 && itemAllowed(c.name, endorsed)).sort((a, z) => Number(/uniform/i.test(z.name)) - Number(/uniform/i.test(a.name)) || a.name.localeCompare(z.name));
  const [items, setItems] = useState<Record<string, number>>({});
  const itemsTotal = itemList.reduce((s, c) => s + Number(c.default_amount_centavos) * (items[c.id] ?? 0), 0);
  const setQty = (id: string, q: number) => setItems((cur) => ({ ...cur, [id]: Math.max(0, Math.min(10, q)) }));
  async function handOver() {
    setPayError(""); setHanding(true);
    try {
      if (needsProof && payFile) await uploadTraineeProof(e.trainee_id, { mode: payMode, amount: payAmount, reference: payRef, file: payFile });
      const chosen = itemList.filter((c) => (items[c.id] ?? 0) > 0).map((c) => ({ chargeCatalogId: c.id, quantity: items[c.id] }));
      await post({ action: "application-handover", enrollmentId: e.id, ...(chosen.length ? { items: chosen } : {}) }, needsProof ? `Proof saved to Google Drive and handed to the Cashier (${payMode}).` : "Handed to the Cashier for payment (Cash).");
    } catch (err) { setPayError(err instanceof Error ? err.message : "Could not hand to the Cashier."); }
    finally { setHanding(false); }
  }
  const balance = balanceOf(e);
  const check = (requirement: string, status: "Verified" | "Rejected", label: string, note?: string) => {
    const text = note ?? (status === "Rejected" ? remarks.trim() : undefined);
    setOpt((o) => ({ ...o, [requirement]: { status, remarks: text } })); setSaving((v) => ({ ...v, [requirement]: true })); setTickError("");
    setUnticking(null); setRemarks(""); setNotes((n) => ({ ...n, [requirement]: "" }));
    inFlight.current += 1;
    void submit({ action: "requirement-check", enrollmentId: e.id, requirement, status, remarks: text })
      .catch((err: unknown) => { setOpt((o) => { const n = { ...o }; delete n[requirement]; return n; }); setTickError(`${label}: ${err instanceof Error ? err.message : "not saved"}`); })
      .finally(() => {
        setSaving((v) => { const n = { ...v }; delete n[requirement]; return n; });
        inFlight.current -= 1;
        window.clearTimeout(refresh.current);
        refresh.current = window.setTimeout(() => { if (inFlight.current === 0) void reload().then(() => { if (inFlight.current === 0) setOpt({}); }); }, 400);
      });
  };
  const rows = [...REQUIREMENTS.map((q) => ({ ...q, optional: false })), { ...OTHER_REQUIREMENT, label: "Other (optional)", optional: true }];
  const partner = partnerOf(data, e); const srn = data.trainees.find((x) => x.id === e.trainee_id)?.srn;
  // Design 01 · Card Header (owner, 29 Oct 2026): navy name card, the source, three tiles, then the requirements.
  return <div className="sc full tp">
    <div className="tp-hero">
      <div className="tp-av" aria-hidden="true">{t ? `${t.legal_first_name.charAt(0)}${t.legal_last_name.charAt(0)}`.toUpperCase() : "NW"}</div>
      <div className="tp-who"><h3>{t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "—"}</h3>
        <p><span className="tp-mono">{appNo}</span>{srn ? <> · SRN <span className="tp-mono">{srn}</span></> : null}{t?.mobile ? ` · ${t.mobile}` : ""}{t?.email ? <> · <span className="lc">{t.email}</span></> : null}</p>
        <div className="tp-chips">{sourceLabel(e.source, partner) && <span className="tp-chip or">{sourceLabel(e.source, partner)}</span>}{billTo && <span className="tp-chip bl">Company Charge</span>}<Badge tone={s.tone}>{s.text}</Badge></div></div>
    </div>
    {e.enrollment_status === "Pending" && <SourcePicker key={`${e.id}:${partner?.id ?? e.source}`} data={data} enrollment={e} busy={busy} post={post} />}
    <div className="tp-stats">
      {/* Change Schedule while the Cashier has recorded no payment (owner, 9 Nov 2026): unpaid trainees are still applications, so it sits here too. */}
      <div><span className="tp-cap">Training</span><b>{c ? `${c.code} · ${c.name}` : "—"}</b><small>{scheduleOf(e)}{b ? ` · ${b.batch_number}` : ""}</small>{directBatchChange(e) && <button type="button" className="portal-secondary tp-change" onClick={() => setChanging(true)}>Change Schedule</button>}{changing && <ChooseBatchModal data={data} enrollment={e} reload={reload} change onClose={() => setChanging(false)} />}</div>
      <div><span className="tp-cap">Payment</span><b className={`tp-mono${r.paid ? " sc-good" : ""}`}>{r.paid ? pesos2(r.paidCentavos) : pesos2(balance)}</b><small>{billTo ? `Billed to ${billTo.name}` : r.paid ? `Paid · balance ${pesos2(balance)}` : r.handed ? "With the Cashier" : "Not paid yet"}</small></div>
      <div><span className="tp-cap">Requirements</span><b>{REQUIREMENTS.length - missingNow.length} of {REQUIREMENTS.length}</b><small>{missingNow.length ? `Missing: ${missingNow.map((q) => q.label).join(", ")}` : "All received"}</small></div>
    </div>
    <div className="sc-table"><table><thead><tr><th>Requirement</th><th>Received</th><th>Remarks</th><th>Received by</th></tr></thead><tbody>
      {tickError && <tr><td colSpan={4}><Message kind="error" text={tickError} /></td></tr>}
      {rows.map((q) => { const ck = r.latest.get(q.code); const ticked = statusOf(q.code) === "Verified"; const note = notes[q.code] ?? ""; const needsNote = q.optional && !ticked && !note.trim();
        return <tr key={q.code} className={ticked ? "ok" : ""}>
          <td><b>{q.label}</b>{!ticked && ck?.status === "Rejected" && <small className="sc-bad">Not accepted{ck.remarks ? `: ${ck.remarks}` : ""}</small>}</td>
          <td><label className="sc-rec"><input type="checkbox" checked={ticked} disabled={!!saving[q.code] || needsNote} onChange={() => { if (ticked) { if (q.optional) check(q.code, "Rejected", q.label, "Removed"); else { setUnticking(q.code); setRemarks(""); } } else check(q.code, "Verified", q.label, note.trim() || undefined); }} />{q.optional && !ticked ? "Optional" : "Received"}</label></td>
          <td>{ticked ? <span className="sc-note">{(opt[q.code] ? opt[q.code].remarks : ck?.remarks) || "—"}</span>
            : unticking === q.code ? null
            : <input className="sc-input" value={note} onChange={(ev) => setNotes((n) => ({ ...n, [q.code]: ev.target.value }))} placeholder={q.optional ? "What is it? e.g. COP for BT-PSSR" : q.code === "valid_id" ? "e.g. Passport, expires 2030" : q.code === "medical_peme" ? "Clinic and date" : "Optional"} aria-label={`Remarks for ${q.label}`} />}
            {unticking === q.code && <span className="sc-untick"><input className="sc-input" value={remarks} onChange={(ev) => setRemarks(ev.target.value)} placeholder="Reason, e.g. medical certificate expired" aria-label={`Reason for ${q.label}`} autoFocus /><button type="button" className="portal-primary" disabled={!!saving[q.code] || !remarks.trim()} onClick={() => check(q.code, "Rejected", q.label)}>Mark Not Received</button><button type="button" className="ghost-button" onClick={() => setUnticking(null)}>Keep</button></span>}</td>
          <td>{saving[q.code] ? <span className="muted-text">Saving…</span> : opt[q.code] ? <span className="muted-text">Saved</span> : ck ? <><span>{ck.checked_by_name ?? "Staff"}</span><small>{fmtDate(day(ck.checked_at))}</small></> : <span className="muted-text">—</span>}</td>
        </tr>; })}
      <tr className="sc-total"><td>Received</td><td colSpan={3}>{REQUIREMENTS.length - missingNow.length} of {REQUIREMENTS.length}</td></tr>
    </tbody></table></div>
    {!r.handed && !r.paid && allTicked && e.enrollment_status === "Pending" && <div className="sc-pay">
      <div className="sc-pay-mode"><span className="pay-label">Mode of Payment</span><div className="cx-choice" role="radiogroup" aria-label="Mode of payment">{payModes.map((m) => <button type="button" role="radio" aria-checked={payMode === m.name} key={m.id} className={payMode === m.name ? "on" : ""} onClick={() => setPayMode(m.name)}>{m.name}</button>)}<button type="button" role="radio" aria-checked={isCC} className={isCC ? "on" : ""} onClick={() => setPayMode(COMPANY_CHARGE)}>Company Charge</button></div></div>
      {isCC ? <>
        <label className="sc-pay-ref">Company<select value={ccAgency} onChange={(ev) => setCcAgency(ev.target.value)}><option value="">Choose the company…</option>{(["Agency", "Consultancy"] as const).map((k) => { const list = companies.filter((a) => (a.kind === "Consultancy" ? "Consultancy" : "Agency") === k); return list.length ? <optgroup key={k} label={k === "Agency" ? "Agencies" : "Consultancies"}>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup> : null; })}</select></label>
        <span className="sc-pay-note">No payment at the Cashier and no receipt: {ccName || "the company"} is billed on its Billing Statement.</span>
        <div className="sc-pay-go"><button type="button" className="portal-primary" disabled={busy || anySaving || !ccAgency || !fbSaved} onClick={() => void post({ action: "application-enroll-charge", enrollmentId: e.id, agencyId: ccAgency }, `Enrolled · Company Charge (${ccName}).`).catch(() => undefined)}>Enroll · Company Charge</button>{!fbSaved ? threadNote : !ccAgency && <small>Choose the company first</small>}</div>
      </> : needsProof ? <>
        <label className="sc-pay-amt">Amount (₱)<input inputMode="decimal" value={payAmount} onChange={(ev) => setPayAmount(ev.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label>
        <label className="sc-pay-ref">Reference No.<input value={payRef} onChange={(ev) => setPayRef(ev.target.value.toUpperCase())} placeholder="From the screenshot" maxLength={80} /></label>
        <label className="sc-pay-file">Proof of Payment<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(ev) => setPayFile(ev.target.files?.[0] ?? null)} /></label>
      </> : <span className="sc-pay-note">Trainee pays at the Cashier.</span>}
      {!isCC && itemList.length > 0 && <div className="sc-items"><span className="pay-label">Items to Collect</span>
        {itemList.map((c) => { const q = items[c.id] ?? 0; return <div key={c.id} className="sc-item"><label><input type="checkbox" checked={q > 0} onChange={(ev) => setQty(c.id, ev.target.checked ? 1 : 0)} /> <b>{c.name}</b> <small>{pesos2(Number(c.default_amount_centavos))} each</small></label>{q > 0 && <span className="sc-qty"><button type="button" aria-label={`One less ${c.name}`} onClick={() => setQty(c.id, q - 1)}>−</button><span>{q}</span><button type="button" aria-label={`One more ${c.name}`} onClick={() => setQty(c.id, q + 1)}>+</button></span>}<span className="sc-item-amt">{q > 0 ? pesos2(Number(c.default_amount_centavos) * q) : ""}</span></div>; })}
      </div>}
      {!isCC && <div className="sc-pay-go"><button type="button" className="portal-primary" disabled={busy || handing || anySaving || !proofReady || !fbSaved} onClick={() => void handOver()}>{handing ? "Saving…" : `${needsProof ? "Upload Proof & Hand to Cashier" : "Hand to Cashier"} · ${pesos2(balance + itemsTotal)}`}</button>{!fbSaved ? threadNote : needsProof && !proofReady && <small>Amount, reference and photo are required</small>}</div>}
      {payError && <div className="sc-pay-err"><Message kind="error" text={payError} /></div>}
    </div>}
    {r.handed && !r.paid && !billTo && (() => { const pr = (data.traineeProofs ?? []).filter((x) => x.trainee_id === e.trainee_id).sort((a, z) => z.submitted_at.localeCompare(a.submitted_at))[0]; const held = (data.pendingItems ?? []).filter((x) => x.enrollment_id === e.id); return <div className="sc-handed">With the Cashier · {pr ? `${pr.method} ${pesos2(pr.amount_centavos)} · Ref. ${pr.reference}` : "Cash"}{held.map((x) => ` · ${x.description} ${pesos2(x.amount_centavos)}`).join("")}</div>; })()}
    <div className="sc-foot">
      <small>{!allTicked ? `Still to tick: ${missingNow.map((q) => q.label).join(", ")}` : !fbSaved && !r.handed && !r.paid ? "All requirements received. Add the Meta thread link in the Trainee Account to continue." : isCC && !r.paid ? `All requirements received. Enroll on Company Charge: ${ccName || "the company"} is billed on its Billing Statement, so no payment at the Cashier.` : !r.handed && !r.paid ? "All requirements received. Hand the trainee to the Cashier for payment." : !r.paid ? "With the Cashier — waiting for payment." : !e.batch_id && !e.scheduled_on ? "Paid. Choose a batch and the trainee is enrolled automatically." : "Paid — enrolling. Refresh if the status has not changed."}</small>
      <span className="sc-acts">
        {r.ready && <button type="button" className="portal-primary" disabled={busy} onClick={() => void post({ action: "application-enroll", enrollmentId: e.id }, "Trainee enrolled.").catch(() => undefined)}>Enroll Now</button>}
      </span>
    </div>
  </div>;
}

/** Files a trainee's proof of payment in Google Drive (Mode › Month); returns the Drive path. */
async function uploadTraineeProof(traineeId: string, p: { mode: string; amount: string; reference: string; file: File }) {
  const fd = new FormData();
  fd.set("traineeId", traineeId); fd.set("mode", p.mode); fd.set("amount", p.amount); fd.set("reference", p.reference.trim()); fd.set("proof", await shrinkProof(p.file));
  const response = await fetch("/api/staff/payment-proofs/trainee", { method: "POST", body: fd });
  const body = await response.json().catch(() => ({})) as { error?: string; drivePath?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not save the proof to Google Drive.");
  return (body.drivePath ?? "").split(" / ").slice(1).join(" / ");
}

/**
 * Proof of payment uploaded by Registration (owner, 29 Oct 2026; moved from the website).
 * Saved to Google Drive only and listed on the Cashier Dashboard until a receipt uses it.
 */
function ProofSection({ data, enrollment: e, reload }: { data: PortalData; enrollment: Enrollment; reload: () => Promise<void> }) {
  const modes = data.paymentMethods.filter((m) => m.active && m.requires_reference && (m.kind ?? "receivable") === "receivable");
  const mine = (data.traineeProofs ?? []).filter((p) => p.trainee_id === e.trainee_id);
  const [mode, setMode] = useState(modes[0]?.name ?? ""), [amount, setAmount] = useState(""), [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!modes.length) return null;
  async function upload() {
    setMsg(null);
    if (!mode || !(Number(amount) > 0) || reference.trim().length < 3 || !file) { setMsg({ kind: "error", text: "Add the amount, the reference no. and the photo." }); return; }
    setBusy(true);
    try {
      const path = await uploadTraineeProof(e.trainee_id, { mode, amount, reference, file });
      setMsg({ kind: "success", text: `Saved to Google Drive · ${path}. The Cashier sees it on the dashboard.` });
      setAmount(""); setReference(""); setFile(null); if (fileRef.current) fileRef.current.value = "";
      await reload();
    } catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not upload the proof." }); }
    finally { setBusy(false); }
  }
  return <section className="full rg-proof">
    <div className="rg-proof-head"><strong>Proof of Payment</strong><span className="muted-text">{mine.length ? `${mine.length} waiting for receipt` : "Optional · for the Cashier to view"}</span></div>
    {mine.length > 0 && <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Uploaded</th><th>Mode</th><th className="fs-n">Amount</th><th>Reference</th><th>Status</th><th></th></tr></thead><tbody>
      {mine.map((p) => <tr key={p.id}><td>{fmtDate(day(p.submitted_at))}<small>{fmtClock(p.submitted_at)}</small></td><td>{p.method}</td><td className="fs-n">{pesos2(p.amount_centavos)}</td><td className="cl-mono">{p.reference}</td><td><Badge tone="orange">Waiting for Receipt</Badge></td><td>{p.drive_link && <ViewIcon label="View Proof" href={p.drive_link} />}</td></tr>)}
    </tbody></table></div>}
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="rg-proof-form">
      <div className="rg-proof-wide"><span className="pay-label">Mode of Payment</span><div className="cx-choice" role="radiogroup" aria-label="Mode of payment">{modes.map((m) => <button type="button" role="radio" aria-checked={mode === m.name} key={m.id} className={mode === m.name ? "on" : ""} onClick={() => setMode(m.name)}>{m.name}</button>)}</div></div>
      <label>Amount (₱)<input inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label>
      <label>Reference No.<input value={reference} onChange={(ev) => setReference(ev.target.value.toUpperCase())} placeholder="From the trainee's screenshot" maxLength={80} /></label>
      <label className="rg-proof-wide">Photo or PDF of the Proof<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} /></label>
      <div className="rg-proof-wide rg-proof-act"><button type="button" className="portal-primary" disabled={busy} onClick={() => void upload()}>{busy ? "Uploading…" : "Upload Proof"}</button></div>
    </div>
  </section>;
}

/** Everything about one enrollment, read-only on money. Requests go to Accounting. */
/**
 * Change the start date of an in-house course that runs on a picked date (no
 * batch). Any day is allowed, past included (owner, 13 Oct 2026), as long as
 * the training days fit Monday to Saturday of one week.
 */
function StartDateEditor({ data, enrollment: e, busy, post }: { data: PortalData; enrollment: Enrollment; busy: boolean; post: (body: Record<string, unknown>, ok: string) => Promise<unknown> }) {
  const course = data.courses.find((c) => c.id === e.course_id);
  const [value, setValue] = useState(e.scheduled_on ?? "");
  if (!course || course.delivery_type !== "In-House" || first(e.batches) || e.partner_offer_id || e.enrollment_status === "Cancelled") return null;
  const today = manilaToday(), ok = !!value && fitsInWeek(value, course.duration_label), changed = value !== (e.scheduled_on ?? "");
  const ends = ok ? automaticEndDate(value, course.duration_label) : "";
  return <div className="full sd-edit">
    <label>Start Date<input type="date" value={value} onChange={(ev) => setValue(ev.target.value)} /></label>
    <button type="button" className="portal-secondary" disabled={busy || !ok || !changed} onClick={() => void post({ action: "enrollment-set-start", enrollmentId: e.id, scheduledOn: value }, ends < today ? "Start date changed. The training is now finished, so the certificate can move on." : "Start date changed.").catch(() => undefined)}>Change Start Date</button>
    <small style={{ color: !value || ok ? "var(--muted)" : "var(--red, #b42318)" }}>{!value ? `${course.duration_label} · Monday to Saturday, one week.` : !ok ? "Pick a day that is not a Sunday and lets the course finish by Saturday of the same week." : `${value < today ? "Backdated · " : ""}${fmtDate(value)} to ${fmtDate(ends)}`}</small>
  </div>;
}

/** Other STCW Courses (owner, 20 Oct 2026): Registration picks the partnered center (its fee) and the training date. */
function OtherCenterEditor({ data, enrollment: e, busy, post }: { data: PortalData; enrollment: Enrollment; busy: boolean; post: (body: Record<string, unknown>, ok: string) => Promise<unknown> }) {
  const course = data.courses.find((c) => c.id === e.course_id);
  const [offerId, setOfferId] = useState(e.partner_offer_id ?? ""), [date, setDate] = useState(e.scheduled_on ?? "");
  if (!course || course.delivery_type !== "Partner or Endorsed" || e.enrollment_status !== "Pending") return null;
  const offers = data.offers.filter((o) => o.course_id === e.course_id);
  const picked = offers.find((o) => o.id === offerId);
  const centerName = (o: (typeof offers)[number]) => first(o.partner_centers)?.name ?? "Partnered center";
  const changed = offerId !== (e.partner_offer_id ?? "") || date !== (e.scheduled_on ?? "");
  return <div className="full sd-edit">
    <label>Training Center<select value={offerId} onChange={(ev) => setOfferId(ev.target.value)}><option value="">Choose the center</option>{offers.map((o) => <option key={o.id} value={o.id}>{centerName(o)} · {pesos2(Number(o.training_fee_centavos))} · {o.duration_label}</option>)}</select></label>
    <label>Training Date<input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></label>
    <button type="button" className="portal-primary" disabled={busy || !offerId || !date || !changed} onClick={() => void post({ action: "other-course-center", enrollmentId: e.id, offerId, scheduledOn: date }, `Training center set: ${picked ? centerName(picked) : ""}. The fee to collect is ${picked ? pesos2(Number(picked.training_fee_centavos)) : ""}.`).catch(() => undefined)}>Save Center and Date</button>
    <small style={{ color: "var(--muted)" }}>{!offers.length ? "No partnered center offers this course right now." : !e.partner_offer_id ? "Other STCW course: set the center and date before handing to the Cashier." : `Fee ${pesos2(Number(e.selling_price_centavos))}.`}</small>
  </div>;
}

export function EnrollmentDrawer({ data, enrollment: e, reload, onClose, onOpenAccount }: { data: PortalData; enrollment: Enrollment; reload: () => Promise<void>; onClose: () => void; onOpenAccount?: () => void }) {
  const { busy, msg, post } = usePost(reload);
  const [req, setReq] = useState<RequestType | null>(null);
  const [addingCourse, setAddingCourse] = useState(false);
  const [choosingBatch, setChoosingBatch] = useState(false), [changingBatch, setChangingBatch] = useState(false);
  const t = first(e.trainees), c = first(e.courses), b = first(e.batches);
  const traineeRecord = data.trainees.find((x) => x.id === e.trainee_id) ?? null;
  const center = first(first(e.partner_course_offers)?.partner_centers)?.name;
  const paid = Number(e.paid_centavos), due = dueCentavos(e), balance = balanceOf(e), charges = Number(e.charges_centavos ?? 0), discounts = Number(e.discounts_centavos ?? 0);
  const payments = data.payments.filter((p) => p.trainee_id === e.trainee_id).sort((a, z) => z.received_at.localeCompare(a.received_at));
  const history = requestsFor(data, e).sort((a, z) => z.created_at.localeCompare(a.created_at));
  const pendingTypes = new Set(history.filter((r) => r.status === "Pending").map((r) => r.request_type));
  const canRequest = e.enrollment_status !== "Cancelled";
  const isApplication = e.enrollment_status === "Pending";
  const canChangeBatch = directBatchChange(e);
  const hasDocuments = e.enrollment_status === "Enrolled" || e.enrollment_status === "Open Schedule";
  const p = payState(e);
  const billTo = e.enrollment_status !== "Cancelled" ? chargeTo(data, e) : null;
  return <Modal title={isApplication ? `Application ${appNoOf(data, e.trainee_id) ?? e.enrollment_number}` : e.enrollment_number} onClose={onClose} wide>
    <div className="portal-form">
      {msg && <div className="full"><Message kind={msg.kind} text={msg.text} /></div>}
      {isApplication && <ScreeningPanel data={data} enrollment={e} busy={busy} post={post} reload={reload} onOpenAccount={onOpenAccount} />}
      {!isApplication && <div className="kv-grid kv-stack full">
        <div><span>{isApplication ? "Applicant" : "Trainee"}</span><strong>{t ? fullName(t) : "—"}</strong><small>{appNoOf(data, e.trainee_id) ? <span className="app-no">{appNoOf(data, e.trainee_id)}</span> : null}{t?.trainee_number} · <span className="lc">{t?.email}</span> · {t?.mobile}</small></div>
        <div><span>Course</span><strong>{c?.name ?? "—"}</strong><small>{c?.code}{center ? ` · endorsed: ${center}` : " · New Wave"}</small></div>
        <div><span>Schedule</span>{canChangeBatch && <button type="button" className="portal-secondary reg-change-batch" onClick={() => setChangingBatch(true)}>Change Schedule</button>}<strong>{scheduleOf(e)}</strong><small>{b ? `${b.batch_number}${b.mode ? ` · ${b.mode}` : ""}${b.venue ? ` · ${b.venue}` : ""}` : e.scheduled_on ? (c && first(e.partner_course_offers) ? "Endorsed training date" : `Start date picked · ends ${fmtDate(automaticEndDate(e.scheduled_on, data.courses.find((x) => x.id === e.course_id)?.duration_label ?? "1"))}`) : "Not yet placed on a batch"}</small></div>
        <div><span>Status</span><strong><Badge tone={statusTone(e.enrollment_status)}>{e.enrollment_status}</Badge><LateChip e={e} /></strong><small>{isApplication ? "Submitted" : "Created"} {fmtDate(day(e.created_at))}{e.source ? ` · ${e.source}` : ""}</small></div>
      </div>}
      <StartDateEditor data={data} enrollment={e} busy={busy} post={post} />
      <OtherCenterEditor data={data} enrollment={e} busy={busy} post={post} />
      {e.enrollment_status !== "Cancelled" && e.enrollment_status !== "Pending" && !billTo && <ProofSection data={data} enrollment={e} reload={reload} />}

      <div className="full"><strong>Payment status</strong> <small style={{ color: "var(--muted)" }}>read-only — payments are recorded by the Cashier</small></div>
      <div className="pill-row full">
        <div><span>Fee</span><b>{pesos(e.selling_price_centavos)}</b></div>
        {charges > 0 && <div className="warn"><span>Charges</span><b>+{pesos(charges)}</b></div>}
        {discounts > 0 && <div className="ok"><span>Discounts</span><b>−{pesos(discounts)}</b></div>}
        <div><span>Total due</span><b>{pesos(due)}</b></div>
        {billTo ? <div className={balance === 0 ? "ok" : undefined}><span>Company Charge</span><b>{balance === 0 ? `Paid by ${billTo.name}` : `Billed to ${billTo.name} · ${pesos(balance)}`}</b></div> : <div className={balance === 0 ? "ok" : paid > 0 ? "warn" : "bad"}><span>{p.text}</span><b>{pesos(paid)} paid · {pesos(balance)} balance</b></div>}
      </div>
      {payments.length > 0 && <div className="full"><small style={{ color: "var(--muted)", fontWeight: 700 }}>Trainee&apos;s payments</small>{payments.slice(0, 6).map((pm) => <div className="live-row-item" key={pm.id}><div><strong>{pm.payment_number}</strong><small>{pm.method}{pm.reference_number ? ` · ${pm.reference_number}` : ""} · {fmtDate(day(pm.received_at))} · {pm.verification_state}</small></div><span className="slot-count">{pesos(pm.amount_centavos)}</span></div>)}<p className="portal-form-note">Payments are recorded per trainee; which enrollment each one covers is on the receipt.</p></div>}

      <div className="full"><strong>Documents</strong></div>
      {hasDocuments ? <>
        <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
          <TarButton data={data} traineeId={e.trainee_id} reload={reload} className="portal-primary" enrollmentId={e.id} />
          <InstructionsButton data={data} enrollment={e} reload={reload} />
        </div>
      </> : isApplication ? <>
        <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}><TarButton data={data} traineeId={e.trainee_id} reload={reload} className="portal-primary" enrollmentId={e.id} /></div>
        <p className="portal-form-note full">The TAR prints regardless of payment and shows the balance. Training instructions become available once the trainee is paid and enrolled.</p>
      </> : <p className="portal-form-note full">No documents for a cancelled enrollment.</p>}

      {isApplication && <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>{!e.batch_id && !e.scheduled_on && <button type="button" className="portal-primary" data-short="Batch" onClick={() => setChoosingBatch(true)}>Choose Batch</button>}{traineeRecord && <button type="button" onClick={() => setAddingCourse(true)}>+ Add Another Course</button>}</div>}

      <div className="full"><strong>Request a change</strong> <small style={{ color: "var(--muted)" }}>goes to the Cashier for charges, then Accounting for approval</small></div>
      <div className="document-actions full" style={{ gap: 8, flexWrap: "wrap" }}>
        {REG_REQUESTS.filter((type) => !(isApplication && (type === "Make-up Class" || type === "Reprinting" || type === "TAR reprint")) && !(canChangeBatch && type === "Rescheduling")).map((type) => <button key={type} type="button" disabled={!canRequest || pendingTypes.has(type)} title={pendingTypes.has(type) ? "A request of this type is already pending" : undefined} onClick={() => setReq(type)}>{requestLabel(type, isApplication)}</button>)}
      </div>
      {canChangeBatch && <p className="portal-form-note full">Not paid yet: change the schedule with Change Schedule. Once the Cashier records any payment, a change of batch goes through the request and its fee.</p>}
      {history.length > 0 && <div className="full"><small style={{ color: "var(--muted)", fontWeight: 700 }}>Request history</small>{history.map((r: RequestRow) => { const st = requestStage(r); const charge = first(r.enrollment_charges); return <div className="live-row-item" key={r.id}><div><strong>{r.request_number} · {r.request_type === "Rescheduling" ? "Change batch / reschedule" : r.request_type}</strong><small>{r.reason} · filed {fmtDate(day(r.created_at))}{charge ? ` · charge ${pesos(charge.amount_centavos)}` : r.stage === "For approval" && r.status === "Pending" ? " · no charge" : ""}{r.decided_at ? ` · decided ${fmtDate(day(r.decided_at))}` : ""}{r.decision_remarks ? ` · ${r.decision_remarks}` : ""}</small></div><Badge tone={st.tone}>{st.text}</Badge></div>; })}</div>}

      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Close</button></div>
    </div>
    {req && <RequestActionModal data={data} enrollment={e} reqType={req} onClose={() => setReq(null)} post={(body) => post(body, "Request sent to the Cashier for charges.")} />}
    {addingCourse && traineeRecord && <AssignCourseModal data={data} trainee={traineeRecord} reload={reload} onClose={() => setAddingCourse(false)} />}
    {choosingBatch && <ChooseBatchModal data={data} enrollment={e} reload={reload} onClose={() => setChoosingBatch(false)} />}
    {changingBatch && <ChooseBatchModal data={data} enrollment={e} reload={reload} change onClose={() => setChangingBatch(false)} />}
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
    <div className="rr-switch" role="tablist" aria-label="Courses">{COURSE_TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{tcl(t)}<small>{counts[t]}</small></button>)}</div>

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
      <div className="panel-heading"><div><h2>In-House Courses</h2></div><label className="portal-field-inline">Category<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All Categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label></div>
      <div className="portal-table"><table><thead><tr><th>Code</th><th>Course</th><th>Category</th><th>Duration</th><th>Modality</th><th>Fee</th></tr></thead><tbody>{others.filter((c) => !category || (first(c.course_categories)?.name ?? "In-House") === category).map((c) => <tr key={c.id}><td><strong>{c.code}</strong></td><td>{c.name}</td><td>{first(c.course_categories)?.name ?? "In-House"}</td><td>{c.duration_label}</td><td>Online</td><td>{pesos(c.standard_price_centavos)}</td></tr>)}</tbody></table>{!others.length && <p className="portal-empty-copy">No courses.</p>}</div>
    </section>}

    {tab === "Endorsed programs" && <section className="portal-panel">
      <div className="panel-heading"><div><h2>Endorsed Programs</h2></div><label className="portal-field-inline">Partner Center<select value={center} onChange={(e) => setCenter(e.target.value)}>{centers.map((c) => <option key={c}>{c}</option>)}{!centers.length && <option value="">None Yet</option>}</select></label></div>
      <div className="portal-table"><table><thead><tr><th>Code</th><th>Course</th><th>Duration</th><th>Training Fee</th></tr></thead><tbody>{offers.map(({ offer, course }) => <tr key={offer.id}><td><strong>{course?.code}</strong></td><td>{course?.name}</td><td>{offer.duration_label}</td><td>{pesos(offer.training_fee_centavos)}</td></tr>)}</tbody></table>{!offers.length && <p className="portal-empty-copy">No programs for this center.</p>}</div>
    </section>}
  </div>;
}
