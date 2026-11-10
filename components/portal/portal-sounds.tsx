"use client";

import { useState } from "react";
import { Message } from "./shared-ui";
import { playChime, unlockChime, SOUND_ROLES } from "@/lib/portal-alerts";

const NAMES: Record<(typeof SOUND_ROLES)[number], [string, string]> = {
  registration: ["Registration", "New registrations from the website and walk-ins"],
  cashier: ["Cashier", "New payment proofs and hand-overs from Registration"],
  releasing_officer: ["Releasing Officer", "New certificates ready"],
  mismo_officer: ["MISMO Compliance Officer", "New enrollments"],
};

/** Admin › Configuration › Portal Sounds (owner, 10 Nov 2026): the new-arrival chime per role, on by default. */
export function PortalSounds({ value, reload }: { value?: Record<string, boolean> | null; reload: () => Promise<void> }) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(SOUND_ROLES.map((r) => [r, value?.[r] !== false])));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  return <div className="portal-page hr-page">
    <div className="portal-heading hr-head"><div><span className="portal-eyebrow">Configuration</span><h1>Portal Sounds</h1></div>
      <div className="hr-head-acts"><button type="button" className="portal-secondary" onClick={() => { unlockChime(); playChime(); }}>Play Sound</button>
        <button type="button" className="portal-primary" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          try { const r = await fetch("/api/admin/portal-sound", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sound: on }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Could not save."); await reload(); setMsg({ kind: "success", text: "Saved. Each role hears the chime as set here." }); }
          catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(false); }
        }}>{busy ? "Saving…" : "Save"}</button></div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <section className="portal-panel">
      {SOUND_ROLES.map((r) => <label key={r} className="hr-row sound-row"><div><strong>{NAMES[r][0]}</strong><small>{NAMES[r][1]}</small></div>
        <span className="sound-switch"><input type="checkbox" role="switch" checked={on[r]} onChange={(e) => setOn({ ...on, [r]: e.target.checked })} /><span>{on[r] ? "Sound On" : "Sound Off"}</span></span></label>)}
    </section>
  </div>;
}
