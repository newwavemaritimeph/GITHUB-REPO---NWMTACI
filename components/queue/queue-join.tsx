"use client";

import { useEffect, useState } from "react";
import { joinProblem, windowsFor, windowsText } from "@/lib/queue";
import { QueueHead } from "./queue-brand";

type Service = { code: string; name: string; default_window: number };
type Win = { no: number; name: string; service_codes: string[] };
/** Links work on the queue host (/t/...) and, for testing, on the main host (/queue/t/...). */
export const queueBase = () => (typeof window !== "undefined" && window.location.pathname.startsWith("/queue") ? "/queue" : "");

/** /join (queue plan §10; Bright Wave, owner 10 Nov 2026): full name, mobile, service, consent, Submit. */
export function QueueJoin() {
  const [services, setServices] = useState<Service[]>([]), [windows, setWindows] = useState<Win[]>([]);
  const [name, setName] = useState(""), [mobile, setMobile] = useState(""), [service, setService] = useState(""), [consent, setConsent] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/queue/state").then((r) => r.json()).then((s: { services?: Service[]; windows?: Win[]; error?: string }) => {
      if (s.error) setError(s.error);
      setServices(s.services ?? []); setWindows(s.windows ?? []);
    }).catch(() => setError("We could not load the services. Please ask at the front desk."));
  }, []);
  async function join() {
    const problem = joinProblem({ name, mobile, service, consent }, services.map((s) => s.code));
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/queue/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, mobile, service, consent }) });
      const b = await r.json();
      if (!r.ok) { setError(b.error ?? "We could not register you in the queue."); return; }
      window.location.href = `${queueBase()}/t/${b.token}`;
    } catch { setError("We could not reach the queue. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  const where = (code: string) => { const nos = windowsFor(code, windows); const w = windows.find((x) => x.no === nos[0]); return `${w?.name ?? ""} · ${windowsText(nos)}`; };
  return <main className="q-wrap">
    <QueueHead sub="Walk-In Queue" />
    <section className="q-body">
      <h1>Queue Registration</h1>
      <label className="q-field">Full Name<input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Dela Cruz" maxLength={120} /></label>
      <label className="q-field">Mobile Number<input type="tel" inputMode="tel" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="09XX XXX XXXX" maxLength={16} /></label>
      <span className="q-label" id="q-svc-label">Purpose of Visit</span>
      <div className="q-services" role="radiogroup" aria-labelledby="q-svc-label">{services.map((s) => <button key={s.code} type="button" role="radio" aria-checked={service === s.code} className={service === s.code ? "on" : ""} onClick={() => setService(s.code)}><b>{s.name}</b><small>{where(s.code)}</small></button>)}</div>
      <label className="q-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree that New Wave uses my name and mobile number only to manage today&apos;s queue, per the Data Privacy Act (RA 10173).</label>
      {error && <p className="q-error" role="alert">{error}</p>}
      <button type="button" className="q-go" disabled={busy || !services.length} onClick={() => void join()}>{busy ? "Submitting…" : "Submit"}</button>
      <p className="q-note">Your number shows on your phone and on the screen in our office.</p>
    </section>
  </main>;
}
