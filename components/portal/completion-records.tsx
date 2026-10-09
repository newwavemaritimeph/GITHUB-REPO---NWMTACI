"use client";

import { useEffect, useMemo, useState } from "react";
import { completionProblems, durationText, emptyResult, formDate, numberSeries, practicalDone, practicalOk, remarkOf, resultOf, type AssessmentTask, type CompletionFields, type TraineeResult } from "@/lib/completion-record";
import type { CompletionBatch, CompletionPayload } from "@/lib/completion-record-server";
import { Badge, Message } from "./shared-ui";

/**
 * MISMO › Completion Records (owner, 9 Oct 2026): the Training Completion and
 * Record of Assessment Report per STCW batch. Trainee details come from the
 * portal; class number, places, written %, the practical checklist, MTI
 * certificate numbers, assessor, training director and dates are encoded here.
 */

const API = "/api/staff/completion-records";
const TONE: Record<CompletionBatch["status"], string> = { "Not Started": "orange", Draft: "orange", Ready: "blue", Printed: "green" };
const LABEL: Record<CompletionBatch["status"], string> = { "Not Started": "Not Started", Draft: "Draft", Ready: "Ready to Print", Printed: "Printed" };

function useLoad<T>(url: string | null, tick: number) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  const key = `${url}#${tick}`;
  useEffect(() => {
    if (!url) return;
    let live = true;
    void fetch(url, { cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Could not load."); if (live) setState({ key: `${url}#${tick}`, data: b as T, error: "" }); })
      .catch((e) => { if (live) setState({ key: `${url}#${tick}`, data: null, error: e instanceof Error ? e.message : "Could not load." }); });
    return () => { live = false; };
  }, [url, tick]);
  const same = state.key.split("#")[0] === url;
  return { data: same ? state.data : null, error: state.key === key ? state.error : "", loading: state.key !== key };
}

export function CompletionRecords({ eyebrow = "MISMO" }: { eyebrow?: string }) {
  const [tick, setTick] = useState(0), [pick, setPick] = useState<string | null>(null), [filter, setFilter] = useState("All");
  const list = useLoad<{ ready: boolean; batches: CompletionBatch[] }>(API, tick);
  const batches = list.data?.batches ?? [];
  const shown = filter === "All" ? batches : batches.filter((b) => (filter === "To Do" ? b.status === "Not Started" || b.status === "Draft" : b.status === filter));
  return <div className="portal-page cx ac tcr-ui">
    <div className="cx-head"><div><span className="portal-eyebrow">{eyebrow}</span><h1>Completion Records</h1></div></div>
    {list.error && <Message kind="error" text={list.error} />}
    {list.data && !list.data.ready && <Message kind="error" text="The Completion Records tables are not in the database yet. Run database updates 202610090039 and 202610090040 (Supabase SQL Editor), then reload this page." />}
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>STCW Batches</h2>
      <div className="cx-seg">{["All", "To Do", "Ready", "Printed"].map((f) => <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "Ready" ? "Ready to Print" : f}</button>)}</div></div>
      {shown.length ? <div className="tcr-batches">{shown.map((b) => <button key={b.id} type="button" className={`tcr-bt${pick === b.id ? " on" : ""}`} onClick={() => setPick(b.id)}>
        <b>{b.batchNumber} · {b.courseCode}</b><small>{durationText(b.startsOn, b.endsOn)} · {b.trainees} trainee{b.trainees === 1 ? "" : "s"}</small><Badge tone={TONE[b.status]}>{LABEL[b.status]}</Badge></button>)}</div>
        : <p className="portal-empty-copy">{list.loading ? "Loading…" : "No STCW batch has ended in the last 120 days."}</p>}
    </section>
    {pick && <RecordEditor key={pick} batchId={pick} onSaved={() => setTick((t) => t + 1)} />}
  </div>;
}

/** One sentence about the Google Drive filing that came back with a save. */
function driveNote(d: { state?: string; path?: string | null; error?: string } | null | undefined) {
  if (!d) return "";
  if (d.state === "Filed") return `Filed in Google Drive: ${d.path ?? "TCROA"}.`;
  if (d.state === "Updated") return "The copy in Google Drive › TCROA was updated.";
  if (d.state === "Failed") return `Google Drive did not take it (${d.error ?? "connection problem"}); use Upload Again.`;
  if (d.state === "Not configured") return "Google Drive is not connected yet (Admin › Configuration).";
  return "";
}

function RecordEditor({ batchId, onSaved }: { batchId: string; onSaved: () => void }) {
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad<CompletionPayload>(`${API}?batch=${batchId}`, tick);
  const [fields, setFields] = useState<CompletionFields | null>(null);
  const [results, setResults] = useState<Record<string, TraineeResult> | null>(null);
  const [first, setFirst] = useState(""), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null), [busy, setBusy] = useState(false), [editTasks, setEditTasks] = useState<AssessmentTask[] | null>(null);
  const f = fields ?? data?.fields ?? null, rs = results ?? data?.results ?? null;
  const n = data?.tasks.length ?? 0;
  const problems = useMemo(() => (data && f && rs ? completionProblems(f, data.trainees, rs, n) : []), [data, f, rs, n]);
  if (error) return <Message kind="error" text={error} />;
  if (!data || !f || !rs) return <section className="portal-panel cx-panel"><p className="portal-empty-copy">Loading…</p></section>;
  const dirty = fields !== null || results !== null;
  const setF = (k: keyof CompletionFields, v: string) => { setMsg(null); setFields({ ...f, [k]: v }); };
  const setR = (id: string, patch: Partial<TraineeResult>) => { setMsg(null); setResults({ ...rs, [id]: { ...(rs[id] ?? emptyResult(n)), ...patch } }); };
  const cycle = (id: string, j: number) => { const r = rs[id] ?? emptyResult(n); const ticks = [...r.ticks]; ticks[j] = ticks[j] === null || ticks[j] === undefined ? true : ticks[j] === true ? false : null; setR(id, { ticks }); };
  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Could not save."); setMsg({ kind: "success", text: [ok, driveNote(b.drive)].filter(Boolean).join(" ") }); return b as Record<string, unknown>; }
    catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not save." }); return null; }
    finally { setBusy(false); }
  }
  async function save() { if (await post({ action: "save", batchId, fields: f, results: rs }, problems.length ? "Draft saved. Finish the missing items before printing." : "Saved. The record is complete and ready to print.")) { setFields(null); setResults(null); setTick((t) => t + 1); onSaved(); } }
  async function upload() { if (await post({ action: "drive", batchId }, "")) setTick((t) => t + 1); }
  async function saveTasks() { if (!editTasks) return; const clean = editTasks.filter((t) => t.title.trim()); if (await post({ action: "tasks", courseId: data!.batch.courseId, batchId, tasks: clean }, `Assessment tasks saved for ${data!.batch.courseCode}.`)) { setEditTasks(null); setResults(null); setTick((t) => t + 1); } }
  const fillNumbers = () => { const competent = data.trainees.filter((t) => resultOf(rs[t.enrollmentId] ?? emptyResult(n), n) === "C"); const series = numberSeries(first, competent.length); if (!series) { setMsg({ kind: "error", text: "Type the first MTI certificate number, e.g. MTI-094-609-26-002382." }); return; } const next = { ...rs }; competent.forEach((t, i) => { next[t.enrollmentId] = { ...next[t.enrollmentId], cert: series[i] }; }); setResults(next); setMsg({ kind: "success", text: `${competent.length} numbers filled from ${first.trim()}. Change any of them by hand, then Save.` }); };
  const useLast = () => { const l = data.lastSignatories; setFields({ ...f, assessor: f.assessor || l?.assessor || "", coaValidity: f.coaValidity || l?.coaValidity || "", director: f.director || l?.director || "", assessedOn: f.assessedOn || data.batch.endsOn, directorOn: f.directorOn || data.batch.endsOn }); };
  const field = (k: keyof CompletionFields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label>{label}<input value={f[k]} onChange={(e) => setF(k, e.target.value)} {...props} /></label>;

  return <>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <section className="portal-panel cx-panel"><div className="panel-heading"><div><h2>{data.batch.batchNumber} · {data.batch.courseCode}</h2><small>{data.batch.courseName} · {durationText(data.batch.startsOn, data.batch.endsOn)}</small></div>
      <div className="cx-acts"><button type="button" className="portal-secondary" disabled={busy || !dirty} onClick={() => { setFields(null); setResults(null); }}>Discard</button><button type="button" className="portal-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
        <a className={`portal-secondary tcr-print${problems.length || dirty || data.status === "Not Started" ? " off" : ""}`} href={`/portal/completion-record/${batchId}`} target="_blank" rel="noreferrer" aria-disabled={!!problems.length || dirty}>Preview and Print</a>
        <a className={`portal-secondary tcr-print${problems.length || dirty || data.status === "Not Started" ? " off" : ""}`} href={`/api/documents/completion-record/${batchId}`} target="_blank" rel="noreferrer" aria-disabled={!!problems.length || dirty}>Download PDF</a></div></div>
      <div className="tcr-drive">{data.drive ? <><Badge tone="green">In Google Drive</Badge><span>{data.drive.path ?? "TCROA"}{data.drive.filedAt ? ` · updated ${new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(data.drive.filedAt))}` : ""}</span>{data.drive.link && <a href={data.drive.link} target="_blank" rel="noreferrer">Open in Drive</a>}</>
        : <><Badge tone="orange">Not in Google Drive Yet</Badge><span>{problems.length || data.status === "Not Started" ? "It is filed in TCROA automatically once the record is complete and saved." : "Not filed yet."}</span></>}
        {!problems.length && data.status !== "Not Started" && !dirty && <button type="button" className="portal-secondary" disabled={busy} onClick={() => void upload()}>Upload Again</button>}</div>
      <div className="tcr-form">
        <label>Training Course<span className="tcr-ro">{data.batch.courseName}</span></label>
        <label>Training Duration<span className="tcr-ro">{durationText(data.batch.startsOn, data.batch.endsOn)}</span></label>
        {field("classNo", "Class No.", { placeholder: "e.g. 26-609-118", maxLength: 40 })}
        {field("writtenPlace", "Place of Written Assessment", { placeholder: "e.g. TR 103", maxLength: 60 })}
        {field("practicalPlace", "Place of Practical Assessment", { placeholder: "e.g. TR 103", maxLength: 60 })}
        {field("resitClassNo", "Class No. for Re-sit", { placeholder: "Only for a re-sit", maxLength: 40 })}
        {field("resitDuration", "Re-sit Training Duration", { placeholder: "Only for a re-sit", maxLength: 80 })}
      </div>
    </section>

    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Assessment Tasks · {data.batch.courseCode}</h2>
      {editTasks ? <div className="cx-acts"><button type="button" className="portal-secondary" onClick={() => setEditTasks(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy} onClick={() => void saveTasks()}>Save Tasks</button></div>
        : <button type="button" className="portal-secondary" disabled={data.status === "Printed"} onClick={() => setEditTasks(data.tasks.length ? data.tasks.map((t) => ({ ...t })) : [{ title: "", criteria: "" }])}>{data.tasks.length ? "Edit Tasks" : "Add Tasks"}</button>}</div>
      {editTasks ? <div className="tcr-tasks">{editTasks.map((t, i) => <div key={i} className="tcr-task"><b>Task {i + 1}</b>
          <label>Assessment Task<textarea value={t.title} maxLength={400} onChange={(e) => setEditTasks(editTasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></label>
          <label>Assessment Criteria<textarea value={t.criteria} maxLength={600} onChange={(e) => setEditTasks(editTasks.map((x, j) => (j === i ? { ...x, criteria: e.target.value } : x)))} /></label>
          <button type="button" className="portal-secondary" onClick={() => setEditTasks(editTasks.filter((_, j) => j !== i))}>Remove</button></div>)}
          {editTasks.length < 8 && <button type="button" className="portal-secondary tcr-add" onClick={() => setEditTasks([...editTasks, { title: "", criteria: "" }])}>Add Task</button>}
          <p className="ac-note">Saved for {data.batch.courseCode} and used on every record of this course that is not printed yet. After changing the tasks, check this record&apos;s checklist again.</p></div>
        : data.tasks.length ? <div className="tcr-tasks">{data.tasks.map((t, i) => <div key={i} className="tcr-task"><b>Task {i + 1}</b><span>{t.title}</span>{t.criteria && <small>{t.criteria}</small>}</div>)}</div>
        : <p className="portal-empty-copy">Add the assessment tasks for {data.batch.courseCode} once; they are reused on every record of this course.</p>}
    </section>

    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Trainees and Results</h2>
      <div className="tcr-fill"><label>First MTI Certificate No.<input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="MTI-094-609-26-002382" /></label><button type="button" className="portal-secondary" onClick={fillNumbers}>Number the Competent Trainees</button></div></div>
      {data.trainees.length ? <div className="cl-wrap"><table className="cl-log tcr-grid"><thead><tr><th>#</th><th>Name of Trainee</th><th>Date of Birth</th><th>Place of Birth</th><th>Rank</th><th className="c">Written %</th><th className="c">Remarks</th>
        {data.tasks.map((_, j) => <th key={j} className="c">Task {j + 1}<button type="button" className="tcr-all" onClick={() => setResults(Object.fromEntries(data.trainees.map((t) => { const r = rs[t.enrollmentId] ?? emptyResult(n); const ticks = [...r.ticks]; ticks[j] = true; return [t.enrollmentId, { ...r, ticks }]; })))}>All ✓</button></th>)}
        <th className="c">Practical</th><th className="c">Result</th><th>MTI Training Certificate No.</th></tr></thead><tbody>
        {data.trainees.map((t, i) => { const r = rs[t.enrollmentId] ?? emptyResult(n); const res = resultOf(r, n); return <tr key={t.enrollmentId}>
          <td>{i + 1}</td><td><b>{t.name}</b></td><td className="cl-mono">{formDate(t.birthdate) || "—"}</td><td>{t.placeOfBirth || "—"}</td><td>{t.rank || "N/A"}</td>
          <td className="c"><input className="tcr-pct" inputMode="numeric" aria-label={`Written percentage for ${t.name}`} value={r.pct ?? ""} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 3); setR(t.enrollmentId, { pct: v === "" ? null : Math.min(100, Number(v)) }); }} /></td>
          <td className="c"><b className={remarkOf(r.pct) === "F" ? "tcr-f" : "tcr-p"}>{remarkOf(r.pct)}</b></td>
          {data.tasks.map((_, j) => <td key={j} className="c"><button type="button" className={`tcr-tick${r.ticks[j] === true ? " yes" : r.ticks[j] === false ? " no" : ""}`} aria-label={`Task ${j + 1}: ${r.ticks[j] === true ? "Performed" : r.ticks[j] === false ? "Not performed" : "Not checked"}`} onClick={() => cycle(t.enrollmentId, j)}>{r.ticks[j] === true ? "✓" : r.ticks[j] === false ? "✗" : ""}</button></td>)}
          <td className="c">{practicalDone(r, n) ? (practicalOk(r, n) ? "✓" : "✗") : ""}</td>
          <td className="c">{res && <Badge tone={res === "C" ? "green" : "red"}>{res === "C" ? "Competent" : "Not Yet Competent"}</Badge>}</td>
          <td><input className="tcr-cert" aria-label={`MTI certificate number for ${t.name}`} value={res === "NYC" ? "" : r.cert} disabled={res === "NYC"} placeholder={res === "NYC" ? "Not issued" : ""} maxLength={60} onChange={(e) => setR(t.enrollmentId, { cert: e.target.value })} /></td>
        </tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">No enrolled trainees in this batch.</p>}
      <p className="ac-note">Click a task box to cycle ✓ Performed · ✗ Not Performed · blank. Remarks, Practical and Result fill in by themselves: Pass at 75% and above; Competent when the trainee passes the written test and performs every task.</p>
    </section>

    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Certified Correct</h2><button type="button" className="portal-secondary" onClick={useLast}>Use Last Names and Training End Date</button></div>
      <div className="tcr-form">
        {field("assessor", "Assessor", { maxLength: 120 })}{field("coaValidity", "COA Validity", { placeholder: "e.g. 06 January 2031", maxLength: 60 })}{field("assessedOn", "Date", { type: "date" })}
        {field("director", "Training Director", { maxLength: 120 })}{field("directorOn", "Date", { type: "date" })}
      </div>
    </section>
    {problems.length ? <div className="ms-banner">Before printing, complete: {problems.join(" · ")}.</div> : dirty ? <div className="ms-banner">Save the changes, then Preview and Print.</div> : <div className="ms-banner green">Complete — ready to print.{data.printCount ? ` Printed ${data.printCount} time${data.printCount === 1 ? "" : "s"}.` : ""}</div>}
  </>;
}
