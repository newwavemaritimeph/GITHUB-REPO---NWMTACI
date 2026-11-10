"use client";

import { useMemo, useState } from "react";
import { Badge, Message } from "./shared-ui";
import { dueLabel, type DueItem } from "@/lib/hr-due";
import { hrPost, shortDate, toneOf } from "./hr-people";
import type { myDueItems } from "./myhr-extra";

/**
 * Notification bell, Design 3 (owner, 10 Nov 2026): a drawer from the right (a bottom sheet on phones).
 * HR and the Admin get Fit to Work and Biodata tabs with tick-boxes and Remind Selected; everyone gets
 * their own reminders (My Reminders) and the usual notifications.
 */
type Note = { id: string; title: string; body: string; read_at?: string | null; created_at: string };
type Tab = "Fit to Work" | "Biodata" | "Mine" | "Notifications";

export function bellCount(hrDue: DueItem[], mine: ReturnType<typeof myDueItems>, unread: number) {
  return unread + mine.length + hrDue.filter((d) => d.state === "Overdue" || d.state === "Missing" || d.state === "For Checking").length;
}

export function BellDrawer({ hrDue, mine, notes, onClose, markRead, openHr, openMyHr, reload }: {
  hrDue: DueItem[] | null; mine: ReturnType<typeof myDueItems>; notes: Note[]; onClose: () => void; markRead: () => Promise<void>;
  openHr: () => void; openMyHr: () => void; reload: () => Promise<void>;
}) {
  const tabs: Tab[] = [...(hrDue ? (["Fit to Work", "Biodata"] as Tab[]) : []), ...(mine.length ? (["Mine"] as Tab[]) : []), "Notifications"];
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const kind = tab === "Fit to Work" ? "fit" : "biodata";
  const rows = useMemo(() => (hrDue ?? []).filter((d) => d.kind === kind && d.state !== "Current"), [hrDue, kind]);
  const selected = rows.filter((r) => picked[`${kind}:${r.employeeId}`] && r.state !== "For Checking");
  const count = (t: Tab) => t === "Mine" ? mine.length : t === "Notifications" ? notes.filter((n) => !n.read_at).length : (hrDue ?? []).filter((d) => d.kind === (t === "Fit to Work" ? "fit" : "biodata") && d.state !== "Current").length;

  async function remind() {
    setBusy(true); setMsg(null);
    try {
      const r = await hrPost({ action: "hr-remind", kind: kind === "fit" ? "fit_to_work" : "biodata", employeeIds: selected.map((s) => s.employeeId) });
      setPicked({}); await reload();
      setMsg({ kind: "success", text: `Reminder sent to ${r.sent} employee${r.sent === 1 ? "" : "s"} in MyHR and by e-mail.${r.noAccount?.length ? ` No account or e-mail: ${r.noAccount.join(", ")}.` : ""}` });
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not send." }); }
    finally { setBusy(false); }
  }

  return <>
    <div className="bell-bg" onClick={onClose} />
    <aside className="bell-drawer" role="dialog" aria-label="Notifications">
      <i className="bell-grab" aria-hidden="true" />
      <div className="bell-head"><b>Notifications</b><button type="button" className="bell-x" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="bell-tabs" role="tablist">{tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); setMsg(null); }}>{t === "Mine" ? "My Reminders" : t}{count(t) > 0 && <span>{count(t)}</span>}</button>)}</div>
      {msg && <div className="bell-msg"><Message kind={msg.kind} text={msg.text} /></div>}
      <div className="bell-list">
        {(tab === "Fit to Work" || tab === "Biodata") && <>
          {rows.map((r) => { const key = `${kind}:${r.employeeId}`, checking = r.state === "For Checking"; return <label key={key} className="bell-row">
            <input type="checkbox" disabled={checking} checked={!!picked[key]} onChange={(e) => setPicked({ ...picked, [key]: e.target.checked })} />
            <span><b>{r.name}</b><small>{checking ? "New certificate waiting for checking" : r.last ? `${r.kind === "fit" ? "Last certificate" : "Last confirmed"} ${shortDate(r.last)}${r.due ? ` · due ${shortDate(r.due)}` : ""}` : r.kind === "fit" ? "No certificate on file" : "Never confirmed"}</small></span>
            <Badge tone={toneOf(r.state)}>{dueLabel(r)}</Badge>
          </label>; })}
          {!rows.length && <p className="portal-empty-copy">Everyone is up to date.</p>}
        </>}
        {tab === "Mine" && mine.map((m, i) => <div key={i} className="bell-row"><span className={`bell-ic ${m.key}`}>{m.key === "fit" ? "FW" : m.key === "biodata" ? "BD" : "✉"}</span><span><b>{m.title}</b><small>{m.text}</small></span><button type="button" className="portal-primary row-act" onClick={openMyHr}>{m.key === "fit" ? "Upload" : m.key === "biodata" ? "Review" : "Read"}</button></div>)}
        {tab === "Notifications" && <>
          {notes.map((n) => <div key={n.id} className={`bell-row${n.read_at ? "" : " unread"}`}><span className="bell-dot" aria-hidden="true" /><span><b>{n.title}</b><small>{n.body}</small></span><small className="bell-when">{shortDate(n.created_at)}</small></div>)}
          {!notes.length && <p className="portal-empty-copy">No notifications yet.</p>}
        </>}
      </div>
      <div className="bell-foot">
        {(tab === "Fit to Work" || tab === "Biodata") && <><button type="button" className="portal-primary" disabled={!selected.length || busy} onClick={() => void remind()}>{busy ? "Sending…" : `Remind Selected${selected.length ? ` (${selected.length})` : ""}`}</button><button type="button" className="portal-secondary" onClick={openHr}>Open 201</button></>}
        {tab === "Notifications" && <button type="button" className="portal-secondary" onClick={() => void markRead()}>Mark All as Read</button>}
        {tab === "Mine" && <button type="button" className="portal-primary" onClick={openMyHr}>Open MyHR</button>}
      </div>
    </aside>
  </>;
}
