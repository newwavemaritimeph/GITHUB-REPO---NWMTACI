"use client";

import { useCallback, useEffect, useState } from "react";
import { playChime, unlockChime } from "@/lib/portal-alerts";
import { useQueueLive } from "./use-queue-live";
import { QueueBrand } from "./queue-brand";

type Ticket = { id: string; ticket_no: string; service_code: string; status: string; window_no: number | null; full_name: string | null; mobile: string | null; created_at: string; called_at: string | null; recall_count: number };
type Data = { windows: { no: number; name: string; service_codes: string[] }[]; allWindows?: { no: number; name: string }[]; services: { code: string; name: string }[]; tickets: Ticket[]; stats: { waiting: number; served: number; noShows: number; avgWait: number } };
const WINDOW_KEY = "nw-queue-window";
const minutes = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

/** /staff (queue plan §10; Bright Wave, owner 10 Nov 2026): pick a window, then Call Next, Recall, Done and No-Show; the waiting list and today's numbers. */
export function QueueStaff() {
  const [d, setD] = useState<Data | null>(null), [chosen, setChosen] = useState<number | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ err?: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/queue/staff", { cache: "no-store" }), b = await r.json();
      if (!r.ok) { setMsg({ err: true, text: b.error ?? "Could not load the queue." }); return; }
      setD(b as Data);
    } catch { setMsg({ err: true, text: "Offline, reconnecting…" }); }
  }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);
  // The window choice is remembered on this computer for this login.
  const [saved] = useState<number | null>(() => { try { return Number(localStorage.getItem(WINDOW_KEY)) || null; } catch { return null; } });
  const win = chosen ?? (d?.windows.some((w) => w.no === saved) ? saved : d?.windows[0]?.no ?? null);
  const codes = d?.windows.find((w) => w.no === win)?.service_codes ?? [];
  const online = useQueueLive((e) => { void load(); if (e?.type === "join" && codes.includes(e.service_code)) playChime(); }, 10000);
  const pick = (no: number) => { setChosen(no); try { localStorage.setItem(WINDOW_KEY, String(no)); } catch { /* not saved */ } };
  const serving = d?.tickets.find((t) => t.status === "serving" && t.window_no === win) ?? null;
  // Windows 1 and 2 share the Registration line: a window sees every waiting ticket for the services it serves.
  const waiting = (d?.tickets ?? []).filter((t) => t.status === "waiting" && codes.includes(t.service_code) && (t.window_no === null || t.window_no === win));
  const sharing = (d?.windows ?? []).filter((w) => w.no !== win && w.service_codes.some((c) => codes.includes(c))).map((w) => w.no);
  const others = (d?.tickets ?? []).filter((t) => t.status === "serving" && t.window_no !== win);
  const svc = (code: string) => d?.services.find((s) => s.code === code)?.name ?? code;
  const act = useCallback(async (body: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/queue/staff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), b = await r.json();
      if (!r.ok) setMsg({ err: true, text: b.error ?? "That did not work." });
      else setMsg({ text: body.action === "call-next" && !b.ticket ? "No one is waiting at this window." : ok.replace("{no}", b.ticket?.ticket_no ?? "") });
      await load();
    } catch { setMsg({ err: true, text: "Offline. Try again." }); }
    finally { setBusy(false); }
  }, [load]);
  // Keyboard: N call next, R recall, D done.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || !win || (e.target as HTMLElement)?.closest("input,select,textarea")) return;
      const k = e.key.toLowerCase();
      if (k === "n") void act({ action: "call-next", window: win }, "Now serving {no}.");
      if (k === "r" && serving) void act({ action: "recall", ticketId: serving.id }, "Recalled {no}.");
      if (k === "d" && serving) void act({ action: "done", ticketId: serving.id }, "{no} done.");
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [act, busy, win, serving]);
  if (!d) return <main className="qs"><p className="q-note">{msg?.text ?? "Loading the queue…"}</p></main>;
  if (!d.windows.length) return <main className="qs"><p className="qs-msg err">No window is set up for your role.</p></main>;
  return <div onPointerDown={unlockChime}>
    <div className="qs-bar"><QueueBrand sub="Queue Console" /><label>Window <select value={win ?? ""} onChange={(e) => pick(Number(e.target.value))} aria-label="Window">{d.windows.map((w) => <option key={w.no} value={w.no}>{`Window ${w.no} · ${w.name}`}</option>)}</select></label></div>
    <main className="qs">
    {!online && <p className="qs-msg err">Offline, reconnecting…</p>}
    {msg && <p className={`qs-msg${msg.err ? " err" : ""}`} role="status">{msg.text}</p>}
    <div className="qs-grid">
      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        <section className="qs-now" aria-live="polite">
          <small>NOW SERVING · WINDOW {win}</small>
          <div className="q-no q-mono">{serving?.ticket_no ?? "—"}</div>
          {serving && <div>{serving.full_name ?? "Walk-in"} · {svc(serving.service_code)}{serving.recall_count ? ` · recalled ${serving.recall_count}×` : ""}</div>}
          <div className="qs-btns">
            <button type="button" className="main" disabled={busy || !win} onClick={() => void act({ action: "call-next", window: win }, "Now serving {no}.")}>Call Next<kbd>N</kbd></button>
            <button type="button" disabled={busy || !serving} onClick={() => serving && void act({ action: "recall", ticketId: serving.id }, "Recalled {no}.")}>Recall<kbd>R</kbd></button>
            <button type="button" disabled={busy || !serving} onClick={() => serving && void act({ action: "done", ticketId: serving.id }, "{no} done.")}>Done<kbd>D</kbd></button>
            <button type="button" disabled={busy || !serving} onClick={() => serving && void act({ action: "no_show", ticketId: serving.id }, "{no} marked No-Show.")}>No-Show</button>
          </div>
        </section>
        <section className="qs-panel"><h2><span>{sharing.length ? `Waiting for Windows ${[win, ...sharing].sort().join(" and ")}` : `Waiting at Window ${win}`}</span><span>{waiting.length}</span></h2>
          {waiting.length ? waiting.map((t) => <div key={t.id} className="qs-row"><b className="q-mono">{t.ticket_no}</b><span>{t.full_name ?? "Walk-in"} <small>· {svc(t.service_code)}</small></span><small>{minutes(t.created_at)} min</small></div>) : <p className="q-note" style={{ padding: 14 }}>No one is waiting.</p>}
        </section>
      </div>
      <section className="qs-panel"><h2><span>Today</span></h2>
        <div className="qs-stats"><div><b>{d.stats.waiting}</b><small>Waiting Now</small></div><div><b>{d.stats.served}</b><small>Served</small></div><div><b>{d.stats.avgWait} min</b><small>Average Wait</small></div><div><b>{d.stats.noShows}</b><small>No-Shows</small></div>
          {others.length > 0 && <div className="qs-other">{others.map((t) => <span key={t.id}>Window {t.window_no}: <b className="q-mono">{t.ticket_no}</b></span>)}</div>}</div>
      </section>
    </div>
    </main>
  </div>;
}
