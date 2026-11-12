"use client";

import { useState } from "react";
import { askText, askConfirm } from "./dialogs";
import { Badge, Message } from "./shared-ui";
import { HrFormModal, toCentavos } from "./hr-forms";
import { first, pesos2 } from "@/lib/portal-format";
import { specialProblem, specialTotals, type SpecialRate, type SpecialRequest, type SpecialStatus } from "@/lib/special-arrangements";

/** Special Arrangement fees (owner, 12 Nov 2026): the Cashier requests, Accounting or the Admin decide and monitor. */
type Person = { legal_first_name: string; legal_last_name: string };
type Course = { id: string; code?: string | null; name: string };
export type SpecialRow = SpecialRequest & { enrollments?: { enrollment_number: string; trainee_id?: string; course_id?: string; trainees?: Person | Person[] | null; courses?: { code?: string | null; name: string } | { code?: string | null; name: string }[] | null } | null };
type Enr = { id: string; enrollment_number: string; course_id: string; enrollment_status: string; selling_price_centavos: number; trainees?: Person | Person[] | null; courses?: { code?: string | null; name: string } | { code?: string | null; name: string }[] | null };
type Data = { specialRates?: SpecialRate[]; specialRequests?: SpecialRow[]; courses: Course[]; agencies: { id: string; name: string; active: boolean }[] };

export const SPECIAL_URL = "/api/staff/special-arrangements";
export async function specialPost(body: Record<string, unknown>) {
  const r = await fetch(SPECIAL_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Could not save.");
  return j as { ok: true; requestNo?: string; addsCentavos?: number };
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const fd = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso)) : "—");
const manilaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));
export const SPECIAL_TONE: Record<SpecialStatus, string> = { Pending: "orange", Approved: "green", Rejected: "red" };
const personName = (t: Person | null) => (t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee");
export const specialTrainee = (r: SpecialRow) => personName(first(r.enrollments?.trainees ?? null));
export const specialCourse = (r: SpecialRow) => { const c = first(r.enrollments?.courses ?? null); return c?.code ?? c?.name ?? "Course"; };
export const pendingSpecials = (data: { specialRequests?: SpecialRow[] }) => (data.specialRequests ?? []).filter((r) => r.approval_status === "Pending");

/** The Cashier's Special Arrangement form, shown when Request = Special Arrangement. */
export function SpecialRequestForm({ data, enrollments, onSent, onCancel, sendLabel = "Request Special Arrangement" }: { data: Data; enrollments: Enr[]; onSent: (text: string) => Promise<void> | void; onCancel?: () => void; sendLabel?: string }) {
  const open = enrollments.filter((e) => e.enrollment_status !== "Cancelled");
  const [enrollmentId, setEnrollmentId] = useState(open[0]?.id ?? ""), [rateId, setRateId] = useState(""), [price, setPrice] = useState("");
  const [agencyId, setAgencyId] = useState(""), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const e = open.find((x) => x.id === enrollmentId);
  const rates = (data.specialRates ?? []).filter((r) => r.active && r.course_id === e?.course_id);
  const pick = rateId && (rateId === "other" || rates.some((r) => r.id === rateId)) ? rateId : rates[0]?.id ?? "other";
  const rate = rates.find((r) => r.id === pick), offList = !rate;
  const standard = Number(e?.selling_price_centavos ?? 0), special = rate ? Number(rate.price_centavos) : toCentavos(price);
  const openRequest = pendingSpecials(data).some((r) => r.enrollment_id === enrollmentId);
  const problem = e ? specialProblem({ standard, special, offList, reason, openRequest }) : "Choose the enrollment.";
  const courseOf = (x: Enr) => first(x.courses)?.code ?? first(x.courses)?.name ?? "Course";
  async function send() {
    setBusy(true); setErr("");
    try {
      const r = await specialPost({ action: "request", enrollmentId, rateId: rate?.id ?? null, priceCentavos: offList ? special : null, agencyId: agencyId || null, reason });
      setPrice(""); setReason("");
      await onSent(`${r.requestNo} sent to Accounting and the Admin. It adds ${pesos2(r.addsCentavos ?? 0)} once approved.`);
    } catch (x) { setErr(x instanceof Error ? x.message : "Could not send the request."); } finally { setBusy(false); }
  }
  return <>
    {err && <div className="full"><Message kind="error" text={err} /></div>}
    <label className="full">Enrollment<select value={enrollmentId} onChange={(ev) => { setEnrollmentId(ev.target.value); setRateId(""); }}>{!open.length && <option value="">No Enrollment</option>}{open.map((x) => <option key={x.id} value={x.id}>{personName(first(x.trainees ?? null))} · {x.enrollment_number} · {courseOf(x)} · {pesos2(x.selling_price_centavos)}</option>)}</select></label>
    <label>Arrangement<select value={pick} onChange={(ev) => setRateId(ev.target.value)}>{rates.map((r) => <option key={r.id} value={r.id}>{r.arrangement} · {pesos2(r.price_centavos)}</option>)}<option value="other">Other (Not on the List)</option></select></label>
    <label>Requested By Agency<select value={agencyId} onChange={(ev) => setAgencyId(ev.target.value)}><option value="">None</option>{data.agencies.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    {offList && <label>Special Price (PHP)<input inputMode="decimal" value={price} onChange={(ev) => setPrice(ev.target.value)} placeholder="0.00" /></label>}
    <label className={offList ? "" : "full"}>{offList ? "Reason (Required)" : "Note"}<input value={reason} maxLength={300} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Agency asked for an online class" /></label>
    <div className="sa-calc full"><div><small>Standard</small><b>{pesos2(standard)}</b></div><div><small>Special</small><b>{pesos2(special)}</b></div><div className="sa-add"><small>Adds</small><b>{pesos2(Math.max(0, special - standard))}</b></div></div>
    {e && problem && (openRequest || special > 0) && <p className="portal-form-note full">{problem}</p>}
    <p className="portal-form-note full">Sent to Accounting or the Admin. The balance changes only after approval.</p>
    <div className="portal-form-actions full">{onCancel && <button type="button" className="portal-secondary" onClick={onCancel}>Cancel</button>}<button type="button" className="portal-primary" disabled={busy || !!problem} onClick={() => void send()}>{busy ? "Sending…" : sendLabel}</button></div>
  </>;
}

/** Accounting or Admin decision on one request; reject needs a reason. Returns the toast text, or null when cancelled. */
export async function decideSpecial(r: SpecialRow, approve: boolean) {
  const record: [string, string] = [`${r.request_no ?? "Special Arrangement"} · ${specialTrainee(r)}`, `${specialCourse(r)} · ${r.arrangement} · ${pesos2(r.standard_centavos)} → ${pesos2(r.special_centavos)}`];
  if (approve) {
    if (!(await askConfirm(`The trainee's balance goes up by ${pesos2(r.amount_centavos)}.`, { title: "Approve Special Arrangement?", eyebrow: "Special Arrangements", record, okLabel: "Approve" }))) return null;
    await specialPost({ action: "decide", id: r.id, approve: true });
    return `${r.request_no ?? "Request"} approved. The balance now includes ${pesos2(r.amount_centavos)}.`;
  }
  const remarks = await askText("The balance stays as it is. The Cashier sees the reason.", "", { title: "Reject Special Arrangement?", eyebrow: "Special Arrangements", record, label: "Reason", required: true, okLabel: "Reject", danger: true });
  if (!remarks) return null;
  await specialPost({ action: "decide", id: r.id, approve: false, remarks });
  return `${r.request_no ?? "Request"} rejected.`;
}

/** Reports › Special Arrangements: every request with filters, totals, CSV, and decisions for Accounting / Admin. */
export function SpecialArrangementsReport({ data, reload, canDecide }: { data: Data; reload: () => Promise<void>; canDecide: boolean }) {
  const t = today();
  const [from, setFrom] = useState(`${t.slice(0, 8)}01`), [to, setTo] = useState(t), [status, setStatus] = useState("All");
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const agency = (id: string | null) => (id ? data.agencies.find((a) => a.id === id)?.name ?? "Agency" : "None");
  const rows = (data.specialRequests ?? []).filter((r) => { const d = manilaDay(r.created_at); return d >= from && d <= to && (status === "All" || r.approval_status === status); });
  const tot = specialTotals(rows);
  const decide = async (r: SpecialRow, approve: boolean) => { setBusy(r.id); setMsg(null); try { const text = await decideSpecial(r, approve); if (text) { await reload(); setMsg({ kind: "success", text }); } } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(""); } };
  const csv = () => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Request No.", "Requested", "Trainee", "Enrollment", "Course", "Arrangement", "Agency", "Standard", "Special", "Added", "Not on the List", "Reason", "Requested By", "Status", "Decided By", "Decided", "Remarks"].join(","),
      ...rows.map((r) => [r.request_no, manilaDay(r.created_at), specialTrainee(r), r.enrollments?.enrollment_number, specialCourse(r), r.arrangement, agency(r.agency_id), (r.standard_centavos / 100).toFixed(2), (r.special_centavos / 100).toFixed(2), (r.amount_centavos / 100).toFixed(2), r.off_list ? "Yes" : "No", r.reason, r.requested_by_name, r.approval_status, r.decided_by_name, r.decided_at ? manilaDay(r.decided_at) : "", r.decision_remarks].map(q).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + lines], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
    a.href = url; a.download = `special-arrangements-${from}-to-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="portal-page hr-page">
    <div className="portal-heading hr-head"><div><span className="portal-eyebrow">Reports</span><h1>Special Arrangements</h1></div>
      <div className="hr-head-acts">
        <input className="hr-show" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className="hr-show" type="date" value={to} min={from} max={t} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="hr-show" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{["All", "Pending", "Approved", "Rejected"].map((o) => <option key={o}>{o}</option>)}</select>
        <button type="button" className="portal-secondary" disabled={!rows.length} onClick={csv}>Export CSV</button></div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="hr-kpis">
      <div className="hr-kpi"><b>{tot.pending}</b><small>Pending</small></div>
      <div className="hr-kpi"><b>{tot.approved}</b><small>Approved</small></div>
      <div className="hr-kpi"><b>{pesos2(tot.added)}</b><small>Added by Approved</small></div>
      <div className="hr-kpi"><b>{tot.offList}</b><small>Not on the List</small></div>
    </div>
    <section className="portal-panel hr-table"><div className="portal-table-wrap"><table className="portal-table cx-cards">
      <thead><tr><th>Request</th><th>Course · Arrangement</th><th>Agency</th><th className="num">Standard</th><th className="num">Special</th><th className="num">Added</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}>
        <td className="lead" data-l="Request"><strong>{specialTrainee(r)}</strong><small>{[r.request_no, r.requested_by_name, fd(r.created_at)].filter(Boolean).join(" · ")}</small></td>
        <td data-l="Course · Arrangement">{specialCourse(r)} · {r.arrangement}{r.off_list && <> <Badge tone="red">Not on the List</Badge></>}{r.reason && <small>{r.reason}</small>}</td>
        <td data-l="Agency">{agency(r.agency_id)}</td>
        <td data-l="Standard" className="num">{pesos2(r.standard_centavos)}</td>
        <td data-l="Special" className="num"><b>{pesos2(r.special_centavos)}</b></td>
        <td data-l="Added" className="num">{pesos2(r.amount_centavos)}</td>
        <td data-l="Status"><Badge tone={SPECIAL_TONE[r.approval_status]}>{r.approval_status}</Badge>{r.decided_at && <small>{[r.decided_by_name, fd(r.decided_at), r.decision_remarks].filter(Boolean).join(" · ")}</small>}</td>
        <td data-l="" className="hr-cell-acts">{canDecide && r.approval_status === "Pending" && <span className="hr-acts">
          <button type="button" className="portal-secondary danger row-act" disabled={!!busy} onClick={() => void decide(r, false)}>Reject</button>
          <button type="button" className="portal-primary row-act" disabled={!!busy} onClick={() => void decide(r, true)}>Approve</button></span>}</td>
      </tr>)}
        {!rows.length && <tr><td colSpan={8} className="hr-none">No special arrangement requests in this period.</td></tr>}</tbody></table></div></section>
  </div>;
}

/** Configuration › Special Arrangement Rates (Accounting or Admin). Rates are switched off, never deleted. */
export function SpecialRatesSetup({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState<SpecialRate | "new" | null>(null), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const courses = [...data.courses].sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name));
  const courseName = (id: string) => { const c = data.courses.find((x) => x.id === id); return c ? c.code ?? c.name : "Course"; };
  const rates = [...(data.specialRates ?? [])].sort((a, b) => courseName(a.course_id).localeCompare(courseName(b.course_id)) || a.arrangement.localeCompare(b.arrangement));
  const cur = edit && edit !== "new" ? edit : null;
  return <div className="portal-page hr-page">
    <div className="portal-heading hr-head"><div><span className="portal-eyebrow">Configuration</span><h1>Special Arrangement Rates</h1></div>
      <div className="hr-head-acts"><button type="button" className="portal-primary" onClick={() => setEdit("new")}>Add Rate</button></div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <section className="portal-panel hr-table"><div className="portal-table-wrap"><table className="portal-table cx-cards">
      <thead><tr><th>Course</th><th>Arrangement</th><th className="num">Special Price</th><th>Status</th><th /></tr></thead>
      <tbody>{rates.map((r) => <tr key={r.id}>
        <td className="lead" data-l="Course"><strong>{courseName(r.course_id)}</strong></td>
        <td data-l="Arrangement">{r.arrangement}</td>
        <td data-l="Special Price" className="num"><b>{pesos2(r.price_centavos)}</b></td>
        <td data-l="Status"><Badge tone={r.active ? "green" : "slate"}>{r.active ? "Active" : "Off"}</Badge></td>
        <td data-l="" className="hr-cell-acts"><button type="button" className="portal-secondary row-act" onClick={() => setEdit(r)}>Edit</button></td>
      </tr>)}
        {!rates.length && <tr><td colSpan={5} className="hr-none">No rates yet. Use Add Rate, e.g. BT-PSSR · Online · ₱2,500.00.</td></tr>}</tbody></table></div></section>
    {edit && <HrFormModal title={cur ? "Edit Rate" : "Add Rate"} submitLabel={cur ? "Save Rate" : "Add Rate"} onClose={() => setEdit(null)}
      initial={cur ? { courseId: cur.course_id, arrangement: cur.arrangement, price: String(cur.price_centavos / 100), active: cur.active ? "1" : "0" } : { courseId: courses[0]?.id ?? "", active: "1" }}
      fields={[
        { key: "courseId", label: "Course", type: "select", required: true, full: true, options: courses.map((c): [string, string] => [c.id, `${c.code ? `${c.code} · ` : ""}${c.name}`]) },
        { key: "arrangement", label: "Arrangement", required: true, placeholder: "e.g. Online" },
        { key: "price", label: "Special Price (PHP)", type: "number", required: true, min: "0.01", step: "0.01" },
        { key: "active", label: "Status", type: "select", required: true, options: [["1", "Active"], ["0", "Off"]] },
      ]}
      note="The Cashier picks from these rates. Requests already sent keep the price they were sent with."
      onSubmit={async (v) => { await specialPost({ action: "rate-save", id: cur?.id ?? null, courseId: v.courseId, arrangement: v.arrangement, priceCentavos: toCentavos(v.price), active: v.active === "1" }); await reload(); setMsg({ kind: "success", text: "Rate saved." }); }} />}
  </div>;
}
