"use client";

import { useMemo, useState } from "react";
import { Badge, Message, Modal } from "./shared-ui";
import { askText, askConfirm } from "./dialogs";
import { dueLabel, hrDueItems, HR_DEFAULTS, KIND_LABEL, manilaDate, type DueItem, type DueState, type HrSettings } from "@/lib/hr-due";
import type { Hr201 } from "@/lib/hr-server";

/** HR Module, Phase 1 (owner, 10 Nov 2026): the HR Officer's 201 checks, memos, change requests and reminder settings. */
export type HrMemo = { id: string; memo_no: string; memo_type: string; subject: string; body: string; audience?: string; issued_at: string };
export type HrRequest = { id: string; request_no: string; employee_id?: string; request_type: string; details: string; status: string; decision_remarks?: string | null; created_at: string; decided_at?: string | null };
export type HrPlus = { profiles: Hr201[]; memos: HrMemo[]; memoRecipients: { memo_id: string; employee_id: string; acknowledged_at: string | null }[]; requests: HrRequest[]; settings: HrSettings; lastReminder: Record<string, string> } | null;
type Emp = { id: string; employee_number: string; complete_name: string; position: string; active: boolean };

export const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
export const shortDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+08:00` : iso)) : "—");
export const toneOf = (s: DueState) => (s === "Overdue" || s === "Missing" ? "red" : s === "Due Soon" || s === "For Checking" ? "orange" : "green");

/** Every employee's two six-month checks, from the HR payload. */
export function useHrDue(employees: Emp[], plus: HrPlus): DueItem[] {
  return useMemo(() => {
    if (!plus) return [];
    const byId = new Map(plus.profiles.map((p) => [p.id, p]));
    return hrDueItems(employees.map((e) => ({ ...e, ...byId.get(e.id), id: e.id })), plus.settings ?? HR_DEFAULTS, todayManila());
  }, [employees, plus]);
}

export async function hrPost(body: Record<string, unknown>) {
  const r = await fetch("/api/staff/hr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "The action could not be completed.");
  return j as { ok: true; sent?: number; noAccount?: string[]; memoNo?: string; requestNo?: string };
}

export function HrPeople({ view, employees, plus, reload }: { view: "201" | "Memos" | "Requests" | "Settings"; employees: Emp[]; plus: HrPlus; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<Emp | null>(null);
  const due = useHrDue(employees, plus);
  if (!plus) return <section className="portal-panel live-list"><p className="portal-empty-copy">Apply database update 202611100095 to turn on the 201 checks, memos and reminders.</p></section>;
  const run = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key); setMsg(null);
    try { const r = await hrPost(body); await reload(); setMsg({ kind: "success", text: r.noAccount?.length ? `${ok} No portal account yet: ${r.noAccount.join(", ")}.` : ok }); }
    catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); }
    finally { setBusy(""); }
  };
  const profile = (id: string) => plus.profiles.find((p) => p.id === id);
  const active = employees.filter((e) => e.active);

  return <>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {view === "201" && <section className="portal-panel hr-checks">
      <div className="panel-heading"><div><h2>201 and Six-Month Checks</h2></div></div>
      <div className="portal-table-wrap"><table className="portal-table cx-cards"><thead><tr><th>Employee</th><th>Medical Fit to Work</th><th>Updated Biodata</th><th /></tr></thead><tbody>
        {active.map((e) => {
          const fit = due.find((d) => d.employeeId === e.id && d.kind === "fit"), bio = due.find((d) => d.employeeId === e.id && d.kind === "biodata"), p = profile(e.id);
          return <tr key={e.id}>
            <td className="lead" data-l="Employee"><strong>{e.complete_name}</strong><small>{e.employee_number} · {e.position}{p?.employment_type ? ` · ${p.employment_type}` : ""}</small></td>
            <td data-l="Fit to Work">{fit && <span className="hr-due"><Badge tone={toneOf(fit.state)}>{dueLabel(fit)}</Badge><small>{fit.last ? `Last ${shortDate(fit.last)}` : "No certificate on file"}{p?.fit_to_work_pending_on ? ` · New: ${shortDate(p.fit_to_work_pending_on)}` : ""}</small></span>}
              {p?.fit_to_work_pending_on && <span className="hr-acts"><a className="portal-secondary row-act" href={`/api/staff/hr-files?employeeId=${e.id}&which=pending`} target="_blank" rel="noreferrer">View</a><button type="button" className="portal-primary row-act" disabled={!!busy} onClick={() => void run(`acc${e.id}`, { action: "hr-fit-decide", employeeId: e.id, decision: "Accept" }, `Accepted the Fit to Work of ${e.complete_name}.`)}>Accept</button><button type="button" className="portal-secondary row-act" disabled={!!busy} onClick={async () => { const reason = await askText("Why is it returned? The employee sees this."); if (reason) await run(`ret${e.id}`, { action: "hr-fit-decide", employeeId: e.id, decision: "Return", reason }, "Returned to the employee."); }}>Return</button></span>}
              {!p?.fit_to_work_pending_on && p?.fit_to_work_on && <a className="hr-link" href={`/api/staff/hr-files?employeeId=${e.id}&which=current`} target="_blank" rel="noreferrer">View Certificate</a>}</td>
            <td data-l="Biodata">{bio && <span className="hr-due"><Badge tone={toneOf(bio.state)}>{dueLabel(bio)}</Badge><small>{bio.last ? `Confirmed ${shortDate(bio.last)}` : "Never confirmed"}</small></span>}</td>
            <td data-l=""><button type="button" className="portal-secondary row-act" onClick={() => setEditing(e)}>Edit 201</button></td>
          </tr>;
        })}
        {!active.length && <tr><td colSpan={4} className="portal-empty-copy">No active employees.</td></tr>}
      </tbody></table></div>
    </section>}

    {view === "Memos" && <MemoPanel employees={active} plus={plus} busy={busy} run={run} />}

    {view === "Requests" && <section className="portal-panel live-list">
      <div className="panel-heading"><div><h2>201 Change Requests</h2></div><Badge tone="orange">{plus.requests.filter((r) => r.status === "Pending").length} Pending</Badge></div>
      {plus.requests.map((r) => <div className="live-row-item" key={r.id}><div><strong>{employees.find((e) => e.id === r.employee_id)?.complete_name ?? "Employee"} · {r.request_type}</strong><small>{r.request_no} · {shortDate(r.created_at)} · {r.details}{r.decision_remarks ? ` · ${r.decision_remarks}` : ""}</small></div>
        {r.status === "Pending" ? <span className="hr-acts"><button type="button" className="portal-secondary row-act" disabled={!!busy} onClick={async () => { const remarks = await askText("Reason for rejecting?"); if (remarks) await run(`rj${r.id}`, { action: "hr-request-decide", id: r.id, decision: "Rejected", remarks }, "Rejected."); }}>Reject</button><button type="button" className="portal-primary row-act" disabled={!!busy} onClick={async () => { if (await askConfirm("Approve this change? Update the 201 details with Edit 201 as well.")) await run(`ap${r.id}`, { action: "hr-request-decide", id: r.id, decision: "Approved" }, "Approved. The biodata review counts as done."); }}>Approve</button></span> : <Badge tone={r.status === "Approved" ? "green" : "red"}>{r.status}</Badge>}</div>)}
      {!plus.requests.length && <p className="portal-empty-copy">No change requests yet.</p>}
    </section>}

    {view === "Settings" && <SettingsPanel settings={plus.settings ?? HR_DEFAULTS} busy={busy} run={run} />}

    {editing && <Edit201 emp={editing} p={profile(editing.id)} busy={busy} onClose={() => setEditing(null)} save={async (body) => { await run("201", { action: "hr-201-save", employeeId: editing.id, ...body }, `Saved the 201 of ${editing.complete_name}.`); setEditing(null); }} />}
  </>;
}

function Edit201({ emp, p, busy, onClose, save }: { emp: Emp; p?: Hr201; busy: string; onClose: () => void; save: (body: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({ birthDate: p?.birth_date ?? "", sex: p?.sex ?? "", civilStatus: p?.civil_status ?? "", address: p?.address ?? "", mobile: p?.mobile ?? "", personalEmail: p?.personal_email ?? "", employmentType: p?.employment_type ?? "Regular", biometricId: p?.biometric_id ?? "", regularizationDate: p?.regularization_date ?? "", fitToWorkOn: p?.fit_to_work_on ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return <Modal title={`Edit 201 · ${emp.complete_name}`} onClose={onClose} wide>
    <form className="portal-form" onSubmit={(e) => { e.preventDefault(); void save({ ...f, birthDate: f.birthDate || null, regularizationDate: f.regularizationDate || null, fitToWorkOn: f.fitToWorkOn || null }); }}>
      <label>Birth Date<input type="date" value={f.birthDate} onChange={set("birthDate")} /></label>
      <label>Sex<select value={f.sex} onChange={set("sex")}><option value="">—</option><option>Female</option><option>Male</option></select></label>
      <label>Civil Status<select value={f.civilStatus} onChange={set("civilStatus")}><option value="">—</option><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option></select></label>
      <label>Mobile<input value={f.mobile} onChange={set("mobile")} inputMode="tel" /></label>
      <label className="full">Address<input value={f.address} onChange={set("address")} /></label>
      <label>Personal Email<input type="email" value={f.personalEmail} onChange={set("personalEmail")} /></label>
      <label>Employment Type<select value={f.employmentType} onChange={set("employmentType")}><option>Probationary</option><option>Regular</option><option>Project</option><option>Contractual</option></select></label>
      <label>Regularization Date<input type="date" value={f.regularizationDate} onChange={set("regularizationDate")} /></label>
      <label>Biometric ID<input value={f.biometricId} onChange={set("biometricId")} placeholder="User no. on the fingerprint device" /></label>
      <label>Medical Fit to Work Date<input type="date" value={f.fitToWorkOn} max={todayManila()} onChange={set("fitToWorkOn")} /></label>
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button className="portal-primary" disabled={!!busy}>{busy ? "Saving…" : "Save 201"}</button></div>
    </form>
  </Modal>;
}

function MemoPanel({ employees, plus, busy, run }: { employees: Emp[]; plus: NonNullable<HrPlus>; busy: string; run: (k: string, b: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [type, setType] = useState("General Announcement"), [subject, setSubject] = useState(""), [body, setBody] = useState(""), [to, setTo] = useState<string[]>([]), [open, setOpen] = useState("");
  return <>
    <section className="portal-panel">
      <div className="panel-heading"><div><h2>New Memo</h2></div></div>
      <form className="portal-form" onSubmit={async (e) => { e.preventDefault(); if (!(await askConfirm(`Issue this memo to ${to.length || "all"} employee${to.length === 1 ? "" : "s"}? A memo cannot be edited once issued.`))) return; await run("memo", { action: "memo-issue", memoType: type, subject, body, employeeIds: to }, "Memo issued."); setSubject(""); setBody(""); setTo([]); }}>
        <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>{["General Announcement", "Policy", "Office Order", "Schedule / Holiday Advisory", "Reminder"].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Send To<select multiple value={to} onChange={(e) => setTo([...e.target.selectedOptions].map((o) => o.value))} size={Math.min(5, employees.length + 1)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.complete_name}</option>)}</select><small className="field-help">None selected sends it to all employees.</small></label>
        <label className="full">Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={160} /></label>
        <label className="full">Body<textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} required minLength={5} /></label>
        <div className="portal-form-actions full"><button className="portal-primary" disabled={!!busy || !subject || !body}>{busy === "memo" ? "Issuing…" : "Issue Memo"}</button></div>
      </form>
    </section>
    <section className="portal-panel live-list">
      <div className="panel-heading"><div><h2>Issued Memos</h2></div></div>
      {plus.memos.map((m) => { const rec = plus.memoRecipients.filter((r) => r.memo_id === m.id), ack = rec.filter((r) => r.acknowledged_at); return <div key={m.id}>
        <button type="button" className="live-row-item hr-memo-row" onClick={() => setOpen(open === m.id ? "" : m.id)}><div><strong>{m.memo_no} · {m.subject}</strong><small>{m.memo_type} · {shortDate(m.issued_at)} · {m.audience}</small></div><Badge tone={ack.length === rec.length ? "green" : "orange"}>{ack.length} of {rec.length} Acknowledged</Badge></button>
        {open === m.id && <div className="hr-memo-open"><p>{m.body}</p><ul>{rec.map((r) => <li key={r.employee_id}>{employees.find((e) => e.id === r.employee_id)?.complete_name ?? "Employee"} · {r.acknowledged_at ? `Acknowledged ${shortDate(r.acknowledged_at)}` : "Not yet"}</li>)}</ul></div>}
      </div>; })}
      {!plus.memos.length && <p className="portal-empty-copy">No memos issued yet.</p>}
    </section>
  </>;
}

function SettingsPanel({ settings, busy, run }: { settings: HrSettings; busy: string; run: (k: string, b: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [s, setS] = useState(settings);
  const n = (k: keyof HrSettings) => (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) });
  return <section className="portal-panel">
    <div className="panel-heading"><div><h2>Reminders</h2></div></div>
    <form className="portal-form" onSubmit={(e) => { e.preventDefault(); void run("set", { action: "hr-settings-save", fitToWorkMonths: s.fit_to_work_months, biodataMonths: s.biodata_months, firstReminderDays: s.first_reminder_days, repeatDays: s.repeat_days, includeInDailyEmail: s.include_in_daily_email }, "Reminder settings saved."); }}>
      <label>Medical Fit to Work Every (Months)<input type="number" min={1} max={24} value={s.fit_to_work_months} onChange={n("fit_to_work_months")} /></label>
      <label>Biodata Review Every (Months)<input type="number" min={1} max={24} value={s.biodata_months} onChange={n("biodata_months")} /></label>
      <label>First Reminder (Days Before)<input type="number" min={1} max={90} value={s.first_reminder_days} onChange={n("first_reminder_days")} /></label>
      <label>Repeat Every (Days)<input type="number" min={1} max={30} value={s.repeat_days} onChange={n("repeat_days")} /></label>
      <label className="full hr-check"><input type="checkbox" checked={s.include_in_daily_email} onChange={(e) => setS({ ...s, include_in_daily_email: e.target.checked })} /> Include due and overdue checks in the 8:00 PM e-mail</label>
      <div className="portal-form-actions full"><button className="portal-primary" disabled={!!busy}>{busy === "set" ? "Saving…" : "Save Settings"}</button></div>
    </form>
  </section>;
}

export { KIND_LABEL, manilaDate };
