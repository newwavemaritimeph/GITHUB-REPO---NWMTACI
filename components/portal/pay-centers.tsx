"use client";

import { useState } from "react";
import type { PortalData, Enrollment } from "../portal-live-app";
import { first, manilaToday, pesos2 } from "@/lib/portal-format";
import { Badge, Message, fmtDate, usePost } from "./shared-ui";

/**
 * Paying the partnered centers (owner, 20 Oct 2026; design/pay-the-centers-prototype.html):
 * an Other STCW trainee is due to the center on the day they are enrolled (fee paid). The
 * Cashier raises one expense request per center for the trainees ticked; Accounting
 * approves it (CV number); the Cashier releases it. The rebate is collected afterwards.
 */
export type CenterPayment = { enrollment_id: string; amount_centavos: number; expense_id: string; expenses?: unknown };
type Pay = { status?: string; expense_number?: string; voucher_number?: string | null; paid_at?: string | null; payment_channel?: string | null };

const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");
export const centerPaymentsOf = (data: PortalData) => ((data as unknown as { centerPayments?: CenterPayment[] }).centerPayments ?? []);
/** The live payment a trainee is in (a rejected request frees the trainee). */
export function paymentFor(data: PortalData) {
  const map = new Map<string, Pay & { expense_id: string }>();
  for (const l of centerPaymentsOf(data)) { const p = first(l.expenses as Pay | Pay[] | null); if (p && p.status !== "Rejected") map.set(l.enrollment_id, { ...p, expense_id: l.expense_id }); }
  return map;
}
const centerOf = (e: Enrollment) => first(first((e as { partner_course_offers?: unknown }).partner_course_offers as { partner_centers?: unknown } | null)?.partner_centers as { name?: string } | null)?.name ?? "Partnered center";
/** Enrolled Other STCW trainees and where each stands with its center. */
export function centerLines(data: PortalData) {
  const pay = paymentFor(data), today = manilaToday();
  const offers = new Map(data.offers.map((o) => [o.id, o as typeof o & { partner_center_id?: string }]));
  return data.enrollments.filter((e) => e.partner_offer_id && e.enrollment_status === "Enrolled" && Number(e.partner_payable_centavos) > 0).map((e) => {
    const p = pay.get(e.id) ?? null, t = first(e.trainees), c = first(e.courses), b = first(e.batches);
    const enrolledOn = day(e.enrolled_at ?? e.updated_at ?? e.created_at);
    const state: "Due" | "For Approval" | "Approved" | "Paid" = !p ? "Due" : p.status === "Pending" ? "For Approval" : p.status === "Approved" ? "Approved" : "Paid";
    return { e, p, state, centerId: offers.get(e.partner_offer_id!)?.partner_center_id ?? "", center: centerOf(e), name: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : e.enrollment_number, number: t?.trainee_number ?? "", course: c?.code ?? "", courseName: c?.name ?? "", training: b?.starts_on ?? e.scheduled_on ?? null, enrolledOn, dueToday: enrolledOn === today, amount: Number(e.partner_payable_centavos) };
  });
}

export function PayTheCenters({ data, reload, onRelease }: { data: PortalData; reload: () => Promise<void>; onRelease: (expenseId: string) => void }) {
  const lines = centerLines(data);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(lines.filter((l) => l.state === "Due" && l.dueToday).map((l) => l.e.id)));
  const [raising, setRaising] = useState<string | null>(null), [channel, setChannel] = useState(""), [notes, setNotes] = useState("");
  const { busy, msg, post } = usePost(reload);
  const centers = [...new Set(lines.map((l) => l.center))].sort();
  const channels = data.paymentMethods.filter((m) => m.active).map((m) => m.name);
  const owed = (c?: string) => lines.filter((l) => (!c || l.center === c) && l.state !== "Paid").reduce((s, l) => s + l.amount, 0);
  const dueToday = lines.filter((l) => l.state === "Due" && l.dueToday).reduce((s, l) => s + l.amount, 0);
  const tone = { Due: "red", "For Approval": "orange", Approved: "blue", Paid: "green" } as const;
  const send = (center: string) => {
    const sel = lines.filter((l) => l.center === center && l.state === "Due" && picked.has(l.e.id));
    if (!sel.length) return;
    void post({ action: "center-payment-raise", centerId: sel[0].centerId, enrollmentIds: sel.map((l) => l.e.id), paymentChannel: channel, notes }, `Payment to ${center} sent to Accounting for approval.`).then(() => { setRaising(null); setNotes(""); }).catch(() => undefined);
  };
  return <>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {!lines.length ? <section className="portal-panel cx-panel"><p className="portal-empty-copy">No enrolled Other STCW trainees yet. They appear here on the day they are enrolled.</p></section> : <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Due to Centers</h2><span className="muted-text">full fee</span></div>
          <dl className="ac-lines">{centers.map((c) => <div key={c}><dt>{c}</dt><dd>{pesos2(owed(c))}</dd></div>)}<div className="total"><dt>Due today</dt><dd className="minus">{pesos2(dueToday)}</dd></div></dl>
          <p className="ac-foot">A trainee is due to the center on the day they are enrolled. The center&apos;s rebate is collected afterwards in Other Income.</p>
        </section>
      </div>
      <div className="ac-stack">
        {centers.map((center) => { const l = lines.filter((x) => x.center === center); const sel = l.filter((x) => x.state === "Due" && picked.has(x.e.id)); const total = sel.reduce((s, x) => s + x.amount, 0);
          const approved = [...new Map(l.filter((x) => x.state === "Approved" && x.p).map((x) => [x.p!.expense_id, x.p!])).values()];
          return <section key={center} className="portal-panel cx-panel">
            <div className="panel-heading"><h2>{center}</h2><span className="muted-text">Owed {pesos2(owed(center))}</span></div>
            <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th /><th>Trainee · NWMTACI No.</th><th>Course</th><th>Enrolled</th><th>Training</th><th className="r">Pay Center</th><th>Status</th></tr></thead><tbody>
              {l.map((x) => <tr key={x.e.id}>
                <td>{x.state === "Due" && <input type="checkbox" aria-label={`Pick ${x.name}`} checked={picked.has(x.e.id)} onChange={() => { const n = new Set(picked); if (n.has(x.e.id)) n.delete(x.e.id); else n.add(x.e.id); setPicked(n); }} />}</td>
                <td><b>{x.name}</b><small className="cl-mono cl-sub cl-block">{x.number}</small></td>
                <td title={x.courseName}><b>{x.course}</b></td>
                <td>{x.enrolledOn ? fmtDate(x.enrolledOn) : "—"}</td>
                <td>{x.training ? fmtDate(x.training) : "—"}</td>
                <td className="r cl-mono">{pesos2(x.amount)}</td>
                <td>{x.state === "Due" ? <Badge tone={x.dueToday ? tone.Due : "orange"}>{x.dueToday ? "Due Today" : `Due since ${fmtDate(x.enrolledOn)}`}</Badge>
                  : <><Badge tone={tone[x.state]}>{x.state === "Approved" ? `Approved · ${x.p?.voucher_number ?? ""}` : x.state === "Paid" ? "Paid" : "For Approval"}</Badge><small className="cl-sub cl-block">{x.state === "Paid" ? `${x.p?.voucher_number ?? ""}${x.p?.paid_at ? ` · ${fmtDate(day(x.p.paid_at))}` : ""}${x.p?.payment_channel ? ` · ${x.p.payment_channel}` : ""}` : x.state === "For Approval" ? x.p?.expense_number : "Ready to release"}</small></>}</td>
              </tr>)}
            </tbody></table></div>
            {raising === center ? <div className="pc-form">
              <label>Total<input readOnly value={`${pesos2(total)} · ${sel.length} trainee${sel.length === 1 ? "" : "s"}`} /></label>
              <label>Channel<select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Choose at release</option>{channels.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Notes<input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Batch of Oct 27" /></label>
              <span className="cx-acts"><button type="button" className="portal-secondary" onClick={() => setRaising(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !sel.length} onClick={() => send(center)}>Send for Approval</button></span>
            </div> : <div className="rb3-bar on"><span>{sel.length ? <>{sel.length} ticked · <b className="cx-mono">{pesos2(total)}</b></> : "Tick the trainees to pay"}</span>
              <span className="cx-acts">{approved.map((p) => <button key={p.expense_id} type="button" className="portal-secondary" onClick={() => onRelease(p.expense_id)}>Release {p.voucher_number}</button>)}<button type="button" className="portal-primary" disabled={!sel.length} onClick={() => setRaising(center)}>Raise Payment to {center}</button></span></div>}
          </section>; })}
      </div>
    </div>}
  </>;
}
