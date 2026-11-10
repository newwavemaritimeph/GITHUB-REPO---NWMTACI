"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playChime, unlockChime } from "@/lib/portal-alerts";
import { windowsText } from "@/lib/queue";
import { useQueueLive } from "./use-queue-live";
import { QueueHead } from "./queue-brand";

type Status = { ticket_no: string; service: string; status: "waiting" | "serving" | "done" | "no_show" | "cancelled"; window_no: number | null; windows?: number[]; window_name: string | null; ahead_count: number };

/** /t/{token} (queue plan §10; Bright Wave, owner 10 Nov 2026): the number, how many are ahead, then "Go to Window N". */
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
  if (missing) return <main className="q-wrap"><QueueHead sub="Queue" /><section className="q-body"><h1>Ticket Not Found</h1><p className="q-note">Check the link, or ask at the front desk.</p></section></main>;
  if (!t) return <main className="q-wrap"><QueueHead sub="Queue" /><section className="q-body"><p className="q-note">Loading your ticket…</p></section></main>;
  if (t.status === "serving") return <main className="q-wrap" onPointerDown={unlockChime} aria-live="polite">
    <QueueHead sub="Your Turn" turn />
    <section className="q-turn"><div className="q-no q-mono">{t.ticket_no}</div><div style={{ fontSize: 18 }}>It&apos;s your turn. Please go to</div><div className="q-win">Window {t.window_no}</div><div>{t.window_name}</div></section>
  </main>;
  const line = windowsText(t.windows?.length ? t.windows : t.window_no ? [t.window_no] : []);
  return <main className="q-wrap" onPointerDown={unlockChime}>
    <QueueHead sub="Your Number" />
    <section className="q-body">
      <div className="q-card" aria-live="polite">
        <div className="q-no q-mono">{t.ticket_no}</div>
        <div className="q-svc">{t.service} · {t.window_name ? `${t.window_name} · ` : ""}{line}</div>
        {t.status === "waiting" && <>
          <span className="q-pill">Waiting</span>
          <div className="q-ahead" aria-hidden="true">{Array.from({ length: Math.min(t.ahead_count, 4) }, (_, k) => <span key={k}>{k + 1}</span>)}<span className="you">You</span></div>
          <p className="q-big">{t.ahead_count === 0 ? "You are next." : `${t.ahead_count} ahead of you`}</p>
        </>}
        {t.status === "done" && <><span className="q-pill">Served</span><p className="q-big">Thank you!</p></>}
        {t.status === "no_show" && <><span className="q-pill">Missed</span><p className="q-big">Missed your call. Please approach the front desk.</p></>}
        {t.status === "cancelled" && <><span className="q-pill">Cancelled</span><p className="q-big">This ticket was cancelled.</p></>}
      </div>
      <p className="q-note">Keep this page open. You can also watch the screen in the office.</p>
    </section>
  </main>;
}
