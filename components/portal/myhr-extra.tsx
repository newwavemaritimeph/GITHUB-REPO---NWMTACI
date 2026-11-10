"use client";

import { useState } from "react";
import { Badge, Message } from "./shared-ui";
import { dueLabel, dueOf, HR_DEFAULTS, type HrSettings } from "@/lib/hr-due";
import type { Hr201 } from "@/lib/hr-server";
import { hrPost, shortDate, todayManila, toneOf, type HrCoe, type HrMemo, type HrRequest } from "./hr-people";

/** MyHR (owner, 10 Nov 2026): the employee's six-month checks, biodata review, Fit to Work upload and memos. */
export type MyHrExtras = { profile: Hr201 | null; memos: (HrMemo & { acknowledged_at: string | null })[]; requests: HrRequest[]; settings: HrSettings; coes?: HrCoe[] } | null;

/** The employee's own due items, for MyHR and the bell. */
export function myDueItems(x: MyHrExtras) {
  if (!x?.profile) return [];
  const s = x.settings ?? HR_DEFAULTS, today = todayManila(), p = x.profile;
  const fit = dueOf(p.fit_to_work_on, s.fit_to_work_months, s.first_reminder_days, today), bio = dueOf(p.biodata_confirmed_at, s.biodata_months, s.first_reminder_days, today);
  const out: { key: "fit" | "biodata" | "memo"; title: string; text: string; tone: string; label: string; id?: string }[] = [];
  if (!p.fit_to_work_pending_on && fit.state !== "Current") out.push({ key: "fit", title: "Medical Fit to Work", text: fit.due ? `Due ${shortDate(fit.due)} · every ${s.fit_to_work_months} months` : "No certificate on file yet", tone: toneOf(fit.state), label: dueLabel(fit) });
  if (bio.state !== "Current") out.push({ key: "biodata", title: "Review Your Biodata", text: bio.last ? `Last confirmed ${shortDate(bio.last)}` : "Not confirmed yet", tone: toneOf(bio.state), label: dueLabel(bio) });
  for (const m of x.memos.filter((m) => !m.acknowledged_at)) out.push({ key: "memo", id: m.id, title: `Memo ${m.memo_no}`, text: m.subject, tone: "blue", label: "Unread" });
  return out;
}

export function MyHrChecks({ x, employeeId, reload }: { x: MyHrExtras; employeeId?: string; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [file, setFile] = useState<File | null>(null), [certDate, setCertDate] = useState(""), [change, setChange] = useState(""), [asking, setAsking] = useState(false);
  if (!x?.profile) return null;
  const p = x.profile, s = x.settings ?? HR_DEFAULTS, today = todayManila();
  const fit = dueOf(p.fit_to_work_on, s.fit_to_work_months, s.first_reminder_days, today), bio = dueOf(p.biodata_confirmed_at, s.biodata_months, s.first_reminder_days, today);
  const act = async (key: string, f: () => Promise<unknown>, ok: string) => { setBusy(key); setMsg(null); try { await f(); await reload(); setMsg({ kind: "success", text: ok }); } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(""); } };
  const upload = () => act("fit", async () => {
    const form = new FormData(); form.set("file", file!); form.set("certificateDate", certDate);
    const r = await fetch("/api/staff/hr-files", { method: "POST", body: form }); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "Upload failed."); setFile(null); setCertDate("");
  }, "Uploaded. HR will check your certificate.");
  const pendingRequest = x.requests.find((r) => r.request_type === "201 Change" && r.status === "Pending");

  return <section className="portal-panel myhr-checks" id="myhr-checks">
    <div className="panel-heading"><div><h2>My 201 · Six-Month Checks</h2></div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="myhr-check">
      <div className="myhr-check-head"><div><strong>Medical Fit to Work</strong><small>{p.fit_to_work_on ? `Last ${shortDate(p.fit_to_work_on)} · due ${shortDate(fit.due)}` : "No certificate on file"}</small></div>
        {p.fit_to_work_pending_on ? <Badge tone="orange">For Checking</Badge> : <Badge tone={toneOf(fit.state)}>{dueLabel(fit)}</Badge>}</div>
      {p.fit_to_work_pending_on ? <small className="myhr-note">You uploaded a certificate dated {shortDate(p.fit_to_work_pending_on)}. HR is checking it.{employeeId && <> <a href={`/api/staff/hr-files?employeeId=${employeeId}&which=pending`} target="_blank" rel="noreferrer">View</a></>}</small>
        : <div className="myhr-upload"><label>Date on the Certificate<input type="date" max={today} value={certDate} onChange={(e) => setCertDate(e.target.value)} /></label><label>Certificate (PDF or Photo)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label><button type="button" className="portal-primary" disabled={!file || !certDate || !!busy} onClick={() => void upload()}>{busy === "fit" ? "Uploading…" : "Upload"}</button></div>}
    </div>
    <div className="myhr-check">
      <div className="myhr-check-head"><div><strong>Biodata Review</strong><small>{bio.last ? `Last confirmed ${shortDate(bio.last)} · next ${shortDate(bio.due)}` : "Not confirmed yet"}</small></div><Badge tone={toneOf(bio.state)}>{dueLabel(bio)}</Badge></div>
      <small className="myhr-note">Every {s.biodata_months} months, check that your address, mobile, civil status and emergency contact are still correct.</small>
      {pendingRequest ? <small className="myhr-note">Your change request {pendingRequest.request_no} is waiting for HR.</small>
        : <div className="myhr-acts"><button type="button" className="portal-primary" disabled={!!busy} onClick={() => void act("bio", () => hrPost({ action: "myhr-biodata-confirm" }), "Thank you. Your biodata is confirmed.")}>{busy === "bio" ? "Saving…" : "Confirm No Changes"}</button><button type="button" className="portal-secondary" onClick={() => setAsking(!asking)}>Request a Change</button></div>}
      {asking && !pendingRequest && <div className="myhr-upload"><label className="full">What Changed<textarea rows={3} value={change} onChange={(e) => setChange(e.target.value)} placeholder="e.g. New address: …; new emergency contact: …" /></label><button type="button" className="portal-primary" disabled={change.trim().length < 5 || !!busy} onClick={() => void act("req", async () => { await hrPost({ action: "myhr-request-file", requestType: "201 Change", details: change.trim() }); setChange(""); setAsking(false); }, "Sent to HR.")}>{busy === "req" ? "Sending…" : "Send to HR"}</button></div>}
    </div>
  </section>;
}

export function MyHrMemos({ x, reload }: { x: MyHrExtras; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  if (!x) return null;
  return <section className="portal-panel live-list" id="myhr-memos">
    <div className="panel-heading"><div><h2>Memos</h2></div><Badge tone={x.memos.some((m) => !m.acknowledged_at) ? "orange" : "green"}>{x.memos.filter((m) => !m.acknowledged_at).length} Unread</Badge></div>
    {err && <Message kind="error" text={err} />}
    {x.memos.map((m) => <div key={m.id} className="myhr-memo">
      <div className="myhr-check-head"><div><strong>{m.subject}</strong><small>{m.memo_no} · {m.memo_type} · {shortDate(m.issued_at)}</small></div><Badge tone={m.acknowledged_at ? "green" : "red"}>{m.acknowledged_at ? "Acknowledged" : "Unread"}</Badge></div>
      <p>{m.body}</p>
      <a className="hr-link" href={`/api/documents/hr?type=memo&id=${m.id}`} target="_blank" rel="noreferrer">View PDF</a>
      {m.acknowledged_at ? <small className="myhr-note">You acknowledged this on {shortDate(m.acknowledged_at)}.</small>
        : <button type="button" className="portal-primary" disabled={!!busy} onClick={async () => { setBusy(m.id); setErr(""); try { await hrPost({ action: "memo-ack", memoId: m.id }); await reload(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(""); } }}>{busy === m.id ? "Saving…" : "I Have Read and Understood"}</button>}
    </div>)}
    {!x.memos.length && <p className="portal-empty-copy">No memos yet.</p>}
  </section>;
}

/** Certificate of Employment (owner, 10 Nov 2026): request with a purpose; HR issues it within 3 days. */
export function MyHrCoe({ x, reload }: { x: MyHrExtras; reload: () => Promise<void> }) {
  const [purpose, setPurpose] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  if (!x) return null;
  const rows = x.coes ?? [], waiting = rows.some((c) => c.status === "Pending");
  return <section className="portal-panel">
    <div className="panel-heading"><h2>Certificate of Employment</h2></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {!waiting && <div className="portal-form hr-form"><label className="full">Purpose<input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Bank loan, visa application" /></label>
      <div className="portal-form-actions full"><button type="button" className="portal-primary" disabled={busy || purpose.trim().length < 3} onClick={async () => { setBusy(true); setMsg(null); try { await hrPost({ action: "myhr-coe-request", purpose: purpose.trim() }); setPurpose(""); await reload(); setMsg({ kind: "success", text: "Sent to HR. You get it within 3 days." }); } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not send." }); } finally { setBusy(false); } }}>{busy ? "Sending…" : "Request COE"}</button></div></div>}
    <h3 className="hr-sub">My Requests</h3>
    <div className="live-list">{rows.map((c) => <div className="live-row-item" key={c.id}><div><strong>{c.purpose}</strong><small>{c.coe_no ? `${c.coe_no} · ` : ""}Requested {shortDate(c.requested_at)}</small></div>
      <span className="hr-acts"><Badge tone={c.status === "Issued" ? "green" : c.status === "Rejected" ? "red" : "orange"}>{c.status === "Pending" ? "With HR" : c.status}</Badge>{c.status === "Issued" && <a className="portal-secondary row-act" href={`/api/documents/hr?type=coe&id=${c.id}`} target="_blank" rel="noreferrer">View</a>}</span></div>)}
      {!rows.length && <p className="portal-empty-copy">No requests yet.</p>}</div>
  </section>;
}
