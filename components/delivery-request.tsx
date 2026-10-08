"use client";

import { useEffect, useState, type FormEvent } from "react";

/**
 * Certificate delivery on the public website (owner, 8 Oct 2026): request form
 * (NWMTACI number + birth date to confirm it is the trainee) and tracking.
 */

type Cert = { id: string; course: string; dates: string };
type Track = { requestNumber: string; status: string; declineReason?: string | null; trackingNumber?: string | null; shippedOn?: string | null; destination: string; course: string; firstName: string; fee: string };
const STEPS = ["Requested", "With the Cashier", "Paid", "Shipped", "Delivered"];
const STEP_LABEL: Record<string, string> = { Requested: "Requested", "With the Cashier": "Checked · pay the fee", Paid: "Fee paid", Shipped: "Shipped", Delivered: "Delivered" };

async function call(body: unknown) {
  const r = await fetch("/api/public/delivery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Something went wrong. Please try again.");
  return j;
}

export function DeliveryRequest() {
  const [mode, setMode] = useState<"request" | "track">("request");
  const [prefill, setPrefill] = useState("");
  // A tracking link from the emails (?no=DR-…) opens the tracker with the number filled in.
  useEffect(() => { const no = new URLSearchParams(window.location.search).get("no"); if (no) void Promise.resolve().then(() => { setPrefill(no); setMode("track"); }); }, []);
  return <div className="dr-layout">
    <div className="dr-main">
      <div className="dr-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode === "request"} className={mode === "request" ? "on" : ""} onClick={() => setMode("request")}>Request delivery</button><button type="button" role="tab" aria-selected={mode === "track"} className={mode === "track" ? "on" : ""} onClick={() => setMode("track")}>Track my request</button></div>
      {mode === "request" ? <RequestForm onDone={(no) => { setPrefill(no); setMode("track"); }} /> : <Tracker initialNo={prefill} />}
    </div>
    <aside className="dr-side">
      <h3>How it works</h3>
      <ol><li>Send this request.</li><li>Registration checks your certificate.</li><li>Pay the ₱500.00 delivery fee at our Cashier (we email you how).</li><li>We ship by LBC and email you the tracking number.</li></ol>
      <div className="dr-fee"><span>Delivery fee (LBC)</span><b>₱500.00</b></div>
      <p>Prefer to pick it up? Bring a valid ID to our office in Ermita, Manila.</p>
    </aside>
  </div>;
}

function RequestForm({ onDone }: { onDone: (no: string) => void }) {
  const [nw, setNw] = useState(""), [bd, setBd] = useState("");
  const [found, setFound] = useState<{ firstName: string; certificates: Cert[] } | null>(null);
  const [f, setF] = useState({ enrollmentId: "", recipientName: "", mobile: "", addressLine: "", city: "", province: "", zip: "", email: "", agree: false });
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  async function lookup() {
    setBusy(true); setErr(""); setFound(null);
    try { const j = await call({ step: "lookup", nwmtaciNo: nw, birthdate: bd }); setFound(j); if (j.certificates?.length === 1) set("enrollmentId", j.certificates[0].id); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not check."); }
    finally { setBusy(false); }
  }
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true); setErr("");
    try { const j = await call({ step: "submit", nwmtaciNo: nw, birthdate: bd, ...f }); onDone(j.requestNumber); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not send."); }
    finally { setBusy(false); }
  }
  const ready = !!found && !!f.enrollmentId && f.recipientName.trim().length > 1 && f.mobile.trim() && f.addressLine.trim().length > 4 && f.city.trim() && f.province.trim() && f.email.includes("@") && f.agree;
  return <form className="dr-form" onSubmit={submit}>
    <fieldset><legend>1 · Confirm it is you</legend>
      <label>NWMTACI number<input value={nw} onChange={(e) => { setNw(e.target.value); setFound(null); }} placeholder="NWMTACI-2026-0000" autoComplete="off" required /></label>
      <label>Birth date<input type="date" value={bd} onChange={(e) => { setBd(e.target.value); setFound(null); }} required /></label>
      {!found && <button type="button" className="dr-btn" disabled={busy || nw.trim().length < 4 || !bd} onClick={() => void lookup()}>{busy ? "Checking…" : "Continue"}</button>}
      {found && <p className="dr-ok full">✓ Found: {found.firstName}</p>}
    </fieldset>
    {found && (found.certificates.length ? <>
      <fieldset><legend>2 · Certificate to deliver</legend>
        <label className="full">Course<select value={f.enrollmentId} onChange={(e) => set("enrollmentId", e.target.value)} required><option value="">Choose the course</option>{found.certificates.map((c) => <option key={c.id} value={c.id}>{c.course}{c.dates ? ` · ${c.dates}` : ""}</option>)}</select></label>
      </fieldset>
      <fieldset><legend>3 · Where to send it</legend>
        <label>Recipient name<input value={f.recipientName} onChange={(e) => set("recipientName", e.target.value)} placeholder="Who will receive the parcel" required /></label>
        <label>Mobile number<input value={f.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="09xx xxx xxxx" inputMode="tel" required /></label>
        <label className="full">House no., street, barangay<input value={f.addressLine} onChange={(e) => set("addressLine", e.target.value)} required /></label>
        <label>City / municipality<input value={f.city} onChange={(e) => set("city", e.target.value)} required /></label>
        <label>Province<input value={f.province} onChange={(e) => set("province", e.target.value)} required /></label>
        <label>ZIP code<input value={f.zip} onChange={(e) => set("zip", e.target.value)} inputMode="numeric" /></label>
        <label>Email for updates<input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="your@gmail.com" required /></label>
      </fieldset>
      <label className="dr-agree"><input type="checkbox" checked={f.agree} onChange={(e) => set("agree", e.target.checked)} /><span>Send my certificate to the address above. New Wave is not liable once LBC has received the parcel.</span></label>
      <button type="submit" className="dr-btn primary" disabled={busy || !ready}>{busy ? "Sending…" : "Send request"}</button>
    </> : <p className="dr-err">We found you, but there is no completed New Wave course to deliver yet. Contact us if this is wrong.</p>)}
    {err && <p className="dr-err" role="alert">{err}</p>}
  </form>;
}

function Tracker({ initialNo }: { initialNo: string }) {
  const [no, setNo] = useState(initialNo), [bd, setBd] = useState("");
  const [t, setT] = useState<Track | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function look(ev: FormEvent) {
    ev.preventDefault(); setBusy(true); setErr(""); setT(null);
    try { const r = await fetch(`/api/public/delivery?no=${encodeURIComponent(no.trim())}&birthdate=${encodeURIComponent(bd)}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Not found."); setT(j); }
    catch (e) { setErr(e instanceof Error ? e.message : "Not found."); }
    finally { setBusy(false); }
  }
  const at = t ? STEPS.indexOf(t.status) : -1;
  return <div>
    {initialNo && !t && <p className="dr-ok">Request <b>{initialNo}</b> received. We emailed you a copy. Enter your birth date to see its status.</p>}
    <form className="dr-form" onSubmit={look}><fieldset><legend>Find your request</legend>
      <label>Request number<input value={no} onChange={(e) => setNo(e.target.value)} placeholder="DR-2026-000001" required /></label>
      <label>Birth date<input type="date" value={bd} onChange={(e) => setBd(e.target.value)} required /></label>
      <button type="submit" className="dr-btn" disabled={busy}>{busy ? "Looking…" : "Show status"}</button>
    </fieldset></form>
    {err && <p className="dr-err" role="alert">{err}</p>}
    {t && <div className="dr-track">
      <h3>{t.requestNumber} · {t.course}</h3>
      <p className="dr-muted">To {t.destination}</p>
      {t.status === "Declined" ? <p className="dr-err">This request was declined: {t.declineReason}</p> : <ol className="dr-steps">{STEPS.map((s, i) => <li key={s} className={i <= at ? "done" : i === at + 1 ? "next" : ""}>{STEP_LABEL[s]}{s === "Shipped" && t.trackingNumber ? <span>LBC tracking no. <b>{t.trackingNumber}</b></span> : null}</li>)}</ol>}
      {t.status === "With the Cashier" && <p className="dr-pay">Please pay the {t.fee} delivery fee at our Cashier — in cash at the office, or by GCash, PSBank or UnionBank (we emailed the details). Quote <b>{t.requestNumber}</b>.</p>}
      {t.trackingNumber && <p className="dr-muted">Follow the parcel on the LBC website with tracking number <b>{t.trackingNumber}</b>.</p>}
    </div>}
  </div>;
}
