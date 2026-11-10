"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { announcement, announcementTagalog, type QueueBroadcast } from "@/lib/queue";
import { playChime, unlockChime } from "@/lib/portal-alerts";
import { DEFAULT_VOICE, VOICE_KEY, listVoices, loadVoice, speak, useQueueLive, type VoiceSettings } from "./use-queue-live";
import { QueueBrand } from "./queue-brand";
import { queueBase } from "./queue-join";

type Ticket = { ticket_no: string; service_code: string; window_no: number | null; first_name?: string };
type State = { windows: { no: number; name: string; service_codes: string[]; serving: (Ticket & { called_at: string | null }) | null }[]; waiting: Ticket[]; waitingCount: number; services: { code: string; name: string }[]; ticker: string };

/**
 * /display (queue plan §10; Harbor Navy, owner 10 Nov 2026): each window as a band with its number in orange (Registration
 * orange edge, Cashier cyan edge), Up Next and the QR on the right, a ticker below. A join flashes the border with a banner
 * and the chime; a call flashes that window, chimes and is announced in the chosen voice.
 */
export function QueueDisplay() {
  const [s, setS] = useState<State | null>(null), [started, setStarted] = useState(false), [clock, setClock] = useState("");
  const [banner, setBanner] = useState(""), [flash, setFlash] = useState(false), [calling, setCalling] = useState<number | null>(null), [qr, setQr] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false), [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE), [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const startedRef = useRef(false), names = useRef<Record<string, string>>({}), voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const load = useCallback(async () => {
    try { const r = await fetch("/api/queue/state", { cache: "no-store" }); if (r.ok) { const next = await r.json() as State; names.current = Object.fromEntries(next.services.map((x) => [x.code, x.name])); setS(next); } } catch { /* offline badge shows */ }
  }, []);
  useEffect(() => { const id = setTimeout(() => { void load(); setVoice(loadVoice()); setVoices(listVoices()); }, 0); return () => clearTimeout(id); }, [load]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () => setVoices(listVoices());
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date()));
    const id = setInterval(tick, 1000); const first = setTimeout(tick, 0); return () => { clearInterval(id); clearTimeout(first); };
  }, []);
  // Phase 1: the QR points at /join. Phase 2 turns it into the rotating screen QR.
  useEffect(() => { void QRCode.toDataURL(`${window.location.origin}${queueBase()}/join`, { margin: 1, width: 360, color: { dark: "#123F63", light: "#FFFFFF" } }).then(setQr).catch(() => undefined); }, []);
  const announce = (ticketNo: string, windowNo: number) => { speak(announcement(ticketNo, windowNo), voiceRef.current); if (voiceRef.current.tagalog) speak(announcementTagalog(ticketNo, windowNo), voiceRef.current, "fil"); };
  const online = useQueueLive((e: QueueBroadcast | null) => {
    void load();
    if (!e || !startedRef.current) return;
    if (e.type === "join") {
      setBanner(`New Arrival: ${e.ticket_no} · ${names.current[e.service_code] ?? ""}`); setFlash(true); playChime();
      setTimeout(() => setFlash(false), 1200); setTimeout(() => setBanner(""), 4000);
    }
    if ((e.type === "call" || e.type === "recall") && e.window_no) {
      setCalling(e.window_no); playChime(); setTimeout(() => setCalling(null), 3200);
      setTimeout(() => announce(e.ticket_no, e.window_no!), 700);
    }
  }, 15000);
  async function start() {
    unlockChime(); startedRef.current = true; setStarted(true);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* optional */ }
    try { await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request("screen"); } catch { /* optional */ }
    setVoices(listVoices());
  }
  const saveVoice = (next: VoiceSettings) => { setVoice(next); try { localStorage.setItem(VOICE_KEY, JSON.stringify(next)); } catch { /* not saved */ } };
  return <div className={`qd${flash ? " flash" : ""}`}>
    <header className="qd-top"><QueueBrand sub="NOW SERVING" /><div className="qd-right"><button type="button" className="qd-gear" onClick={() => setVoiceOpen((v) => !v)} aria-expanded={voiceOpen}>Voice Settings</button><div className="qd-clock q-mono">{clock}</div></div></header>
    <main className="qd-main">
      <section><h2 className="qd-h">Windows</h2>
        {(s?.windows ?? []).map((w) => <div key={w.no} className={`qd-win${w.service_codes?.includes("P") ? " cashier" : ""}${calling === w.no ? " call" : ""}`}><div><small>WINDOW {w.no}</small><b>{w.name}</b></div><div className="qd-now q-mono">{w.serving ? w.serving.ticket_no : "—"}</div></div>)}
      </section>
      <section><h2 className="qd-h">Up Next{s ? ` · ${s.waitingCount}` : ""}</h2>
        <div className="qd-next">{(s?.waiting ?? []).map((t) => <span key={t.ticket_no} className="q-mono">{t.ticket_no}{t.first_name ? ` ${t.first_name}` : ""}</span>)}{s && !s.waiting.length && <span style={{ fontSize: 22, fontWeight: 500 }}>No one waiting</span>}</div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL */}
        {qr && <div className="qd-qr"><img src={qr} alt="QR code to join the queue" /><div><b>Scan to Join the Queue</b><small>Your number shows on your phone and on this screen.</small></div></div>}
      </section>
    </main>
    <div className="qd-ticker">{s?.ticker ?? ""}</div>
    {voiceOpen && <div className="qd-voice" role="dialog" aria-label="Voice Settings">
      <h2>Voice Settings</h2>
      <label>Voice<select value={voice.voice} onChange={(e) => saveVoice({ ...voice, voice: e.target.value })}>
        <option value="">Automatic (Google or Microsoft English)</option>
        {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}
      </select></label>
      <label>Speed · {voice.rate.toFixed(2)}<input type="range" min={0.6} max={1.2} step={0.02} value={voice.rate} onChange={(e) => saveVoice({ ...voice, rate: Number(e.target.value) })} /></label>
      <label className="row"><input type="checkbox" checked={voice.tagalog} onChange={(e) => saveVoice({ ...voice, tagalog: e.target.checked })} /> Also Say in Tagalog</label>
      {!voices.length && <p style={{ margin: 0, color: "#5B6B7D", fontSize: 14 }}>This browser has not listed its voices yet. Press Start Display, or try Chrome or Edge.</p>}
      <div className="acts"><button type="button" onClick={() => setVoiceOpen(false)}>Close</button><button type="button" className="main" onClick={() => { unlockChime(); announce("E-004", 1); }}>Test Voice</button></div>
    </div>}
    {banner && <div className="qd-banner" role="status">{banner}</div>}
    {!online && <div className="qd-offline">Offline, reconnecting…</div>}
    {!started && <div className="qd-start"><button type="button" onClick={() => void start()}>Start Display</button></div>}
  </div>;
}
