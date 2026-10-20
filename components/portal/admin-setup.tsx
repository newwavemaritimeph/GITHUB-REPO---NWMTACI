"use client";

import { useState } from "react";
import { parseCsv } from "@/lib/csv";
import { formatCertificateNumber } from "@/lib/certificate-rules";
import { htmlTableToLines, matchClassroomLine, matchCourse, parseClassroomLines, parseLastCertificateNo, readNumberRows } from "@/lib/admin-imports";

/**
 * Admin one-time setup (owner, 20 Oct 2026): import the last certificate number
 * per course from a Google Sheet, import the Google Classroom links and codes, and
 * set the default room per course.
 */
type Course = { id: string; code: string; name: string; delivery_type: string };
type Series = { course_id: string; prefix: string; pad: number; batch_prefix: string; next_batch: number };
type SetupData = { courses: Course[]; batches: { id: string; course_id: string; starts_on: string; batch_number: string }[]; classrooms?: { id: string; name: string; active?: boolean }[]; certificateSeries?: Series[]; defaultRooms?: { course_id: string; classroom_id: string }[] };

async function op(body: Record<string, unknown>) {
  const r = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? "Could not save.");
  return out;
}
const own = (d: SetupData) => d.courses.filter((c) => c.delivery_type === "In-House");
const Msg = ({ m }: { m: { kind: "ok" | "err"; text: string } | null }) => (m ? <div className={`portal-message ${m.kind === "ok" ? "success" : "error"}`}>{m.text}</div> : null);

export function CertificateNumberImport({ data, reload }: { data: SetupData; reload: () => Promise<void> }) {
  const [url, setUrl] = useState(""), [rows, setRows] = useState<{ code: string; name: string; last: string; courseId: string }[] | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const courses = own(data);
  const series = new Map((data.certificateSeries ?? []).map((s) => [s.course_id, s]));
  const load = (csv: string) => {
    const found = readNumberRows(parseCsv(csv));
    if (!found.length) { setMsg({ kind: "err", text: "No rows found. The sheet needs Course Code, Course Name and Last Certificate No. columns." }); return; }
    setRows(found.map((r) => ({ ...r, courseId: matchCourse(courses, r.code, r.name)?.id ?? "" }))); setMsg(null);
  };
  async function readSheet() {
    setBusy(true); setMsg(null);
    try { const r = await fetch("/api/staff/sheet-csv", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }); const out = await r.json(); if (!r.ok) throw new Error(out.error); load(out.csv); }
    catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "The sheet could not be read." }); } finally { setBusy(false); }
  }
  const plan = (r: { last: string; courseId: string }) => {
    const p = parseLastCertificateNo(r.last), s = series.get(r.courseId);
    if (!p) return null;
    const prefix = p.prefix || s?.prefix || "", pad = p.prefix ? p.pad : s?.pad ?? Math.max(p.pad, 5);
    return { prefix, pad, next: p.number + 1 };
  };
  async function save() {
    if (!rows) return;
    setBusy(true); setMsg(null);
    let done = 0; const failed: string[] = [];
    for (const r of rows) {
      const p = plan(r), s = series.get(r.courseId);
      if (!r.courseId || !p) continue;
      try { await op({ action: "certificate-series-save", courseId: r.courseId, prefix: p.prefix, nextNumber: p.next, pad: Math.min(10, Math.max(1, p.pad)), batchPrefix: s?.batch_prefix ?? "", nextBatch: s?.next_batch ?? 1 }); done++; }
      catch (e) { failed.push(`${r.code || r.name}: ${e instanceof Error ? e.message : "not saved"}`); }
    }
    await reload(); setBusy(false);
    setMsg({ kind: failed.length ? "err" : "ok", text: `${done} course${done === 1 ? "" : "s"} saved; their next certificates continue from your sheet.${failed.length ? ` Not saved: ${failed.join("; ")}` : ""}` });
    if (!failed.length) setRows(null);
  }
  return <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Import Last Certificate Numbers</h2></div>
    <p className="ac-note">One-time setup. Your Google Sheet needs three columns: Course Code, Course Name and Last Certificate No. (e.g. HPT-00149, or just 149). Share it as &quot;Anyone with the link can view&quot; and paste the link, or download it as CSV and upload the file. The portal continues from the next number.</p>
    <Msg m={msg} />
    {!rows ? <div className="pm-form">
      <label style={{ gridColumn: "1 / -1" }}>Google Sheet Link<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" /></label>
      <div className="pm-actions" style={{ gridColumn: "1 / -1" }}><label className="portal-secondary tp-upload">Upload CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(load); e.target.value = ""; }} /></label><button type="button" className="portal-primary" disabled={busy || !url.trim()} onClick={() => void readSheet()}>{busy ? "Reading…" : "Read Sheet"}</button></div>
    </div> : <>
      <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>From the Sheet</th><th>Portal Course</th><th>Last No. Used</th><th>Next Certificate</th></tr></thead><tbody>
        {rows.map((r, i) => { const p = plan(r); return <tr key={i}>
          <td className="cl-mono">{r.code || "—"}<small className="cl-sub cl-block">{r.name}</small></td>
          <td><select className="cl-in" value={r.courseId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, courseId: e.target.value } : x)))}><option value="">Skip this row</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></td>
          <td className="cl-mono">{r.last}</td>
          <td className="cl-mono">{r.courseId && p ? <b>{formatCertificateNumber(p.prefix, p.next, p.pad)}</b> : <span className="cl-sub">{p ? "—" : "Not a number"}</span>}</td></tr>; })}
      </tbody></table></div>
      <div className="pm-actions"><span className="muted-text">{rows.filter((r) => r.courseId && plan(r)).length} of {rows.length} rows will be saved.</span><span className="cx-acts"><button type="button" className="portal-secondary" onClick={() => setRows(null)}>Back</button><button type="button" className="portal-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save Numbers"}</button></span></div>
    </>}
  </section>;
}

export function ClassroomLinksImport({ data, reload }: { data: SetupData; reload: () => Promise<void> }) {
  const [text, setText] = useState(""), [rows, setRows] = useState<{ label: string; link: string; code: string; courseId: string; batchId: string }[] | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const courses = own(data);
  const read = (raw: string) => {
    const lines = parseClassroomLines(raw);
    if (!lines.length) { setMsg({ kind: "err", text: "No Classroom links found. Paste the table with the links (copy the whole table so the Open links come along), or a CSV with the full links." }); return; }
    setRows(lines.map((l) => { const m = matchClassroomLine(l, courses, data.batches); return { label: [l.code, l.name].filter(Boolean).join(" · "), link: l.link, code: l.classCode ?? "", courseId: m.batch ? "" : m.course?.id ?? "", batchId: m.batch?.id ?? "" }; }));
    setMsg(null);
  };
  async function save() {
    if (!rows) return;
    const send = rows.filter((r) => r.courseId || r.batchId).map((r) => ({ courseId: r.courseId || null, batchId: r.batchId || null, link: r.link, code: r.code }));
    setBusy(true); setMsg(null);
    try { const out = await op({ action: "classroom-links-import", rows: send }); await reload(); setMsg({ kind: "ok", text: `Saved ${out.courses} course${out.courses === 1 ? "" : "s"} and ${out.batches} batch class${out.batches === 1 ? "" : "es"}. Enrollment emails and instructions now include the Join Google Classroom button and class code.` }); setRows(null); setText(""); }
    catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(false); }
  }
  const batchName = (id: string) => { const b = data.batches.find((x) => x.id === id); const c = b && courses.find((x) => x.id === b.course_id); return b ? `${c?.code ?? ""} batch ${b.batch_number} · starts ${b.starts_on}` : ""; };
  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Configuration</span><h1>Classroom Links</h1></div></div>
    <p className="ac-note">One-time setup. Copy your whole table of courses (code, name, the Open link and the class code) and paste it below. The links behind &quot;Open&quot; are kept. Classes made per batch, such as CCMD0081 (Oct 19-21, 2026), are saved on that batch.</p>
    <Msg m={msg} />
    {!rows ? <section className="portal-panel cx-panel"><div className="pm-form">
      <label style={{ gridColumn: "1 / -1" }}>Paste Your Table<textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => { const html = e.clipboardData.getData("text/html"); if (/<table/i.test(html)) { e.preventDefault(); setText(htmlTableToLines(html)); } }} placeholder={"Code\tCourse\tLink\tClass Code\nDWK\tDeck Watchkeeping\thttps://classroom.google.com/c/…\tiqsghbil"} style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 13 }} /></label>
      <div className="pm-actions" style={{ gridColumn: "1 / -1" }}><label className="portal-secondary tp-upload">Upload CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => { setText(t); read(t); }); e.target.value = ""; }} /></label><button type="button" className="portal-primary" disabled={!text.trim()} onClick={() => read(text)}>Read Table</button></div>
    </div></section> : <section className="portal-panel cx-panel">
      <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>From the Table</th><th>Saves To</th><th>Class Code</th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i}>
          <td>{r.label}<small className="cl-sub cl-block cl-mono">{r.link.replace("https://", "")}</small></td>
          <td>{r.batchId ? <span>{batchName(r.batchId)}</span> : <select className="cl-in" value={r.courseId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, courseId: e.target.value } : x)))}><option value="">Skip this row</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>}</td>
          <td><input className="cl-in cl-mono" value={r.code} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, code: e.target.value.trim() } : x)))} aria-label="Class code" /></td></tr>)}
      </tbody></table></div>
      <div className="pm-actions"><span className="muted-text">{rows.filter((r) => r.courseId || r.batchId).length} of {rows.length} rows will be saved.</span><span className="cx-acts"><button type="button" className="portal-secondary" onClick={() => setRows(null)}>Back</button><button type="button" className="portal-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save All"}</button></span></div>
    </section>}
  </div>;
}

export function DefaultRoomsPanel({ data, reload }: { data: SetupData; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null), [adding, setAdding] = useState("");
  const rooms = (data.classrooms ?? []).filter((r) => r.active !== false);
  const defaults = new Map((data.defaultRooms ?? []).map((d) => [d.course_id, d.classroom_id]));
  const courses = own(data);
  const shown = courses.filter((c) => defaults.has(c.id) || c.id === adding);
  async function save(courseId: string, classroomId: string | null) {
    setBusy(courseId); setMsg(null);
    try { await op({ action: "default-room-save", courseId, classroomId }); await reload(); setAdding(""); setMsg({ kind: "ok", text: classroomId ? "Default room saved. Upcoming batches of this course now use it." : "Default room removed." }); }
    catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(""); }
  }
  return <section className="portal-panel cx-panel" style={{ marginBottom: 16 }}><div className="panel-heading"><h2>Default Room per Course</h2></div>
    <p className="ac-note">New batches of these courses get the room automatically, and upcoming batches move with it. You can still change the room of one batch.</p>
    <Msg m={msg} />
    <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>Course</th><th>Default Room</th><th /></tr></thead><tbody>
      {shown.map((c) => <tr key={c.id}><td><b>{c.code}</b><small className="cl-sub cl-block">{c.name}</small></td>
        <td><select className="cl-in" value={defaults.get(c.id) ?? ""} disabled={!!busy} onChange={(e) => void save(c.id, e.target.value || null)}><option value="">No default</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td>
        <td>{busy === c.id ? <span className="cl-sub">Saving…</span> : null}</td></tr>)}
      {!shown.length && <tr><td colSpan={3}><span className="portal-empty-copy">No default rooms yet. Run database update 202610200049, or add a course below.</span></td></tr>}
    </tbody></table></div>
    <div className="pm-actions"><select className="cl-in" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add a course"><option value="">Add a course…</option>{courses.filter((c) => !defaults.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div>
  </section>;
}
