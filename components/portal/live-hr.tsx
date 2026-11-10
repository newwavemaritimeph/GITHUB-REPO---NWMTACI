"use client";

import { useMemo, useState, type ReactNode } from "react";
import { askConfirm } from "./dialogs";
import { ActionsMenu, Badge, Message, submit } from "./shared-ui";
import { HrFormModal, fromCentavos, toCentavos, type HrField } from "./hr-forms";
import { HrPeople, hrPost, shortDate, toneOf, useHrDue, type HrPlus } from "./hr-people";
import { dueLabel, KIND_LABEL } from "@/lib/hr-due";

/** Loose shapes for the HR slices of the staff-operations payload. */
type Employee = { id: string; employee_number: string; complete_name: string; position: string; employment_status: string; date_hired: string; pay_type: string; base_rate_centavos: number; instructor_daily_rate_centavos?: number | null; work_email?: string | null; active: boolean };
type Attendance = { id: string; employee_id: string; attendance_date: string; checked_in_at?: string | null; checked_out_at?: string | null; minutes_late: number; minutes_undertime: number; status: string; remarks?: string | null };
type Leave = { id: string; employee_id: string; leave_type: string; starts_on: string; ends_on: string; reason: string; status: string; created_at: string };
type Advance = { id: string; employee_id: string; amount_centavos: number; requested_on: string; balance_centavos: number; status: string };
type Period = { id: string; period_number: string; starts_on: string; ends_on: string; pay_date: string; status: string; finalized_at?: string | null };
type PayItem = { id: string; payroll_period_id: string; employee_id: string; gross_centavos: number; deduction_centavos: number; net_centavos: number; breakdown?: Record<string, unknown> };
type Benefit = { id: string; employee_id: string; benefit_type: string; reference?: string | null; amount_centavos: number; effective_from?: string | null; effective_to?: string | null };
type Contract = { id: string; employee_id: string; contract_type: string; position?: string | null; rate_centavos?: number | null; starts_on: string; ends_on?: string | null; status: string; notes?: string | null };
export type HrData = { employees: Employee[]; employeeAttendance: Attendance[]; leaveRequests: Leave[]; cashAdvances: Advance[]; payrollPeriods: Period[]; payrollItems: PayItem[]; benefitRecords: Benefit[]; employmentContracts: Contract[] };

/**
 * HR workspace (owner, 10 Nov 2026: "Consolidated Tabs, Dropdowns, Buttons, Categorized"). Each screen is one item in
 * the portal's navy dropdown tabs, grouped as in the approved HR prototype. No tab row inside the page.
 */
export const HR_GROUPS = [
  ["People", ["Employees", "201 and checks"]],
  ["Time and Leave", ["Staff attendance", "Leave"]],
  ["Pay", ["Payroll", "13th month", "Cash advances", "Benefits", "Contracts"]],
  ["Requests", ["Change requests", "COE requests"]],
  ["Memos and Notices", ["Memos", "Document templates"]],
  ["Settings", ["Reminders"]],
] as const;
export type HrView = "HR dashboard" | (typeof HR_GROUPS)[number][1][number];
export const HR_VIEWS: HrView[] = ["HR dashboard", ...HR_GROUPS.flatMap(([, items]) => items)];
export const HR_LABEL: Partial<Record<HrView, string>> = { "HR dashboard": "Dashboard", "201 and checks": "201 and Checks", "13th month": "13th Month", "COE requests": "COE Requests", "Staff attendance": "Attendance" };
const hrTitle = (v: HrView) => HR_LABEL[v] ?? v.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and");
const groupOf = (v: HrView) => HR_GROUPS.find(([, items]) => (items as readonly string[]).includes(v))?.[0] ?? "HR";

function currentCutoff() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value), m = Number(parts.find((p) => p.type === "month")!.value), d = Number(parts.find((p) => p.type === "day")!.value);
  const mm = String(m).padStart(2, "0"), eom = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= 15 ? { startsOn: `${y}-${mm}-01`, endsOn: `${y}-${mm}-15`, payDate: `${y}-${mm}-15` } : { startsOn: `${y}-${mm}-16`, endsOn: `${y}-${mm}-${eom}`, payDate: `${y}-${mm}-${eom}` };
}
const pesos = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format((Number(centavos) || 0) / 100);
const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const clock = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso)) : "—");
const statusTone = (s: string) => (s === "Approved" || s === "Active" || s === "Finalized" ? "green" : s === "Rejected" || s === "Terminated" ? "red" : s === "Pending" || s === "Draft" ? "orange" : "slate");

type Form = { title: string; fields: HrField[]; initial?: Record<string, string>; submitLabel?: string; wide?: boolean; note?: string; save: (v: Record<string, string>) => Promise<void> } | null;

export function LiveHr({ data, role, reload, plus = null, view = "HR dashboard", go }: { data: HrData; role: string; reload: () => Promise<void>; plus?: HrPlus; view?: HrView; go?: (v: HrView) => void }) {
  const [form, setForm] = useState<Form>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(""), [show, setShow] = useState("Pending");
  const canManage = role === "admin" || role === "hr";
  const nameOf = useMemo(() => new Map(data.employees.map((e) => [e.id, e.complete_name])), [data.employees]);
  const active = data.employees.filter((e) => e.active);
  const empOptions: [string, string][] = active.map((e) => [e.id, `${e.complete_name} · ${e.employee_number}`]);
  const due = useHrDue(data.employees, plus);

  /** Saves through the operations endpoint; errors land inside the open form. */
  const save = async (body: Record<string, unknown>) => { await submit(body); await reload(); };
  /** One-click row actions (approve, archive): the message shows above the list. */
  const act = async (body: Record<string, unknown>, ok: string) => { setBusy(true); setMsg(null); try { await save(body); setMsg({ kind: "success", text: ok }); } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(false); } };

  /** Add or edit an employee: every 201 detail and the compensation in one form (owner, 10 Nov 2026), like the prototype's 201 tabs. */
  const employeeForm = (e?: Employee) => {
    const p = plus?.profiles.find((x) => x.id === e?.id), g = p?.government_ids ?? {}, pay = p?.payroll_account ?? {}, em = p?.emergency_contact ?? {};
    const status = e ? (["Active", "On Leave", "Suspended", "Separated"].includes(e.employment_status) ? e.employment_status : e.active ? "Active" : "Separated") : "Active";
    setForm({
      title: e ? `Edit Employee · ${e.complete_name}` : "Add Employee", submitLabel: e ? "Save Employee" : "Add Employee", wide: true,
      initial: {
        completeName: e?.complete_name ?? "", birthDate: p?.birth_date ?? "", sex: p?.sex ?? "", civilStatus: p?.civil_status ?? "", mobile: p?.mobile ?? "", personalEmail: p?.personal_email ?? "", address: p?.address ?? "",
        tin: g.tin ?? "", sss: g.sss ?? "", philhealth: g.philhealth ?? "", pagibig: g.pagibig ?? "",
        position: e?.position ?? "", employmentType: p?.employment_type ?? "Probationary", employmentStatus: status, dateHired: e?.date_hired ?? todayManila(), regularizationDate: p?.regularization_date ?? "", biometricId: p?.biometric_id ?? "", workEmail: e?.work_email ?? "", fitToWorkOn: p?.fit_to_work_on ?? "",
        payType: e && ["Monthly", "Daily", "Weekly"].includes(e.pay_type) ? e.pay_type : "Monthly", baseRate: fromCentavos(e?.base_rate_centavos), dailyRate: fromCentavos(e?.instructor_daily_rate_centavos), daysFactor: String(pay.days_factor ?? 313), allowance: fromCentavos(pay.allowance_centavos), payoutMethod: pay.method ?? "Cash", payoutAccount: pay.account ?? "",
        emergencyName: em.name ?? "", emergencyRelation: em.relation ?? "", emergencyMobile: em.mobile ?? "",
      },
      fields: [
        { key: "completeName", label: "Full Name", required: true, full: true, placeholder: "Last Name, First Name Middle Initial", section: "Personal" },
        { key: "birthDate", label: "Birth Date", type: "date" }, { key: "sex", label: "Sex", type: "select", options: ["Female", "Male"] },
        { key: "civilStatus", label: "Civil Status", type: "select", options: ["Single", "Married", "Widowed", "Separated"] }, { key: "mobile", label: "Mobile", placeholder: "09XX XXX XXXX" },
        { key: "personalEmail", label: "Personal Email", type: "email" }, { key: "address", label: "Address", full: true },
        { key: "tin", label: "TIN", placeholder: "000-000-000-000", section: "Government IDs" }, { key: "sss", label: "SSS No.", placeholder: "00-0000000-0" },
        { key: "philhealth", label: "PhilHealth No.", placeholder: "00-000000000-0" }, { key: "pagibig", label: "Pag-IBIG No.", placeholder: "0000-0000-0000" },
        { key: "position", label: "Position", required: true, section: "Employment" }, { key: "employmentType", label: "Employment Type", type: "select", required: true, options: ["Probationary", "Regular", "Project", "Contractual"] },
        { key: "employmentStatus", label: "Status", type: "select", required: true, options: ["Active", "On Leave", "Suspended", "Separated"] }, { key: "dateHired", label: "Date Hired", type: "date", required: true },
        { key: "regularizationDate", label: "Regularization Date", type: "date" }, { key: "biometricId", label: "Biometric ID", placeholder: "User No. on the Fingerprint Device" },
        { key: "workEmail", label: "Work Email (Portal Login)", type: "email" }, { key: "fitToWorkOn", label: "Last Medical Fit to Work", type: "date", max: todayManila() },
        { key: "payType", label: "Pay Type", type: "select", required: true, options: [["Monthly", "Monthly-Paid"], ["Daily", "Daily-Paid"], ["Weekly", "Weekly"]], section: "Compensation" },
        { key: "baseRate", label: "Basic Rate (PHP)", type: "number", min: "0", step: "0.01", required: true, placeholder: "Monthly salary or daily rate" },
        { key: "dailyRate", label: "Instructor Daily Rate (PHP)", type: "number", min: "0", step: "0.01", show: (v) => v.payType === "Daily" },
        { key: "daysFactor", label: "Work Week", type: "select", required: true, options: [["313", "6 Days (Factor 313)"], ["261", "5 Days (Factor 261)"]] },
        { key: "allowance", label: "Allowance per Month (PHP)", type: "number", min: "0", step: "0.01" },
        { key: "payoutMethod", label: "Paid Through", type: "select", required: true, options: ["Cash", "Bank", "GCash"] },
        { key: "payoutAccount", label: "Account No.", show: (v) => v.payoutMethod !== "Cash" },
        { key: "emergencyName", label: "Contact Name", section: "Emergency Contact" }, { key: "emergencyRelation", label: "Relationship" }, { key: "emergencyMobile", label: "Mobile" },
      ],
      save: async (v) => {
        await hrPost({ action: "hr-employee-save", id: e?.id ?? null, completeName: v.completeName, position: v.position, employmentType: v.employmentType, employmentStatus: v.employmentStatus, dateHired: v.dateHired, regularizationDate: v.regularizationDate || null, biometricId: v.biometricId, workEmail: v.workEmail,
          birthDate: v.birthDate || null, sex: v.sex, civilStatus: v.civilStatus, address: v.address, mobile: v.mobile, personalEmail: v.personalEmail, tin: v.tin, sss: v.sss, philhealth: v.philhealth, pagibig: v.pagibig,
          payType: v.payType, baseRateCentavos: toCentavos(v.baseRate), dailyRateCentavos: v.payType === "Daily" ? toCentavos(v.dailyRate) || toCentavos(v.baseRate) : null, daysFactor: Number(v.daysFactor), allowanceCentavos: toCentavos(v.allowance),
          payoutMethod: v.payoutMethod, payoutAccount: v.payoutAccount, emergencyName: v.emergencyName, emergencyRelation: v.emergencyRelation, emergencyMobile: v.emergencyMobile, fitToWorkOn: v.fitToWorkOn || null });
        await reload();
      },
    });
  };
  const leaveForm = () => setForm({ title: "File Leave", submitLabel: "File Leave", initial: { leaveType: "Vacation", startsOn: todayManila(), endsOn: todayManila() }, fields: [
    { key: "employeeId", label: "Employee", type: "select", required: true, options: empOptions, full: true },
    { key: "leaveType", label: "Leave Type", type: "select", required: true, options: ["Vacation", "Sick", "Emergency", "Service Incentive", "Maternity", "Paternity", "Solo Parent", "Unpaid"] },
    { key: "startsOn", label: "From", type: "date", required: true }, { key: "endsOn", label: "To", type: "date", required: true },
    { key: "reason", label: "Reason", required: true, full: true },
  ], save: (v) => save({ action: "leave-file", ...v }) });
  const advanceForm = () => setForm({ title: "Cash Advance", submitLabel: "File Advance", initial: { requestedOn: todayManila() }, fields: [
    { key: "employeeId", label: "Employee", type: "select", required: true, options: empOptions, full: true },
    { key: "amount", label: "Amount (PHP)", type: "number", required: true, min: "1", step: "0.01" }, { key: "requestedOn", label: "Requested On", type: "date", required: true },
  ], save: (v) => save({ action: "advance-file", employeeId: v.employeeId, amountCentavos: toCentavos(v.amount), requestedOn: v.requestedOn }) });
  const benefitForm = (b?: Benefit) => setForm({ title: b ? "Edit Benefit" : "Add Benefit", initial: b ? { employeeId: b.employee_id, benefitType: b.benefit_type, reference: b.reference ?? "", amount: fromCentavos(b.amount_centavos), effectiveFrom: b.effective_from ?? "" } : { benefitType: "SSS" }, fields: [
    { key: "employeeId", label: "Employee", type: "select", required: true, options: empOptions, full: true },
    { key: "benefitType", label: "Benefit", type: "select", required: true, options: ["SSS", "PhilHealth", "Pag-IBIG", "TIN/BIR", "Other"] },
    { key: "reference", label: "ID / Reference No." }, { key: "amount", label: "Monthly Contribution (PHP)", type: "number", min: "0", step: "0.01" }, { key: "effectiveFrom", label: "Effective From", type: "date" },
  ], save: (v) => save({ action: "benefit-save", id: b?.id ?? null, employeeId: v.employeeId, benefitType: v.benefitType, reference: v.reference, amountCentavos: toCentavos(v.amount), effectiveFrom: v.effectiveFrom || null }) });
  const contractForm = (c?: Contract) => setForm({ title: c ? "Edit Contract" : "Add Contract", initial: c ? { employeeId: c.employee_id, contractType: c.contract_type, position: c.position ?? "", rate: fromCentavos(c.rate_centavos), startsOn: c.starts_on, endsOn: c.ends_on ?? "", status: c.status, notes: c.notes ?? "" } : { contractType: "Probationary", startsOn: todayManila(), status: "Active" }, fields: [
    { key: "employeeId", label: "Employee", type: "select", required: true, options: empOptions, full: true },
    { key: "contractType", label: "Contract Type", type: "select", required: true, options: ["Probationary", "Regular", "Project", "Consultancy"] }, { key: "position", label: "Position" },
    { key: "rate", label: "Rate (PHP)", type: "number", min: "0", step: "0.01" }, { key: "status", label: "Status", type: "select", required: true, options: ["Active", "Ended", "Terminated"] },
    { key: "startsOn", label: "Start", type: "date", required: true }, { key: "endsOn", label: "End (Blank if Open-Ended)", type: "date" },
    { key: "notes", label: "Notes", full: true },
  ], save: (v) => save({ action: "contract-save", id: c?.id ?? null, employeeId: v.employeeId, contractType: v.contractType, position: v.position, rateCentavos: toCentavos(v.rate), startsOn: v.startsOn, endsOn: v.endsOn || null, status: v.status, notes: v.notes }) });
  const attendanceForm = () => setForm({ title: "Encode Time", submitLabel: "Save Entry", initial: { attendanceDate: todayManila(), scheduledIn: "08:00", scheduledOut: "17:00" }, fields: [
    { key: "employeeId", label: "Employee", type: "select", required: true, options: empOptions, full: true },
    { key: "attendanceDate", label: "Date", type: "date", required: true, max: todayManila() }, { key: "remarks", label: "Reason", type: "select", required: true, options: ["Device Down", "Forgot to Punch", "Field Work / Official Business", "Before Device Setup", "Other"] },
    { key: "timeIn", label: "Time In (Blank = Absent)", type: "time" }, { key: "timeOut", label: "Time Out", type: "time" },
    { key: "scheduledIn", label: "Scheduled In", type: "time", required: true, section: "Schedule" }, { key: "scheduledOut", label: "Scheduled Out", type: "time", required: true },
  ], note: "Late and undertime are computed from the schedule. Every entry is in the audit log.", save: (v) => save({ action: "hr-attendance-log", employeeId: v.employeeId, attendanceDate: v.attendanceDate, scheduledIn: v.scheduledIn, scheduledOut: v.scheduledOut, timeIn: v.timeIn || undefined, timeOut: v.timeOut || undefined, remarks: `Manual · ${v.remarks}` }) });
  const periodForm = () => { const c = currentCutoff(); setForm({ title: "Open Payroll Period", submitLabel: "Open and Compute", initial: c, fields: [
    { key: "startsOn", label: "Covers From", type: "date", required: true }, { key: "endsOn", label: "Covers To", type: "date", required: true }, { key: "payDate", label: "Pay Date", type: "date", required: true },
  ], save: (v) => save({ action: "payroll-open", ...v }) }); };

  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);
  const search = <input className="hr-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Name" aria-label="Search" />;
  const showSel = (opts: string[]) => <select className="hr-show" value={opts.includes(show) ? show : opts[0]} onChange={(e) => setShow(e.target.value)} aria-label="Show">{opts.map((o) => <option key={o}>{o}</option>)}</select>;
  const shown = (s: string, opts: string[]) => { const pick = opts.includes(show) ? show : opts[0]; return pick === "All" || s === pick; };

  let actions: ReactNode = null, body: ReactNode = null;
  const pendingLeave = data.leaveRequests.filter((l) => l.status === "Pending"), pendingAdv = data.cashAdvances.filter((a) => a.status === "Pending");

  if (view === "HR dashboard") {
    const today = todayManila();
    const onLeave = data.leaveRequests.filter((l) => l.status === "Approved" && l.starts_on <= today && l.ends_on >= today);
    const weekEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    const outWeek = data.leaveRequests.filter((l) => l.status !== "Rejected" && l.starts_on <= weekEnd && l.ends_on >= today);
    const checks = due.filter((d) => d.state !== "Current");
    const reqs = (plus?.requests ?? []).filter((r) => r.status === "Pending").length;
    actions = canManage && <button type="button" className="portal-primary" onClick={() => employeeForm()}>Add Employee</button>;
    body = <>
      <div className="hr-kpis">{([["Employees", active.length, "Employees"], ["On Leave Today", onLeave.length, "Leave"], ["Approvals Waiting", pendingLeave.length + pendingAdv.length, "Leave"], ["Fit to Work or Biodata Due", checks.length, "201 and checks"], ["Requests Waiting", reqs, "Change requests"]] as [string, number, HrView][]).map(([l, n, to]) => <button type="button" key={l} className="hr-kpi" onClick={() => go?.(to)}><b>{n}</b><small>{l}</small></button>)}</div>
      <div className="hr-two">
        <section className="portal-panel"><div className="panel-heading"><h2>Approvals Waiting</h2>{pendingLeave.length + pendingAdv.length > 5 && <button type="button" className="portal-secondary row-act" onClick={() => go?.("Leave")}>Open All</button>}</div>
          {[...pendingLeave.map((l) => ({ id: l.id, kind: "leave" as const, who: nameOf.get(l.employee_id) ?? "—", what: `${l.leave_type} Leave · ${shortDate(l.starts_on)}–${shortDate(l.ends_on)}` })), ...pendingAdv.map((a) => ({ id: a.id, kind: "advance" as const, who: nameOf.get(a.employee_id) ?? "—", what: `Cash Advance · ${pesos(a.amount_centavos)}` }))].slice(0, 5).map((r) => <div className="hr-row" key={r.id}><div><strong>{r.who}</strong><small>{r.what}</small></div>
            {canManage && <span className="hr-acts"><button type="button" className="portal-secondary row-act" disabled={busy} onClick={() => void act({ action: r.kind === "leave" ? "leave-decide" : "advance-decide", id: r.id, decision: "Rejected" }, "Rejected.")}>Reject</button><button type="button" className="portal-primary row-act" disabled={busy} onClick={() => void act({ action: r.kind === "leave" ? "leave-decide" : "advance-decide", id: r.id, decision: "Approved" }, "Approved.")}>Approve</button></span>}</div>)}
          {!pendingLeave.length && !pendingAdv.length && <p className="hr-none">Nothing waiting.</p>}
        </section>
        <section className="portal-panel"><div className="panel-heading"><h2>Coming Up</h2>{checks.length > 5 && <button type="button" className="portal-secondary row-act" onClick={() => go?.("201 and checks")}>Open All</button>}</div>
          {checks.slice(0, 5).map((d) => <div className="hr-row" key={`${d.employeeId}${d.kind}`}><div><strong>{d.name}</strong><small>{KIND_LABEL[d.kind]}{d.due ? ` · due ${shortDate(d.due)}` : ""}</small></div><Badge tone={toneOf(d.state)}>{dueLabel(d)}</Badge></div>)}
          {outWeek.slice(0, 4).map((l) => <div className="hr-row" key={l.id}><div><strong>{nameOf.get(l.employee_id) ?? "—"}</strong><small>{l.leave_type} Leave · {shortDate(l.starts_on)}–{shortDate(l.ends_on)}</small></div><Badge tone={statusTone(l.status)}>{l.status === "Approved" ? "Out" : l.status}</Badge></div>)}
          {!checks.length && !outWeek.length && <p className="hr-none">Nothing coming up.</p>}
        </section>
      </div>
    </>;
  } else if (view === "Employees") {
    const opts = ["Active", "Archived", "All"];
    const rows = data.employees.filter((e) => (show === "Archived" ? !e.active : show === "All" ? true : e.active) && match(`${e.complete_name} ${e.employee_number} ${e.position}`));
    actions = <>{search}{showSel(opts)}{canManage && <button type="button" className="portal-primary" onClick={() => employeeForm()}>Add Employee</button>}</>;
    body = <Table head={["Employee", "Position", "Status", "Pay", ""]} empty="No employees found." rows={rows.map((e) => <tr key={e.id} className={e.active ? "" : "row-muted"}>
      <td className="lead" data-l="Employee"><strong>{e.complete_name}</strong><small>{e.employee_number} · hired {shortDate(e.date_hired)}{e.work_email ? ` · ${e.work_email}` : ""}</small></td>
      <td data-l="Position">{e.position}</td><td data-l="Status"><Badge tone={statusTone(e.employment_status)}>{e.employment_status}</Badge></td>
      <td data-l="Pay" className="mono">{pesos(e.base_rate_centavos)}<small>{e.pay_type}</small></td>
      <td data-l="" className="hr-cell-acts">{canManage && <><button type="button" className="portal-primary row-act" onClick={() => employeeForm(e)}>Edit</button><ActionsMenu label="More" items={[{ label: "201 and Checks", onClick: () => go?.("201 and checks") }, { label: e.active ? "Archive" : "Restore", danger: e.active, onClick: async () => { if (await askConfirm(`${e.active ? "Archive" : "Restore"} ${e.complete_name}?`)) void act({ action: "employee-set-active", id: e.id, active: !e.active }, e.active ? "Archived." : "Restored."); } }]} /></>}</td>
    </tr>)} />;
  } else if (view === "201 and checks" || view === "Change requests" || view === "Memos" || view === "Reminders" || view === "COE requests" || view === "Document templates") {
    body = <HrPeople view={view === "201 and checks" ? "201" : view === "Change requests" ? "Requests" : view === "Reminders" ? "Settings" : view === "COE requests" ? "COE" : view === "Document templates" ? "Templates" : "Memos"} employees={data.employees} plus={plus} reload={reload} onEdit={(id) => { const e = data.employees.find((x) => x.id === id); if (e) employeeForm(e); }} />;
  } else if (view === "Staff attendance") {
    const [who, setWho] = [show.startsWith("emp:") ? show.slice(4) : "", (id: string) => setShow(id ? `emp:${id}` : "All")];
    const rows = data.employeeAttendance.filter((r) => !who || r.employee_id === who).slice(0, 120);
    actions = <><select className="hr-show" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Employee"><option value="">All Employees</option>{active.map((e) => <option key={e.id} value={e.id}>{e.complete_name}</option>)}</select>{canManage && <button type="button" className="portal-primary" onClick={attendanceForm}>Encode Time</button>}</>;
    body = <Table head={["Date", "Employee", "In", "Out", "Late", "Status"]} empty="No attendance logged yet." rows={rows.map((r) => <tr key={r.id}>
      <td className="lead" data-l="Date"><strong>{shortDate(r.attendance_date)}</strong>{r.remarks && <small>{r.remarks}</small>}</td><td data-l="Employee">{nameOf.get(r.employee_id) ?? "—"}</td>
      <td data-l="In" className="mono">{clock(r.checked_in_at)}</td><td data-l="Out" className="mono">{clock(r.checked_out_at)}</td>
      <td data-l="Late" className="mono">{r.minutes_late ? `${r.minutes_late}m` : "—"}{r.minutes_undertime ? <small>UT {r.minutes_undertime}m</small> : null}</td>
      <td data-l="Status"><Badge tone={r.status === "Absent" ? "red" : r.status === "Late" ? "orange" : "green"}>{r.status}</Badge></td></tr>)} />;
  } else if (view === "Leave" || view === "Cash advances") {
    const opts = ["Pending", "Approved", "Rejected", "All"], leave = view === "Leave";
    actions = <>{search}{showSel(opts)}{canManage && <button type="button" className="portal-primary" onClick={leave ? leaveForm : advanceForm}>{leave ? "File Leave" : "File Advance"}</button>}</>;
    const decide = (id: string) => canManage && <span className="hr-acts"><button type="button" className="portal-secondary row-act" disabled={busy} onClick={() => void act({ action: leave ? "leave-decide" : "advance-decide", id, decision: "Rejected" }, "Rejected.")}>Reject</button><button type="button" className="portal-primary row-act" disabled={busy} onClick={() => void act({ action: leave ? "leave-decide" : "advance-decide", id, decision: "Approved" }, "Approved.")}>Approve</button></span>;
    body = leave
      ? <Table head={["Employee", "Leave", "Dates", "Status", ""]} empty="No leave in this list." rows={data.leaveRequests.filter((l) => shown(l.status, opts) && match(nameOf.get(l.employee_id) ?? "")).map((l) => <tr key={l.id}>
          <td className="lead" data-l="Employee"><strong>{nameOf.get(l.employee_id) ?? "—"}</strong><small>{l.reason}</small></td><td data-l="Leave">{l.leave_type}</td>
          <td data-l="Dates">{shortDate(l.starts_on)} – {shortDate(l.ends_on)}</td><td data-l="Status"><Badge tone={statusTone(l.status)}>{l.status}</Badge></td><td data-l="" className="hr-cell-acts">{l.status === "Pending" && decide(l.id)}</td></tr>)} />
      : <Table head={["Employee", "Requested", "Amount", "Balance", "Status", ""]} empty="No cash advances in this list." rows={data.cashAdvances.filter((a) => shown(a.status, opts) && match(nameOf.get(a.employee_id) ?? "")).map((a) => <tr key={a.id}>
          <td className="lead" data-l="Employee"><strong>{nameOf.get(a.employee_id) ?? "—"}</strong></td><td data-l="Requested">{shortDate(a.requested_on)}</td>
          <td data-l="Amount" className="mono">{pesos(a.amount_centavos)}</td><td data-l="Balance" className="mono">{pesos(a.balance_centavos)}</td>
          <td data-l="Status"><Badge tone={statusTone(a.status)}>{a.status}</Badge></td><td data-l="" className="hr-cell-acts">{a.status === "Pending" && decide(a.id)}</td></tr>)} />;
  } else if (view === "Payroll") {
    actions = canManage && <button type="button" className="portal-primary" onClick={periodForm}>Open Payroll Period</button>;
    body = <Payroll data={data} nameOf={nameOf} canManage={canManage} busy={busy} act={act} />;
  } else if (view === "13th month") {
    body = <Thirteenth data={data} />;
  } else if (view === "Benefits") {
    actions = <>{search}{canManage && <button type="button" className="portal-primary" onClick={() => benefitForm()}>Add Benefit</button>}</>;
    body = <Table head={["Employee", "Benefit", "ID / Reference", "Monthly", ""]} empty="No benefit records yet." rows={data.benefitRecords.filter((b) => match(nameOf.get(b.employee_id) ?? "")).map((b) => <tr key={b.id}>
      <td className="lead" data-l="Employee"><strong>{nameOf.get(b.employee_id) ?? "—"}</strong>{b.effective_from && <small>From {shortDate(b.effective_from)}</small>}</td><td data-l="Benefit">{b.benefit_type}</td>
      <td data-l="Reference" className="mono">{b.reference || "—"}</td><td data-l="Monthly" className="mono">{b.amount_centavos ? pesos(b.amount_centavos) : "—"}</td>
      <td data-l="" className="hr-cell-acts">{canManage && <><button type="button" className="portal-primary row-act" onClick={() => benefitForm(b)}>Edit</button><ActionsMenu label="More" items={[{ label: "Remove", danger: true, onClick: async () => { if (await askConfirm("Remove this benefit record?")) void act({ action: "benefit-remove", id: b.id }, "Removed."); } }]} /></>}</td></tr>)} />;
  } else if (view === "Contracts") {
    actions = <>{search}{canManage && <button type="button" className="portal-primary" onClick={() => contractForm()}>Add Contract</button>}</>;
    body = <Table head={["Employee", "Contract", "Coverage", "Rate", "Status", ""]} empty="No contracts yet." rows={data.employmentContracts.filter((c) => match(nameOf.get(c.employee_id) ?? "")).map((c) => <tr key={c.id}>
      <td className="lead" data-l="Employee"><strong>{nameOf.get(c.employee_id) ?? "—"}</strong>{c.position && <small>{c.position}</small>}</td><td data-l="Contract">{c.contract_type}</td>
      <td data-l="Coverage">{shortDate(c.starts_on)} – {c.ends_on ? shortDate(c.ends_on) : "Open"}</td><td data-l="Rate" className="mono">{c.rate_centavos ? pesos(c.rate_centavos) : "—"}</td>
      <td data-l="Status"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
      <td data-l="" className="hr-cell-acts">{canManage && <><button type="button" className="portal-primary row-act" onClick={() => contractForm(c)}>Edit</button><ActionsMenu label="More" items={[{ label: "Remove", danger: true, onClick: async () => { if (await askConfirm("Remove this contract record?")) void act({ action: "contract-remove", id: c.id }, "Removed."); } }]} /></>}</td></tr>)} />;
  }

  return <div className="portal-page hr-page">
    <div className="portal-heading hr-head"><div><span className="portal-eyebrow">{view === "HR dashboard" ? "HR" : groupOf(view)}</span><h1>{view === "HR dashboard" ? "HR Dashboard" : hrTitle(view)}</h1></div>{actions && <div className="hr-head-acts">{actions}</div>}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {body}
    {form && <HrFormModal title={form.title} fields={form.fields} initial={form.initial} submitLabel={form.submitLabel} wide={form.wide} note={form.note} onSubmit={form.save} onClose={() => setForm(null)} />}
  </div>;
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[]; empty: string }) {
  return <section className="portal-panel hr-table"><div className="portal-table-wrap"><table className="portal-table cx-cards"><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>
    {rows.length ? rows : <tr><td colSpan={head.length} className="hr-none">{empty}</td></tr>}
  </tbody></table></div></section>;
}

function Payroll({ data, nameOf, canManage, busy, act }: { data: HrData; nameOf: Map<string, string>; canManage: boolean; busy: boolean; act: (b: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [open, setOpen] = useState(data.payrollPeriods[0]?.id ?? "");
  const items = data.payrollItems.filter((i) => i.payroll_period_id === open);
  return <>
    <Table head={["Period", "Covers", "Pay Date", "Net Total", "Status", ""]} empty="No payroll periods yet. Use Open Payroll Period." rows={data.payrollPeriods.map((p) => { const its = data.payrollItems.filter((i) => i.payroll_period_id === p.id); return <tr key={p.id} className={open === p.id ? "hr-picked" : ""}>
      <td className="lead" data-l="Period"><button type="button" className="hr-linkbtn" onClick={() => setOpen(p.id)}><strong>{p.period_number}</strong></button><small>{its.length} employees</small></td>
      <td data-l="Covers">{shortDate(p.starts_on)} – {shortDate(p.ends_on)}</td><td data-l="Pay Date">{shortDate(p.pay_date)}</td>
      <td data-l="Net Total" className="mono"><strong>{pesos(its.reduce((s, i) => s + Number(i.net_centavos), 0))}</strong></td><td data-l="Status"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
      <td data-l="" className="hr-cell-acts">{canManage && p.status === "Draft" && <button type="button" className="portal-primary row-act" disabled={busy} onClick={() => void act({ action: "payroll-review", id: p.id }, "Marked reviewed.")}>Mark Reviewed</button>}
        {canManage && p.status === "Reviewed" && <button type="button" className="portal-primary row-act" disabled={busy} onClick={async () => { if (await askConfirm("Finalize this payroll? It posts a Paid Payroll voucher to Accounting and cannot be edited.")) void act({ action: "payroll-finalize", id: p.id }, "Finalized."); }}>Finalize</button>}</td></tr>; })} />
    {open && <Table head={["Employee", "Gross", "Deductions", "Net", ""]} empty="No payslips in this period." rows={items.map((i) => <tr key={i.id}>
      <td className="lead" data-l="Employee"><strong>{nameOf.get(i.employee_id) ?? "—"}</strong></td><td data-l="Gross" className="mono">{pesos(i.gross_centavos)}</td>
      <td data-l="Deductions" className="mono">{pesos(i.deduction_centavos)}</td><td data-l="Net" className="mono"><strong>{pesos(i.net_centavos)}</strong></td>
      <td data-l="" className="hr-cell-acts"><a className="portal-secondary row-act" href={`/api/documents/payslip/${i.id}`} target="_blank" rel="noreferrer">Payslip</a></td></tr>)} />}
  </>;
}

function Thirteenth({ data }: { data: HrData }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const monthlyBasic = (e: Employee) => { const b = Number(e.base_rate_centavos); return e.pay_type === "Weekly" ? Math.round(b * 4.33) : e.pay_type === "Daily" ? b * 26 : b; };
  const monthsIn = (e: Employee) => { const h = new Date(e.date_hired); const hy = h.getFullYear(), hm = h.getMonth() + 1; const start = hy < year ? 1 : hy === year ? hm : 13; if (start > 12) return 0; const end = year < now.getFullYear() ? 12 : year === now.getFullYear() ? now.getMonth() + 1 : 0; return Math.max(0, end - start + 1); };
  const rows = data.employees.filter((e) => e.active).map((e) => { const mb = monthlyBasic(e), m = monthsIn(e); return { e, mb, m, amt: Math.round((mb * m) / 12) }; });
  const total = rows.reduce((s, r) => s + r.amt, 0);
  const csv = () => {
    const lines = [["Employee", "Position", "Pay type", "Monthly basic", "Months", "13th month"].join(","), ...rows.map((r) => [r.e.complete_name, r.e.position, r.e.pay_type, (r.mb / 100).toFixed(2), String(r.m), (r.amt / 100).toFixed(2)].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = `13th-month-${year}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return <>
    <div className="hr-bar"><select className="hr-show" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => <option key={y} value={y}>{y}</option>)}</select><span className="hr-total">Total <b className="mono">{pesos(total)}</b></span><button type="button" className="portal-secondary" onClick={csv}>Export CSV</button></div>
    <Table head={["Employee", "Pay Type", "Monthly Basic", "Months", "13th Month"]} empty="No active employees." rows={rows.map((r) => <tr key={r.e.id}>
      <td className="lead" data-l="Employee"><strong>{r.e.complete_name}</strong><small>Hired {shortDate(r.e.date_hired)}</small></td><td data-l="Pay Type">{r.e.pay_type}</td>
      <td data-l="Monthly Basic" className="mono">{pesos(r.mb)}</td><td data-l="Months">{r.m}</td><td data-l="13th Month" className="mono"><strong>{pesos(r.amt)}</strong></td></tr>)} />
  </>;
}
