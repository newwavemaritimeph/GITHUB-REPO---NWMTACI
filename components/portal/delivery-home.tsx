"use client";

import { useState } from "react";
import type { PortalData } from "../portal-live-app";
import { manilaToday } from "@/lib/portal-format";
import { Badge, Message, usePost } from "./shared-ui";

/**
 * Certificate delivery (owner, 8 Oct 2026). The trainee requests it on the
 * website; Registration checks it and sends it to the Cashier for the LBC fee
 * (₱500.00); once paid it reaches the Releasing Officer, who ships it and must
 * enter the LBC tracking number so the trainee can follow it.
 */

export type DeliveryRow = { id: string; request_number: string; status: string; recipient_name: string; mobile: string; address_line: string; city: string; province: string; zip?: string | null; email: string; decline_reason?: string | null; tracking_number?: string | null; shipped_on?: string | null; paid_at?: string | null; created_at: string; enrollment_id: string; trainee_id: string; certificate_status?: string | null; certificate_number?: string | null; trainees?: { legal_first_name: string; legal_last_name: string; application_number?: string | null; trainee_number?: string | null } | { legal_first_name: string; legal_last_name: string }[] | null; enrollments?: { enrollment_number: string; courses: { name: string; code: string } | { name: string; code: string }[] | null } | { enrollment_number: string }[] | null };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
export const deliveriesOf = (data: PortalData) => ((data as PortalData & { deliveryRequests?: DeliveryRow[] }).deliveryRequests ?? []);
const when = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const who = (r: DeliveryRow) => { const t = one(r.trainees as { legal_first_name: string; legal_last_name: string; application_number?: string | null; trainee_number?: string | null } | null); return { name: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee", no: t?.application_number ?? t?.trainee_number ?? "" }; };
const courseOf = (r: DeliveryRow) => { const e = one(r.enrollments as { enrollment_number: string; courses: { name: string; code: string } | { name: string; code: string }[] | null } | null); return one(e?.courses ?? null)?.name ?? "Course"; };
const address = (r: DeliveryRow) => [r.address_line, r.city, r.province, r.zip].filter(Boolean).join(", ");
const tone = (s: string) => (s === "Requested" ? "orange" : s === "With the Cashier" || s === "Paid" ? "blue" : s === "Shipped" || s === "Delivered" ? "green" : undefined);
const DECLINE_REASONS = ["Certificate not yet printed — request again after release", "Training fee not settled", "Address incomplete", "Duplicate request", "Other"];

function Counts({ rows }: { rows: DeliveryRow[] }) {
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  return <dl className="ac-lines">{["Requested", "With the Cashier", "Paid", "Shipped", "Delivered", "Declined"].map((s) => <div key={s}><dt>{s === "Paid" ? "Paid · to ship" : s}</dt><dd>{n(s)}</dd></div>)}</dl>;
}

/** Registration › Delivery requests: check the certificate, then send to the Cashier or decline. */
export function RegistrationDeliveries({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const rows = deliveriesOf(data);
  const { busy, msg, post } = usePost(reload);
  const [declining, setDeclining] = useState<string | null>(null), [reason, setReason] = useState(""), [note, setNote] = useState("");
  const [show, setShow] = useState<"Open" | "All">("Open");
  const printed = (r: DeliveryRow) => ["Printed", "Released"].includes(r.certificate_status ?? "");
  const shown = rows.filter((r) => show === "All" || r.status === "Requested");
  const fresh = rows.filter((r) => r.status === "Requested").length;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Registration</span><h1>Delivery Requests</h1></div></div>
    <p className="ac-note">From the website. Check that the certificate is printed, then send to the Cashier for the ₱500.00 LBC fee.</p>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {fresh > 0 && <div className="ms-banner blue"><b>{fresh} new delivery request{fresh === 1 ? "" : "s"}</b><span>waiting for your check</span></div>}
    <div className="ac-rail">
      <div className="ac-stack"><section className="portal-panel cx-panel"><div className="panel-heading"><h2>Requests</h2></div><Counts rows={rows} /></section></div>
      <section className="portal-panel cx-panel">
        <div className="ac-chipbar">{(["Open", "All"] as const).map((s) => <button key={s} type="button" className={`ac-chip${show === s ? " on" : ""}`} onClick={() => setShow(s)}>{s === "Open" ? "New" : "All"}<span>{s === "Open" ? fresh : rows.length}</span></button>)}</div>
        {shown.length ? <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>#</th><th>Trainee · NWMTACI no.</th><th>Certificate</th><th>Deliver to</th><th>Requested</th><th>Action</th></tr></thead><tbody>
          {shown.map((r, i) => { const w = who(r); return [
            <tr key={r.id}><td className="cl-no">{i + 1}</td>
              <td><b>{w.name}</b><small className="cl-sub cl-block cl-mono">{w.no} · {r.request_number}</small><small className="cl-sub cl-block">{courseOf(r)}</small></td>
              <td>{r.certificate_number ? <span className="cl-mono">{r.certificate_number}</span> : null}{printed(r) ? <small className="cl-sub cl-block">Printed</small> : <Badge tone="orange">Not Printed Yet</Badge>}</td>
              <td>{address(r)}<small className="cl-sub cl-block">{r.recipient_name} · {r.mobile}</small></td>
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
        </tbody></table></div> : <p className="portal-empty-copy">{show === "Open" ? "No new delivery requests." : "No delivery requests yet."}</p>}
      </section>
    </div>
  </div>;
}

/** Red alert on the Releasing Officer's dashboard when paid requests are waiting to ship. */
export function DeliveryAlert({ data, onOpen }: { data: PortalData; onOpen: () => void }) {
  const paid = deliveriesOf(data).filter((r) => r.status === "Paid");
  if (!paid.length) return null;
  return <div className="cl-alarm" role="alert"><span className="cl-pulse" aria-hidden="true" /><b>{paid.length} paid delivery request{paid.length === 1 ? "" : "s"} to ship</b><span>{paid.slice(0, 4).map((r) => who(r).name.split(",")[0]).join(", ")}{paid.length > 4 ? ` and ${paid.length - 4} more` : ""}</span><button type="button" onClick={onOpen}>Open Delivery</button></div>;
}

/** Releasing Officer › Delivery: paid requests to ship (tracking number required), shipped and delivered. */
export function ReleasingDeliveries({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const rows = deliveriesOf(data).filter((r) => ["Paid", "Shipped", "Delivered"].includes(r.status));
  const { busy, msg, post } = usePost(reload);
  const [shipping, setShipping] = useState<string | null>(null), [tracking, setTracking] = useState(""), [shippedOn, setShippedOn] = useState(manilaToday());
  const toShip = rows.filter((r) => r.status === "Paid").length;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Releasing Officer</span><h1>Delivery</h1></div></div>
    <p className="ac-note">Only paid requests appear here. Enter the LBC tracking number when you ship; the trainee sees it on the website and by email.</p>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="ac-rail">
      <div className="ac-stack"><section className="portal-panel cx-panel"><div className="panel-heading"><h2>Delivery</h2></div>
        <dl className="ac-lines"><div><dt>To ship</dt><dd className={toShip ? "warn" : ""}>{toShip}</dd></div><div><dt>Shipped</dt><dd>{rows.filter((r) => r.status === "Shipped").length}</dd></div><div><dt>Delivered</dt><dd>{rows.filter((r) => r.status === "Delivered").length}</dd></div></dl></section></div>
      <section className="portal-panel cx-panel">
        {rows.length ? <div className="cl-wrap" style={{ marginTop: 18 }}><table className="cl-log cl-light"><thead><tr><th>#</th><th>Trainee</th><th>Certificate No.</th><th>Deliver to</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {rows.map((r, i) => { const w = who(r); return [
            <tr key={r.id}><td className="cl-no">{i + 1}</td>
              <td><b>{w.name}</b><small className="cl-sub cl-block">{courseOf(r)}</small><small className="cl-sub cl-block cl-mono">{r.request_number}</small></td>
              <td className="cl-mono">{r.certificate_number ?? "—"}</td>
              <td>{address(r)}<small className="cl-sub cl-block">{r.recipient_name} · {r.mobile}</small></td>
              <td><Badge tone={tone(r.status)}>{r.status === "Paid" ? "Paid · to Ship" : r.status}</Badge>{r.tracking_number && <small className="cl-sub cl-block cl-mono">{r.tracking_number}</small>}</td>
              <td>{r.status === "Paid" ? <button type="button" className="portal-primary" disabled={busy} onClick={() => { setShipping(r.id); setTracking(""); setShippedOn(manilaToday()); }}>Mark Shipped</button> : r.status === "Shipped" ? <button type="button" className="portal-secondary" disabled={busy} onClick={() => void post({ action: "delivery-delivered", id: r.id }, "Marked delivered.").catch(() => undefined)}>Mark Delivered</button> : null}</td>
            </tr>,
            shipping === r.id && <tr key={`${r.id}-s`} className="cl-voidrow"><td /><td colSpan={5}><div className="cl-void ms-ship">
              <label>LBC Tracking Number (Required)<input value={tracking} autoFocus onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 1234 5678 9012" /></label>
              <label>Date Sent<input type="date" value={shippedOn} max={manilaToday()} onChange={(e) => setShippedOn(e.target.value)} /></label>
              <button type="button" className="portal-secondary" onClick={() => setShipping(null)}>Cancel</button>
              <button type="button" className="portal-primary" disabled={busy || tracking.trim().length < 4 || !shippedOn} onClick={() => void post({ action: "delivery-ship", id: r.id, trackingNumber: tracking.trim(), shippedOn }, "Shipped. The trainee was emailed the tracking number.").then(() => setShipping(null)).catch(() => undefined)}>Mark Shipped</button>
            </div></td></tr>,
          ]; })}
        </tbody></table></div> : <p className="portal-empty-copy">No paid delivery requests yet.</p>}
      </section>
    </div>
  </div>;
}
