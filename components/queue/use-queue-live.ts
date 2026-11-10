"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { QUEUE_CHANNEL, type QueueBroadcast } from "@/lib/queue";

/**
 * Live queue events (queue plan §4): the public Realtime broadcast, plus a poll every `pollMs` so a missed message or a
 * dropped connection only delays an update. `online` turns false when the channel drops; on reconnect `onEvent(null)`
 * asks the page to fetch the whole state again.
 */
export function useQueueLive(onEvent: (e: QueueBroadcast | null) => void, pollMs = 15000) {
  const handler = useRef(onEvent);
  useEffect(() => { handler.current = onEvent; });
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let client: ReturnType<typeof createSupabaseBrowserClient> | null = null;
    try { client = createSupabaseBrowserClient(); } catch { client = null; }
    const channel = client?.channel(QUEUE_CHANNEL).on("broadcast", { event: "queue" }, (msg) => handler.current(msg.payload as QueueBroadcast)).subscribe((status) => {
      const ok = status === "SUBSCRIBED";
      setOnline((was) => { if (ok && !was) handler.current(null); return ok || status === "CLOSED" ? ok : false; });
    });
    const poll = setInterval(() => handler.current(null), pollMs);
    const back = () => { setOnline(true); handler.current(null); };
    const gone = () => setOnline(false);
    window.addEventListener("online", back); window.addEventListener("offline", gone);
    return () => { clearInterval(poll); window.removeEventListener("online", back); window.removeEventListener("offline", gone); if (channel) void client?.removeChannel(channel); };
  }, [pollMs]);
  return online;
}

/** Spoken calls one after another, never overlapping (queue plan §11): English voice, rate 0.88. */
const spoken: string[] = [];
let speaking = false;
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  spoken.push(text);
  if (speaking) return;
  const next = () => {
    const line = spoken.shift();
    if (!line) { speaking = false; return; }
    speaking = true;
    const u = new SpeechSynthesisUtterance(line);
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    u.voice = voices.find((v) => /google|microsoft/i.test(v.name)) ?? voices[0] ?? null;
    u.rate = 0.88;
    u.onend = next; u.onerror = next;
    window.speechSynthesis.speak(u);
  };
  next();
}
