"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playChime, unlockChime } from "@/lib/portal-alerts";
import { useQueueLive } from "./use-queue-live";

type Status = { ticket_no: string; service: string; status: "waiting" | "serving" | "done" | "no_show" | "cancelled"; window_no: number; window_name: string | null; ahead_count: number };

/** /t/{token} (queue plan §10): the big number, then "N ahead of you", then "Your turn, go to Window N". */
export function QueueTicket({ token }: { token: string }) {
  const [t, setT] = useState<Status | null>(null), [missing, setMissing] = useState(false);
  const was = useRef<string>("");
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/queue/ticket/${token}`, { cache: "no-store" });
      if (r.status === 404) { setMissing(true); return; }
      if (r.ok) setT(await r.json());
    } catch { /* the next event or poll tries again */ }
  }, [token]);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);
  useQueueLive(() => void load(), 10000);
  useEffect(() => {
    if (!t) return;
    if (t.status === "serving" && was.current && was.current !== "serving") {
      try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch { /* not supported */ }
      if (document.visibilityState === "visible") playChime();
    }
    was.current = t.status;
  }, [t]);
  if (missing) return <main className="q-wrap"><section className="q-card"><h1>Ticket Not Found</h1><p className="q-note">Check the link, or ask at the front desk.</p></section></main>;
  if (!t) return <main className="q-wrap"><p className="q-note">Loading your ticket…</p></main>;
  const turn = t.status === "serving";
  return <main className="q-wrap" onPointerDown={unlockChime}>
    <div className="q-brand"><img src="/new-wave-emblem.png" alt="" />New Wave Maritime · Queue</div>
    <section className={`q-card q-ticket${turn ? " q-turn" : ""}`} aria-live="polite">
      <div className="q-no">{t.ticket_no}</div>
      <div className="q-svc">{t.service} · Window {t.window_no}{t.window_name ? ` · ${t.window_name}` : ""}</div>
      {t.status === "waiting" && <><span className="q-pill">Waiting</span><p className="q-big">{t.ahead_count === 0 ? "You are next." : `${t.ahead_count} ahead of you.`}</p></>}
      {turn && <><span className="q-pill">Your Turn</span><p className="q-big">Go to Window {t.window_no}.</p></>}
      {t.status === "done" && <><span className="q-pill">Served</span><p className="q-big">Thank you!</p></>}
      {t.status === "no_show" && <><span className="q-pill">Missed</span><p className="q-big">Missed your call. Please approach the front desk.</p></>}
      {t.status === "cancelled" && <><span className="q-pill">Cancelled</span><p className="q-big">This ticket was cancelled.</p></>}
    </section>
    <p className="q-note">Keep this page open. You can also watch the screen in the office.</p>
  </main>;
}
