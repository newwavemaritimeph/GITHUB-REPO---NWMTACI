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

/** Voice settings for the monitor (owner, 10 Nov 2026: "Can I choose Text to Voice?"), kept on that monitor. */
export type VoiceSettings = { voice: string; rate: number; tagalog: boolean };
export const VOICE_KEY = "nw-queue-voice";
export const DEFAULT_VOICE: VoiceSettings = { voice: "", rate: 0.88, tagalog: false };
export function loadVoice(): VoiceSettings {
  try { return { ...DEFAULT_VOICE, ...JSON.parse(localStorage.getItem(VOICE_KEY) ?? "{}") }; } catch { return DEFAULT_VOICE; }
}
/** The voices this browser offers, English and Filipino first. */
export function listVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const rank = (l: string) => (l.startsWith("en") ? 0 : /^(fil|tl)/i.test(l) ? 1 : 2);
  return window.speechSynthesis.getVoices().slice().sort((a, b) => rank(a.lang) - rank(b.lang) || a.name.localeCompare(b.name));
}

/** Spoken calls one after another, never overlapping (queue plan §11). The chosen voice, else a Google or Microsoft English voice. */
const spoken: { text: string; s: VoiceSettings; lang?: "fil" }[] = [];
let speaking = false;
export function speak(text: string, s: VoiceSettings = DEFAULT_VOICE, lang?: "fil") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  spoken.push({ text, s, lang });
  if (speaking) return;
  const next = () => {
    const item = spoken.shift();
    if (!item) { speaking = false; return; }
    speaking = true;
    const u = new SpeechSynthesisUtterance(item.text), all = listVoices();
    const english = all.filter((v) => v.lang.startsWith("en")), filipino = all.find((v) => /^(fil|tl)/i.test(v.lang));
    u.voice = (item.lang === "fil" ? filipino : null) ?? all.find((v) => v.voiceURI === item.s.voice) ?? english.find((v) => /google|microsoft/i.test(v.name)) ?? english[0] ?? null;
    u.rate = item.s.rate;
    u.onend = next; u.onerror = next;
    window.speechSynthesis.speak(u);
  };
  next();
}
