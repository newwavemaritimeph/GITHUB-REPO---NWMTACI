"use client";

import { useMemo, useState } from "react";

/** Loose shapes for the HR slices of the staff-operations payload. */
type Employee = { id: string; employee_number: string; complete_name: string; position: string; employment_status: string; date_hired: string; pay_type: string; base_rate_centavos: number; instructor_daily_rate_centavos?: number | null; work_email?: string | null; active: boolean };
type Attendance = { id: string; employee_id: string; attendance_date: string; checked_in_at?: string | null; checked_out_at?: string | null; minutes_late: number; minutes_undertime: number; status: string; remarks?: string | null };
type Leave = { id: string; employee_id: string; leave_type: string; starts_on: string; ends_on: string; reason: string; status: string; created_at: string };
type Advance = { id: string; employee_id: string; amount_centavos: number; requested_on: string; balance_centavos: number; status: string };
type Period = { id: string; period_number: string; starts_on: string; ends_on: string; pay_date: string; status: string; finalized_at?: string | null };
export type HrData = { employees: Employee[]; employeeAttendance: Attendance[]; leaveRequests: Leave[]; cashAdvances: Advance[]; payrollPeriods: Period[] };

const pesos = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0 }).format((Number(centavos) || 0) / 100);
const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const num = (raw: string | null) => (raw == null || raw.trim() === "" ? null : Math.round(Number(raw) * 100));

export function LiveHr({ data, role, reload }: { data: HrData; role: string; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<"Overview" | "Directory" | "Attendance" | "Requests" | "Payroll">("Overview");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canManage = role === "admin" || role === "hr";
  const nameOf = useMemo(() => new Map(data.employees.map((e) => [e.id, e.complete_name])), [data.employees]);

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

  const activeEmployees = data.employees.filter((e) => e.active);
  const pendingLeave = data.leaveRequests.filter((l) => l.status === "Pending");
  const pendingAdvances = data.cashAdvances.filter((a) => a.status === "Pending");

  const leaderboard = useMemo(() => {
    const stats = new Map<string, { present: number; late: number; days: number }>();
    for (const record of data.employeeAttendance) {
      const entry = stats.get(record.employee_id) ?? { present: 0, late: 0, days: 0 };
      entry.days += 1;
      if (record.status !== "Absent") entry.present += 1;
      if (record.status === "Late") entry.late += 1;
      stats.set(record.employee_id, entry);
    }
    return [...stats.entries()]
      .map(([id, s]) => ({ id, name: nameOf.get(id) ?? "—", present: s.present, days: s.days, onTime: s.present ? Math.round(((s.present - s.late) / s.present) * 100) : 0 }))
      .sort((a, b) => b.present - a.present || b.onTime - a.onTime)
      .slice(0, 8);
  }, [data.employeeAttendance, nameOf]);

  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div><span className="portal-eyebrow">People operations</span><h1>HR &amp; payroll</h1><p>Employee directory, daily attendance, leave and cash-advance requests, and payroll periods.</p></div>
      </div>
      <div className="portal-tabs">
        {(["Overview", "Directory", "Attendance", "Requests", "Payroll"] as const).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {message && <div className="portal-message error" role="alert">{message}</div>}

      {tab === "Overview" && (
        <>
          <div className="finance-hero">
            <div><span>Active employees</span><strong>{activeEmployees.length}</strong><small>{data.employees.length} total on file</small></div>
            <article><span>Pending leave</span><strong>{pendingLeave.length}</strong><small>Awaiting a decision</small></article>
            <article><span>Pending advances</span><strong>{pendingAdvances.length}</strong><small>{pesos(pendingAdvances.reduce((s, a) => s + Number(a.amount_centavos), 0))} requested</small></article>
            <article><span>Payroll periods</span><strong>{data.payrollPeriods.length}</strong><small>Cut-off 15th &amp; 30th</small></article>
          </div>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Attendance leaderboard</h2><p>Ranked by days present and on-time rate</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Employee</th><th>Days present</th><th>Logged days</th><th>On-time</th></tr></thead><tbody>
              {leaderboard.map((r) => <tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.present}</td><td>{r.days}</td><td>{r.onTime}%</td></tr>)}
              {!leaderboard.length && <tr><td colSpan={4}><span className="portal-empty-copy">No attendance logged yet.</span></td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}

      {tab === "Directory" && (
        <section className="portal-panel">
          <div className="panel-heading"><div><h2>Employee directory</h2><p>Active and inactive staff on record</p></div></div>
          <div className="portal-table"><table><thead><tr><th>Employee</th><th>Position</th><th>Status</th><th>Pay type</th><th>Base rate</th><th>Work email</th></tr></thead><tbody>
            {data.employees.map((e) => (
              <tr key={e.id} className={e.active ? "" : "row-muted"}>
                <td><strong>{e.complete_name}</strong><small>{e.employee_number} · hired {e.date_hired}</small></td>
                <td>{e.position}</td>
                <td>{e.employment_status}</td>
                <td>{e.pay_type}{e.pay_type === "Daily" && e.instructor_daily_rate_centavos ? ` · ${pesos(e.instructor_daily_rate_centavos)}/day` : ""}</td>
                <td>{pesos(e.base_rate_centavos)}</td>
                <td>{e.work_email ?? "—"}</td>
              </tr>
            ))}
            {!data.employees.length && <tr><td colSpan={6}><span className="portal-empty-copy">No employees on record.</span></td></tr>}
          </tbody></table></div>
        </section>
      )}

      {tab === "Attendance" && <AttendanceTab data={data} nameOf={nameOf} canManage={canManage} busy={busy} post={post} />}

      {tab === "Requests" && (
        <>
          <section className="portal-panel">
            <div className="panel-heading">
              <div><h2>Leave requests</h2><p>File and decide employee leave</p></div>
              {canManage && <button className="portal-primary" disabled={busy} onClick={() => {
                const employeeId = pickEmployee(data.employees); if (!employeeId) return;
                const leaveType = window.prompt("Leave type? (e.g. Sick, Vacation, Emergency)", "Vacation"); if (!leaveType) return;
                const startsOn = window.prompt("Start date (YYYY-MM-DD)?", todayManila()); if (!startsOn) return;
                const endsOn = window.prompt("End date (YYYY-MM-DD)?", startsOn); if (!endsOn) return;
                const reason = window.prompt("Reason?"); if (!reason) return;
                void post({ action: "leave-file", employeeId, leaveType, startsOn, endsOn, reason });
              }}>+ File leave</button>}
            </div>
            <div className="portal-table"><table><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
              {data.leaveRequests.map((l) => (
                <tr key={l.id}>
                  <td><strong>{nameOf.get(l.employee_id) ?? "—"}</strong></td>
                  <td>{l.leave_type}</td>
                  <td>{l.starts_on} → {l.ends_on}</td>
                  <td>{l.reason}</td>
                  <td>{l.status}</td>
                  <td className="document-actions">
                    {canManage && l.status === "Pending" && <button disabled={busy} onClick={() => post({ action: "leave-decide", id: l.id, decision: "Approved" })}>Approve</button>}
                    {canManage && l.status === "Pending" && <button disabled={busy} onClick={() => post({ action: "leave-decide", id: l.id, decision: "Rejected" })}>Reject</button>}
                  </td>
                </tr>
              ))}
              {!data.leaveRequests.length && <tr><td colSpan={6}><span className="portal-empty-copy">No leave requests.</span></td></tr>}
            </tbody></table></div>
          </section>

          <section className="portal-panel">
            <div className="panel-heading">
              <div><h2>Cash advances</h2><p>Salary advances against future payroll</p></div>
              {canManage && <button className="portal-primary" disabled={busy} onClick={() => {
                const employeeId = pickEmployee(data.employees); if (!employeeId) return;
                const amt = num(window.prompt("Advance amount (PHP)?")); if (!amt) return;
                const requestedOn = window.prompt("Requested on (YYYY-MM-DD)?", todayManila()); if (!requestedOn) return;
                void post({ action: "advance-file", employeeId, amountCentavos: amt, requestedOn });
              }}>+ File advance</button>}
            </div>
            <div className="portal-table"><table><thead><tr><th>Employee</th><th>Requested</th><th>Amount</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>
              {data.cashAdvances.map((a) => (
                <tr key={a.id}>
                  <td><strong>{nameOf.get(a.employee_id) ?? "—"}</strong></td>
                  <td>{a.requested_on}</td>
                  <td>{pesos(a.amount_centavos)}</td>
                  <td>{pesos(a.balance_centavos)}</td>
                  <td>{a.status}</td>
                  <td className="document-actions">
                    {canManage && a.status === "Pending" && <button disabled={busy} onClick={() => post({ action: "advance-decide", id: a.id, decision: "Approved" })}>Approve</button>}
                    {canManage && a.status === "Pending" && <button disabled={busy} onClick={() => post({ action: "advance-decide", id: a.id, decision: "Rejected" })}>Reject</button>}
                  </td>
                </tr>
              ))}
              {!data.cashAdvances.length && <tr><td colSpan={6}><span className="portal-empty-copy">No cash advances.</span></td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}

      {tab === "Payroll" && (
        <section className="portal-panel">
          <div className="panel-heading"><div><h2>Payroll periods</h2><p>Semi-monthly cut-off — 1–15 (paid 15th) and 16–EOM (paid 30th)</p></div></div>
          <div className="portal-table"><table><thead><tr><th>Period</th><th>Covers</th><th>Pay date</th><th>Status</th></tr></thead><tbody>
            {data.payrollPeriods.map((p) => (
              <tr key={p.id}><td><strong>{p.period_number}</strong></td><td>{p.starts_on} → {p.ends_on}</td><td>{p.pay_date}</td><td>{p.status}{p.finalized_at ? " · finalized" : ""}</td></tr>
            ))}
            {!data.payrollPeriods.length && <tr><td colSpan={4}><span className="portal-empty-copy">No payroll periods yet. Finalizing periods and payslips is the next HR slice.</span></td></tr>}
          </tbody></table></div>
        </section>
      )}
    </div>
  );
}

function pickEmployee(employees: Employee[]): string | null {
  const active = employees.filter((e) => e.active);
  if (!active.length) { window.alert("No active employees on file."); return null; }
  const menu = active.map((e, i) => `${i + 1}. ${e.complete_name} (${e.position})`).join("\n");
  const pick = window.prompt(`Which employee? Enter a number:\n${menu}`);
  const idx = pick == null ? NaN : Number(pick) - 1;
  return Number.isInteger(idx) && idx >= 0 && idx < active.length ? active[idx].id : null;
}

function AttendanceTab({ data, nameOf, canManage, busy, post }: { data: HrData; nameOf: Map<string, string>; canManage: boolean; busy: boolean; post: (body: Record<string, unknown>) => Promise<void> }) {
  const [employeeId, setEmployeeId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(todayManila());
  const [scheduledIn, setScheduledIn] = useState("08:00");
  const [scheduledOut, setScheduledOut] = useState("17:00");
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [remarks, setRemarks] = useState("");
  const active = data.employees.filter((e) => e.active);

  async function submit() {
    await post({ action: "hr-attendance-log", employeeId, attendanceDate, scheduledIn, scheduledOut, timeIn: timeIn || undefined, timeOut: timeOut || undefined, remarks });
    setTimeIn(""); setTimeOut(""); setRemarks("");
  }

  return (
    <>
      {canManage && (
        <section className="portal-panel">
          <div className="panel-heading"><div><h2>Log attendance</h2><p>Late and undertime are computed from the schedule. Leave time-in blank to mark Absent.</p></div></div>
          <div className="portal-form" style={{ padding: "4px 0" }}>
            <label>Employee<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">Select employee</option>{active.map((e) => <option key={e.id} value={e.id}>{e.complete_name}</option>)}</select></label>
            <label>Date<input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} /></label>
            <label>Scheduled in<input type="time" value={scheduledIn} onChange={(e) => setScheduledIn(e.target.value)} /></label>
            <label>Scheduled out<input type="time" value={scheduledOut} onChange={(e) => setScheduledOut(e.target.value)} /></label>
            <label>Time in<input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} /></label>
            <label>Time out<input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} /></label>
            <label className="full">Remarks<input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
            <div className="full"><button className="portal-primary" disabled={busy || !employeeId} onClick={submit}>{busy ? "Saving…" : "Save attendance"}</button></div>
          </div>
        </section>
      )}

      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Recent attendance</h2><p>Most recent logged days</p></div></div>
        <div className="portal-table"><table><thead><tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th>Late</th><th>Undertime</th><th>Status</th></tr></thead><tbody>
          {data.employeeAttendance.slice(0, 60).map((r) => (
            <tr key={r.id}>
              <td><strong>{r.attendance_date}</strong></td>
              <td>{nameOf.get(r.employee_id) ?? "—"}</td>
              <td>{r.checked_in_at ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(r.checked_in_at)) : "—"}</td>
              <td>{r.checked_out_at ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(r.checked_out_at)) : "—"}</td>
              <td>{r.minutes_late ? `${r.minutes_late}m` : "—"}</td>
              <td>{r.minutes_undertime ? `${r.minutes_undertime}m` : "—"}</td>
              <td>{r.status}</td>
            </tr>
          ))}
          {!data.employeeAttendance.length && <tr><td colSpan={7}><span className="portal-empty-copy">No attendance logged yet.</span></td></tr>}
        </tbody></table></div>
      </section>
    </>
  );
}
