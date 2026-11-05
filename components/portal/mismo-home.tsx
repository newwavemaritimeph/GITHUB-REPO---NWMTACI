"use client";

import { useEffect, useState } from "react";
import { addDays, manilaToday } from "@/lib/portal-format";
import { finalList, mismoCopyText, mismoCsv, mismoListed, mismoMissing, mismoPaidCsv, mismoState, paidLate, type EntryDay, type MismoBatch, type MismoDay, type MismoState, type MismoTrainee } from "@/lib/mismo";
import { Badge, Message, fmtDate, periodRange, submit, txWhen, usePaged } from "./shared-ui";

/**
 * MARINA MISMO Compliance Officer (owner, 8 Oct 2026; Design 3 · One List, 5 Nov 2026). The officer inputs every paid
 * trainee in the MARINA MISMO System: one list of the trainees in class, with what they need to type, a Copy button
 * and an Encoded tick. The portal does not connect to MARINA. Every tab is date sensitive (owner, 5 Nov 2026).
 * The 11:00 AM list for the instructor and the 4:00 PM final list stay.
 */

type History = { batch_id: string; list_date: string; trainee_count: number; submitted_at: string; profiles?: { complete_name: string } | { complete_name: string }[] | null; batches?: { batch_number: string; courses: { name: string; code: string } | { name: string; code: string }[] | null } | { batch_number: string; courses: unknown }[] | null };
type Payload = MismoDay & { now: string; history: History[]; entryDays?: EntryDay[] };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
/** Manila hour now (0–23). */
const manilaHour = () => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Manila" }).format(new Date()));

const SPANS = ["Daily", "Weekly", "Monthly", "Custom"] as const;
type Span = (typeof SPANS)[number];
/** The date and duration pickers shared by the officer's lists. */
function useSpan(initial: Span) {
  const today = manilaToday();
  const [mode, setMode] = useState<Span>(initial), [date, setDate] = useState(today), [from, setFrom] = useState(`${today.slice(0, 8)}01`), [to, setTo] = useState(today);
  const ready = mode !== "Custom" || (!!from && !!to && from <= to);
  const range = mode === "Custom" ? { from, to, label: `${fmtDate(from)} – ${fmtDate(to)}` } : periodRange(mode, date);
  const step = (n: number) => setDate(mode === "Daily" ? addDays(date, n) : addDays(n < 0 ? range.from : range.to, n));
  const bar = (count: string) => <div className="portal-panel ms-span"><div className="pd-bar">
    <span className="cx-seg">{SPANS.map((x) => <button key={x} type="button" className={mode === x ? "on" : ""} onClick={() => setMode(x)}>{x}</button>)}</span>
    {mode === "Custom" ? <>
      <label className="cx-dt">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="cx-dt">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
    </> : <>
      <button type="button" className="portal-secondary" aria-label="Previous" onClick={() => step(-1)}>‹</button>
      <input type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      <button type="button" className="portal-secondary" aria-label="Next" onClick={() => step(1)}>›</button>
      {date !== today && <button type="button" className="portal-secondary" onClick={() => setDate(today)}>Today</button>}
    </>}
    <span className="pd-label">{ready ? <b>{range.label}</b> : "Choose a From date on or before the To date."} · {count}</span>
  </div></div>;
  return { mode, date, today, ready, range, bar };
}

function useMismo(from: string, to: string) {
  const key = `${from}:${to}`;
  const [state, setState] = useState<{ key: string; data: Payload | null; error: string }>({ key: "", data: null, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!from) return;
    let live = true;
    void fetch(`/api/staff/mismo?date=${from}&to=${to}`, { cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Could not load."); if (live) setState({ key: `${from}:${to}`, data: b as Payload, error: "" }); })
      .catch((e) => { if (live) setState({ key: `${from}:${to}`, data: null, error: e instanceof Error ? e.message : "Could not load." }); });
    return () => { live = false; };
  }, [from, to, tick]);
  // Refresh every 2 minutes so payments recorded by the Cashier show up.
  useEffect(() => { const id = window.setInterval(() => setTick((t) => t + 1), 120_000); return () => window.clearInterval(id); }, []);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : "", reload: () => setTick((t) => t + 1) };
}

function Head({ title }: { title: string }) {
  return <div className="cx-head"><div><span className="portal-eyebrow">MISMO Compliance Officer</span><h1>{title}</h1></div></div>;
}
const pdfUrl = (date: string, list: "final" | "unsettled", batch?: string) => `/api/documents/mismo?date=${date}&list=${list}${batch ? `&batch=${batch}` : ""}`;
function saveCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const spanName = (from: string, to: string) => (from === to ? from : `${from}-to-${to}`);

const FILTERS: ("All" | MismoState)[] = ["All", "For Encoding", "Encoded", "For Completion"];

export function MismoDashboard() {
  const span = useSpan("Daily");
  const { from, to } = span.range;
  const { data, error, reload } = useMismo(span.ready ? from : "", to);
  const [filter, setFilter] = useState<"All" | MismoState>("For Encoding"), [q, setQ] = useState("");
  // A tick shows at once; the officer works through many in a row and should not wait on each save.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState(""), [copied, setCopied] = useState("");
  const withTick = (t: MismoTrainee): MismoTrainee => (t.enrollmentId in ticks ? { ...t, entryAt: ticks[t.enrollmentId] ? t.entryAt ?? "now" : null } : t);
  const inClass = (data?.batches ?? []).flatMap((b) => b.trainees.map((t) => ({ b, t: withTick(t) })));
  // Not yet paid: off this list unless on Company Charge (owner, 5 Nov 2026). The count stays for the instructor's printout.
  const all = inClass.filter((r) => mismoListed(r.t)), unpaid = inClass.length - all.length;
  const count = (s: MismoState) => all.filter((r) => mismoState(r.t) === s).length;
  const term = q.trim().toLowerCase();
  const rows = all.filter((r) => (filter === "All" || mismoState(r.t) === filter) && (!term || `${r.t.lastName} ${r.t.firstName} ${r.t.middleName ?? ""} ${r.t.srn ?? ""} ${r.b.courseCode} ${r.b.batchNumber}`.toLowerCase().includes(term)));
  const paged = usePaged(rows);
  async function tick(t: MismoTrainee, done: boolean) {
    setProblem(""); setTicks((c) => ({ ...c, [t.enrollmentId]: done }));
    try { await submit({ action: "mismo-entry", enrollmentId: t.enrollmentId, done }); reload(); }
    catch (e) { setTicks((c) => { const n = { ...c }; delete n[t.enrollmentId]; return n; }); setProblem(e instanceof Error ? e.message : "Could not save."); }
  }
  async function copy(t: MismoTrainee, b: MismoBatch) {
    try { await navigator.clipboard.writeText(mismoCopyText(t, b)); setCopied(t.enrollmentId); window.setTimeout(() => setCopied((c) => (c === t.enrollmentId ? "" : c)), 1400); }
    catch { setProblem("The browser refused to copy. Select the row and copy it by hand."); }
  }
  const canPrint11 = span.mode === "Daily" && unpaid > 0 && (span.date < span.today || (span.date === span.today && manilaHour() >= 11));
  return <div className="portal-page cx ac ms-page">
    <Head title="Dashboard" />
    {span.bar(`${all.length} trainee${all.length === 1 ? "" : "s"}`)}
    {error && <Message kind="error" text={error} />}
    {problem && <Message kind="error" text={problem} />}
    <div className="cx-tiles ms-tiles">
      <div className="cx-tile ms-key"><span>For Encoding</span><b>{count("For Encoding")}</b></div>
      <div className="cx-tile" style={{ ["--c" as string]: "#0a7a3e" }}><span>Encoded</span><b>{count("Encoded")}</b></div>
      <div className={`cx-tile${unpaid ? " ms-alert" : ""}`} style={{ ["--c" as string]: "#b42318" }}><span>Unpaid</span><b>{unpaid}</b></div>
      <div className={`cx-tile${count("For Completion") ? " ms-alert" : ""}`} style={{ ["--c" as string]: "#a2470b" }}><span>For Completion</span><b>{count("For Completion")}</b></div>
    </div>
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Trainees in Class</h2><span className="cl-acts">
      {canPrint11 && <a className="portal-secondary" href={pdfUrl(span.date, "unsettled")} target="_blank" rel="noreferrer">Print for the Instructor</a>}
      <button type="button" className="portal-secondary" disabled={!count("For Encoding") && !count("Encoded") && !count("For Completion")} onClick={() => data && saveCsv(`MISMO-${spanName(from, to)}.csv`, mismoPaidCsv(data.batches))}>Excel / CSV</button>
    </span></div>
      <div className="cx-bar ac-bar ms-tools"><span className="cx-seg">{FILTERS.map((f) => <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f} {f === "All" ? all.length : count(f)}</button>)}</span>
        <input className="vx-search" aria-label="Search trainee" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, SRN, course or batch" /></div>
      {!data ? <p className="portal-empty-copy">{error || !span.ready ? "" : "Loading…"}</p> : !inClass.length ? <p className="portal-empty-copy">No STCW class in this period.</p> : !rows.length ? <p className="portal-empty-copy">No trainees here.</p> : <>
        <div className="cl-wrap"><table className="cl-log cl-light"><thead><tr><th>#</th><th>Trainee</th><th>Batch</th><th>Birth Date</th><th>SRN</th><th>Rank</th><th>Paid</th><th></th><th>MARINA MISMO</th></tr></thead><tbody>
          {paged.shown.map(({ b, t }, i) => { const s = mismoState(t), missing = mismoMissing(t); return <tr key={`${b.id}:${t.enrollmentId}`} className={s === "Encoded" ? "ms-done" : undefined}>
            <td className="cl-no">{paged.offset + i + 1}</td>
            <td><b>{t.lastName}, {t.firstName}{t.middleName ? ` ${t.middleName}` : ""}</b></td>
            <td>{b.courseCode}<small className="cl-sub cl-block cl-mono">{b.batchNumber}</small></td>
            <td className="cl-mono">{t.birthdate ?? "—"}</td><td className="cl-mono">{t.srn ?? "—"}</td><td>{t.rank ?? "—"}</td>
            <td>{t.companyCharge ? "Company Charge" : t.lastPaidAt ? txWhen(t.lastPaidAt) : "—"}{paidLate(t) && <small className="cl-block"><Badge tone="orange">Paid Late</Badge></small>}</td>
            <td>{!missing.length && <button type="button" className="portal-secondary ms-copy" onClick={() => void copy(t, b)}>{copied === t.enrollmentId ? "Copied" : "Copy"}</button>}</td>
            <td>{s === "For Completion" ? <Badge tone="orange">Missing {missing.join(", ")}</Badge> : <label className="ms-tick"><input type="checkbox" checked={s === "Encoded"} onChange={(e) => void tick(t, e.target.checked)} /> Encoded</label>}</td>
          </tr>; })}
        </tbody></table></div>{paged.pager}</>}
    </section>
  </div>;
}

export function MismoFinalList() {
  const span = useSpan("Daily");
  const { from, to } = span.range;
  const { data, error } = useMismo(span.ready ? from : "", to);
  // The cut-off is 4:00 PM on the batch's first class day in this period.
  const isReady = (b: MismoBatch) => { const cut = b.cutDate ?? from; return cut < span.today || (cut === span.today && manilaHour() >= 16); };
  return <div className="portal-page cx ac ms-page">
    <Head title="Final List" />
    {span.bar(`${data?.batches.length ?? 0} batch${data?.batches.length === 1 ? "" : "es"}`)}
    {error && <Message kind="error" text={error} />}
    {!data ? <p className="portal-empty-copy">{error || !span.ready ? "" : "Loading…"}</p> : !data.batches.length ? <section className="portal-panel cx-panel"><p className="portal-empty-copy">No STCW class in this period.</p></section>
      : data.batches.map((b) => { const ok = finalList(b), out = b.trainees.filter(paidLate), cut = b.cutDate ?? from, done = ok.filter((t) => t.entryAt).length; return !isReady(b) ? <section className="portal-panel cx-panel" key={b.id}>
        <div className="panel-heading"><h2>{b.batchNumber} · {b.courseName}</h2></div>
        <div className="ms-banner amber"><b>The final list is made at 4:00 PM on {fmtDate(cut)}.</b><span>Trainees who settle before then are included.</span></div>
      </section> : <section className="portal-panel cx-panel" key={b.id}>
        <div className="panel-heading"><h2>{b.batchNumber} · {b.courseName}</h2><span className="cl-acts">
          <button type="button" className="portal-secondary" disabled={!ok.length} onClick={() => saveCsv(`MISMO-${b.batchNumber}-${cut}.csv`, mismoCsv(b))}>Excel / CSV</button>
          <a className="portal-secondary" href={pdfUrl(cut, "final", b.id)} target="_blank" rel="noreferrer">Print PDF</a>
          <Badge tone={ok.length && done === ok.length ? "green" : "orange"}>{done} of {ok.length} Encoded</Badge>
        </span></div>
        <p className="ms-sub"><b>{ok.length} trainee{ok.length === 1 ? "" : "s"} for MARINA</b> · Cut-Off {fmtDate(cut)}, 4:00 PM · {b.startsOn === b.endsOn ? fmtDate(b.startsOn) : `${fmtDate(b.startsOn)} – ${fmtDate(b.endsOn)}`} · {b.room ?? "Room not set"} · {b.instructor ?? "Instructor not set"}{out.length ? ` · ${out.length} paid after 4:00 PM` : ""}</p>
        <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Last Name</th><th>First Name</th><th>Middle Name</th><th>Birth Date</th><th>SRN</th><th>Rank</th><th>Course</th></tr></thead><tbody>
          {ok.map((t, i) => <tr key={t.enrollmentId}><td className="cl-no">{i + 1}</td><td><b>{t.lastName}</b></td><td>{t.firstName}</td><td>{t.middleName || "—"}</td><td className="cl-mono">{t.birthdate ?? "—"}</td><td className="cl-mono">{t.srn ?? "—"}</td><td>{t.rank ?? "—"}</td><td>{b.courseCode}</td></tr>)}
          {out.map((t) => <tr key={t.enrollmentId} className="ms-out"><td className="cl-no">—</td><td>{t.lastName}</td><td>{t.firstName}</td><td>{t.middleName || "—"}</td><td className="cl-mono">{t.birthdate ?? "—"}</td><td className="cl-mono">{t.srn ?? "—"}</td><td>{t.rank ?? "—"}</td><td>Left off · Paid Late</td></tr>)}
        </tbody></table></div>
      </section>; })}
  </div>;
}

export function MismoSubmissions() {
  const span = useSpan("Monthly");
  const { from, to } = span.range;
  const { data, error } = useMismo(span.today, span.today);
  // Encoded ticks per batch and day, then the batches marked submitted before the ticks (5 Nov 2026).
  const merged = [
    ...(data?.entryDays ?? []).map((d) => ({ key: `e:${d.batchId}:${d.day}`, day: d.day, batch: d.batchNumber, code: d.code, count: d.count, at: d.lastAt, by: d.by })),
    ...(data?.history ?? []).map((h) => { const b = one(h.batches as { batch_number: string; courses: unknown } | null), c = one(b?.courses as { name: string; code: string } | null); return { key: `s:${h.batch_id}`, day: h.list_date, batch: b?.batch_number ?? "—", code: c?.code ?? "—", count: h.trainee_count, at: h.submitted_at, by: one(h.profiles)?.complete_name ?? "—" }; }),
  ].filter((r) => span.ready && r.day >= from && r.day <= to).sort((a, z) => z.at.localeCompare(a.at));
  const paged = usePaged(merged);
  return <div className="portal-page cx ac ms-page">
    <Head title="Submissions" />
    {span.bar(`${merged.length} ${merged.length === 1 ? "entry" : "entries"}`)}
    {error && <Message kind="error" text={error} />}
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Encoded in the MARINA MISMO System</h2><span className="slot-count">{merged.length}</span></div>
      {merged.length ? <><div className="cl-wrap"><table className="cl-log"><thead><tr><th>Date</th><th>Batch</th><th>Course</th><th>Trainees</th><th>Last Encoded</th><th>By</th></tr></thead><tbody>
        {paged.shown.map((r) => <tr key={r.key}><td>{fmtDate(r.day)}</td><td className="cl-mono">{r.batch}</td><td>{r.code}</td><td className="cl-mono">{r.count}</td><td>{txWhen(r.at)}</td><td>{r.by}</td></tr>)}
      </tbody></table></div>{paged.pager}</> : <p className="portal-empty-copy">{data ? "Nothing input in this period." : error ? "" : "Loading…"}</p>}
    </section>
  </div>;
}
