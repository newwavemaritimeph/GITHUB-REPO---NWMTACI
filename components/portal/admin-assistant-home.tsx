"use client";

import { useEffect, useState } from "react";
import type { PortalData } from "../portal-live-app";
import { addDays, first, manilaToday, pesos2 } from "@/lib/portal-format";
import { accreditationFor, planIssues, requisitionState, requisitionTotal, type Accreditation, type RequisitionLine, type RequisitionState } from "@/lib/admin-assistant";
import { Badge, Message, fmtDate, usePost } from "./shared-ui";
import { EXPENSE_REASONS, RejectInline } from "./reject-inline";
import type { DaySummary, ReconStatus } from "@/lib/reconciliation";

/**
 * Admin Assistant (owner, 9 Oct 2026): requisitions of supplies (approved by the
 * Admin or the Accounting Manager, released by the Cashier as an expense voucher),
 * resource planning (course › batch › classroom › students › instructor) and the
 * instructor shortlist with course accreditations.
 */

type Requisition = { id: string; requisition_number: string; purpose: string; needed_by?: string | null; lines: RequisitionLine[]; total_centavos: number; status: string; decision_remarks?: string | null; created_at: string;
  requester?: { complete_name: string } | { complete_name: string }[] | null; expenses?: { status: string; voucher_number?: string | null; expense_number: string } | { status: string; voucher_number?: string | null; expense_number: string }[] | null };
type Item = { id: string; name: string; unit: string; default_cost_centavos: number; active: boolean };
type Instructor = { id: string; complete_name: string; mobile?: string | null; email?: string | null; notes?: string | null; active: boolean };
type Plan = { batch_id: string; classroom_id?: string | null; instructor_id?: string | null };
type AssistantData = { requisitions?: Requisition[]; requisitionItems?: Item[]; instructors?: Instructor[]; accreditations?: (Accreditation & { id: string })[]; batchResources?: Plan[] };
const extra = (data: PortalData) => data as unknown as AssistantData;
const TONE: Record<RequisitionState, string> = { "For Approval": "orange", Approved: "blue", Released: "green", Rejected: "red" };
const day = (v: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v));
const stateOf = (r: Requisition) => requisitionState({ status: r.status, expense_status: first(r.expenses)?.status });
const itemsText = (r: Requisition) => (r.lines ?? []).map((l) => `${l.description} × ${l.quantity}`).join(", ");
function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="cx-head"><div><span className="portal-eyebrow">Admin Assistant</span><h1>{title}</h1></div>{children}</div>;
}

/** Upcoming batches (not cancelled, not yet ended) with their planned room and instructor. */
function upcoming(data: PortalData) {
  const today = manilaToday();
  const plans = new Map((extra(data).batchResources ?? []).map((p) => [p.batch_id, p]));
  const rooms = new Map(data.classrooms.map((c) => [c.id, c]));
  const acc = extra(data).accreditations ?? [];
  return data.batches.filter((b) => b.status !== "Cancelled" && b.ends_on >= today).sort((a, z) => a.starts_on.localeCompare(z.starts_on)).map((b) => {
    const plan = plans.get(b.id);
    const classroomId = plan?.classroom_id ?? (b as { classroom_id?: string | null }).classroom_id ?? null;
    const room = classroomId ? rooms.get(classroomId) ?? null : null;
    const issues = planIssues({ students: Number(b.confirmed_count ?? 0), startsOn: b.starts_on, courseId: b.course_id, classroom: room, instructorId: plan?.instructor_id ?? null, accreditations: acc });
    return { b, plan, classroomId, room, issues };
  });
}

export function AssistantDashboard({ data, go }: { data: PortalData; go: (m: string) => void }) {
  const today = manilaToday(), month = today.slice(0, 7), soon = addDays(today, 30), week = addDays(today, 7);
  const reqs = extra(data).requisitions ?? [];
  const count = (s: RequisitionState) => reqs.filter((r) => stateOf(r) === s).length;
  const released = reqs.filter((r) => stateOf(r) === "Released" && day(r.created_at).slice(0, 7) === month).reduce((s, r) => s + r.total_centavos, 0);
  const plan = upcoming(data).filter((p) => p.b.starts_on <= week);
  const gaps = plan.filter((p) => p.issues.length);
  const names = new Map((extra(data).instructors ?? []).map((i) => [i.id, i.complete_name]));
  const courses = new Map(data.courses.map((c) => [c.id, c.code]));
  const gcash = useGcash(manilaToday());
  const behind = (gcash.data?.summary ?? []).filter((d) => d.toCheck > 0);
  const toReconcile = behind.reduce((s, d) => s + d.toCheck, 0);
  const expiring = (extra(data).accreditations ?? []).filter((a) => a.valid_until && a.valid_until <= soon).sort((a, z) => (a.valid_until ?? "").localeCompare(z.valid_until ?? ""));
  return <div className="portal-page cx ac">
    <Head title="Dashboard"><button type="button" className="portal-primary" onClick={() => go("Requisitions")}>New Requisition</button></Head>
    {toReconcile > 0 && <div className={`ms-banner ${behind[behind.length - 1].day < manilaToday() ? "red" : "amber"}`}><b>{toReconcile} GCash payment{toReconcile === 1 ? "" : "s"} to reconcile</b><span>Oldest: {fmtDate(behind[behind.length - 1].day)}</span><button type="button" className="ms-bbtn" onClick={() => go("Reconciliation")}>Open Reconciliation</button></div>}
    {gaps.length > 0 && <div className="ms-banner red"><b>{gaps.length} batch{gaps.length === 1 ? "" : "es"} this week need a classroom, an instructor or a check</b><button type="button" className="ms-bbtn" onClick={() => go("Resource planning")}>Open Resource Planning</button></div>}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Requisitions</h2></div>
          <div className="cx-tiles ac-tiles ac-tiles-in">
            <div className="cx-tile ac-count" style={{ ["--c" as string]: "#F25615" }}><span>For Approval</span><b>{count("For Approval")}</b></div>
            <div className="cx-tile ac-count" style={{ ["--c" as string]: "#0571D0" }}><span>Approved · With the Cashier</span><b>{count("Approved")}</b></div>
            <div className="cx-tile ac-count" style={{ ["--c" as string]: "#0a7a3e" }}><span>Released</span><b>{count("Released")}</b></div>
            <div className="cx-tile ac-total ac-count"><span>Released This Month</span><b>{pesos2(released)}</b></div>
          </div>
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Resources This Week</h2></div>
          <dl className="ac-lines"><div><dt>Batches</dt><dd>{plan.length}</dd></div><div><dt>Students</dt><dd>{plan.reduce((s, p) => s + Number(p.b.confirmed_count ?? 0), 0)}</dd></div><div><dt>Need Attention</dt><dd>{gaps.length}</dd></div><div><dt>Instructors on Shortlist</dt><dd>{(extra(data).instructors ?? []).filter((i) => i.active).length}</dd></div></dl>
        </section>
      </div>
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Batches That Need Attention</h2></div>
          {gaps.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Batch</th><th>Course</th><th>Starts</th><th>Issue</th></tr></thead><tbody>
            {gaps.map((p, i) => <tr key={p.b.id}><td className="cl-no">{i + 1}</td><td className="cl-mono">{p.b.batch_number}</td><td>{first(p.b.courses)?.code ?? "—"}</td><td>{fmtDate(p.b.starts_on)}</td><td className="aa-warn">{p.issues.join(" · ")}</td></tr>)}
          </tbody></table></div> : <p className="portal-empty-copy">Every batch this week has a classroom and an accredited instructor.</p>}
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Accreditations Expiring or Expired</h2></div>
          {expiring.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Instructor</th><th>Course</th><th>Accreditation No.</th><th>Valid Until</th></tr></thead><tbody>
            {expiring.map((a) => <tr key={a.id}><td>{names.get(a.instructor_id) ?? "—"}</td><td>{courses.get(a.course_id) ?? "—"}</td><td className="cl-mono">{a.accreditation_number || "—"}</td><td><Badge tone={(a.valid_until ?? "") < today ? "red" : "orange"}>{(a.valid_until ?? "") < today ? `Expired ${fmtDate(a.valid_until!)}` : fmtDate(a.valid_until!)}</Badge></td></tr>)}
          </tbody></table></div> : <p className="portal-empty-copy">No accreditation expires in the next 30 days.</p>}
        </section>
      </div>
    </div>
  </div>;
}

type Draft = { itemId: string; description: string; quantity: number; unit: string };
export function AssistantRequisitions({ data, reload, canRaise, canDecide }: { data: PortalData; reload: () => Promise<void>; canRaise: boolean; canDecide: boolean }) {
  const { busy, msg, post } = usePost(reload);
  const items = (extra(data).requisitionItems ?? []).filter((i) => i.active);
  const reqs = extra(data).requisitions ?? [];
  const blank = (): Draft => ({ itemId: items[0]?.id ?? "", description: items[0]?.name ?? "", quantity: 1, unit: items[0] ? (items[0].default_cost_centavos / 100).toFixed(2) : "" });
  const [adding, setAdding] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [lines, setLines] = useState<Draft[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const toLines = (): RequisitionLine[] => lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitCentavos: Math.round(Number(l.unit || 0) * 100) }));
  const total = requisitionTotal(toLines());
  const valid = purpose.trim().length >= 2 && lines.length > 0 && toLines().every((l) => l.description && l.quantity > 0 && l.unitCentavos > 0);
  const setLine = (i: number, patch: Partial<Draft>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, id: string) => { const it = items.find((x) => x.id === id); setLine(i, it ? { itemId: id, description: it.name, unit: (it.default_cost_centavos / 100).toFixed(2) } : { itemId: "", description: "" }); };
  const send = () => void post({ action: "requisition-create", purpose: purpose.trim(), neededBy: neededBy || null, lines: toLines() }, "Sent for approval.").then(() => { setAdding(false); setPurpose(""); setNeededBy(""); setLines([]); }).catch(() => undefined);
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">{canRaise ? "Admin Assistant" : "Approvals"}</span><h1>Requisitions</h1></div>{canRaise && !adding && <button type="button" className="portal-primary" onClick={() => { setAdding(true); setLines([blank()]); }}>New Requisition</button>}</div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {adding && <section className="portal-panel cx-panel"><div className="panel-heading"><h2>New Requisition</h2></div>
      <div className="portal-form cx-formpad">
        <label>Purpose<input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Pantry restock" /></label>
        <label>Needed By<input type="date" value={neededBy} min={manilaToday()} onChange={(e) => setNeededBy(e.target.value)} /></label>
      </div>
      <div className="cl-wrap"><table className="cl-log aa-lines"><thead><tr><th>Item</th><th>Quantity</th><th>Unit Cost (₱)</th><th>Amount</th><th></th></tr></thead><tbody>
        {lines.map((l, i) => <tr key={i}>
          <td><select aria-label="Item" value={l.itemId} onChange={(e) => pickItem(i, e.target.value)}>{items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}<option value="">Other</option></select>
            {!l.itemId && <input aria-label="Item name" value={l.description} placeholder="Item name" onChange={(e) => setLine(i, { description: e.target.value })} />}</td>
          <td><input type="number" min={1} aria-label="Quantity" value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></td>
          <td><input type="number" min={0} step="0.01" aria-label="Unit cost" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
          <td className="cl-mono">{pesos2(l.quantity * Math.round(Number(l.unit || 0) * 100))}</td>
          <td><button type="button" className="portal-secondary" onClick={() => setLines(lines.filter((_, k) => k !== i))}>Remove</button></td></tr>)}
      </tbody></table></div>
      <div className="aa-total"><button type="button" className="portal-secondary" disabled={lines.length >= 10} onClick={() => setLines([...lines, blank()])}>Add Item</button><span>Total <b className="cl-mono">{pesos2(total)}</b></span><button type="button" className="portal-secondary" onClick={() => setAdding(false)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !valid} onClick={send}>Send for Approval</button></div>
      {!items.length && <p className="ac-foot">No items on the list yet. Accounting adds them in Configuration › Requisition Items; you can still type an item under Other.</p>}
    </section>}
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Requisition Log</h2><span className="slot-count">{reqs.length}</span></div>
      {reqs.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>RQ No.</th><th>Date</th><th>Requested By</th><th>Items</th><th>Purpose</th><th>Total</th><th>Status</th>{canDecide && <th></th>}</tr></thead><tbody>
        {reqs.map((r, i) => { const s = stateOf(r), ex = first(r.expenses); return [<tr key={r.id}>
          <td className="cl-no">{i + 1}</td><td className="cl-mono">{r.requisition_number}</td><td>{fmtDate(day(r.created_at))}</td><td>{first(r.requester)?.complete_name ?? "—"}</td><td>{itemsText(r)}</td><td>{r.purpose}{r.needed_by ? <small> · needed by {fmtDate(r.needed_by)}</small> : null}</td>
          <td className="cl-mono">{pesos2(r.total_centavos)}</td>
          <td><Badge tone={TONE[s]}>{s}{ex?.voucher_number && s !== "Rejected" ? ` · ${ex.voucher_number}` : ""}</Badge>{s === "Rejected" && r.decision_remarks ? <small> {r.decision_remarks}</small> : null}</td>
          {canDecide && <td>{s === "For Approval" && rejecting !== r.id && <span className="cl-acts"><button type="button" className="portal-secondary" disabled={busy} onClick={() => setRejecting(r.id)}>Reject</button><button type="button" className="portal-primary" disabled={busy} onClick={() => void post({ action: "requisition-decide", id: r.id, approve: true }, "Approved. The voucher is with the Cashier.").catch(() => undefined)}>Approve</button></span>}</td>}
        </tr>, rejecting === r.id && <tr key={`${r.id}-rej`}><td colSpan={9}><RejectInline reasons={EXPENSE_REASONS} busy={busy} onCancel={() => setRejecting(null)} onReject={(why) => void post({ action: "requisition-decide", id: r.id, approve: false, remarks: why }, "Rejected.").then(() => setRejecting(null)).catch(() => undefined)} /></td></tr>]; })}
      </tbody></table></div> : <p className="portal-empty-copy">No requisitions yet.</p>}
      <p className="ac-foot">Approved by the Admin or the Accounting Manager; the approval issues a voucher (CV) in Expenses and the Cashier releases the funds.</p>
    </section>
  </div>;
}

export function ResourcePlanning({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload);
  const rows = upcoming(data);
  const rooms = data.classrooms.filter((c) => c.active);
  const instructors = (extra(data).instructors ?? []).filter((i) => i.active);
  const acc = extra(data).accreditations ?? [];
  const save = (batchId: string, classroomId: string | null, instructorId: string | null) => void post({ action: "resource-plan-save", batchId, classroomId, instructorId }, "Saved.").catch(() => undefined);
  return <div className="portal-page cx ac">
    <Head title="Resource Planning" />
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Upcoming Batches</h2><span className="slot-count">{rows.length}</span></div>
      {rows.length ? <div className="cl-wrap"><table className="cl-log aa-lines"><thead><tr><th>Course</th><th>Batch</th><th>Dates</th><th>Classroom</th><th>Students</th><th>Instructor</th></tr></thead><tbody>
        {rows.map(({ b, plan, classroomId, issues }) => { const c = first(b.courses); return <tr key={b.id}>
          <td><b>{c?.code ?? "—"}</b><small>{c?.name}</small></td><td className="cl-mono">{b.batch_number}</td><td>{b.starts_on === b.ends_on ? fmtDate(b.starts_on) : `${fmtDate(b.starts_on)} – ${fmtDate(b.ends_on)}`}</td>
          <td><select aria-label="Classroom" disabled={busy} value={classroomId ?? ""} onChange={(e) => save(b.id, e.target.value || null, plan?.instructor_id ?? null)}><option value="">Choose Classroom</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.capacity} seats)</option>)}</select>
            {issues.filter((x) => /room|classroom/i.test(x)).map((x) => <span key={x} className="aa-warn">{x}</span>)}</td>
          <td className="cl-mono">{Number(b.confirmed_count ?? 0)} / {b.capacity}</td>
          <td><select aria-label="Instructor" disabled={busy} value={plan?.instructor_id ?? ""} onChange={(e) => save(b.id, classroomId, e.target.value || null)}><option value="">Choose Instructor</option>{instructors.map((i) => { const s = accreditationFor(acc, i.id, b.course_id, b.starts_on); return <option key={i.id} value={i.id}>{i.complete_name}{s === "ok" ? " · Accredited" : s === "expired" ? " · Expired" : " · Not Accredited"}</option>; })}</select>
            {issues.filter((x) => /instructor|accredit/i.test(x)).map((x) => <span key={x} className="aa-warn">{x}</span>)}</td>
        </tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">No upcoming batches.</p>}
      <p className="ac-foot">Only instructors on the shortlist are listed; each shows whether they are accredited for the batch&apos;s course.</p>
    </section>
  </div>;
}

export function InstructorShortlist({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const { busy, msg, post } = usePost(reload);
  const today = manilaToday(), soon = addDays(today, 30);
  const list = extra(data).instructors ?? [];
  const acc = extra(data).accreditations ?? [];
  const courses = data.courses.filter((c) => (c as { active?: boolean }).active !== false).sort((a, z) => a.code.localeCompare(z.code));
  const code = new Map(data.courses.map((c) => [c.id, c.code]));
  const [form, setForm] = useState<{ id?: string; completeName: string; mobile: string; email: string; notes: string } | null>(null);
  const [accFor, setAccFor] = useState<string | null>(null);
  const [accForm, setAccForm] = useState({ courseId: "", accreditationNumber: "", validUntil: "" });
  const saveInstructor = () => form && void post({ action: "instructor-save", ...form }, form.id ? "Instructor updated." : "Instructor added.").then(() => setForm(null)).catch(() => undefined);
  const saveAcc = (instructorId: string) => void post({ action: "instructor-accreditation-save", instructorId, courseId: accForm.courseId, accreditationNumber: accForm.accreditationNumber, validUntil: accForm.validUntil || null }, "Accreditation saved.").then(() => { setAccFor(null); setAccForm({ courseId: "", accreditationNumber: "", validUntil: "" }); }).catch(() => undefined);
  return <div className="portal-page cx ac">
    <Head title="Instructors">{!form && <button type="button" className="portal-primary" onClick={() => setForm({ completeName: "", mobile: "", email: "", notes: "" })}>Add Instructor</button>}</Head>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {form && <section className="portal-panel cx-panel"><div className="panel-heading"><h2>{form.id ? "Edit Instructor" : "Add Instructor"}</h2></div>
      <div className="portal-form cx-formpad">
        <label>Complete Name<input value={form.completeName} onChange={(e) => setForm({ ...form, completeName: e.target.value })} /></label>
        <label>Mobile Number<input inputMode="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || form.completeName.trim().length < 2} onClick={saveInstructor}>Save</button></div>
      </div></section>}
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Instructor Shortlist</h2><span className="slot-count">{list.filter((i) => i.active).length}</span></div>
      {list.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Instructor</th><th>Mobile</th><th>Email</th><th>Course Accreditations</th><th></th></tr></thead><tbody>
        {list.map((i, n) => { const mine = acc.filter((a) => a.instructor_id === i.id); return [<tr key={i.id} className={i.active ? undefined : "ms-out"}>
          <td className="cl-no">{n + 1}</td><td><b>{i.complete_name}</b>{i.notes ? <small>{i.notes}</small> : null}</td><td className="cl-mono">{i.mobile || "—"}</td><td>{i.email || "—"}</td>
          <td><span className="aa-chips">{mine.map((a) => { const tone = a.valid_until && a.valid_until < today ? "red" : a.valid_until && a.valid_until <= soon ? "orange" : "green"; return <span key={a.id} className="aa-chip"><Badge tone={tone}>{code.get(a.course_id) ?? "Course"}{a.accreditation_number ? ` · ${a.accreditation_number}` : ""}{a.valid_until ? ` · Until ${fmtDate(a.valid_until)}` : ""}</Badge><button type="button" aria-label="Remove accreditation" disabled={busy} onClick={() => void post({ action: "instructor-accreditation-save", instructorId: i.id, courseId: a.course_id, remove: true }, "Accreditation removed.").catch(() => undefined)}>×</button></span>; })}{!mine.length && "—"}</span></td>
          <td><span className="cl-acts"><button type="button" className="portal-secondary" onClick={() => { setAccFor(accFor === i.id ? null : i.id); setAccForm({ courseId: courses[0]?.id ?? "", accreditationNumber: "", validUntil: "" }); }}>Add Accreditation</button><button type="button" className="portal-secondary" onClick={() => setForm({ id: i.id, completeName: i.complete_name, mobile: i.mobile ?? "", email: i.email ?? "", notes: i.notes ?? "" })}>Edit</button><button type="button" className="portal-secondary" disabled={busy} onClick={() => void post({ action: "instructor-save", id: i.id, completeName: i.complete_name, mobile: i.mobile ?? "", email: i.email ?? "", notes: i.notes ?? "", active: !i.active }, i.active ? "Removed from the shortlist." : "Back on the shortlist.").catch(() => undefined)}>{i.active ? "Archive" : "Restore"}</button></span></td>
        </tr>, accFor === i.id && <tr key={`${i.id}-acc`}><td colSpan={6}><div className="portal-form aa-accform">
          <label>Course<select value={accForm.courseId} onChange={(e) => setAccForm({ ...accForm, courseId: e.target.value })}>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
          <label>Accreditation No.<input value={accForm.accreditationNumber} onChange={(e) => setAccForm({ ...accForm, accreditationNumber: e.target.value })} /></label>
          <label>Valid Until<input type="date" value={accForm.validUntil} onChange={(e) => setAccForm({ ...accForm, validUntil: e.target.value })} /></label>
          <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={() => setAccFor(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !accForm.courseId} onClick={() => saveAcc(i.id)}>Save Accreditation</button></div>
        </div></td></tr>]; })}
      </tbody></table></div> : <p className="portal-empty-copy">No instructors on the shortlist yet.</p>}
    </section>
  </div>;
}

/* ------------------------------------------------------------ GCash reconciliation */

type ReconRow = { id: string; payment_number: string; receipt_number: string | null; received_at: string; amount_centavos: number; reference_number: string | null; trainee: string; recorded_by: string | null; proof_link: string | null; status: ReconStatus | null; remarks: string | null; checked_by: string | null; checked_at: string | null };
type Missing = { payment_id: string; remarks: string | null; checked_at: string; payment_number: string; received_at: string; amount_centavos: number; reference_number: string | null; trainee: string };
type ReconDay = { day: string; today: string; tracked: boolean; rows: ReconRow[]; summary: DaySummary[]; missing: Missing[] };
const clock = (iso: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const shortDay = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));

function useGcash(date: string) {
  const [state, setState] = useState<{ key: string; data: ReconDay | null; error: string }>({ key: "", data: null, error: "" });
  const [tick, setTick] = useState(0);
  const key = `${date}:${tick}`;
  useEffect(() => {
    let live = true;
    void fetch(`/api/staff/reconciliation?date=${date}`, { cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Could not load."); if (live) setState({ key: `${date}:${tick}`, data: b as ReconDay, error: "" }); })
      .catch((e) => { if (live) setState({ key: `${date}:${tick}`, data: null, error: e instanceof Error ? e.message : "Could not load." }); });
    return () => { live = false; };
  }, [date, tick]);
  const fresh = state.key === key;
  return { data: fresh ? state.data : state.data && state.data.day === date ? state.data : null, error: fresh ? state.error : "", reload: async () => setTick((t) => t + 1) };
}

/**
 * GCash Reconciliation (owner, 9 Oct 2026): every GCash payment, sorted by day.
 * The Admin Assistant ticks the ones found on the printed GCash transaction
 * history and marks them Reconciled; missing ones go to Accounting.
 */
export function GcashReconciliation({ canCheck }: { canCheck: boolean }) {
  const today = manilaToday();
  const [date, setDate] = useState(today);
  const { data, error, reload } = useGcash(date);
  const { busy, msg, post } = usePost(reload);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [noting, setNoting] = useState<{ id: string; kind: "missing" | "undo" } | null>(null);
  const [note, setNote] = useState("");
  const rows = data?.rows ?? [];
  const term = q.trim().toLowerCase().replace(/[₱,\s]/g, "");
  const hit = (r: ReconRow) => !!term && ((r.reference_number ?? "").toLowerCase().includes(term) || (r.amount_centavos / 100).toFixed(2).includes(term));
  const open = rows.filter((r) => !r.status);
  const ok = rows.filter((r) => r.status === "Reconciled"), missing = rows.filter((r) => r.status === "Not in History");
  const pick = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const go = (d: string) => { setDate(d); setPicked(new Set()); setNoting(null); };
  const markOk = () => void post({ action: "reconcile-mark", paymentIds: [...picked], status: "Reconciled" }, `${picked.size} marked reconciled.`).then(() => setPicked(new Set())).catch(() => undefined);
  const saveNote = () => { if (!noting) return; const body = noting.kind === "missing" ? { action: "reconcile-mark", paymentIds: [noting.id], status: "Not in History", remarks: note.trim() } : { action: "reconcile-undo", paymentId: noting.id, reason: note.trim() };
    void post(body, noting.kind === "missing" ? "Marked Not in History. Accounting will see it." : "Back to To Check.").then(() => { setNoting(null); setNote(""); pick(noting.id, false); }).catch(() => undefined); };
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Admin Assistant</span><h1>GCash Reconciliation</h1></div>
      <span className="cl-acts"><span className="ac-day"><button type="button" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>‹</button><input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && e.target.value <= today && go(e.target.value)} /><button type="button" aria-label="Next day" disabled={date >= today} onClick={() => go(addDays(date, 1))}>›</button></span>
        <a className="portal-secondary" href={`/api/documents/reconciliation?date=${date}`} target="_blank" rel="noreferrer">Print Day Sheet</a></span></div>
    {error && <Message kind="error" text={error} />}
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {data && !data.tracked && <Message kind="error" text="Apply database update 202610090035 to start reconciling." />}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>{date === today ? "Today" : fmtDate(date)}</h2><span className="muted-text">GCash</span></div>
          <div className="cx-tiles ac-tiles ac-tiles-in">
            <div className="cx-tile ac-count" style={{ ["--c" as string]: "#0571D0" }}><span>GCash Received · {rows.length}</span><b>{pesos2(rows.reduce((s, r) => s + r.amount_centavos, 0))}</b></div>
            <div className="cx-tile ac-count" style={{ ["--c" as string]: "#0a7a3e" }}><span>Reconciled · {ok.length}</span><b>{pesos2(ok.reduce((s, r) => s + r.amount_centavos, 0))}</b></div>
            <div className={`cx-tile ac-count${open.length && date < today ? " cl-overdue" : ""}`} style={{ ["--c" as string]: "#F25615" }}><span>To Check</span><b>{open.length}</b></div>
            <div className="cx-tile ac-count" style={{ ["--c" as string]: "#b42318" }}><span>Not in History</span><b>{missing.length}</b></div>
          </div>
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Last 14 Days</h2></div>
          <div className="rc-days">{(data?.summary ?? []).map((d) => <button type="button" key={d.day} className={`rc-day${d.day === date ? " on" : ""}`} onClick={() => go(d.day)}>
            <b>{d.day === today ? "Today" : shortDay(d.day)}</b><span className="cl-mono">{pesos2(d.total)}</span>
            <small>{d.count} GCash payment{d.count === 1 ? "" : "s"}</small>
            <span className={`rc-st ${d.toCheck ? (d.day < today ? "late" : "todo") : d.missing ? "late" : "ok"}`}>{d.toCheck ? `${d.toCheck} to check` : d.missing ? `${d.missing} not in history` : d.count ? "All reconciled ✓" : "None"}</span>
          </button>)}</div>
        </section>
      </div>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>GCash Payments</h2><span className="slot-count">{rows.length}</span></div>
        <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Find a payment" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by GCash reference no. or amount" />
          {canCheck && <><span className="muted-text">{picked.size} ticked</span><button type="button" className="portal-primary" disabled={busy || !picked.size || !data?.tracked} onClick={markOk}>Mark Reconciled</button></>}</div>
        {!data ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : rows.length ? <div className="cl-wrap"><table className="cl-log rc-log"><thead><tr>{canCheck && <th className="rc-ck"><input type="checkbox" aria-label="Tick all to check" checked={open.length > 0 && open.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(open.map((r) => r.id)) : new Set())} /></th>}<th>#</th><th>Time</th><th>Receipt No.</th><th>Trainee</th><th>GCash Ref. No.</th><th>Amount</th><th>Proof</th><th>Recorded By</th><th>Status</th>{canCheck && <th />}</tr></thead><tbody>
          {rows.map((r, i) => [<tr key={r.id} className={`${r.status === "Reconciled" ? "rc-done" : r.status ? "rc-miss" : ""}${hit(r) ? " rc-hit" : ""}`}>
            {canCheck && <td className="rc-ck">{!r.status && <input type="checkbox" aria-label={`Tick ${r.reference_number ?? r.payment_number}`} checked={picked.has(r.id)} onChange={(e) => pick(r.id, e.target.checked)} />}</td>}
            <td className="cl-no">{i + 1}</td><td className="cl-mono">{clock(r.received_at)}</td><td className="cl-mono">{r.receipt_number ?? r.payment_number}</td><td>{r.trainee}</td><td className="cl-mono"><b>{r.reference_number ?? "—"}</b></td><td className="cl-mono">{pesos2(r.amount_centavos)}</td>
            <td>{r.proof_link ? <a href={r.proof_link} target="_blank" rel="noreferrer">View</a> : <span className="cl-sub">—</span>}</td><td>{r.recorded_by ?? "—"}</td>
            <td>{r.status === "Reconciled" ? <Badge tone="green">Reconciled</Badge> : r.status ? <Badge tone="red">Not in History</Badge> : <Badge tone="orange">To Check</Badge>}{r.checked_by && <small className="cl-sub cl-block">{r.checked_by}</small>}</td>
            {canCheck && <td>{r.status ? <button type="button" className="rc-mini" onClick={() => { setNoting({ id: r.id, kind: "undo" }); setNote(""); }}>Undo</button> : <button type="button" className="rc-mini" onClick={() => { setNoting({ id: r.id, kind: "missing" }); setNote(""); }}>Not in History</button>}</td>}
          </tr>,
          noting?.id === r.id && <tr key={`${r.id}-note`}><td colSpan={canCheck ? 11 : 9}><div className="cl-void"><label>{noting.kind === "missing" ? "What did you find?" : "Reason for undoing"}<input value={note} autoFocus onChange={(e) => setNote(e.target.value)} placeholder={noting.kind === "missing" ? "e.g. Not on the printout — ask the Cashier" : "e.g. Ticked by mistake"} /></label><button type="button" className="portal-secondary" onClick={() => setNoting(null)}>Cancel</button><button type="button" className={noting.kind === "missing" ? "cl-danger" : "portal-primary"} disabled={busy || note.trim().length < 3} onClick={saveNote}>{noting.kind === "missing" ? "Mark Not in History" : "Undo"}</button></div></td></tr>,
          r.status === "Not in History" && r.remarks && noting?.id !== r.id && <tr key={`${r.id}-rm`}><td colSpan={canCheck ? 11 : 9} className="rc-remark">↳ {r.remarks}</td></tr>])}
        </tbody></table></div> : <p className="portal-empty-copy">No GCash payments on this day.</p>}
        <p className="ac-foot">Tick the payments you find on the printed GCash history, then Mark Reconciled. Payments missing from the history go to Accounting as Not in History.</p>
      </section>
    </div>
  </div>;
}

/** Accounting dashboard line: GCash payments the Admin Assistant could not find in the GCash history. */
export function GcashNotInHistory() {
  const { data } = useGcash(manilaToday());
  const list = data?.missing ?? [];
  if (!list.length) return null;
  return <details className="rc-alert"><summary><b>{list.length} GCash payment{list.length === 1 ? "" : "s"} not in the GCash history</b><span>Checked by the Admin Assistant · tap to see</span></summary>
    <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Date</th><th>Receipt No.</th><th>Trainee</th><th>GCash Ref. No.</th><th>Amount</th><th>Note</th></tr></thead><tbody>
      {list.map((m) => <tr key={m.payment_id}><td>{m.received_at ? fmtDate(day(m.received_at)) : "—"}</td><td className="cl-mono">{m.payment_number}</td><td>{m.trainee}</td><td className="cl-mono">{m.reference_number ?? "—"}</td><td className="cl-mono">{pesos2(m.amount_centavos)}</td><td className="rc-remark">{m.remarks}</td></tr>)}
    </tbody></table></div>
  </details>;
}
