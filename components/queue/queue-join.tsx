"use client";

import { useEffect, useState } from "react";
import { joinProblem } from "@/lib/queue";

type Service = { code: string; name: string; default_window: number };
/** Links work on the queue host (/t/...) and, for testing, on the main host (/queue/t/...). */
export const queueBase = () => (typeof window !== "undefined" && window.location.pathname.startsWith("/queue") ? "/queue" : "");

/** /join (queue plan §10): full name, mobile, what they came for, consent, "Get My Number". */
export function QueueJoin() {
  const [services, setServices] = useState<Service[]>([]), [windows, setWindows] = useState<Record<number, string>>({});
  const [name, setName] = useState(""), [mobile, setMobile] = useState(""), [service, setService] = useState(""), [consent, setConsent] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/queue/state").then((r) => r.json()).then((s: { services?: Service[]; windows?: { no: number; name: string }[]; error?: string }) => {
      if (s.error) setError(s.error);
      setServices(s.services ?? []);
      setWindows(Object.fromEntries((s.windows ?? []).map((w) => [w.no, w.name])));
    }).catch(() => setError("We could not load the services. Please ask at the front desk."));
  }, []);
  async function join() {
    const problem = joinProblem({ name, mobile, service, consent }, services.map((s) => s.code));
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/queue/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, mobile, service, consent }) });
      const b = await r.json();
      if (!r.ok) { setError(b.error ?? "We could not get you a number."); return; }
      window.location.href = `${queueBase()}/t/${b.token}`;
    } catch { setError("We could not reach the queue. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <main className="q-wrap">
    <div className="q-brand"><img src="/new-wave-emblem.png" alt="" />New Wave Maritime · Queue</div>
    <section className="q-card">
      <h1>Get Your Number</h1>
      <label>Full Name<input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Dela Cruz" maxLength={120} /></label>
      <label>Mobile Number<input type="tel" inputMode="tel" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="09XXXXXXXXX" maxLength={16} /></label>
      <div style={{ display: "grid", gap: 6 }}><span id="q-svc-label" style={{ fontSize: 14, fontWeight: 600, color: "var(--q-muted)" }}>What Did You Come For?</span>
        <div className="q-services" role="radiogroup" aria-labelledby="q-svc-label">{services.map((s) => <button key={s.code} type="button" role="radio" aria-checked={service === s.code} className={service === s.code ? "on" : ""} onClick={() => setService(s.code)}><b>{s.name}</b><small>Window {s.default_window}{windows[s.default_window] ? ` · ${windows[s.default_window]}` : ""}</small></button>)}</div>
      </div>
      <label className="q-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree that New Wave uses my name and mobile number only to manage today&apos;s queue, per the Data Privacy Act (RA 10173).</label>
      {error && <p className="q-error" role="alert">{error}</p>}
      <button type="button" className="q-go" disabled={busy || !services.length} onClick={() => void join()}>{busy ? "Getting Your Number…" : "Get My Number"}</button>
    </section>
    <p className="q-note">Your number shows on your phone and on the screen in our office.</p>
  </main>;
}
