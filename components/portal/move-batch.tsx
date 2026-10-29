"use client";

import { useState } from "react";
import { automaticEndDate, moveProblem } from "@/lib/scheduling";
import { Message, usePost } from "./shared-ui";

const fmt = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/** Move to New Dates (owner, 29 Oct 2026): any day but Sunday, before the batch starts; trainees are emailed. */
export function MoveBatch({ batch, durationLabel, trainees, reload, onMoved }: { batch: { id: string; status?: string | null; starts_on: string }; durationLabel: string; trainees: number; reload: () => Promise<void>; onMoved: (text: string) => void }) {
  const { busy, msg, post } = usePost(reload);
  const today = manilaToday();
  const [start, setStart] = useState(""), [reason, setReason] = useState(""), [notify, setNotify] = useState(true);
  const locked = moveProblem({ status: batch.status ?? "Open", startsOn: batch.starts_on, newStart: "9999-12-31", today, hasAttendance: false });
  if (locked) return <p className="portal-form-note full">{locked}</p>;
  const problem = start ? moveProblem({ status: batch.status ?? "Open", startsOn: batch.starts_on, newStart: start, today, hasAttendance: false }) : null;
  const end = start && !problem ? automaticEndDate(start, durationLabel) : "";
  const days: string[] = [];
  if (end) for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d = new Date(d.getTime() + 86400000)) days.push(d.toISOString().slice(0, 10));
  async function move() {
    const r = await post({ action: "batch-move", batchId: batch.id, startsOn: start, reason: reason.trim(), notify }) as { emailed?: number };
    onMoved(`Moved to ${start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`}${notify && r.emailed ? ` · ${r.emailed} trainee${r.emailed === 1 ? "" : "s"} emailed` : ""}.`);
  }
  return <div className="full mv-batch">
    <strong>Move to New Dates</strong>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="mv-grid">
      <label>New Start Date<input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} />{problem && <small className="field-error">{problem}</small>}</label>
      <label>Automatic End Date<input type="date" value={end} readOnly /></label>
    </div>
    {days.length > 0 && <div className="mv-days">{days.map((d) => <span key={d} className={new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? "off" : ""}>{fmt(d)}{new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? " · No Class" : ""}</span>)}</div>}
    <label>Reason<input value={reason} maxLength={200} placeholder="e.g. Holiday · Nov 30 Bonifacio Day" onChange={(e) => setReason(e.target.value)} /></label>
    <label className="portal-check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /><span>Email the {trainees} trainee{trainees === 1 ? "" : "s"} on this batch the new dates</span></label>
    <div className="portal-form-actions"><button type="button" className="portal-primary" disabled={busy || !end || reason.trim().length < 3} onClick={() => void move().catch(() => undefined)}>{busy ? "Moving…" : "Move Batch"}</button></div>
  </div>;
}
