"use client";

import { useState } from "react";
import type { PortalData } from "../portal-live-app";
import { Badge, Message, MonthBar, useMonthRows, usePost } from "./shared-ui";

/**
 * Certificate delivery (owner, 8 Oct 2026). The trainee requests it on the
 * website; Registration checks it and sends it to the Cashier for the LBC fee
 * (₱500.00); once paid it reaches the Releasing Officer's To Release tab, who ships
 * it and must enter the LBC tracking number so the trainee can follow it.
 */

export type DeliveryRow = { id: string; request_number: string; status: string; recipient_name: string; mobile: string; address_line: string; city: string; province: string; zip?: string | null; email: string; decline_reason?: string | null; tracking_number?: string | null; shipped_on?: string | null; paid_at?: string | null; created_at: string; enrollment_id: string; trainee_id: string; certificate_status?: string | null; certificate_number?: string | null; trainees?: { legal_first_name: string; legal_last_name: string; application_number?: string | null; trainee_number?: string | null } | { legal_first_name: string; legal_last_name: string }[] | null; enrollments?: { enrollment_number: string; courses: { name: string; code: string } | { name: string; code: string }[] | null } | { enrollment_number: string }[] | null };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
export const deliveriesOf = (data: PortalData) => ((data as PortalData & { deliveryRequests?: DeliveryRow[] }).deliveryRequests ?? []);
const when = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const who = (r: DeliveryRow) => { const t = one(r.trainees as { legal_first_name: string; legal_last_name: string; application_number?: string | null; trainee_number?: string | null } | null); return { name: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee", no: t?.application_number ?? t?.trainee_number ?? "" }; };
const courseOf = (r: DeliveryRow) => { const e = one(r.enrollments as { enrollment_number: string; courses: { name: string; code: string } | { name: string; code: string }[] | null } | null); return one(e?.courses ?? null)?.name ?? "Course"; };
export const deliveryAddress = (r: DeliveryRow) => [r.address_line, r.city, r.province, r.zip].filter(Boolean).join(", ");
const tone = (s: string) => (s === "Requested" ? "orange" : s === "With the Cashier" || s === "Paid" ? "blue" : s === "Shipped" || s === "Delivered" ? "green" : undefined);
const DECLINE_REASONS = ["Certificate not yet printed — request again after release", "Training fee not settled", "Address incomplete", "Duplicate request", "Other"];

function Counts({ rows }: { rows: DeliveryRow[] }) {
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  return <dl className="ac-lines">{["Requested", "With the Cashier", "Paid", "Shipped", "Delivered", "Declined"].map((s) => <div key={s}><dt>{s === "Paid" ? "Paid · to ship" : s}</dt><dd>{n(s)}</dd></div>)}</dl>;
}

/** Registration › Delivery requests: check the certificate, then send to the Cashier or decline. */
export function RegistrationDeliveries({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const all = deliveriesOf(data);
  // New requests always show; the rest wait for a date (owner, 5 Nov 2026).
  const { p, rows } = useMonthRows(all, (r) => r.created_at, false);
  const { busy, msg, post } = usePost(reload);
  const [declining, setDeclining] = useState<string | null>(null), [reason, setReason] = useState(""), [note, setNote] = useState("");
  const [show, setShow] = useState<"Open" | "All">("Open");
  const printed = (r: DeliveryRow) => ["Printed", "Released"].includes(r.certificate_status ?? "");
  const shown = show === "All" ? rows : all.filter((r) => r.status === "Requested");
  const fresh = all.filter((r) => r.status === "Requested").length;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Registration</span><h1>Delivery Requests</h1></div></div>
    <p className="ac-note">From the website. Check that the certificate is printed, then send to the Cashier for the ₱500.00 LBC fee.</p>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {fresh > 0 && <div className="ms-banner blue"><b>{fresh} new delivery request{fresh === 1 ? "" : "s"}</b><span>waiting for your check</span></div>}
    {show === "All" && <MonthBar p={p} what="Requested" count={`${rows.length} request${rows.length === 1 ? "" : "s"}`} />}
    <div className="ac-rail">
      <div className="ac-stack"><section className="portal-panel cx-panel"><div className="panel-heading"><h2>Requests</h2></div><Counts rows={p.picked ? rows : all} /></section></div>
      <section className="portal-panel cx-panel">
        <div className="ac-chipbar">{(["Open", "All"] as const).map((s) => <button key={s} type="button" className={`ac-chip${show === s ? " on" : ""}`} onClick={() => setShow(s)}>{s === "Open" ? "New" : "All"}<span>{s === "Open" ? fresh : rows.length}</span></button>)}</div>
        {show === "All" && !p.picked ? null : shown.length ? <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>#</th><th>Trainee · NWMTACI no.</th><th>Certificate</th><th>Deliver to</th><th>Requested</th><th>Action</th></tr></thead><tbody>
          {shown.map((r, i) => { const w = who(r); return [
            <tr key={r.id}><td className="cl-no">{i + 1}</td>
              <td><b>{w.name}</b><small className="cl-sub cl-block cl-mono">{w.no} · {r.request_number}</small><small className="cl-sub cl-block">{courseOf(r)}</small></td>
              <td>{r.certificate_number ? <span className="cl-mono">{r.certificate_number}</span> : null}{printed(r) ? <small className="cl-sub cl-block">Printed</small> : <Badge tone="orange">Not Printed Yet</Badge>}</td>
              <td>{deliveryAddress(r)}<small className="cl-sub cl-block">{r.recipient_name} · {r.mobile}</small></td>
              <td>{when(r.created_at)}</td>
              <td>{r.status === "Requested" ? <span className="cl-acts"><button type="button" className="portal-secondary" disabled={busy} onClick={() => { setDeclining(r.id); setReason(""); setNote(""); }}>Decline</button><button type="button" className="portal-primary" disabled={busy || !printed(r)} title={printed(r) ? undefined : "Wait until the certificate is printed"} onClick={() => void post({ action: "delivery-check", id: r.id }, "Sent to the Cashier. The trainee was emailed how to pay.").catch(() => undefined)}>Send to the Cashier</button></span> : <><Badge tone={tone(r.status)}>{r.status}</Badge>{r.decline_reason && <small className="cl-sub cl-block">{r.decline_reason}</small>}</>}</td>
            </tr>,
            declining === r.id && <tr key={`${r.id}-d`} className="cl-voidrow"><td /><td colSpan={5}><div className="cl-void">
              <label>Reason (Emailed to the Trainee)<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose a Reason</option>{DECLINE_REASONS.map((x) => <option key={x}>{x}</option>)}</select></label>
              {reason === "Other" && <label>Details<input value={note} onChange={(e) => setNote(e.target.value)} /></label>}
              <button type="button" className="portal-secondary" onClick={() => setDeclining(null)}>Keep</button>
              <button type="button" className="cl-danger" disabled={busy || !reason || (reason === "Other" && note.trim().length < 3)} onClick={() => void post({ action: "delivery-decline", id: r.id, reason: reason === "Other" ? note.trim() : reason }, "Declined. The trainee was emailed the reason.").then(() => setDeclining(null)).catch(() => undefined)}>Decline</button>
            </div></td></tr>,
          ]; })}
        </tbody></table></div> : <p className="portal-empty-copy">{show === "Open" ? "No new delivery requests." : "No delivery requests in this period."}</p>}
      </section>
    </div>
  </div>;
}

/** Red alert on the Releasing Officer's dashboard when paid requests are waiting to ship. */
export function DeliveryAlert({ data, onOpen }: { data: PortalData; onOpen: () => void }) {
  const paid = deliveriesOf(data).filter((r) => r.status === "Paid");
  if (!paid.length) return null;
  return <div className="cl-alarm" role="alert"><span className="cl-pulse" aria-hidden="true" /><b>{paid.length} paid delivery request{paid.length === 1 ? "" : "s"} to ship</b><span>{paid.slice(0, 4).map((r) => who(r).name.split(",")[0]).join(", ")}{paid.length > 4 ? ` and ${paid.length - 4} more` : ""}</span><button type="button" onClick={onOpen}>Open To Release</button></div>;
}
