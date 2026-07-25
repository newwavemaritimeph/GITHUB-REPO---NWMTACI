"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pill, StatCard, ToastProvider } from "@/components/ui/kit";
import { NewWaveLogo } from "./new-wave-logo";
import { AttendanceModule } from "./portal/module-attendance";
import { CertificatesModule } from "./portal/module-certificates";
import { EnrollmentsModule } from "./portal/module-enrollments";
import {
  AccountingModule,
  CatalogModule,
  HrModule,
  InstructionsModule,
  ReportsModule,
  RequestsModule,
  SettingsModule,
  TraineesModule,
} from "./portal/module-others";
import { PaymentsModule } from "./portal/module-payments";
import { RegistrationsModule } from "./portal/module-registrations";
import { SchedulesModule } from "./portal/module-schedules";
import { PageHeader, Panel, StageBadge, type Module } from "./portal/shared";
import { pesos } from "@/lib/endorsement-catalog";
import { SystemProvider, formatDate, formatDateTime, fullName, todayIso, useSystem } from "@/lib/system/store";
import type { Role } from "@/lib/system/types";

const roles: Role[] = ["Admin", "Registration", "Cashier", "Accounting", "Training Operations", "HR", "Instructor"];

const nav: { label: Module; icon: string; roles?: Role[] }[] = [
  { label: "Dashboard", icon: "⌂" },
  { label: "Registrations", icon: "✎", roles: ["Admin", "Registration"] },
  { label: "Trainees", icon: "◎", roles: ["Admin", "Registration", "Cashier", "Accounting", "Training Operations"] },
  { label: "Enrollments", icon: "▤", roles: ["Registration", "Cashier", "Accounting", "Training Operations"] },
  { label: "Courses & centers", icon: "◇", roles: ["Admin", "Registration", "Accounting", "Training Operations"] },
  { label: "Schedules", icon: "□", roles: ["Training Operations", "Instructor"] },
  { label: "Payments", icon: "₱", roles: ["Cashier", "Accounting"] },
  { label: "Accounting", icon: "▥", roles: ["Admin", "Accounting"] },
  { label: "Instructions", icon: "✉", roles: ["Admin", "Training Operations"] },
  { label: "Attendance", icon: "✓", roles: ["Admin", "Training Operations", "Instructor"] },
  { label: "Certificates", icon: "◈", roles: ["Training Operations"] },
  { label: "Requests", icon: "↗", roles: ["Admin", "Cashier", "Accounting", "Training Operations", "HR", "Instructor"] },
  { label: "HR & payroll", icon: "♙", roles: ["HR"] },
  { label: "Reports", icon: "↥", roles: ["Admin", "Cashier", "Accounting", "Training Operations", "HR"] },
  { label: "Settings", icon: "⚙", roles: ["Admin"] },
];

/* --------------------------------------------------------------- dashboard */

function Dashboard({ role, go }: { role: Role; go: (module: Module) => void }) {
  const { state, views } = useSystem();
  const all = views();

  const pendingRegistrations = state.submissions.filter((item) =>
    ["Submitted", "Under Review", "Possible Duplicate"].includes(item.status),
  );
  const pendingPayments = state.ledger.filter((entry) => entry.type === "payment" && entry.verification === "Pending");
  const collectionsToday = state.ledger
    .filter((entry) => entry.type === "payment" && entry.verification === "Verified" && entry.recordedAt.slice(0, 10) === todayIso())
    .reduce((sum, entry) => sum + entry.amountCentavos, 0);
  const outstanding = all.reduce((sum, item) => sum + item.balanceCentavos, 0);
  const readyInstructions = all.filter((item) => item.paymentStatus === "Paid" && !item.enrollment.instructionsSentAt);
  const certificatesReady = all.filter((item) => item.certificate?.status === "Ready to Print");
  const pendingRequests = state.requests.filter((item) => item.status === "Pending" || item.status === "For clarification");
  const todaySessions = state.attendanceSessions.filter((session) => session.sessionDate === todayIso());
  const unverifiedSessions = state.attendanceSessions.filter((session) => session.state === "Submitted");
  const openSeats = state.batches
    .filter((batch) => batch.status === "Open")
    .reduce(
      (sum, batch) =>
        sum + Math.max(0, batch.capacity - all.filter((item) => item.enrollment.batchId === batch.id && item.stage !== "Cancelled").length),
      0,
    );
  const openPayroll = state.payrollPeriods.find((period) => period.status !== "Finalized");

  // ---- date-sensitive registration figures -------------------------------
  const today = todayIso();
  const monthKey = today.slice(0, 7);
  const monthName = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(new Date());
  const tomorrow = (() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  })();
  const newlyRegistered = state.submissions.filter((item) => (item.submittedAt ?? "").slice(0, 10) === today);
  const registeredThisMonth = state.submissions.filter((item) => (item.submittedAt ?? "").slice(0, 7) === monthKey);
  const activeEnrollments = all.filter((item) => item.stage !== "Cancelled");
  const startingTomorrow = activeEnrollments.filter((item) => item.batch?.startsOn === tomorrow);

  const officerBoard = (() => {
    const counts = new Map<string, number>();
    activeEnrollments.forEach((item) => {
      const who = item.enrollment.processedBy;
      if (who) counts.set(who, (counts.get(who) ?? 0) + 1);
    });
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  })();
  const trainingBoard = (() => {
    const counts = new Map<string, number>();
    activeEnrollments.forEach((item) => counts.set(item.enrollment.courseName, (counts.get(item.enrollment.courseName) ?? 0) + 1));
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
  })();
  const maxTraining = trainingBoard[0]?.[1] ?? 1;
  const maxOfficer = officerBoard[0]?.[1] ?? 1;

  const activeAnnouncements = [...state.announcements]
    .filter((item) => !item.expiresOn || item.expiresOn >= today)
    .sort(
      (left, right) =>
        Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || right.postedAt.localeCompare(left.postedAt),
    );

  const isRegistration = role === "Registration";

  const metrics: Record<Role, { label: string; value: string; note: string; icon: string; module: Module }[]> = {
    Admin: [
      { label: "New registrations", value: String(pendingRegistrations.length), note: "Awaiting review", icon: "✎", module: "Registrations" },
      { label: "Collections today", value: pesos(collectionsToday), note: `${pendingPayments.length} to verify`, icon: "₱", module: "Accounting" },
      { label: "Outstanding", value: pesos(outstanding), note: `${all.filter((item) => item.balanceCentavos > 0).length} enrollments`, icon: "!", module: "Accounting" },
      { label: "Pending approvals", value: String(pendingRequests.length), note: "Requests and changes", icon: "↗", module: "Requests" },
      { label: "Trainee records", value: String(state.trainees.length), note: "All programs", icon: "◎", module: "Trainees" },
      { label: "Reports", value: String(5), note: "Audited exports", icon: "↥", module: "Reports" },
    ],
    Registration: [
      { label: "Newly registered today", value: String(newlyRegistered.length), note: "From the public site", icon: "✎", module: "Registrations" },
      { label: "Registered this month", value: String(registeredThisMonth.length), note: monthName, icon: "◎", module: "Registrations" },
      { label: "Starting tomorrow", value: String(startingTomorrow.length), note: "Trainees with a schedule in 1 day", icon: "□", module: "Enrollments" },
      { label: "Active enrollments", value: String(activeEnrollments.length), note: "All batches", icon: "▤", module: "Enrollments" },
    ],
    Cashier: [
      { label: "Collections today", value: pesos(collectionsToday), note: "Verified payments", icon: "₱", module: "Payments" },
      { label: "Proofs to verify", value: String(pendingPayments.length), note: "Online payments", icon: "!", module: "Payments" },
      { label: "Unpaid", value: String(all.filter((item) => item.paymentStatus === "Unpaid").length), note: "No payment yet", icon: "◎", module: "Enrollments" },
      { label: "Partially paid", value: String(all.filter((item) => item.paymentStatus === "Partially Paid").length), note: "Balance remaining", icon: "□", module: "Enrollments" },
      { label: "Outstanding", value: pesos(outstanding), note: "Total receivables", icon: "▥", module: "Accounting" },
      { label: "Receipts issued", value: String(state.ledger.filter((entry) => entry.receiptNumber).length), note: "All time", icon: "◈", module: "Payments" },
    ],
    Accounting: [
      { label: "Gross collections", value: pesos(state.ledger.filter((entry) => entry.type === "payment" && entry.verification === "Verified").reduce((sum, entry) => sum + entry.amountCentavos, 0)), note: "Verified payments", icon: "₱", module: "Accounting" },
      { label: "Receivables", value: pesos(outstanding), note: "Open balances", icon: "!", module: "Accounting" },
      { label: "Unreconciled", value: String(pendingPayments.length), note: pesos(pendingPayments.reduce((sum, entry) => sum + entry.amountCentavos, 0)), icon: "◎", module: "Payments" },
      { label: "Expenses pending", value: String(state.expenses.filter((expense) => expense.status === "Pending").length), note: pesos(state.expenses.filter((expense) => expense.status === "Pending").reduce((sum, expense) => sum + expense.amountCentavos, 0)), icon: "▥", module: "Accounting" },
      { label: "Partner offers", value: String(96), note: "Endorsed catalog", icon: "◇", module: "Courses & centers" },
      { label: "Payroll draft", value: pesos(openPayroll?.items.reduce((sum, item) => sum + item.grossCentavos - item.deductionCentavos, 0) ?? 0), note: openPayroll?.periodNumber ?? "All periods closed", icon: "♙", module: "HR & payroll" },
    ],
    "Training Operations": [
      { label: "Sessions today", value: String(todaySessions.length), note: `${state.batches.filter((batch) => batch.status === "Ongoing").length} batches running`, icon: "✓", module: "Attendance" },
      { label: "Awaiting verification", value: String(unverifiedSessions.length), note: "Submitted by instructors", icon: "!", module: "Attendance" },
      { label: "Open batches", value: String(state.batches.filter((batch) => batch.status === "Open").length), note: `${openSeats} slots available`, icon: "□", module: "Schedules" },
      { label: "Unpublished batches", value: String(state.batches.filter((batch) => batch.publishedAt === null && batch.status !== "Cancelled").length), note: "Hidden from the public site", icon: "◎", module: "Schedules" },
      { label: "Certificates ready", value: String(certificatesReady.length), note: state.settings.certificateIssuanceEnabled ? "Ready to print" : "Template required", icon: "◈", module: "Certificates" },
      { label: "Instructions to send", value: String(readyInstructions.length), note: "Fully paid enrollments", icon: "✉", module: "Instructions" },
    ],
    HR: [
      { label: "Active employees", value: String(state.employees.filter((employee) => employee.status === "Active").length), note: `${state.employees.filter((employee) => employee.department === "Training").length} in training`, icon: "◎", module: "HR & payroll" },
      { label: "Pending leave", value: String(state.leaveRequests.filter((leave) => leave.status === "Pending").length), note: "Awaiting a decision", icon: "!", module: "HR & payroll" },
      { label: "Payroll status", value: openPayroll?.status ?? "Finalized", note: openPayroll?.periodNumber ?? "All periods closed", icon: "₱", module: "HR & payroll" },
      { label: "Approved leave", value: String(state.leaveRequests.filter((leave) => leave.status === "Approved").length), note: "This period", icon: "✓", module: "HR & payroll" },
      { label: "Part-time staff", value: String(state.employees.filter((employee) => employee.employmentType === "Part-time").length), note: "Daily-rate instructors", icon: "□", module: "HR & payroll" },
      { label: "Available exports", value: String(5), note: "Audited reports", icon: "↥", module: "Reports" },
    ],
    Instructor: [
      { label: "Sessions today", value: String(todaySessions.length), note: todaySessions.length ? "Ready for check-in" : "No class today", icon: "✓", module: "Attendance" },
      { label: "Trainees today", value: String(all.filter((item) => todaySessions.some((session) => session.batchId === item.enrollment.batchId)).length), note: "Across today's batches", icon: "◎", module: "Attendance" },
      { label: "Open sessions", value: String(state.attendanceSessions.filter((session) => session.state === "Open").length), note: "Attendance in progress", icon: "□", module: "Attendance" },
      { label: "Submitted", value: String(unverifiedSessions.length), note: "Awaiting verification", icon: "↗", module: "Attendance" },
      { label: "Active batches", value: String(state.batches.filter((batch) => batch.status === "Open" || batch.status === "Ongoing").length), note: "Open and ongoing", icon: "▤", module: "Schedules" },
      { label: "Upcoming sessions", value: String(state.attendanceSessions.filter((session) => session.sessionDate > todayIso()).length), note: "Planned", icon: "◇", module: "Schedules" },
    ],
  };

  const tasks: { tone: string; title: string; detail: string; module: Module }[] = [];
  if (pendingRegistrations.length)
    tasks.push({ tone: "amber", title: "Review new registrations", detail: `${pendingRegistrations.length} submission${pendingRegistrations.length === 1 ? "" : "s"} waiting to become enrollments`, module: "Registrations" });
  if (pendingPayments.length)
    tasks.push({ tone: "amber", title: "Verify payment proofs", detail: `${pendingPayments.length} online payment${pendingPayments.length === 1 ? "" : "s"} need cashier confirmation`, module: "Payments" });
  if (readyInstructions.length)
    tasks.push({ tone: "blue", title: "Send training instructions", detail: `${readyInstructions.length} fully paid enrollment${readyInstructions.length === 1 ? "" : "s"} ready to send`, module: "Instructions" });
  if (unverifiedSessions.length)
    tasks.push({ tone: "blue", title: "Verify submitted attendance", detail: `${unverifiedSessions.length} session${unverifiedSessions.length === 1 ? "" : "s"} submitted by instructors`, module: "Attendance" });
  if (certificatesReady.length)
    tasks.push({ tone: "green", title: "Print eligible certificates", detail: `${certificatesReady.length} record${certificatesReady.length === 1 ? "" : "s"} passed attendance verification`, module: "Certificates" });
  if (pendingRequests.length)
    tasks.push({ tone: "amber", title: "Decide pending requests", detail: `${pendingRequests.length} change request${pendingRequests.length === 1 ? "" : "s"} awaiting approval`, module: "Requests" });
  if (!state.settings.certificateTemplateApproved)
    tasks.push({ tone: "blue", title: "Complete launch settings", detail: "A certificate template must be approved before issuance", module: "Settings" });

  return (
    <div className="page">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date())}
        title="Good day, Jocelyn."
        description={`Here is what needs attention in ${role.toLowerCase()} today.`}
        actions={
          <button
            className="primary-button"
            onClick={() => go(role === "Cashier" ? "Payments" : role === "Instructor" ? "Attendance" : role === "HR" ? "HR & payroll" : "Registrations")}
          >
            {role === "Cashier" ? "Record payment" : role === "Instructor" ? "Start attendance" : role === "HR" ? "Open payroll" : "Review registrations"}
          </button>
        }
      />

      {activeAnnouncements.length > 0 && (
        <Panel
          title="Announcement board"
          description="Posted by the Admin / Accounting Manager"
          action={<Pill tone="blue">{activeAnnouncements.length} active</Pill>}
        >
          {activeAnnouncements.map((item) => (
            <div key={item.id} className="announcement-row">
              <span className="announcement-mark" aria-hidden="true">{item.pinned ? "📌" : "📣"}</span>
              <div className="announcement-body">
                <strong>{item.title}</strong>
                <p>{item.body}</p>
                <small>
                  {item.postedBy} · {formatDate(item.postedAt)}
                  {item.expiresOn ? ` · shown until ${formatDate(item.expiresOn)}` : ""}
                </small>
              </div>
            </div>
          ))}
        </Panel>
      )}

      <div className={`stat-grid ${isRegistration ? "stat-grid-4" : "stat-grid-6"}`}>
        {metrics[role].map((metric, index) => (
          <StatCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            note={metric.note}
            icon={metric.icon}
            tone={index}
            onClick={() => go(metric.module)}
          />
        ))}
      </div>

      {isRegistration && (
        <div className="two-column">
          <Panel title="Trainings with most enrollments" description="Ranked by active enrollments">
            {trainingBoard.length === 0 ? (
              <div className="empty-block"><span aria-hidden="true">□</span><h3>No enrollments yet</h3><p>Approved registrations will appear here.</p></div>
            ) : (
              trainingBoard.map(([course, count], index) => (
                <div key={course} className="leaderboard-row">
                  <span className="rank">{index + 1}</span>
                  <div className="leaderboard-copy">
                    <strong>{course}</strong>
                    <div className="leaderboard-bar"><i style={{ width: `${Math.round((count / maxTraining) * 100)}%` }} /></div>
                  </div>
                  <b className="leaderboard-count">{count}</b>
                </div>
              ))
            )}
          </Panel>
          <Panel title="Registration performance" description="Officers ranked by enrollments processed">
            {officerBoard.length === 0 ? (
              <div className="empty-block"><span aria-hidden="true">◎</span><h3>No attributed enrollments</h3><p>Enrollments you process will be counted here.</p></div>
            ) : (
              officerBoard.map(([officer, count], index) => (
                <div key={officer} className="leaderboard-row">
                  <span className={`rank ${index === 0 ? "gold" : ""}`}>{index + 1}</span>
                  <div className="leaderboard-copy">
                    <strong>{officer}</strong>
                    <div className="leaderboard-bar"><i style={{ width: `${Math.round((count / maxOfficer) * 100)}%` }} /></div>
                  </div>
                  <b className="leaderboard-count">{count}</b>
                </div>
              ))
            )}
          </Panel>
        </div>
      )}

      {!isRegistration && (
      <>
      <div className="two-column">
        <Panel title="Priority work" description="Built from live records, ordered by operational urgency" action={<Pill tone="amber">{tasks.length} actions</Pill>}>
          {tasks.length === 0 ? (
            <div className="empty-block">
              <span aria-hidden="true">✓</span>
              <h3>Everything is clear</h3>
              <p>No registrations, payments, attendance, or certificates need attention right now.</p>
            </div>
          ) : (
            tasks.map((task) => (
              <button key={task.title} className="priority-row" onClick={() => go(task.module)}>
                <span className={`priority-icon ${task.tone}`} aria-hidden="true">
                  {task.tone === "green" ? "✓" : task.tone === "blue" ? "→" : "!"}
                </span>
                <span className="priority-copy">
                  <strong>{task.title}</strong>
                  <small>{task.detail}</small>
                </span>
                <b aria-hidden="true">›</b>
              </button>
            ))
          )}
        </Panel>

        <Panel
          title="Latest enrollments"
          description="Newest records across every course"
          action={
            <button className="link-button" onClick={() => go("Enrollments")}>
              View all
            </button>
          }
        >
          {all.length === 0 ? (
            <div className="empty-block">
              <span aria-hidden="true">▤</span>
              <h3>No enrollments yet</h3>
              <p>Approve a registration to create the first enrollment.</p>
            </div>
          ) : (
            all.slice(0, 5).map((item) => (
              <div key={item.enrollment.id} className="activity-row">
                <div>
                  <strong>{fullName(item.trainee)}</strong>
                  <small>
                    {item.enrollment.courseName} · {item.enrollment.reference}
                  </small>
                </div>
                <div className="activity-right">
                  <StageBadge stage={item.stage} />
                  <small>{item.balanceCentavos > 0 ? `${pesos(item.balanceCentavos)} due` : "Settled"}</small>
                </div>
              </div>
            ))
          )}
        </Panel>
      </div>

      <Panel title="Today at the center" description="Sessions in progress and the latest audited activity" padded={false}>
        <div className="two-column two-column-flush">
          <div className="panel-padded">
            <h3 className="sub-heading">Sessions today</h3>
            {todaySessions.length === 0 ? (
              <p className="muted-text">No training session is scheduled for today.</p>
            ) : (
              todaySessions.map((session) => {
                const batch = state.batches.find((item) => item.id === session.batchId);
                return (
                  <div key={session.id} className="activity-row">
                    <div>
                      <strong>
                        {batch?.courseName} · {session.name}
                      </strong>
                      <small>
                        {batch?.venue} · {batch?.instructor}
                      </small>
                    </div>
                    <Pill tone={session.state === "Verified" ? "green" : session.state === "Open" ? "amber" : "slate"}>{session.state}</Pill>
                  </div>
                );
              })
            )}
          </div>
          <div className="panel-padded">
            <h3 className="sub-heading">Recent activity</h3>
            {state.activity.slice(0, 6).map((entry) => (
              <div key={entry.id} className="activity-row">
                <div>
                  <strong>{entry.action}</strong>
                  <small>
                    {entry.recordRef} · {entry.actor}
                  </small>
                </div>
                <small className="muted-text">{formatDateTime(entry.createdAt)}</small>
              </div>
            ))}
          </div>
        </div>
      </Panel>
      </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

function PortalShell({ previewMode }: { previewMode: boolean }) {
  const { state, ready, actor, setActor, markNotificationsRead } = useSystem();
  const [role, setRole] = useState<Role>("Admin");
  const [active, setActive] = useState<Module>("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const visibleNav = nav.filter((item) => !item.roles || item.roles.includes(role));
  const staffNotifications = state.notifications.filter((item) => item.audience === "staff");
  const unread = staffNotifications.filter((item) => !item.readAt);
  const pendingRequests = state.requests.filter((item) => item.status === "Pending").length;
  const pendingRegistrations = state.submissions.filter((item) =>
    ["Submitted", "Under Review", "Possible Duplicate"].includes(item.status),
  ).length;

  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length < 2) return [];
    const results: { key: string; label: string; detail: string; module: Module }[] = [];
    state.trainees.forEach((trainee) => {
      if (`${fullName(trainee)} ${trainee.traineeNumber} ${trainee.email}`.toLowerCase().includes(term)) {
        results.push({ key: `t-${trainee.id}`, label: fullName(trainee), detail: `Trainee ${trainee.traineeNumber}`, module: "Trainees" });
      }
    });
    state.enrollments.forEach((enrollment) => {
      if (`${enrollment.reference} ${enrollment.courseName}`.toLowerCase().includes(term)) {
        results.push({ key: `e-${enrollment.id}`, label: enrollment.reference, detail: enrollment.courseName, module: "Enrollments" });
      }
    });
    state.submissions.forEach((submission) => {
      if (`${submission.reference} ${fullName(submission.applicant)}`.toLowerCase().includes(term)) {
        results.push({ key: `r-${submission.id}`, label: submission.reference, detail: `Registration · ${fullName(submission.applicant)}`, module: "Registrations" });
      }
    });
    state.batches.forEach((batch) => {
      if (`${batch.batchNumber} ${batch.courseName}`.toLowerCase().includes(term)) {
        results.push({ key: `b-${batch.id}`, label: batch.batchNumber, detail: batch.courseName, module: "Schedules" });
      }
    });
    return results.slice(0, 8);
  }, [search, state.batches, state.enrollments, state.submissions, state.trainees]);

  function go(module: Module) {
    setActive(module);
    setSidebarOpen(false);
    setSearch("");
  }

  if (!ready) {
    return (
      <div className="portal-loading">
        <NewWaveLogo />
        <p>Loading workspace…</p>
      </div>
    );
  }

  return (
    <main className="portal">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <NewWaveLogo inverted />
        </div>
        <label className="role-picker">
          <span>Working as</span>
          <select
            value={role}
            onChange={(event) => {
              const next = event.target.value as Role;
              setRole(next);
              setActor(next);
              setActive("Dashboard");
            }}
          >
            {roles.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <nav aria-label="Staff workspace">
          {visibleNav.map((item) => (
            <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => go(item.label)}>
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.label === "Requests" && pendingRequests > 0 && <small>{pendingRequests}</small>}
              {item.label === "Registrations" && pendingRegistrations > 0 && <small>{pendingRegistrations}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar avatar-light">JE</span>
          <div>
            <strong>Jocelyn Eala</strong>
            <span>{actor}</span>
          </div>
          <Link href="/" aria-label="Back to the public website">
            ↗
          </Link>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation">
            ☰
          </button>
          <div className="topbar-search">
            <label>
              <span aria-hidden="true">⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search trainee, enrollment, registration, or batch"
              />
            </label>
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((result) => (
                  <button key={result.key} onClick={() => go(result.module)}>
                    <strong>{result.label}</strong>
                    <small>{result.detail}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          {previewMode && <Pill tone="blue">Secure preview</Pill>}
          <div className="topbar-actions">
            <button
              className="bell"
              aria-label={`Notifications, ${unread.length} unread`}
              onClick={() => {
                setNotificationsOpen(!notificationsOpen);
                if (!notificationsOpen) markNotificationsRead();
              }}
            >
              ○{unread.length > 0 && <span>{unread.length}</span>}
            </button>
            <div className="today-block">
              <span>Today</span>
              <strong>{formatDate(todayIso())}</strong>
            </div>
          </div>
          {notificationsOpen && (
            <div className="notification-popover">
              <header>
                <h3>Notifications</h3>
                <button className="link-button" onClick={() => setNotificationsOpen(false)}>
                  Close
                </button>
              </header>
              {staffNotifications.slice(0, 8).map((item) => (
                <div key={item.id} className="notification-row">
                  <i aria-hidden="true" />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                    <small className="muted-text">{formatDateTime(item.createdAt)}</small>
                  </div>
                </div>
              ))}
              {staffNotifications.length === 0 && <p className="muted-text notification-empty">No notifications yet.</p>}
            </div>
          )}
        </header>

        {active === "Dashboard" && <Dashboard role={role} go={go} />}
        {active === "Registrations" && <RegistrationsModule go={go} />}
        {active === "Trainees" && <TraineesModule go={go} role={role} />}
        {active === "Enrollments" && <EnrollmentsModule go={go} />}
        {active === "Courses & centers" && <CatalogModule role={role} />}
        {active === "Schedules" && <SchedulesModule />}
        {active === "Payments" && <PaymentsModule />}
        {active === "Accounting" && <AccountingModule role={role} />}
        {active === "Instructions" && <InstructionsModule />}
        {active === "Attendance" && <AttendanceModule />}
        {active === "Certificates" && <CertificatesModule go={go} />}
        {active === "Requests" && <RequestsModule />}
        {active === "HR & payroll" && <HrModule />}
        {active === "Reports" && <ReportsModule />}
        {active === "Settings" && <SettingsModule />}
      </section>

      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    </main>
  );
}

export function PortalApp({ previewMode = false }: { previewMode?: boolean }) {
  return (
    <SystemProvider>
      <ToastProvider>
        <PortalShell previewMode={previewMode} />
      </ToastProvider>
    </SystemProvider>
  );
}
