"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { announcement, type QueueBroadcast } from "@/lib/queue";
import { playChime, unlockChime } from "@/lib/portal-alerts";
import { speak, useQueueLive } from "./use-queue-live";
import { queueBase } from "./queue-join";

type Ticket = { ticket_no: string; service_code: string; window_no: number | null; first_name?: string };
type State = { windows: { no: number; name: string; serving: (Ticket & { called_at: string | null }) | null }[]; waiting: Ticket[]; waitingCount: number; services: { code: string; name: string }[]; ticker: string };

/**
 * /display (queue plan §10): windows and their ticket on the left, Up Next and the QR on the right, a ticker below.
 * A join flashes the border with a banner and the chime; a call flashes that window, chimes and is announced.
 * "Start Display" each morning unlocks sound and keeps the screen awake.
 */
export function QueueDisplay() {
  const [s, setS] = useState<State | null>(null), [started, setStarted] = useState(false), [clock, setClock] = useState("");
  const [banner, setBanner] = useState(""), [flash, setFlash] = useState(false), [calling, setCalling] = useState<number | null>(null), [qr, setQr] = useState("");
  const startedRef = useRef(false), names = useRef<Record<string, string>>({});
  const load = useCallback(async () => {
    try { const r = await fetch("/api/queue/state", { cache: "no-store" }); if (r.ok) { const next = await r.json() as State; names.current = Object.fromEntries(next.services.map((x) => [x.code, x.name])); setS(next); } } catch { /* offline badge shows */ }
  }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);
  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date()));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);
  // Phase 1: the QR points at /join. Phase 2 turns it into the rotating screen QR.
  useEffect(() => { void QRCode.toDataURL(`${window.location.origin}${queueBase()}/join`, { margin: 1, width: 360 }).then(setQr).catch(() => undefined); }, []);
  const online = useQueueLive((e: QueueBroadcast | null) => {
    void load();
    if (!e || !startedRef.current) return;
    if (e.type === "join") {
      setBanner(`New Arrival: ${e.ticket_no} · ${names.current[e.service_code] ?? ""}`); setFlash(true); playChime();
      setTimeout(() => setFlash(false), 1200); setTimeout(() => setBanner(""), 4000);
    }
    if ((e.type === "call" || e.type === "recall") && e.window_no) {
      setCalling(e.window_no); playChime(); setTimeout(() => setCalling(null), 3200);
      setTimeout(() => speak(announcement(e.ticket_no, e.window_no!)), 700);
    }
  }, 15000);
  async function start() {
    unlockChime(); startedRef.current = true; setStarted(true);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* optional */ }
    try { await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request("screen"); } catch { /* optional */ }
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }
  return <div className={`qd${flash ? " flash" : ""}`}>
    <header className="qd-top"><div className="q-brand"><img src="/new-wave-emblem.png" alt="" />New Wave Maritime · Now Serving</div><div className="qd-clock">{clock}</div></header>
    <main className="qd-main">
      <section><h2 className="qd-h">Windows</h2>
        {(s?.windows ?? []).map((w) => <div key={w.no} className={`qd-win${calling === w.no ? " call" : ""}`}><div><small>Window {w.no}</small><b>{w.name}</b></div><div className="qd-now">{w.serving ? w.serving.ticket_no : "—"}</div></div>)}
      </section>
      <section><h2 className="qd-h">Up Next{s ? ` · ${s.waitingCount}` : ""}</h2>
        <div className="qd-next">{(s?.waiting ?? []).map((t) => <span key={t.ticket_no}>{t.ticket_no}{t.first_name ? ` ${t.first_name}` : ""}</span>)}{s && !s.waiting.length && <span style={{ fontSize: 22, fontWeight: 500 }}>No one waiting</span>}</div>
        {qr && <div className="qd-qr"><img src={qr} alt="QR code to get a queue number" /><div><b>Scan to Get Your Number</b><small>Your number shows on your phone and on this screen.</small></div></div>}
      </section>
    </main>
    <div className="qd-ticker">{s?.ticker ?? ""}</div>
    {banner && <div className="qd-banner" role="status">{banner}</div>}
    {!online && <div className="qd-offline">Offline, reconnecting…</div>}
    {!started && <div className="qd-start"><button type="button" onClick={() => void start()}>Start Display</button></div>}
  </div>;
}
