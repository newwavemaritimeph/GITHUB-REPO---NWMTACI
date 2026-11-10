"use client";

import { useMemo, useState } from "react";
import { Badge, Message } from "./shared-ui";
import { askText, askConfirm } from "./dialogs";
import { daysBetween, dueLabel, hrDueItems, HR_DEFAULTS, KIND_LABEL, manilaDate, type DueItem, type DueState, type HrSettings } from "@/lib/hr-due";
import type { Hr201 } from "@/lib/hr-server";

/** HR Module, Phase 1 (owner, 10 Nov 2026): the HR Officer's 201 checks, memos, change requests and reminder settings. */
export type HrMemo = { id: string; memo_no: string; memo_type: string; subject: string; body: string; audience?: string; issued_at: string };
export type HrRequest = { id: string; request_no: string; employee_id?: string; request_type: string; details: string; status: string; decision_remarks?: string | null; created_at: string; decided_at?: string | null };
export type HrTemplate = { doc_type: "coe" | "nte" | "memo"; version: number; body: string; signatories: { label: string; name: string; title: string }[]; created_at: string };
export type HrCoe = { id: string; employee_id?: string; purpose: string; status: string; requested_at: string; completed_at?: string | null; coe_no?: string | null; drive_link?: string | null };
export type HrPlus = { profiles: Hr201[]; memos: HrMemo[]; memoRecipients: { memo_id: string; employee_id: string; acknowledged_at: string | null }[]; requests: HrRequest[]; settings: HrSettings; lastReminder: Record<string, string>; templates?: Partial<Record<"coe" | "nte" | "memo", HrTemplate>>; coes?: HrCoe[] } | null;
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

export function HrPeople({ view, employees, plus, reload, onEdit }: { view: "201" | "Memos" | "Requests" | "Settings" | "COE" | "Templates"; employees: Emp[]; plus: HrPlus; reload: () => Promise<void>; onEdit?: (id: string) => void }) {
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
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
            <td data-l=""><button type="button" className="portal-secondary row-act" onClick={() => onEdit?.(e.id)}>Edit 201</button></td>
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

    {view === "COE" && <CoePanel employees={employees} plus={plus} busy={busy} run={run} />}
    {view === "Templates" && <TemplatesPanel plus={plus} busy={busy} run={run} />}
  </>;
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
        <button type="button" className="live-row-item hr-memo-row" onClick={() => setOpen(open === m.id ? "" : m.id)}><div><strong>{m.memo_no} · {m.subject}</strong><small>{m.memo_type} · {shortDate(m.issued_at)} · {m.audience}</small></div><Badge tone={ack.length === rec.length ? "green" : "orange"}>{`${ack.length} of ${rec.length} Acknowledged`}</Badge></button>
        {open === m.id && <div className="hr-memo-open"><a className="portal-secondary row-act" href={`/api/documents/hr?type=memo&id=${m.id}`} target="_blank" rel="noreferrer">PDF</a><p>{m.body}</p><ul>{rec.map((r) => <li key={r.employee_id}>{employees.find((e) => e.id === r.employee_id)?.complete_name ?? "Employee"} · {r.acknowledged_at ? `Acknowledged ${shortDate(r.acknowledged_at)}` : "Not yet"}</li>)}</ul></div>}
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

/** COE requests from MyHR (owner, 10 Nov 2026): issue within 3 days; Issue numbers it and opens the PDF. */
function CoePanel({ employees, plus, busy, run }: { employees: Emp[]; plus: NonNullable<HrPlus>; busy: string; run: (k: string, b: Record<string, unknown>, ok: string) => Promise<void> }) {
  const rows = plus.coes ?? [];
  const name = (id?: string) => employees.find((e) => e.id === id)?.complete_name ?? "Employee";
  return <section className="portal-panel hr-table"><div className="portal-table-wrap"><table className="portal-table cx-cards"><thead><tr><th>Employee</th><th>Purpose</th><th>Requested</th><th>Status</th><th /></tr></thead><tbody>
    {rows.map((c) => { const late = c.status === "Pending" && daysBetween(manilaDate(c.requested_at), todayManila()) > 3; return <tr key={c.id}>
      <td className="lead" data-l="Employee"><strong>{name(c.employee_id)}</strong>{c.coe_no && <small className="mono">{c.coe_no}</small>}</td>
      <td data-l="Purpose">{c.purpose}</td><td data-l="Requested">{shortDate(c.requested_at)}</td>
      <td data-l="Status"><Badge tone={c.status === "Issued" ? "green" : c.status === "Rejected" || late ? "red" : "orange"}>{late ? "Over 3 Days" : c.status}</Badge></td>
      <td data-l="" className="hr-cell-acts">{c.status === "Pending" ? <span className="hr-acts"><button type="button" className="portal-secondary row-act" disabled={!!busy} onClick={async () => { const reason = await askText("Why can it not be issued? The employee sees this."); if (reason) await run(`cr${c.id}`, { action: "hr-coe-reject", id: c.id, reason }, "Returned to the employee."); }}>Reject</button><button type="button" className="portal-primary row-act" disabled={!!busy} onClick={async () => { if (await askConfirm(`Issue the COE of ${name(c.employee_id)}? It is numbered and filed; print it, sign and seal it.`)) await run(`ci${c.id}`, { action: "hr-coe-issue", id: c.id }, "COE issued. Open the PDF to print it."); }}>Issue</button></span>
        : c.status === "Issued" && <span className="hr-acts"><a className="portal-primary row-act" href={`/api/documents/hr?type=coe&id=${c.id}`} target="_blank" rel="noreferrer">PDF</a>{c.drive_link && <a className="portal-secondary row-act" href={c.drive_link} target="_blank" rel="noreferrer">Drive</a>}</span>}</td>
    </tr>; })}
    {!rows.length && <tr><td colSpan={5} className="hr-none">No COE requests yet. Employees request one in MyHR.</td></tr>}
  </tbody></table></div></section>;
}

const TPL_FIELDS: Record<"coe" | "nte" | "memo", string[]> = {
  coe: ["employee_name", "title", "last_name", "position", "date_hired", "date_until", "employment_type", "purpose", "date_issued"],
  nte: ["incident_facts", "rule_violated", "possible_sanction", "response_due"],
  memo: ["memo_body", "subject", "memo_type", "memo_no"],
};
const TPL_NAME = { coe: "Certificate of Employment", nte: "Notice to Explain", memo: "Memorandum" } as const;
type Sig = { label: string; name: string; title: string };

/** Document Templates: the wording and signatories of the COE (A4), NTE and Memo (Legal). Each save is a new version. */
function TemplatesPanel({ plus, busy, run }: { plus: NonNullable<HrPlus>; busy: string; run: (k: string, b: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [doc, setDoc] = useState<"coe" | "nte" | "memo">("coe");
  const [draft, setDraft] = useState<Record<string, { body: string; sigs: Sig[] }>>({});
  const t = plus.templates?.[doc];
  if (!t) return <section className="portal-panel"><p className="hr-none">Apply database update 202611100096 to turn on the document templates.</p></section>;
  const cur = draft[doc] ?? { body: t.body, sigs: t.signatories };
  const set = (next: Partial<typeof cur>) => setDraft({ ...draft, [doc]: { ...cur, ...next } });
  const setSig = (i: number, k: keyof Sig, v: string) => set({ sigs: cur.sigs.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  return <div className="hr-tpl">
    <div className="hr-bar">
      <select className="hr-show" value={doc} onChange={(e) => setDoc(e.target.value as typeof doc)} aria-label="Document">{(Object.keys(TPL_NAME) as (keyof typeof TPL_NAME)[]).map((k) => <option key={k} value={k}>{TPL_NAME[k]}</option>)}</select>
      <Badge tone="slate">{`${doc === "coe" ? "A4" : "Legal"} · Version ${t.version}`}</Badge>
      <span className="hr-bar-gap" />
      <a className="portal-secondary" href={`/api/documents/hr?type=preview&doc=${doc}`} target="_blank" rel="noreferrer">Preview PDF</a>
      <button type="button" className="portal-primary" disabled={!!busy || !draft[doc]} onClick={async () => { await run("tpl", { action: "hr-template-save", docType: doc, body: cur.body, signatories: cur.sigs }, "Saved as a new version. Documents already issued keep their version."); const d = { ...draft }; delete d[doc]; setDraft(d); }}>{busy === "tpl" ? "Saving…" : "Save as New Version"}</button>
    </div>
    <section className="portal-panel"><div className="panel-heading"><h2>Content</h2></div>
      <div className="hr-tpl-body">
        <div className="hr-chips">{TPL_FIELDS[doc].map((f) => <button key={f} type="button" onClick={() => { const a = document.getElementById("hr-tpl-text") as HTMLTextAreaElement | null; const at = a?.selectionStart ?? cur.body.length, to = a?.selectionEnd ?? at; set({ body: `${cur.body.slice(0, at)}{{${f}}}${cur.body.slice(to)}` }); }}>{`{{${f}}}`}</button>)}</div>
        <textarea id="hr-tpl-text" rows={12} value={cur.body} onChange={(e) => set({ body: e.target.value })} aria-label="Template wording" />
        {doc === "nte" && <small className="hr-warn">The response deadline is never less than 5 calendar days from receipt.</small>}
      </div>
    </section>
    <section className="portal-panel"><div className="panel-heading"><h2>Signatories</h2>{cur.sigs.length < 6 && <button type="button" className="portal-secondary row-act" onClick={() => set({ sigs: [...cur.sigs, { label: "Noted by", name: "", title: "" }] })}>Add Signatory</button>}</div>
      {cur.sigs.map((g, i) => <div className="hr-sig" key={i}>
        <input value={g.label} onChange={(e) => setSig(i, "label", e.target.value)} placeholder="Label (e.g. Certified by)" aria-label="Label" />
        <input value={g.name} onChange={(e) => setSig(i, "name", e.target.value)} placeholder="Name" aria-label="Name" />
        <input value={g.title} onChange={(e) => setSig(i, "title", e.target.value)} placeholder="Position" aria-label="Position" />
        <button type="button" className="portal-secondary row-act" disabled={cur.sigs.length < 2} onClick={() => set({ sigs: cur.sigs.filter((_, j) => j !== i) })}>Remove</button>
      </div>)}
    </section>
  </div>;
}
