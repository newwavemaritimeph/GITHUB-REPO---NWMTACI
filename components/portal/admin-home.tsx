"use client";

import { useEffect, useMemo, useState } from "react";
import type { PortalData } from "../portal-live-app";
import { addDays, first, manilaToday, pesos2 } from "@/lib/portal-format";
import { groupNotices, holidayReminders, holidaysInMonth, totalsByChannel, voidReasonProblem, type HolidayDay, type MarinaStatus, type Notice } from "@/lib/admin-dashboard";
import { requisitionState } from "@/lib/admin-assistant";
import { Badge, Message, fmtDate, fullName, usePost as useRawPost } from "./shared-ui";
import { certificateLines } from "./releasing-home";
import { upcoming } from "./admin-assistant-home";

/**
 * Admin workspace (owner, 9 Oct 2026): an up-to-date dashboard with a start and
 * end date, Search Trainee and Enrollments with the Admin-only voids, the voucher
 * list for the Daily Summary Report, and the holiday list behind the MARINA
 * reminders. Every void needs a written reason and is recorded in the audit log.
 */

const CHANNELS = ["Cash", "GCash", "PSBank", "UnionBank"] as const;
type Dash = {
  today: string; from: string; to: string; enrollments: number; enrollmentsPerDay: Record<string, number>;
  collections: { channel: string; amount: number }[]; releases: { channel: string; amount: number }[];
  classes: { id: string; batchNumber: string; courseCode: string; courseName: string; stcw: boolean; students: number; capacity: number; room: string | null; roomSeats: number | null; instructor: string | null }[];
  mismo: { batches: number; submitted: number; afterCutoff: boolean };
  unreconciled: { channel: string; count: number; total: number; oldest: string | null }[];
  holidays: HolidayDay[];
};
type Requisition = { id: string; requisition_number: string; status: string; total_centavos: number; created_at: string; lines?: { description: string; quantity: number }[]; expenses?: { status: string; voucher_number?: string | null } | { status: string; voucher_number?: string | null }[] | null };
type Extra = { requisitions?: Requisition[]; holidays?: { holiday_date: string; name: string; kind: string; marina_status: string }[] };
const extra = (d: PortalData) => d as unknown as Extra;
const weekday = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const when = (v: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(v));

/** usePost that reports success as true/false instead of throwing (the message shows the error). */
function usePost(reload: () => Promise<void>) {
  const raw = useRawPost(reload);
  return { busy: raw.busy, msg: raw.msg, post: async (body: Record<string, unknown>, text?: string) => { try { await raw.post(body, text); return true; } catch { return false; } } };
}

function Head({ eyebrow = "Admin", title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return <div className="cx-head"><div><span className="portal-eyebrow">{eyebrow}</span><h1>{title}</h1></div>{children}</div>;
}

function useJson<T>(url: string) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  const [tick, setTick] = useState(0);
  const key = `${url}#${tick}`;
  useEffect(() => {
    let live = true;
    const k = `${url}#${tick}`;
    void fetch(url, { cache: "no-store" }).then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not load."); if (live) setState({ key: k, data: body as T, error: "" }); })
      .catch((e) => { if (live) setState({ key: k, data: null, error: e instanceof Error ? e.message : "Could not load." }); });
    return () => { live = false; };
  }, [url, tick]);
  const fresh = state.key === key;
  // Keep showing the last data while a refresh of the same address loads.
  const same = state.key.split("#")[0] === url;
  return { data: fresh || same ? state.data : null, error: fresh ? state.error : "", loading: !fresh, load: async () => setTick((t) => t + 1) };
}

/** The reason box shared by every void and cancellation. */
function VoidBox({ title, detail, busy, onCancel, onConfirm }: { title: string; detail: string; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [problem, setProblem] = useState("");
  return <div className="ad-void" role="group" aria-label={title}>
    <b>{title}</b><p>{detail}</p>
    <label>Reason<input value={reason} onChange={(e) => { setReason(e.target.value); setProblem(""); }} placeholder="e.g. Wrong trainee, duplicate receipt, wrong amount" maxLength={500} /></label>
    {problem && <p className="ad-err">{problem}</p>}
    <div className="ad-void-actions"><button type="button" className="portal-secondary" onClick={onCancel} disabled={busy}>Keep It</button>
      <button type="button" className="ad-danger" disabled={busy} onClick={() => { const p = voidReasonProblem(reason); if (p) { setProblem(p); return; } onConfirm(reason.trim()); }}>{busy ? "Saving…" : title}</button></div>
  </div>;
}

/* ---------------- Dashboard ---------------- */

export function AdminHome({ data, go, reload }: { data: PortalData; go: (m: string) => void; reload: () => Promise<void> }) {
  const today = manilaToday();
  const [from, setFrom] = useState(today), [to, setTo] = useState(today), [cat, setCat] = useState("All");
  const { data: dash, error, loading } = useJson<Dash>(`/api/staff/admin?view=dashboard&from=${from}&to=${to}`);

  const notices = useMemo(() => {
    const list: Notice[] = [];
    const certs = certificateLines(data);
    const overdue = certs.filter((l) => l.view.overdue), dueToday = certs.filter((l) => !l.view.overdue && l.view.state === "Due" && l.view.dueOn === today);
    const names = (ls: typeof certs) => ls.slice(0, 5).map((l) => `${l.name} (${l.course.code})`).join(", ") + (ls.length > 5 ? ` and ${ls.length - 5} more` : "");
    if (overdue.length) list.push({ category: "Certificates", severity: "urgent", title: `${overdue.length} certificate${overdue.length === 1 ? "" : "s"} overdue to print`, detail: names(overdue), go: "Certifications" });
    if (dueToday.length) list.push({ category: "Certificates", severity: "reminder", title: `${dueToday.length} certificate${dueToday.length === 1 ? "" : "s"} due to print today, not printed yet`, detail: names(dueToday), go: "Certifications" });
    const voids = (data.certificates as unknown as { void_status?: string | null }[]).filter((c) => c.void_status === "Requested").length;
    if (voids) list.push({ category: "Certificates", severity: "reminder", title: `${voids} certificate void request${voids === 1 ? "" : "s"} waiting for you`, detail: "Approve or reject them in Certifications.", go: "Certifications" });
    const week = addDays(today, 7);
    const plan = upcoming(data).filter((p) => p.b.starts_on <= week && p.issues.length);
    if (plan.length) list.push({ category: "Classes and Rooms", severity: plan.some((p) => p.b.starts_on <= today) ? "urgent" : "reminder", title: `${plan.length} batch${plan.length === 1 ? "" : "es"} this week need a classroom, an instructor or a check`, detail: plan.slice(0, 4).map((p) => `${p.b.batch_number} ${first(p.b.courses)?.code ?? ""}: ${p.issues.join(", ")}`).join(" · "), go: "Resource planning" });
    for (const c of dash?.unreconciled ?? []) list.push({ category: "Payments and Reconciliation", severity: "reminder", title: `${c.count} ${c.channel} payment${c.count === 1 ? "" : "s"} not reconciled from earlier days`, detail: `${pesos2(c.total)}${c.oldest ? ` · oldest ${fmtDate(c.oldest)}` : ""}` });
    if (dash && dash.mismo.batches > dash.mismo.submitted) list.push({ category: "MISMO", severity: dash.mismo.afterCutoff ? "urgent" : "reminder", title: dash.mismo.afterCutoff ? "MARINA MISMO final list not yet submitted today" : "MARINA MISMO final list due after the 4:00 PM cut-off", detail: `${dash.mismo.batches - dash.mismo.submitted} of ${dash.mismo.batches} batch${dash.mismo.batches === 1 ? "" : "es"} still to submit`, go: "Final list" });
    for (const h of holidayReminders(dash?.holidays ?? [], today)) list.push({ category: "Holidays and MARINA Requests", severity: "reminder", title: `Holiday on a training day: ${h.name}, ${weekday(h.date)}`, detail: `${h.batches.length} batch${h.batches.length === 1 ? "" : "es"} in class (${[...new Set(h.batches.map((b) => b.courseCode))].join(", ")}). Request MARINA's permission to conduct training, or move the classes.`, go: `holiday:${h.date.slice(0, 7)}` });
    return list;
  }, [data, dash, today]);
  const groups = groupNotices(notices);
  const shown = cat === "All" ? groups : groups.filter((g) => g.category === cat);

  const coll = totalsByChannel(dash?.collections ?? [], CHANNELS), rel = totalsByChannel(dash?.releases ?? [], CHANNELS);
  const channels = [...CHANNELS, ...(coll.Other || rel.Other ? ["Other"] : [])];
  const totalColl = Object.values(coll).reduce((s, v) => s + v, 0), totalRel = Object.values(rel).reduce((s, v) => s + v, 0);
  const approvals = useApprovals(data);
  const reqs = (extra(data).requisitions ?? []).slice(0, 8);
  const days: string[] = []; for (let d = from; d <= to && days.length < 62; d = addDays(d, 1)) days.push(d);
  const peak = Math.max(1, ...days.map((d) => dash?.enrollmentsPerDay[d] ?? 0));
  const stcw = (dash?.classes ?? []).filter((c) => c.stcw);
  const [month, setMonth] = useState(addDays(today, 31).slice(0, 7));
  const quick: [string, string, string][] = [["Today", today, today], ["This Week", addDays(today, -6), today], ["This Month", `${today.slice(0, 7)}-01`, today]];

  return <div className="portal-page cx ac ad">
    <Head title="Dashboard">
      <div className="ad-range">
        <label>Start<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label>End<input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <div className="cx-seg">{quick.map(([l, a, b]) => <button key={l} type="button" className={from === a && to === b ? "on" : ""} onClick={() => { setFrom(a); setTo(b); }}>{l}</button>)}</div>
      </div>
    </Head>
    {error && <Message kind="error" text={error} />}

    <section className="portal-panel cx-panel ad-notices"><div className="panel-heading"><h2>Important Notifications</h2><span className="ad-count">{notices.length}</span></div>
      {notices.length ? <>
        <div className="cx-seg ad-cats" role="tablist">{["All", ...groups.map((g) => g.category)].map((c) => { const n = c === "All" ? notices.length : groups.find((g) => g.category === c)?.notices.length ?? 0; return <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c} <span className="ad-count">{n}</span></button>; })}</div>
        {shown.map((g) => <div key={g.category} className="ad-group"><h3>{g.category}<span className="ad-count">{g.notices.length}</span>{g.urgent > 0 && <Badge tone="red">{g.urgent} Urgent</Badge>}</h3>
          {g.notices.map((n) => <div key={n.title} className={`ad-notice ${n.severity}`}><div><b>{n.title}</b><small>{n.detail}</small></div>
            {n.go && <button type="button" className="portal-secondary" onClick={() => { if (n.go!.startsWith("holiday:")) { setMonth(n.go!.slice(8)); document.getElementById("ad-holidays")?.scrollIntoView({ behavior: "smooth" }); } else go(n.go!); }}>Open</button>}</div>)}
        </div>)}
      </> : <p className="portal-empty-copy">{loading ? "Checking…" : "Nothing needs your attention."}</p>}
    </section>

    <div className="cx-tiles ac-tiles">
      <div className="cx-tile"><span>Enrollments</span><b>{dash?.enrollments ?? "—"}</b></div>
      <div className="cx-tile"><span>Collections</span><b>{pesos2(totalColl)}</b></div>
      <div className="cx-tile"><span>Releases (Expenses Paid)</span><b>{pesos2(totalRel)}</b></div>
      <div className={`cx-tile${approvals.length ? " cl-overdue" : ""}`}><span>Requests and Approvals Waiting</span><b>{approvals.length}</b></div>
      <div className="cx-tile"><span>Requisitions for Approval</span><b>{(extra(data).requisitions ?? []).filter((r) => r.status === "For Approval").length}</b></div>
    </div>

    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Ongoing Classes · STCW Courses</h2><small>In class today, {fmtDate(today)}</small></div>
      {stcw.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Batch No.</th><th>Course</th><th>Room</th><th>Instructor</th><th>No. of Students</th></tr></thead><tbody>
        {stcw.map((c) => <tr key={c.id}><td className="cl-mono">{c.batchNumber}</td><td><b>{c.courseCode}</b><small>{c.courseName}</small></td><td>{c.room ?? <Badge tone="orange">No Room</Badge>}</td><td>{c.instructor ?? <Badge tone="orange">No Instructor</Badge>}</td><td className={c.roomSeats && c.students > c.roomSeats ? "aa-warn" : ""}>{c.students} / {c.roomSeats ?? c.capacity}</td></tr>)}
      </tbody></table></div> : <p className="portal-empty-copy">{loading ? "Loading…" : "No STCW class is in session today."}</p>}
    </section>

    <div className="ad-grid">
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Requests and Approvals</h2><small>{approvals.length} waiting</small></div>
        {approvals.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Type</th><th>Item</th><th>Reference</th><th>Amount</th><th>With</th></tr></thead><tbody>
          {approvals.slice(0, 12).map((a) => <tr key={a.key}><td><Badge tone="blue">{a.type}</Badge></td><td>{a.item}</td><td className="cl-mono">{a.ref}</td><td className="cl-mono">{a.amount == null ? "—" : pesos2(a.amount)}</td><td><small>{a.with}</small></td></tr>)}
        </tbody></table></div> : <p className="portal-empty-copy">Nothing is waiting for approval.</p>}
      </section>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>No. of Enrollments</h2><small>{fmtDate(from)} – {fmtDate(to)}</small></div>
        <div className="ad-bars">{days.map((d) => { const n = dash?.enrollmentsPerDay[d] ?? 0; return <div key={d} title={`${fmtDate(d)}: ${n}`}><i style={{ height: `${Math.round((n / peak) * 90) + 2}px` }} /><small>{Number(d.slice(8))}</small></div>; })}</div>
        <p className="ad-note">{dash?.enrollments ?? 0} enrollments · {days.length} day{days.length === 1 ? "" : "s"}</p>
      </section>
    </div>

    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections and Releases</h2><small>{fmtDate(from)} – {fmtDate(to)}</small></div>
      <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Channel</th><th>Collections</th><th>Releases</th><th>Net</th></tr></thead><tbody>
        {channels.map((c) => <tr key={c}><td>{c}</td><td className="cl-mono">{pesos2(coll[c] ?? 0)}</td><td className="cl-mono">{pesos2(rel[c] ?? 0)}</td><td className="cl-mono">{pesos2((coll[c] ?? 0) - (rel[c] ?? 0))}</td></tr>)}
        <tr className="ad-total"><td>Total</td><td className="cl-mono">{pesos2(totalColl)}</td><td className="cl-mono">{pesos2(totalRel)}</td><td className="cl-mono">{pesos2(totalColl - totalRel)}</td></tr>
      </tbody></table></div>
    </section>

    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Requisition Requests</h2><button type="button" className="portal-secondary" onClick={() => go("Requisitions")}>Open Requisitions</button></div>
      {reqs.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>RQ No.</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>
        {reqs.map((r) => { const s = requisitionState({ status: r.status, expense_status: first(r.expenses)?.status }); return <tr key={r.id}><td className="cl-mono">{r.requisition_number}</td><td>{fmtDate(r.created_at.slice(0, 10))}</td><td>{(r.lines ?? []).map((l) => `${l.description} × ${l.quantity}`).join(", ")}</td><td className="cl-mono">{pesos2(r.total_centavos)}</td><td><Badge tone={s === "For Approval" ? "orange" : s === "Released" ? "green" : s === "Rejected" || s === "Voided" ? "red" : "blue"}>{s}</Badge></td></tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">No requisitions yet.</p>}
    </section>

    <HolidayPanel holidays={dash?.holidays ?? []} month={month} setMonth={setMonth} reload={reload} onChanged={() => setFrom((f) => f)} today={today} go={go} />
  </div>;
}

type Approval = { key: string; type: string; item: string; ref: string; amount: number | null; with: string };
function useApprovals(data: PortalData): Approval[] {
  return useMemo(() => {
    const out: Approval[] = [];
    const enr = new Map(data.enrollments.map((e) => [e.id, e]));
    const who = (id: string) => { const e = enr.get(id); const t = first(e?.trainees); return t ? `${t.legal_last_name}, ${t.legal_first_name}` : "—"; };
    for (const x of data.expenses.filter((x) => x.status === "Pending")) out.push({ key: `x${x.id}`, type: "Expense", item: `${x.payee} · ${x.category}`, ref: x.expense_number, amount: Number(x.amount_centavos), with: "Accounting Manager" });
    for (const d of data.pendingDiscounts) out.push({ key: `d${d.id}`, type: "Discount", item: `${who(d.enrollment_id)} · ${d.description}`, ref: enr.get(d.enrollment_id)?.enrollment_number ?? "—", amount: -Number(d.amount_centavos), with: "Accounting Manager" });
    const reqs = (data as unknown as { requests: { id: string; enrollment_id: string; request_type: string; status: string; stage?: string | null }[] }).requests ?? [];
    for (const r of reqs.filter((r) => r.status === "Pending")) out.push({ key: `r${r.id}`, type: r.request_type, item: who(r.enrollment_id), ref: enr.get(r.enrollment_id)?.enrollment_number ?? "—", amount: null, with: r.stage === "With cashier" ? "Cashier (fee)" : "Accounting Manager" });
    for (const c of (data.certificates as unknown as { id: string; enrollment_id: string; void_status?: string | null; certificate_number?: string | null }[]).filter((c) => c.void_status === "Requested")) out.push({ key: `c${c.id}`, type: "Certificate Void", item: who(c.enrollment_id), ref: c.certificate_number ?? "—", amount: null, with: "Admin" });
    for (const q of (extra(data).requisitions ?? []).filter((q) => q.status === "For Approval")) out.push({ key: `q${q.id}`, type: "Requisition", item: (q.lines ?? []).map((l) => `${l.description} × ${l.quantity}`).join(", "), ref: q.requisition_number, amount: Number(q.total_centavos), with: "Admin or Accounting Manager" });
    return out;
  }, [data]);
}

/* ---------------- Holidays ---------------- */

const MARINA_TONE: Record<MarinaStatus, string> = { "Not Sent": "orange", Sent: "blue", Approved: "green", "Classes Moved": "blue" };
function HolidayPanel({ holidays, month, setMonth, reload, today, go }: { holidays: HolidayDay[]; month: string; setMonth: (m: string) => void; reload: () => Promise<void>; onChanged: () => void; today: string; go: (m: string) => void }) {
  const [local, setLocal] = useState<Record<string, MarinaStatus>>({});
  const { busy, msg, post } = usePost(reload);
  const months = [0, 1, 2, 3].map((i) => { const d = new Date(`${today.slice(0, 7)}-01T12:00:00+08:00`); d.setUTCMonth(d.getUTCMonth() + i); return d.toISOString().slice(0, 7); });
  const label = (m: string) => new Intl.DateTimeFormat("en-PH", { month: "long", year: m.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: "Asia/Manila" }).format(new Date(`${m}-15T12:00:00+08:00`));
  const rows = holidaysInMonth(holidays.map((h) => ({ ...h, marinaStatus: local[h.date] ?? h.marinaStatus })), month);
  const hit = rows.filter((h) => h.batches.length);
  async function mark(date: string, status: MarinaStatus) { if (await post({ action: "holiday-marina", date, status }, "Saved.")) setLocal((l) => ({ ...l, [date]: status })); }
  return <section className="portal-panel cx-panel" id="ad-holidays"><div className="panel-heading"><h2>Holidays on Training Dates</h2>
    <div className="cx-seg">{months.map((m) => <button key={m} type="button" className={month === m ? "on" : ""} onClick={() => setMonth(m)}>{label(m)}</button>)}</div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <p className="ad-note">{rows.length ? hit.length ? `${hit.length} holiday${hit.length === 1 ? "" : "s"} fall on training days this month · ${hit.reduce((s, h) => s + h.batches.length, 0)} batches · ${hit.reduce((s, h) => s + h.batches.reduce((a, b) => a + b.students, 0), 0)} trainees. Request MARINA's permission to conduct training on these dates, or move the classes.` : "No batch is scheduled on this month's holidays yet." : "No holidays listed for this month."}</p>
    {rows.length > 0 && <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th>Training on That Day</th><th>MARINA Request</th></tr></thead><tbody>
      {rows.map((h) => <tr key={h.date}><td><b>{weekday(h.date)}</b></td><td>{h.name}</td><td><Badge tone={h.kind === "Regular" ? "red" : "orange"}>{h.kind}</Badge></td>
        <td>{h.batches.length ? h.batches.map((b) => <div key={b.batchNumber}><span className="cl-mono">{b.batchNumber}</span> {b.courseCode} · {b.students} trainee{b.students === 1 ? "" : "s"}</div>) : <small>{new Date(`${h.date}T12:00:00+08:00`).getUTCDay() === 0 ? "No class (Sunday)" : "No batch yet"}</small>}</td>
        <td>{h.batches.length ? <><Badge tone={MARINA_TONE[h.marinaStatus]}>{h.marinaStatus === "Not Sent" ? "Request Not Sent" : h.marinaStatus === "Sent" ? "Request Sent" : h.marinaStatus === "Approved" ? "MARINA Approved" : "Classes Moved"}</Badge>
          <div className="ad-acts">{h.marinaStatus === "Not Sent" && <button type="button" className="portal-secondary" disabled={busy} onClick={() => void mark(h.date, "Sent")}>Mark Request Sent</button>}
            {h.marinaStatus === "Sent" && <button type="button" className="portal-secondary" disabled={busy} onClick={() => void mark(h.date, "Approved")}>Mark Approved</button>}
            {(h.marinaStatus === "Not Sent" || h.marinaStatus === "Sent") && <button type="button" className="portal-secondary" disabled={busy} onClick={() => void mark(h.date, "Classes Moved")}>Classes Moved</button>}
            {(h.marinaStatus === "Approved" || h.marinaStatus === "Classes Moved") && <button type="button" className="ad-link" disabled={busy} onClick={() => void mark(h.date, "Not Sent")}>Undo</button>}</div></> : <small>—</small>}</td></tr>)}
    </tbody></table></div>}
    <p className="ad-note">Keep the list current in <button type="button" className="ad-link" onClick={() => go("Holidays")}>Configuration › Holidays</button>, from each year&apos;s Proclamation and any special days declared later.</p>
  </section>;
}

export function AdminHolidays({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload);
  const [form, setForm] = useState({ date: "", name: "", kind: "Regular" }), [open, setOpen] = useState(false);
  const rows = [...(extra(data).holidays ?? [])].sort((a, z) => a.holiday_date.localeCompare(z.holiday_date));
  const today = manilaToday();
  return <div className="portal-page cx ac ad">
    <Head eyebrow="Admin › Configuration" title="Holidays">{!open && <button type="button" className="portal-primary" onClick={() => setOpen(true)}>Add Holiday</button>}</Head>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {open && <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Add Holiday</h2></div>
      <form className="ad-form" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "holiday-save", ...form }, "Holiday saved.")) { setForm({ date: "", name: "", kind: "Regular" }); setOpen(false); } }}>
        <label>Date<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label>Holiday<input required minLength={3} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Special Non-Working Day" /></label>
        <label>Type<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{["Regular", "Special Non-Working", "Special Working", "Local"].map((k) => <option key={k}>{k}</option>)}</select></label>
        <div className="ad-void-actions"><button type="button" className="portal-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="portal-primary" disabled={busy}>Save Holiday</button></div>
      </form></section>}
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Holidays</h2><small>{rows.length} listed</small></div>
      {rows.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th>MARINA Request</th><th></th></tr></thead><tbody>
        {rows.map((h) => <tr key={h.holiday_date} className={h.holiday_date < today ? "ad-past" : ""}><td><b>{weekday(h.holiday_date)}</b></td><td>{h.name}</td><td>{h.kind}</td><td>{h.marina_status}</td>
          <td><button type="button" className="portal-secondary" disabled={busy} onClick={() => { if (window.confirm(`Remove ${h.name} (${h.holiday_date}) from the list?`)) void post({ action: "holiday-delete", date: h.holiday_date }, "Removed."); }}>Remove</button></td></tr>)}
      </tbody></table></div> : <p className="portal-empty-copy">No holidays yet. Run database update 202610090038, which adds the national holidays, or add them here.</p>}
    </section>
  </div>;
}

/* ---------------- Search Trainee (with Void Payment and Cancel Enrollment) ---------------- */

type Ledger = {
  enrollments: { id: string; number: string; status: string; courseCode: string; courseName: string; batch: string | null; startsOn: string | null; endsOn: string | null; due: number; paid: number }[];
  payments: { id: string; number: string; receipt: string | null; amount: number; method: string; reference: string | null; receivedAt: string; recordedBy: string | null; courses: string[]; valid: boolean; voidReason: string | null; voidedAt: string | null }[];
};

export function AdminSearchTrainee({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [q, setQ] = useState(""), [pick, setPick] = useState<string | null>(null);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase(); if (s.length < 2) return [];
    const nos = (data as unknown as { applicationNumbers?: Record<string, string> }).applicationNumbers ?? {};
    return data.trainees.filter((t) => `${fullName(t)} ${t.trainee_number} ${nos[t.id] ?? ""} ${t.srn ?? ""} ${t.email} ${t.mobile}`.toLowerCase().includes(s)).slice(0, 15);
  }, [q, data]);
  const t = pick ? data.trainees.find((x) => x.id === pick) ?? null : null;
  return <div className="portal-page cx ac ad">
    <Head title="Search Trainee" />
    <section className="portal-panel cx-panel"><div className="ad-search"><input value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder="Search by name, NWMTACI number, SRN, mobile or email" aria-label="Search trainee" /></div>
      {!t && q.trim().length >= 2 && (matches.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Trainee</th><th>Trainee No.</th><th>SRN</th><th>Contact</th><th></th></tr></thead><tbody>
        {matches.map((m) => <tr key={m.id}><td><b>{fullName(m)}</b></td><td className="cl-mono">{m.trainee_number}</td><td className="cl-mono">{m.srn ?? "—"}</td><td>{m.mobile}<small>{m.email}</small></td><td><button type="button" className="portal-secondary" onClick={() => setPick(m.id)}>Open</button></td></tr>)}
      </tbody></table></div> : <p className="portal-empty-copy">No trainee matches.</p>)}
    </section>
    {t && <TraineeLedger trainee={t} reload={reload} onBack={() => setPick(null)} />}
  </div>;
}

function TraineeLedger({ trainee, reload, onBack }: { trainee: PortalData["trainees"][number]; reload: () => Promise<void>; onBack: () => void }) {
  const { data: ledger, error, load } = useJson<Ledger>(`/api/staff/admin?view=trainee&id=${trainee.id}`);
  const after = async () => { await load(); await reload(); };
  const { busy, msg, post } = usePost(after);
  const [act, setAct] = useState<{ kind: "pay" | "enr"; id: string } | null>(null);
  const name = `${trainee.legal_last_name}, ${trainee.legal_first_name}`;
  return <>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {error && <Message kind="error" text={error} />}
    <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>{fullName(trainee)}</h2><small>{trainee.trainee_number} · {trainee.mobile} · {trainee.email}</small></div><button type="button" className="portal-secondary" onClick={onBack}>Back to Results</button></div>
      <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Enrollment</th><th>Course</th><th>Batch · Schedule</th><th>Status</th><th>Due</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>
        {(ledger?.enrollments ?? []).map((e) => <tr key={e.id}><td className="cl-mono">{e.number}</td><td><b>{e.courseCode}</b><small>{e.courseName}</small></td><td>{e.batch ? <span className="cl-mono">{e.batch}</span> : "No batch"}<small>{e.startsOn ? `${fmtDate(e.startsOn)}${e.endsOn && e.endsOn !== e.startsOn ? ` – ${fmtDate(e.endsOn)}` : ""}` : ""}</small></td>
          <td><Badge tone={e.status === "Enrolled" ? "green" : e.status === "Cancelled" ? "red" : "orange"}>{e.status}</Badge></td><td className="cl-mono">{pesos2(e.due)}</td><td className="cl-mono">{pesos2(e.paid)}</td><td className="cl-mono">{pesos2(Math.max(0, e.due - e.paid))}</td>
          <td>{e.status !== "Cancelled" && <button type="button" className="ad-danger-link" onClick={() => setAct({ kind: "enr", id: e.id })}>Cancel Enrollment</button>}</td></tr>)}
        {ledger && !ledger.enrollments.length && <tr><td colSpan={8}><span className="portal-empty-copy">No enrollments.</span></td></tr>}
      </tbody></table></div>
      {act?.kind === "enr" && (() => { const e = ledger?.enrollments.find((x) => x.id === act.id); return e ? <VoidBox title="Cancel Enrollment" busy={busy} onCancel={() => setAct(null)}
        detail={`${name} leaves ${e.courseCode}${e.batch ? ` ${e.batch} and the seat is released` : ""}.${e.paid ? ` The ${pesos2(e.paid)} already paid stays on record; a refund still goes through a Refund request.` : ""}`}
        onConfirm={async (reason) => { if (await post({ action: "enrollment-cancel", enrollmentId: e.id, reason }, `${e.number} cancelled.`)) setAct(null); }} /> : null; })()}
    </section>
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Payments</h2><small>{ledger?.payments.length ?? 0} receipt{ledger?.payments.length === 1 ? "" : "s"}</small></div>
      <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Receipt No.</th><th>Date</th><th>Course</th><th>Mode</th><th>Reference</th><th>Amount</th><th>Recorded By</th><th></th></tr></thead><tbody>
        {(ledger?.payments ?? []).map((p) => <tr key={p.id} className={p.valid ? "" : "ad-voided"}><td className="cl-mono"><a href={`/portal/payment-receipt/${p.id}`} target="_blank" rel="noreferrer">{p.receipt ?? p.number}</a></td><td>{when(p.receivedAt)}</td><td>{p.courses.join(", ") || "—"}</td><td>{p.method}</td><td className="cl-mono">{p.reference ?? "—"}</td>
          <td className="cl-mono">{p.valid ? <b>{pesos2(p.amount)}</b> : <s>{pesos2(p.amount)}</s>}</td><td>{p.recordedBy ?? "—"}</td>
          <td>{p.valid ? <button type="button" className="ad-danger-link" onClick={() => setAct({ kind: "pay", id: p.id })}>Void Payment</button> : <><Badge tone="red">VOID</Badge><small>{p.voidReason}{p.voidedAt ? ` · ${when(p.voidedAt)}` : ""}</small></>}</td></tr>)}
        {ledger && !ledger.payments.length && <tr><td colSpan={8}><span className="portal-empty-copy">No payments.</span></td></tr>}
      </tbody></table></div>
      {act?.kind === "pay" && (() => { const p = ledger?.payments.find((x) => x.id === act.id); return p ? <VoidBox title="Void Payment" busy={busy} onCancel={() => setAct(null)}
        detail={`${pesos2(p.amount)} ${p.method} goes back to ${name}'s balance. The receipt prints VOID and the payment leaves the day's collections and reconciliation. A reversal record and the audit log keep the history; nothing is erased. A cashier closing already submitted is not changed.`}
        onConfirm={async (reason) => { if (await post({ action: "payment-void", paymentId: p.id, reason }, `${p.receipt ?? p.number} voided.`)) setAct(null); }} /> : null; })()}
    </section>
  </>;
}

/* ---------------- Enrollments (with Cancel Enrollment) ---------------- */

export function AdminEnrollments({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [q, setQ] = useState(""), [status, setStatus] = useState("All"), [act, setAct] = useState<string | null>(null), [limit, setLimit] = useState(60);
  const { busy, msg, post } = usePost(reload);
  const statuses = ["All", "Pending", "Enrolled", "Open Schedule", "Cancelled"];
  const rows = data.enrollments.filter((e) => (status === "All" || e.enrollment_status === status) && (() => { const s = q.trim().toLowerCase(); if (!s) return true; const t = first(e.trainees); const c = first(e.courses); return `${e.enrollment_number} ${t?.legal_last_name ?? ""} ${t?.legal_first_name ?? ""} ${t?.trainee_number ?? ""} ${c?.code ?? ""} ${first(e.batches)?.batch_number ?? ""}`.toLowerCase().includes(s); })());
  const due = (e: PortalData["enrollments"][number]) => Number(e.selling_price_centavos) + Number(e.charges_centavos ?? 0) - Number(e.discounts_centavos ?? 0);
  return <div className="portal-page cx ac ad">
    <Head title="Enrollments" />
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cx-status" role="tablist">{statuses.map((s) => { const n = s === "All" ? data.enrollments.length : data.enrollments.filter((e) => e.enrollment_status === s).length; return <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s}{n > 0 && <span>{n}</span>}</button>; })}</div>
    <section className="portal-panel cx-panel"><div className="ad-search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trainee, enrollment, course or batch" aria-label="Search enrollments" /></div>
      <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Enrollment</th><th>Trainee</th><th>Course</th><th>Batch · Schedule</th><th>Status</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>
        {rows.slice(0, limit).map((e) => { const t = first(e.trainees), c = first(e.courses), b = first(e.batches); return <tr key={e.id}>
          <td className="cl-mono">{e.enrollment_number}</td><td><b>{t ? `${t.legal_last_name}, ${t.legal_first_name}` : "—"}</b><small>{t?.trainee_number}</small></td><td>{c?.code ?? "—"}</td>
          <td>{b ? <span className="cl-mono">{b.batch_number}</span> : "No batch"}<small>{b ? fmtDate(b.starts_on) : e.scheduled_on ? fmtDate(e.scheduled_on) : ""}</small></td>
          <td><Badge tone={e.enrollment_status === "Enrolled" ? "green" : e.enrollment_status === "Cancelled" ? "red" : "orange"}>{e.enrollment_status}</Badge></td>
          <td className="cl-mono">{pesos2(Number(e.paid_centavos))}</td><td className="cl-mono">{pesos2(Math.max(0, due(e) - Number(e.paid_centavos)))}</td>
          <td>{e.enrollment_status !== "Cancelled" && <button type="button" className="ad-danger-link" onClick={() => setAct(e.id)}>Cancel Enrollment</button>}</td></tr>; })}
        {!rows.length && <tr><td colSpan={8}><span className="portal-empty-copy">No enrollments match.</span></td></tr>}
      </tbody></table></div>
      {rows.length > limit && <div className="ad-more"><button type="button" className="portal-secondary" onClick={() => setLimit(limit + 60)}>Show More ({rows.length - limit})</button></div>}
      {act && (() => { const e = data.enrollments.find((x) => x.id === act); if (!e) return null; const t = first(e.trainees), b = first(e.batches); return <VoidBox title="Cancel Enrollment" busy={busy} onCancel={() => setAct(null)}
        detail={`${t ? `${t.legal_last_name}, ${t.legal_first_name}` : "The trainee"} leaves ${first(e.courses)?.code ?? "the course"}${b ? ` ${b.batch_number} and the seat is released` : ""}.${Number(e.paid_centavos) ? ` The ${pesos2(Number(e.paid_centavos))} already paid stays on record; a refund still goes through a Refund request.` : ""}`}
        onConfirm={async (reason) => { if (await post({ action: "enrollment-cancel", enrollmentId: e.id, reason }, `${e.enrollment_number} cancelled.`)) setAct(null); }} />; })()}
    </section>
  </div>;
}

/* ---------------- Vouchers (Daily Summary Report) ---------------- */

type Voucher = { id: string; number: string; payee: string; category: string; amount: number; status: string; channel: string | null; createdAt: string; paidAt: string | null; voidReason: string | null; voidedAt: string | null };
export function AdminVouchers() {
  const today = manilaToday();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`), [to, setTo] = useState(today), [act, setAct] = useState<string | null>(null);
  const { data, error, load } = useJson<{ vouchers: Voucher[] }>(`/api/staff/admin?view=vouchers&from=${from}&to=${to}`);
  const { busy, msg, post } = usePost(load);
  const list = data?.vouchers ?? [];
  return <section className="portal-panel cx-panel ad"><div className="panel-heading"><h2>Expenses with Voucher Numbers</h2>
    <div className="ad-range"><label>From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label><label>To<input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label></div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}{error && <Message kind="error" text={error} />}
    <div className="cl-wrap"><table className="cl-log"><thead><tr><th>CV No.</th><th>Date</th><th>Payee</th><th>Category</th><th>Channel</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      {list.map((v) => <tr key={v.id} className={v.status === "Void" ? "ad-voided" : ""}><td className="cl-mono"><a href={`/api/documents/expense/${v.id}?copy=1`} target="_blank" rel="noreferrer">{v.number}</a></td><td>{fmtDate(v.createdAt.slice(0, 10))}</td><td>{v.payee}</td><td>{v.category}</td><td>{v.channel ?? "—"}</td>
        <td className="cl-mono">{v.status === "Void" ? <s>{pesos2(v.amount)}</s> : <b>{pesos2(v.amount)}</b>}</td>
        <td>{v.status === "Void" ? <><Badge tone="red">VOID</Badge><small>{v.voidReason}{v.voidedAt ? ` · ${when(v.voidedAt)}` : ""}</small></> : <Badge tone={v.status === "Paid" ? "green" : "blue"}>{v.status === "Paid" ? "Released" : v.status}</Badge>}</td>
        <td>{v.status !== "Void" && <button type="button" className="ad-danger-link" onClick={() => setAct(v.id)}>Void Voucher</button>}</td></tr>)}
      {data && !list.length && <tr><td colSpan={8}><span className="portal-empty-copy">No vouchers in these dates.</span></td></tr>}
    </tbody></table></div>
    {act && (() => { const v = list.find((x) => x.id === act); return v ? <VoidBox title="Void Voucher" busy={busy} onCancel={() => setAct(null)}
      detail={`${pesos2(v.amount)} to ${v.payee} leaves the expense totals and the cash position. The voucher prints VOID; ${v.number} is kept and never reused.${v.payee.startsWith("Requisition") ? " The requisition shows Voided." : ""}${v.status === "Paid" && (v.channel ?? "Cash") === "Cash" ? " If the cash was handed out, return it to the drawer." : ""}`}
      onConfirm={async (reason) => { if (await post({ action: "expense-void", id: v.id, reason }, `${v.number} voided.`)) setAct(null); }} /> : null; })()}
  </section>;
}
