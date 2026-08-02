"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState, Field, Modal, Pill, Segmented, StatCard, ToastProvider, useToast } from "@/components/ui/kit";
import { NewWaveLogo } from "./new-wave-logo";
import { AttendanceModule } from "./portal/module-attendance";
import { CertificatesModule } from "./portal/module-certificates";
import { EnrollmentsModule } from "./portal/module-enrollments";
import {
  AccountingModule,
  SuppliesModule,
  CatalogModule,
  HrRequestModule,
  InstructionsModule,
  PayrollModule,
  ReportsModule,
  RequestsModule,
  SettingsModule,
  TraineesModule,
  UserSetupModule,
} from "./portal/module-others";
import { PaymentsModule, ExpenseVouchersModule } from "./portal/module-payments";
import { SchedulesModule } from "./portal/module-schedules";
import { ClassroomsModule, InstructorsModule, TrainingSetupModule } from "./portal/module-training";
import { SearchTraineeModule, SetupModule } from "./portal/module-admin";
import { PageHeader, Panel, StageBadge, type Module } from "./portal/shared";
import { pesos } from "@/lib/endorsement-catalog";
import { SystemProvider, formatDate, formatDateTime, fullName, todayIso, useSystem } from "@/lib/system/store";
import type { MonthlyPayable, Role } from "@/lib/system/types";

const roles: Role[] = ["Admin", "Registration", "Cashier", "Accounting", "Training Operations", "HR", "Instructor"];

/** Dashboard reminder of the month's recurring bills for Accounting + Admin. */
function MonthlyPayablesReminder({ payables }: { payables: MonthlyPayable[] }) {
  const active = payables.filter((item) => item.active).sort((a, b) => a.dueDay - b.dueDay);
  const total = active.reduce((sum, item) => sum + item.amountCentavos, 0);
  const todayDay = new Date().getDate();
  return (
    <Panel title="Monthly payables — reminder" description="Recurring bills due this month">
      {active.length === 0 ? (
        <div className="empty-block"><span aria-hidden="true">✓</span><h3>No payables set</h3><p>Add recurring bills in Accounting → Invoices &amp; Vouchers.</p></div>
      ) : (
        <>
          <div className="finance-strip">
            <div className="finance-lead">
              <span>Total this month</span>
              <strong>{pesos(total)}</strong>
              <small>{active.length} payable{active.length === 1 ? "" : "s"}</small>
            </div>
          </div>
          <div className="history-list">
            {active.map((item) => {
              const dueSoon = item.dueDay >= todayDay && item.dueDay - todayDay <= 7;
              const overdue = item.dueDay < todayDay;
              return (
                <div key={item.id} className="history-row">
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.category} · due day {item.dueDay}{item.notes ? ` · ${item.notes}` : ""}</small>
                  </div>
                  <div className="history-right">
                    <strong>{pesos(item.amountCentavos)}</strong>
                    {overdue ? <Pill tone="red">Overdue</Pill> : dueSoon ? <Pill tone="amber">Due soon</Pill> : <Pill tone="slate">Day {item.dueDay}</Pill>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}

const nav: { label: Module; icon: string; roles?: Role[] }[] = [
  { label: "Dashboard", icon: "⌂" },
  { label: "Search trainee", icon: "⌕", roles: ["Admin"] },
  { label: "Registrations", icon: "✎", roles: ["Registration", "Accounting"] },
  { label: "Endorsed courses", icon: "◇", roles: ["Registration", "Training Operations"] },
  { label: "Schedules", icon: "□", roles: ["Registration", "Training Operations", "Instructor"] },
  { label: "Payments", icon: "₱", roles: ["Cashier", "Accounting"] },
  { label: "Expense vouchers", icon: "◰", roles: ["Cashier", "Accounting", "Admin"] },
  { label: "Accounting", icon: "▥", roles: ["Admin", "Accounting"] },
  { label: "Supplies", icon: "▣", roles: ["Admin", "Accounting"] },
  { label: "Instructions", icon: "✉", roles: ["Registration", "Training Operations"] },
  { label: "Attendance", icon: "✓", roles: ["Training Operations", "Instructor"] },
  { label: "Classrooms", icon: "▦", roles: ["Training Operations"] },
  { label: "Certificates", icon: "◈", roles: ["Training Operations"] },
  { label: "Training setup", icon: "⚙", roles: ["Training Operations"] },
  { label: "Requests", icon: "↗", roles: ["Registration", "Admin", "Cashier", "Accounting", "Training Operations", "Instructor"] },
  { label: "User setup", icon: "◎", roles: ["HR"] },
  { label: "Instructors", icon: "◎", roles: ["HR"] },
  { label: "Payroll", icon: "♙", roles: ["HR"] },
  { label: "Request", icon: "↗", roles: ["HR"] },
  { label: "Setup", icon: "⚙", roles: ["Admin"] },
  { label: "Reports", icon: "↥", roles: ["Admin", "Cashier", "Accounting"] },
  { label: "Settings", icon: "⚙", roles: ["Admin"] },
];

/* --------------------------------------------------------------- dashboard */

function Dashboard({ role, go }: { role: Role; go: (module: Module) => void }) {
  const { state, views, postAnnouncement, updateAnnouncement, removeAnnouncement } = useSystem();
  const toast = useToast();
  const all = views();
  const canManageAnnouncements = role === "Admin" || role === "Accounting";
  const [annDraft, setAnnDraft] = useState<{ id: string | null; title: string; body: string; expiresOn: string; pinned: boolean } | null>(null);

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
  // "Registered today" reflects enrollments created today (consistent with the
  // enrollment-based cards below), not raw public submissions.
  const newlyRegistered = all.filter((item) => (item.enrollment.createdAt ?? "").slice(0, 10) === today);
  const activeEnrollments = all.filter((item) => item.stage !== "Cancelled");

  const activeAnnouncements = [...state.announcements]
    .filter((item) => !item.expiresOn || item.expiresOn >= today)
    .sort(
      (left, right) =>
        Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || right.postedAt.localeCompare(left.postedAt),
    );

  const isRegistration = role === "Registration";
  const isAccounting = role === "Accounting";
  const isTrainingOps = role === "Training Operations";
  const isCashier = role === "Cashier";
  const isHR = role === "HR";
  const isAdmin = role === "Admin";
  const [adminSpan, setAdminSpan] = useState<"Today" | "This week" | "This month">("Today");
  const [boardSpan, setBoardSpan] = useState<"Daily" | "Weekly" | "Monthly">("Daily");
  const [certFilter, setCertFilter] = useState<"Drafted" | "Printed" | "Released">("Drafted");
  const [dueWindow, setDueWindow] = useState<"Tomorrow" | "Within 3 days" | "This week">("Tomorrow");

  // ---- registration officer's daily desk ---------------------------------
  const threeDaysOut = (() => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date.toISOString().slice(0, 10);
  })();
  const needsConfirmation = activeEnrollments.filter((item) => item.enrollment.registrationStatus === "Waiting for Payment");
  const needsSlip = activeEnrollments.filter(
    (item) => !item.enrollment.admissionSlipGeneratedAt && item.enrollment.registrationStatus !== "Cancelled",
  );
  const startingSoon = activeEnrollments.filter(
    (item) => item.batch && item.batch.startsOn >= today && item.batch.startsOn <= threeDaysOut,
  );
  const registrationRequests = state.requests.filter((item) => item.status === "Pending" || item.status === "For clarification");

  const metrics: Record<Role, { label: string; value: string; note: string; icon: string; module: Module }[]> = {
    Admin: [
      { label: "Collections today", value: pesos(collectionsToday), note: `${pendingPayments.length} to verify`, icon: "₱", module: "Accounting" },
      { label: "Outstanding", value: pesos(outstanding), note: `${all.filter((item) => item.balanceCentavos > 0).length} enrollments`, icon: "!", module: "Accounting" },
      { label: "Pending approvals", value: String(pendingRequests.length), note: "Requests and changes", icon: "↗", module: "Requests" },
      { label: "Trainee lookup", value: String(state.trainees.length), note: "Search records", icon: "⌕", module: "Search trainee" },
      { label: "Setup", value: String(state.employees.length), note: "Accounts & catalog", icon: "⚙", module: "Setup" },
      { label: "Reports", value: String(5), note: "Audited exports", icon: "↥", module: "Reports" },
    ],
    Registration: [
      { label: "Registered today", value: String(newlyRegistered.length), note: "Who registered", icon: "✎", module: "Registrations" },
      { label: "Needs confirmation", value: String(needsConfirmation.length), note: "Waiting for payment", icon: "!", module: "Registrations" },
      { label: "Needs admission slip", value: String(needsSlip.length), note: "Not yet generated", icon: "◈", module: "Registrations" },
      { label: "Starting soon", value: String(startingSoon.length), note: "Within 3 days", icon: "□", module: "Registrations" },
      { label: "Requests to action", value: String(registrationRequests.length), note: "Trainee requests", icon: "↗", module: "Registrations" },
      { label: "Active enrollments", value: String(activeEnrollments.length), note: "All batches", icon: "▤", module: "Registrations" },
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
      { label: "Partner offers", value: String(96), note: "Endorsed catalog", icon: "◇", module: "Reports" },
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
      { label: "Active employees", value: String(state.employees.filter((employee) => employee.status === "Active").length), note: `${state.employees.filter((employee) => employee.department === "Training").length} in training`, icon: "◎", module: "User setup" },
      { label: "Pending leave", value: String(state.leaveRequests.filter((leave) => leave.status === "Pending").length), note: "Awaiting a decision", icon: "!", module: "Request" },
      { label: "Payroll status", value: openPayroll?.status ?? "Finalized", note: openPayroll?.periodNumber ?? "All periods closed", icon: "₱", module: "Payroll" },
      { label: "Approved leave", value: String(state.leaveRequests.filter((leave) => leave.status === "Approved").length), note: "This period", icon: "✓", module: "Request" },
      { label: "Cash advances", value: String(state.cashAdvances.filter((advance) => advance.status === "Pending").length), note: "Pending approval", icon: "□", module: "Request" },
      { label: "Payroll periods", value: String(state.payrollPeriods.length), note: "Draft → review → finalize", icon: "▥", module: "Payroll" },
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
          role === "Cashier" ? undefined : (
            <button
              className="primary-button"
              onClick={() => go(role === "Instructor" ? "Attendance" : role === "HR" ? "Payroll" : "Registrations")}
            >
              {role === "Instructor" ? "Start attendance" : role === "HR" ? "Open payroll" : "Review registrations"}
            </button>
          )
        }
      />

      {(activeAnnouncements.length > 0 || canManageAnnouncements) && (
        <Panel
          title="Announcement board"
          description="Posted by the Admin / Accounting Manager"
          action={
            canManageAnnouncements ? (
              <button className="link-button" onClick={() => setAnnDraft({ id: null, title: "", body: "", expiresOn: "", pinned: false })}>
                ＋ New announcement
              </button>
            ) : (
              <Pill tone="blue">{activeAnnouncements.length} active</Pill>
            )
          }
        >
          {activeAnnouncements.length === 0 ? (
            <EmptyState icon="📣" title="No announcements" text="Post an update for all staff." />
          ) : (
            activeAnnouncements.map((item) => (
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
                {canManageAnnouncements && (
                  <div className="cell-actions">
                    <button
                      className="ghost-button"
                      onClick={() => setAnnDraft({ id: item.id, title: item.title, body: item.body, expiresOn: item.expiresOn ?? "", pinned: Boolean(item.pinned) })}
                    >
                      Edit
                    </button>
                    <button
                      className="ghost-button ghost-danger"
                      onClick={() => {
                        removeAnnouncement(item.id);
                        toast("warning", "Announcement removed.");
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </Panel>
      )}

      <div className="stat-grid stat-grid-6">
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

      {isAccounting && (() => {
        const verifiedToday = state.ledger.filter(
          (entry) => entry.type === "payment" && entry.verification === "Verified" && entry.recordedAt.slice(0, 10) === today,
        );
        const collectionTotal = verifiedToday.reduce((sum, entry) => sum + entry.amountCentavos, 0);
        const collectionByChannel = state.paymentChannels
          .filter((channel) => channel.active)
          .map((channel) => ({
            name: channel.name,
            total: verifiedToday.filter((entry) => entry.method === channel.name).reduce((sum, entry) => sum + entry.amountCentavos, 0),
            count: verifiedToday.filter((entry) => entry.method === channel.name).length,
          }));
        const disbursements = [
          ...state.ledger
            .filter((entry) => (entry.type === "refund" || entry.type === "reversal") && entry.recordedAt.slice(0, 10) === today)
            .map((entry) => ({ channel: entry.method ?? "Other", amountCentavos: entry.amountCentavos })),
          ...state.expenses
            .filter((expense) => (expense.status === "Paid" || expense.status === "Approved") && (expense.decidedAt ?? expense.createdAt).slice(0, 10) === today)
            .map((expense) => ({ channel: expense.modeOfPayment || "Cash", amountCentavos: expense.amountCentavos })),
        ];
        const disbursementTotal = disbursements.reduce((sum, item) => sum + item.amountCentavos, 0);
        const disbursementChannels = Array.from(new Set(disbursements.map((item) => item.channel))).map((channel) => ({
          name: channel,
          total: disbursements.filter((item) => item.channel === channel).reduce((sum, item) => sum + item.amountCentavos, 0),
          count: disbursements.filter((item) => item.channel === channel).length,
        }));
        return (
          <>
            <Panel title="Daily collections" description="Verified collections across all payment channels — today">
              <div className="finance-strip">
                <div className="finance-lead">
                  <span>Total collected today</span>
                  <strong>{pesos(collectionTotal)}</strong>
                  <small>{verifiedToday.length} payment{verifiedToday.length === 1 ? "" : "s"}</small>
                </div>
                {collectionByChannel.map((channel) => (
                  <article key={channel.name}>
                    <span>{channel.name}</span>
                    <strong>{pesos(channel.total)}</strong>
                    <small>{channel.count} payment{channel.count === 1 ? "" : "s"}</small>
                  </article>
                ))}
              </div>
            </Panel>

            <Panel title="Disbursement" description="Refunds, reversals, and paid/approved expense vouchers — today">
              <div className="finance-strip">
                <div className="finance-lead">
                  <span>Total disbursed today</span>
                  <strong>{pesos(disbursementTotal)}</strong>
                  <small>{disbursements.length} disbursement{disbursements.length === 1 ? "" : "s"}</small>
                </div>
                {disbursementChannels.length === 0 ? (
                  <article><span>No disbursements</span><strong>{pesos(0)}</strong><small>today</small></article>
                ) : (
                  disbursementChannels.map((channel) => (
                    <article key={channel.name}>
                      <span>{channel.name}</span>
                      <strong>{pesos(channel.total)}</strong>
                      <small>{channel.count} item{channel.count === 1 ? "" : "s"}</small>
                    </article>
                  ))
                )}
              </div>
            </Panel>

            <Panel
              title="Opening / closing — today"
              description="Net cash movement today"
              action={<button className="secondary-button" onClick={() => go("Reports")}>Open full report</button>}
            >
              <div className="finance-strip">
                <div className="finance-lead">
                  <span>Net movement today</span>
                  <strong>{pesos(collectionTotal - disbursementTotal)}</strong>
                  <small>Received − disbursed</small>
                </div>
                <article><span>Received</span><strong>{pesos(collectionTotal)}</strong><small>all channels</small></article>
                <article><span>Disbursed</span><strong>{pesos(disbursementTotal)}</strong><small>all channels</small></article>
              </div>
            </Panel>

            <MonthlyPayablesReminder payables={state.monthlyPayables} />
          </>
        );
      })()}

      {isTrainingOps && (() => {
        const weekStart = (() => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); })();
        const weekEnd = (() => { const d = new Date(weekStart); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })();
        const horizon = (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); })();
        const upcomingBatches = state.batches
          .filter((batch) => batch.startsOn >= today && batch.startsOn <= horizon && batch.status !== "Cancelled")
          .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
        const weekBatches = state.batches
          .filter((batch) => batch.startsOn <= weekEnd && batch.endsOn >= weekStart && batch.status !== "Cancelled")
          .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
        const certStatus = certFilter === "Drafted" ? "Ready to Print" : certFilter;
        const certRows = all.filter((item) => item.certificate?.status === certStatus);
        return (
          <>
            <Panel title="Trainees for upcoming schedules" description="Batches starting within the next 14 days">
              {upcomingBatches.length === 0 ? (
                <div className="empty-block"><span aria-hidden="true">□</span><h3>No upcoming batches</h3><p>Open or publish a batch to see its trainees here.</p></div>
              ) : (
                upcomingBatches.map((batch) => {
                  const trainees = all.filter((item) => item.enrollment.batchId === batch.id && item.stage !== "Cancelled");
                  return (
                    <div key={batch.id} className="activity-row">
                      <div>
                        <strong>{batch.courseName} · {formatDate(batch.startsOn)}</strong>
                        <small>{batch.instructor} · {batch.venue} · {trainees.length} trainee{trainees.length === 1 ? "" : "s"}: {trainees.map((t) => fullName(t.trainee)).join(", ") || "none yet"}</small>
                      </div>
                      <Pill tone="blue">{batch.batchNumber}</Pill>
                    </div>
                  );
                })
              )}
            </Panel>

            <div className="two-column">
              <Panel
                title="Certificates"
                description="Filter by status"
                action={
                  <select value={certFilter} onChange={(event) => setCertFilter(event.target.value as typeof certFilter)}>
                    <option>Drafted</option>
                    <option>Printed</option>
                    <option>Released</option>
                  </select>
                }
              >
                {certRows.length === 0 ? (
                  <div className="empty-block"><span aria-hidden="true">◈</span><h3>None {certFilter.toLowerCase()}</h3><p>No certificates in this status.</p></div>
                ) : (
                  certRows.map((item) => (
                    <div key={item.enrollment.id} className="activity-row">
                      <div>
                        <strong>{fullName(item.trainee)}</strong>
                        <small>{item.enrollment.courseName} · {item.certificate?.certificateNumber ?? "No number yet"}</small>
                      </div>
                      <Pill tone={certFilter === "Released" ? "green" : certFilter === "Printed" ? "blue" : "amber"}>{certFilter}</Pill>
                    </div>
                  ))
                )}
              </Panel>

              <Panel title="This week's schedule" description={`${formatDate(weekStart)} – ${formatDate(weekEnd)}`}>
                {weekBatches.length === 0 ? (
                  <div className="empty-block"><span aria-hidden="true">□</span><h3>No sessions this week</h3><p>Nothing is scheduled for the current week.</p></div>
                ) : (
                  weekBatches.map((batch) => (
                    <div key={batch.id} className="activity-row">
                      <div>
                        <strong>{batch.courseName}</strong>
                        <small>{formatDate(batch.startsOn)}–{formatDate(batch.endsOn)} · {batch.instructor} · {batch.venue}</small>
                      </div>
                      <Pill tone="slate">{batch.batchNumber}</Pill>
                    </div>
                  ))
                )}
              </Panel>
            </div>
          </>
        );
      })()}

      {isCashier && (() => {
        const days = dueWindow === "Tomorrow" ? 1 : dueWindow === "Within 3 days" ? 3 : 7;
        const limit = (() => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); })();
        const dueSoon = all
          .filter((item) => item.balanceCentavos > 0 && item.batch && item.batch.startsOn >= today && item.batch.startsOn <= limit && item.stage !== "Cancelled")
          .sort((a, b) => (a.batch?.startsOn ?? "").localeCompare(b.batch?.startsOn ?? ""));
        return (
          <Panel
            title="Trainees with pending balances before training"
            description="Follow up on unpaid balances ahead of the training date"
            action={
              <select value={dueWindow} onChange={(event) => setDueWindow(event.target.value as typeof dueWindow)}>
                <option>Tomorrow</option>
                <option>Within 3 days</option>
                <option>This week</option>
              </select>
            }
          >
            {dueSoon.length === 0 ? (
              <div className="empty-block"><span aria-hidden="true">✓</span><h3>Nothing due {dueWindow.toLowerCase()}</h3><p>No trainee has an outstanding balance for a training starting in this window.</p></div>
            ) : (
              dueSoon.map((item) => (
                <button key={item.enrollment.id} className="activity-row row-clickable" onClick={() => go("Payments")}>
                  <div>
                    <strong>{fullName(item.trainee)}</strong>
                    <small>{item.enrollment.courseName} · starts {formatDate(item.batch!.startsOn)} · {item.enrollment.reference}</small>
                  </div>
                  <strong className="value-danger">{pesos(item.balanceCentavos)} due</strong>
                </button>
              ))
            )}
          </Panel>
        );
      })()}

      {isHR && (() => {
        const active = state.employees.filter((employee) => employee.status === "Active");
        const board = active
          .map((employee) => {
            const records = state.hrAttendance.filter((record) => record.employeeId === employee.id);
            const present = records.filter((record) => record.status !== "Absent").length;
            const onTime = records.filter((record) => record.status === "Present").length;
            const score = present * 2 + onTime; // present days weighted, on-time bonus
            return { employee, present, onTime, total: records.length, score };
          })
          .sort((a, b) => b.score - a.score);
        const maxScore = Math.max(1, ...board.map((row) => row.score));
        return (
          <div className="two-column">
            <Panel title="Active employees" description={`${active.length} on the roster`}>
              {active.length === 0 ? (
                <div className="empty-block"><span aria-hidden="true">◎</span><h3>No active employees</h3><p>Add employees under HR &amp; payroll → User setup.</p></div>
              ) : (
                active.map((employee) => (
                  <div key={employee.id} className="activity-row">
                    <div>
                      <strong>{employee.name}</strong>
                      <small>{employee.position} · {employee.department} · {employee.employmentType}</small>
                    </div>
                    <Pill tone="green">Active</Pill>
                  </div>
                ))
              )}
            </Panel>

            <Panel title="Performance leaderboard" description="Ranked by attendance (present days + on-time)">
              {board.every((row) => row.total === 0) ? (
                <div className="empty-block"><span aria-hidden="true">▤</span><h3>No attendance yet</h3><p>Log daily attendance to build the leaderboard.</p></div>
              ) : (
                board.map((row, index) => (
                  <div key={row.employee.id} className="leaderboard-row">
                    <span className={`rank ${index === 0 ? "gold" : ""}`}>{index + 1}</span>
                    <div className="leaderboard-copy">
                      <strong>{row.employee.name}</strong>
                      <div className="leaderboard-bar"><i style={{ width: `${Math.round((row.score / maxScore) * 100)}%` }} /></div>
                    </div>
                    <b className="leaderboard-count">{row.present}/{row.total} · {row.onTime} on-time</b>
                  </div>
                ))
              )}
            </Panel>
          </div>
        );
      })()}

      {isAdmin && (() => {
        const fromFor = (label: string) => {
          const d = new Date();
          if (label === "Today" || label === "Daily") return today;
          if (label === "This week" || label === "Weekly") { d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); }
          return `${today.slice(0, 8)}01`; // month-to-date
        };
        const from = fromFor(adminSpan);
        const inSpan = (value?: string | null) => Boolean(value) && value!.slice(0, 10) >= from && value!.slice(0, 10) <= today;
        const enrollCount = all.filter((item) => inSpan(item.enrollment.createdAt)).length;
        const sales = state.ledger.filter((e) => e.type === "payment" && e.verification === "Verified" && inSpan(e.recordedAt)).reduce((s, e) => s + e.amountCentavos, 0);
        const disbursement =
          state.ledger.filter((e) => (e.type === "refund" || e.type === "reversal") && inSpan(e.recordedAt)).reduce((s, e) => s + e.amountCentavos, 0) +
          state.expenses.filter((x) => (x.status === "Paid" || x.status === "Approved") && inSpan(x.decidedAt ?? x.createdAt)).reduce((s, x) => s + x.amountCentavos, 0);

        const boardFrom = fromFor(boardSpan);
        const boardEnrolls = all.filter((item) => item.enrollment.createdAt.slice(0, 10) >= boardFrom && item.stage !== "Cancelled");
        const rank = (keyOf: (item: (typeof boardEnrolls)[number]) => string | undefined, limit: number) => {
          const map = new Map<string, number>();
          boardEnrolls.forEach((item) => { const k = keyOf(item); if (k) map.set(k, (map.get(k) ?? 0) + 1); });
          return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
        };
        const courses = rank((item) => item.enrollment.courseName, 3);
        const officers = rank((item) => item.enrollment.processedBy, 5);
        const agencies = rank((item) => item.enrollment.agencyName, 5);
        const board = (title: string, rows: [string, number][], empty: string) => {
          const max = rows[0]?.[1] ?? 1;
          return (
            <Panel title={title} description={`This ${boardSpan.toLowerCase().replace("ly", "")} · by enrollments`}>
              {rows.length === 0 ? (
                <div className="empty-block"><span aria-hidden="true">▤</span><h3>{empty}</h3><p>No data in this period.</p></div>
              ) : rows.map(([name, count], index) => (
                <div key={name} className="leaderboard-row">
                  <span className={`rank ${index === 0 ? "gold" : ""}`}>{index + 1}</span>
                  <div className="leaderboard-copy"><strong>{name}</strong><div className="leaderboard-bar"><i style={{ width: `${Math.round((count / max) * 100)}%` }} /></div></div>
                  <b className="leaderboard-count">{count}</b>
                </div>
              ))}
            </Panel>
          );
        };
        return (
          <>
            <div className="finance-strip">
              <div className="finance-lead">
                <span>Net sales · {adminSpan}</span>
                <strong>{pesos(sales - disbursement)}</strong>
                <small>Sales − disbursement</small>
              </div>
              <article><span>Enrollments</span><strong>{enrollCount}</strong><small>{adminSpan}</small></article>
              <article><span>Total sales</span><strong>{pesos(sales)}</strong><small>Verified collections</small></article>
              <article><span>Total disbursement</span><strong>{pesos(disbursement)}</strong><small>Refunds + expenses</small></article>
            </div>
            <div className="toolbar toolbar-wrap" style={{ padding: "0 4px" }}>
              <Segmented options={["Today", "This week", "This month"] as const} value={adminSpan} onChange={setAdminSpan} />
            </div>

            <div className="toolbar toolbar-wrap" style={{ padding: "8px 4px 0" }}>
              <strong style={{ color: "var(--blue-dark)" }}>Performance leaderboard</strong>
              <Segmented options={["Daily", "Weekly", "Monthly"] as const} value={boardSpan} onChange={setBoardSpan} />
            </div>
            <div className="two-column">
              {board("Most enrolled courses", courses, "No enrollments")}
              {board("Top registration officers", officers, "No attributed enrollments")}
            </div>
            {board("Top consultancies / agencies", agencies, "No agency-referred enrollments")}

            <MonthlyPayablesReminder payables={state.monthlyPayables} />
          </>
        );
      })()}

      {isRegistration && (
        <Panel title="Requests requiring action" description="Trainee change requests still open">
          {registrationRequests.length === 0 ? (
            <div className="empty-block"><span aria-hidden="true">✓</span><h3>Nothing pending</h3><p>No trainee requests need attention right now.</p></div>
          ) : (
            registrationRequests.map((request) => (
              <div key={request.id} className="activity-row">
                <div>
                  <strong>{request.traineeName} · {request.type}</strong>
                  <small>{request.reference} · {request.reason}</small>
                </div>
                <Pill tone={request.status === "For clarification" ? "amber" : "slate"}>{request.status}</Pill>
              </div>
            ))
          )}
        </Panel>
      )}

      {!isRegistration && !isAccounting && !isTrainingOps && !isCashier && !isHR && !isAdmin && (
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

      <Modal
        open={Boolean(annDraft)}
        title={annDraft?.id ? "Edit announcement" : "New announcement"}
        description="Shown on every staff dashboard until removed or expired."
        onClose={() => setAnnDraft(null)}
        wide
        footer={
          <>
            <button className="secondary-button" onClick={() => setAnnDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!annDraft) return;
                const title = annDraft.title.trim();
                const body = annDraft.body.trim();
                if (!title || !body) {
                  toast("warning", "Title and message are required.");
                  return;
                }
                const payload = { title, body, expiresOn: annDraft.expiresOn || undefined, pinned: annDraft.pinned };
                if (annDraft.id) {
                  updateAnnouncement(annDraft.id, payload);
                  toast("success", "Announcement updated.");
                } else {
                  postAnnouncement(payload);
                  toast("success", "Announcement posted.");
                }
                setAnnDraft(null);
              }}
            >
              {annDraft?.id ? "Save changes" : "Post announcement"}
            </button>
          </>
        }
      >
        {annDraft && (
          <div className="form-grid">
            <Field label="Title*" full>
              <input value={annDraft.title} onChange={(event) => setAnnDraft({ ...annDraft, title: event.target.value })} />
            </Field>
            <Field label="Message*" full>
              <textarea rows={4} value={annDraft.body} onChange={(event) => setAnnDraft({ ...annDraft, body: event.target.value })} />
            </Field>
            <Field label="Show until (optional)" hint="Auto-hides after this date">
              <input type="date" value={annDraft.expiresOn} onChange={(event) => setAnnDraft({ ...annDraft, expiresOn: event.target.value })} />
            </Field>
            <label className="inline-field inline-check">
              <input type="checkbox" checked={annDraft.pinned} onChange={(event) => setAnnDraft({ ...annDraft, pinned: event.target.checked })} />
              <span>Pin to top</span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Consolidated Registrations hub: Trainees + Enrollments in one place. Admin
 * oversees Trainees only (enrollment operations were removed from Admin). */
function RegistrationHub({ role, go }: { role: Role; go: (module: Module) => void }) {
  const tabs: ("Trainees" | "Enrollments")[] = role === "Admin" ? ["Trainees"] : ["Trainees", "Enrollments"];
  const [tab, setTab] = useState<"Trainees" | "Enrollments">("Trainees");
  const active = tabs.includes(tab) ? tab : "Trainees";
  return (
    <>
      <div className="hub-tabs">
        {tabs.map((item) => (
          <button key={item} className={active === item ? "active" : ""} onClick={() => setTab(item)}>
            {item === "Enrollments" ? "Enrollments Summary" : item}
          </button>
        ))}
      </div>
      {active === "Enrollments" ? <EnrollmentsModule go={go} role={role} /> : <TraineesModule go={go} role={role} />}
    </>
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
          {previewMode && <Pill tone="blue">Prototype · sample data</Pill>}
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
        {active === "Registrations" && <RegistrationHub role={role} go={go} />}
        {active === "Trainees" && <TraineesModule go={go} role={role} />}
        {active === "Enrollments" && <EnrollmentsModule go={go} role={role} />}
        {active === "Endorsed courses" && <CatalogModule role={role} />}
        {active === "Schedules" && <SchedulesModule role={role} />}
        {active === "Payments" && <PaymentsModule role={role} />}
        {active === "Expense vouchers" && <ExpenseVouchersModule role={role} />}
        {active === "Accounting" && <AccountingModule role={role} />}
        {active === "Supplies" && <SuppliesModule role={role} />}
        {active === "Instructions" && <InstructionsModule />}
        {active === "Attendance" && <AttendanceModule />}
        {active === "Instructors" && <InstructorsModule />}
        {active === "Classrooms" && <ClassroomsModule />}
        {active === "Training setup" && <TrainingSetupModule />}
        {active === "Certificates" && <CertificatesModule go={go} />}
        {active === "Requests" && <RequestsModule role={role} />}
        {active === "User setup" && <UserSetupModule />}
        {active === "Payroll" && <PayrollModule />}
        {active === "Request" && <HrRequestModule />}
        {active === "Search trainee" && <SearchTraineeModule />}
        {active === "Setup" && <SetupModule />}
        {active === "Reports" && <ReportsModule role={role} />}
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

