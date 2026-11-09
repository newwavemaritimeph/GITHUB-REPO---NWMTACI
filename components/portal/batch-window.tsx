"use client";

import { useEffect, useState } from "react";
import { Badge, Message, Modal, fmtDate, submit } from "./shared-ui";
import { RecordEditor } from "./completion-records";
import { manilaToday, pesos2 } from "@/lib/portal-format";
import { downloadCsv } from "@/lib/csv";
import type { BatchRoster } from "@/lib/batch-roster";
import { MISMO_COURSE_CODES, finalList, mismoCopyText, mismoCsv, mismoListed, mismoMissing, mismoState, paidLate, type MismoBatch, type MismoTrainee } from "@/lib/mismo";

/** Manila hour now (0–23). */
export const manilaHour = () => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Manila" }).format(new Date()));
export const mismoPdfUrl = (date: string, list: "final" | "unsettled", batch?: string) => `/api/documents/mismo?date=${date}&list=${list}${batch ? `&batch=${batch}` : ""}`;
export function saveCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
/** The MARINA MISMO column shows for the MISMO Compliance Officer and the Admin, on the STCW courses (owner, 9 Nov 2026). */
export const mismoInWindow = (role: string | undefined, courseCode: string) => (role === "admin" || role === "mismo_officer") && MISMO_COURSE_CODES.includes(courseCode);

const spanOf = (r: { startsOn: string; endsOn: string }) => (r.startsOn === r.endsOn ? fmtDate(r.startsOn) : `${fmtDate(r.startsOn)} – ${fmtDate(r.endsOn)}`);
const shortDay = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso));

/** One trainee's MARINA MISMO cell: Copy and Encoded once paid with full details (owner, 9 Nov 2026: "Move this Copy (Encoded) to the window, per batch"). */
export function MismoCell({ t, copied, busy, onCopy, onEncode, onUndo, onAdd }: { t: MismoTrainee; copied: boolean; busy: boolean; onCopy: () => void; onEncode: () => void; onUndo: () => void; onAdd: () => void }) {
  const state = mismoState(t);
  const badges = <>{paidLate(t) && <Badge tone="orange">Paid Late</Badge>}{t.movedFrom && <span title={`Encoded under ${t.movedFrom}. Correct the entry in MARINA.`}><Badge tone="orange">{`Moved · Was ${t.movedFrom}`}</Badge></span>}</>;
  if (state === "Unpaid") return <Badge tone="red">Not Paid</Badge>;
  if (state === "Encoded") return <span className="cl-acts bw-mm"><span className="bw-done">Encoded · {shortDay(t.entryAt ?? manilaToday())}</span><button type="button" className="st-b" disabled={busy} onClick={onUndo}>Undo</button>{badges}</span>;
  if (state === "For Completion") return <span className="cl-acts bw-mm">{mismoMissing(t).map((m) => <span key={m} className="st-need">{m}</span>)}<button type="button" className="st-b p" onClick={onAdd}>Add Details</button>{badges}</span>;
  return <span className="cl-acts bw-mm"><button type="button" className="st-b" onClick={onCopy}>{copied ? "Copied" : "Copy"}</button><label className="ms-tick"><input type="checkbox" checked={false} disabled={busy} onChange={onEncode} /> Encoded</label>{badges}</span>;
}

/** A missing SRN or birth date, added by the officer and saved in the audit log (owner, 5 Nov 2026). */
function AddDetails({ t, onClose, onSaved }: { t: MismoTrainee; onClose: () => void; onSaved: () => void }) {
  const need = mismoMissing(t), [srn, setSrn] = useState(""), [birthdate, setBirthdate] = useState(""), [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  async function save() {
    setBusy(true); setProblem("");
    try { await submit({ action: "mismo-details", enrollmentId: t.enrollmentId, ...(srn.trim() ? { srn: srn.trim() } : {}), ...(birthdate ? { birthdate } : {}) }); onSaved(); }
    catch (e) { setProblem(e instanceof Error ? e.message : "Could not save."); setBusy(false); }
  }
  return <Modal title={`Add Details · ${t.lastName}, ${t.firstName}`} onClose={onClose}><div className="portal-form">
    {problem && <div className="full"><Message kind="error" text={problem} /></div>}
    {need.includes("SRN") && <label>SRN<input inputMode="numeric" maxLength={20} value={srn} onChange={(e) => setSrn(e.target.value)} /></label>}
    {need.includes("Birth Date") && <label>Birth Date<input type="date" max={manilaToday()} value={birthdate} onChange={(e) => setBirthdate(e.target.value)} /></label>}
    <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || (!srn.trim() && !birthdate)} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></div>
  </div></Modal>;
}

/**
 * The Batch window (owner, 3 Nov 2026): every trainee on one batch, from the database, with Copy List, Excel and PDF.
 * With `mismo`, each trainee also has the MARINA MISMO cell and the batch has its MARINA documents (owner, 9 Nov 2026).
 */
export function BatchWindow({ batchId, batchNumber, mismo = false, onClose, onChanged }: { batchId: string; batchNumber: string; mismo?: boolean; onClose: () => void; onChanged?: () => void }) {
  const [roster, setRoster] = useState<BatchRoster | null>(null), [error, setError] = useState(""), [find, setFind] = useState(""), [note, setNote] = useState(""), [copyBox, setCopyBox] = useState("");
  const [marina, setMarina] = useState<MismoBatch | null>(null), [marinaTick, setMarinaTick] = useState(0), [problem, setProblem] = useState("");
  // A tick shows at once: the officer works through many in a row and should not wait on each save.
  const [ticked, setTicked] = useState<Record<string, string | null>>({}), [busy, setBusy] = useState(""), [copied, setCopied] = useState(""), [adding, setAdding] = useState<MismoTrainee | null>(null), [record, setRecord] = useState(false);
  useEffect(() => { let live = true; fetch(`/api/staff/batch-roster?batchId=${batchId}`, { cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Could not load the trainees."); if (live) setRoster(b as BatchRoster); }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Could not load the trainees."); }); return () => { live = false; }; }, [batchId]);
  const from = roster?.batch.startsOn, to = roster?.batch.endsOn;
  useEffect(() => {
    if (!mismo || !from || !to) return;
    let live = true;
    fetch(`/api/staff/mismo?date=${from}&to=${to}`, { cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Could not load the MARINA MISMO list."); if (live) setMarina((b.batches as MismoBatch[]).find((x) => x.id === batchId) ?? { id: batchId, batchNumber, courseName: "", courseCode: "", startsOn: from, endsOn: to, room: null, instructor: null, trainees: [], submittedAt: null, submittedCount: null }); })
      .catch((e: unknown) => { if (live) setProblem(e instanceof Error ? e.message : "Could not load the MARINA MISMO list."); });
    return () => { live = false; };
  }, [mismo, from, to, batchId, batchNumber, marinaTick]);
  const t = find.trim().toLowerCase();
  const rows = (roster?.rows ?? []).filter((r) => !t || `${r.name} ${r.nwmtaciNo} ${r.srn} ${r.mobile}`.toLowerCase().includes(t));
  const payText = (r: BatchRoster["rows"][number]) => (r.payment === "Balance" ? `Balance ${pesos2(r.balanceCentavos)}` : r.payment);
  const b = roster?.batch, enrolled = (roster?.rows ?? []).filter((r) => r.status !== "Pending").length, pending = (roster?.rows.length ?? 0) - enrolled;
  const trainees = new Map((marina?.trainees ?? []).map((x) => [x.enrollmentId, x.enrollmentId in ticked ? { ...x, entryAt: ticked[x.enrollmentId], movedFrom: ticked[x.enrollmentId] ? null : x.movedFrom } : x]));
  async function copy() {
    const text = (roster?.rows ?? []).map((r, i) => `${i + 1}. ${r.name} · ${r.nwmtaciNo}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopyBox(""); setNote(`Copied ${roster?.rows.length ?? 0} names. Paste them in Messenger or Viber.`); } catch { setCopyBox(text); }
  }
  async function copyOne(x: MismoTrainee) {
    if (!marina) return;
    try { await navigator.clipboard.writeText(mismoCopyText(x, marina)); setCopied(x.enrollmentId); window.setTimeout(() => setCopied((c) => (c === x.enrollmentId ? "" : c)), 1400); }
    catch { setProblem("The browser refused to copy. Select the row and copy it by hand."); }
  }
  async function mark(x: MismoTrainee, done: boolean) {
    setProblem(""); setBusy(x.enrollmentId);
    const before = ticked;
    setTicked({ ...ticked, [x.enrollmentId]: done ? new Date().toISOString() : null });
    try { await submit({ action: "mismo-entry", enrollmentId: x.enrollmentId, done }); onChanged?.(); }
    catch (e) { setTicked(before); setProblem(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(""); }
  }
  const csv = () => roster && downloadCsv(`batch-${roster.batch.batchNumber}.csv`, [["#", "Trainee", "NWMTACI No.", "SRN", "Rank", "Mobile", "Email", "Meta Thread", "Source", "Status", "Payment", "Requirements"], ...roster.rows.map((r, i) => [i + 1, r.name, r.nwmtaciNo, r.srn, r.rank, r.mobile, r.email, r.facebook, r.source, r.status, payText(r), `${r.requirements} of 4`])]);
  const today = manilaToday(), hour = manilaHour();
  const listed = [...trainees.values()].filter(mismoListed), encoded = listed.filter((x) => x.entryAt).length;
  const cut = b?.startsOn ?? today, finalReady = cut < today || (cut === today && hour >= 16), inClass = !!b && b.startsOn <= today && today <= b.endsOn;
  const cols = mismo ? 11 : 10;
  return <Modal title={`Batch ${batchNumber}`} onClose={onClose} wide><div className="portal-form br">
    {error && <Message kind="error" text={error} />}
    {problem && <Message kind="error" text={problem} />}
    {note && <Message kind="success" text={note} />}
    {!roster && !error && <p className="portal-empty-copy">Loading the trainees…</p>}
    {b && roster && <>
      <div className="br-head full">
        <div><span>Course</span><b>{b.code}</b><small>{b.course}</small></div>
        <div><span>Dates</span><b>{spanOf({ startsOn: b.startsOn, endsOn: b.endsOn })}</b><small>{[b.dailyStart?.slice(0, 5), b.dailyEnd?.slice(0, 5)].filter(Boolean).join(" – ") || "8:00 – 17:00"}</small></div>
        <div><span>Room · Instructor</span><b>{b.room ?? "To be assigned"}</b><small>{b.instructor ?? "No instructor yet"}</small></div>
        <div><span>Trainees</span><b>{enrolled} enrolled · {pending} pending</b><small>{Math.max(0, b.capacity - b.held)} slots left of {b.capacity}</small></div>
      </div>
      <div className="br-tools full"><label>Find<input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name, NWMTACI No., SRN, mobile" /></label><span className="br-acts"><button type="button" className="portal-secondary" disabled={!roster.rows.length} onClick={() => void copy()}>Copy List</button><button type="button" className="portal-secondary" disabled={!roster.rows.length} onClick={csv}>Download Excel</button><a className="portal-primary" href={`/api/documents/batch-roster?batchId=${batchId}`} target="_blank" rel="noreferrer">Print / Save PDF</a></span></div>
      {mismo && <div className="bw-marina full"><b>For MARINA</b>
        {finalReady ? <><a className="portal-secondary" href={mismoPdfUrl(cut, "final", batchId)} target="_blank" rel="noreferrer">Final List PDF</a><button type="button" className="portal-secondary" disabled={!marina || !finalList(marina).length} onClick={() => marina && saveCsv(`MISMO-${batchNumber}-${cut}.csv`, mismoCsv(marina))}>CSV for MARINA</button></>
          : <span className="st-need">Final List · 4:00 PM {cut === today ? "Today" : shortDay(cut)}</span>}
        {inClass && (hour >= 11 ? <a className="portal-secondary" href={mismoPdfUrl(today, "unsettled", batchId)} target="_blank" rel="noreferrer">11:00 AM Unpaid</a> : <span className="st-need">11:00 AM Unpaid · Opens at 11:00 AM</span>)}
        <button type="button" className="portal-secondary" onClick={() => setRecord((r) => !r)}>{record ? "Hide Completion Record" : "Completion Record"}</button>
        {marina && <Badge tone={listed.length && encoded === listed.length ? "green" : "orange"}>{`${encoded} of ${listed.length} Encoded`}</Badge>}
      </div>}
      {mismo && record && <div className="full"><RecordEditor batchId={batchId} onSaved={() => undefined} /></div>}
      {copyBox && <div className="sa-copybox full"><textarea readOnly rows={Math.min(14, copyBox.split("\n").length + 1)} value={copyBox} onFocus={(e) => e.currentTarget.select()} aria-label="Trainee list to copy" /><button type="button" className="portal-secondary" onClick={() => setCopyBox("")}>Close</button></div>}
      <div className="cl-wrap full"><table className="cl-log"><thead><tr><th>#</th><th>Trainee</th><th>NWMTACI No.</th><th>SRN</th><th>Rank</th><th>Mobile</th><th>Source</th><th>Status</th><th>Payment</th><th>Requirements</th>{mismo && <th>MARINA MISMO</th>}</tr></thead><tbody>
        {rows.map((r, i) => { const x = trainees.get(r.enrollmentId); return <tr key={r.enrollmentId}><td>{i + 1}</td><td><b>{r.name}</b></td><td className="cl-mono">{r.nwmtaciNo}</td><td className="cl-mono">{r.srn || "—"}</td><td>{r.rank || "—"}</td><td className="cl-mono">{r.mobile || "—"}</td><td>{r.source}</td>
          <td><Badge tone={r.status === "Pending" ? "orange" : "active"}>{r.status}</Badge></td>
          <td><Badge tone={r.payment === "Paid" ? "active" : r.payment === "Company Charge" ? "blue" : r.payment === "Balance" ? "orange" : "red"}>{payText(r)}</Badge></td><td>{r.requirements} of 4</td>
          {mismo && <td className="bw-cell">{x ? <MismoCell t={x} copied={copied === x.enrollmentId} busy={busy === x.enrollmentId} onCopy={() => void copyOne(x)} onEncode={() => void mark(x, true)} onUndo={() => void mark(x, false)} onAdd={() => setAdding(x)} /> : marina ? "—" : <small className="cl-sub">Loading…</small>}</td>}</tr>; })}
        {!rows.length && <tr><td colSpan={cols} className="portal-empty-copy">{roster.rows.length ? "No trainee matches." : "No trainees on this batch yet."}</td></tr>}
      </tbody></table></div>
      <p className="portal-form-note full">Cancelled enrollments are left out.{mismo ? " Trainees not yet paid appear only on the instructor's 11:00 AM printout." : ""}</p>
    </>}
    {adding && <AddDetails t={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); setMarinaTick((n) => n + 1); onChanged?.(); }} />}
  </div></Modal>;
}
