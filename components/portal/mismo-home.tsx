"use client";

import { useEffect, useState } from "react";
import { addDays, manilaToday } from "@/lib/portal-format";
import { MISMO_AHEAD_DAYS, MISMO_BACK_DAYS, MISMO_WHENS, NO_FILTER, finalList, lineOfEntry, lineOfRow, mismoCopyText, mismoCsv, mismoFiltered, mismoListed, mismoMissing, mismoRowsCsv, mismoSearched, mismoSorted, mismoState, paidLate, whenOf, type MismoBatch, type MismoDay, type MismoEntry, type MismoFilter, type MismoLine, type MismoRow, type MismoSort, type MismoTrainee } from "@/lib/mismo";
import { CompletionRecords } from "./completion-records";
import { Badge, Message, Modal, PeriodBar, fmtDate, periodRange, submit, txWhen, usePaged, usePeriod } from "./shared-ui";

/**
 * MARINA MISMO Compliance Officer (owner, 8 Oct 2026; Stage Tabs, 5 Nov 2026). The officer encodes every trainee who is
 * fully paid or on Company Charge in the MARINA MISMO System, including upcoming batches. The portal does not connect to
 * MARINA: it gives the list, a Copy button and an Encoded tick. The 11:00 AM printout and the 4:00 PM final list stay.
 */

const STAGES = ["For Encoding", "For Completion", "Encoded", "Final List", "Completion Records"] as const;
type Stage = (typeof STAGES)[number];

type History = { batch_id: string; list_date: string; trainee_count: number; submitted_at: string; profiles?: { complete_name: string } | { complete_name: string }[] | null; batches?: { batch_number: string; courses: { name: string; code: string } | { name: string; code: string }[] | null } | { batch_number: string; courses: unknown }[] | null };
type Payload = MismoDay & { now: string };
type LogPayload = { entries: MismoEntry[]; history: History[] };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
/** Manila hour now (0–23). */
const manilaHour = () => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Manila" }).format(new Date()));
const shortDay = (d: string) => (d ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : "—");
const classDays = (from: string, to: string) => (from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`);

const SPANS = ["Daily", "Weekly", "Monthly", "Custom"] as const;
type Span = (typeof SPANS)[number];
/** The date and duration pickers of the Final List. */
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
  return { today, ready, range, bar };
}

function useMismo(from: string, to: string, work = false) {
  const key = `${from}:${to}:${work}`;
  const [state, setState] = useState<{ key: string; data: Payload | null; error: string }>({ key: "", data: null, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!from) return;
    let live = true;
    void fetch(`/api/staff/mismo?date=${from}&to=${to}${work ? "&work=1" : ""}`, { cache: "no-store" }).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error ?? "Could not load."); if (live) setState({ key, data: b as Payload, error: "" }); })
      .catch((e) => { if (live) setState((cur) => ({ key, data: cur.key === key ? cur.data : null, error: e instanceof Error ? e.message : "Could not load." })); });
    return () => { live = false; };
  }, [from, to, work, key, tick]);
  // Refresh every 2 minutes so payments recorded by the Cashier show up.
  useEffect(() => { const id = window.setInterval(() => setTick((t) => t + 1), 120_000); return () => window.clearInterval(id); }, []);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : "", reload: () => setTick((t) => t + 1) };
}

const pdfUrl = (date: string, list: "final" | "unsettled", batch?: string) => `/api/documents/mismo?date=${date}&list=${list}${batch ? `&batch=${batch}` : ""}`;
function saveCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Search, Course, Batch, Class Date and Sort, shared by the three lists of trainees. */
function ToolBar({ lines, filter, setFilter, sort, setSort, atLabel, today, children }: { lines: MismoLine[]; filter: MismoFilter; setFilter: (f: MismoFilter) => void; sort: MismoSort; setSort: (s: MismoSort) => void; atLabel: string; today: string; children?: React.ReactNode }) {
  const found = lines.filter((l) => mismoSearched(l, filter.q));
  const courses = [...new Set([...found.map((l) => l.code), filter.course].filter(Boolean))].sort();
  const batches = [...new Map(found.filter((l) => !filter.course || l.code === filter.course).map((l) => [l.batchNumber, l])).values()].sort((a, z) => a.startsOn.localeCompare(z.startsOn) || a.batchNumber.localeCompare(z.batchNumber));
  const dated = mismoFiltered(lines, (l) => l, filter, today, true);
  const count = (w: (typeof MISMO_WHENS)[number]) => (w === "All Dates" ? dated.length : dated.filter((l) => whenOf(l.startsOn, l.endsOn, today) === w).length);
  return <div className="cx-bar ac-bar bs-tools ms-bar">
    <label className="ms-grow">Search<input aria-label="Search trainee" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Name, SRN, Course or Batch" /></label>
    <label>Course<select value={filter.course} onChange={(e) => setFilter({ ...filter, course: e.target.value, batch: "" })}><option value="">All Courses</option>{courses.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
    <label>Batch<select value={filter.batch} onChange={(e) => setFilter({ ...filter, batch: e.target.value })}><option value="">All Batches</option>{filter.batch && !batches.some((b) => b.batchNumber === filter.batch) && <option value={filter.batch}>{filter.batch}</option>}{batches.map((b) => <option key={b.batchNumber} value={b.batchNumber}>{b.batchNumber} · {shortDay(b.startsOn)}</option>)}</select></label>
    <label>Class Date<select value={filter.when} onChange={(e) => setFilter({ ...filter, when: e.target.value as MismoFilter["when"] })}>{MISMO_WHENS.map((w) => <option key={w} value={w}>{w} ({count(w)})</option>)}</select></label>
    <label>Sort<select value={sort} onChange={(e) => setSort(e.target.value as MismoSort)}><option value="date">Class Date · Oldest First</option><option value="batch">Batch</option><option value="course">Course</option><option value="name">Trainee</option><option value="at">{atLabel}</option></select></label>
    {children}
  </div>;
}

function ClassDay({ from, to, today }: { from: string; to: string; today: string }) {
  const when = whenOf(from, to, today);
  return <>{classDays(from, to)}<small className="cl-block"><Badge tone={when === "Today" ? "active" : when === "Upcoming" ? "blue" : "orange"}>{when === "Past Classes" ? "Past" : when}</Badge></small></>;
}

/** For Encoding and For Completion. */
export function MismoWorkList({ stage, rows, loaded, filter, setFilter, sort, setSort, today, copied, onCopy, onEncode, onAdd }: { stage: "For Encoding" | "For Completion"; rows: MismoRow[]; loaded: boolean; filter: MismoFilter; setFilter: (f: MismoFilter) => void; sort: MismoSort; setSort: (s: MismoSort) => void; today: string; copied: string; onCopy: (row: MismoRow) => void; onEncode: (t: MismoTrainee) => void; onAdd: (row: MismoRow) => void }) {
  const shown = mismoSorted(mismoFiltered(rows, lineOfRow, filter, today), sort, lineOfRow);
  const paged = usePaged(shown);
  const encoding = stage === "For Encoding";
  const who = ({ t }: MismoRow) => <td data-l="Trainee"><b>{t.lastName}, {t.firstName}{t.middleName ? ` ${t.middleName}` : ""}</b>{paidLate(t) && <span className="ms-chip"><Badge tone="orange">Paid Late</Badge></span>}{t.movedFrom && <span className="ms-chip" title={`Encoded under ${t.movedFrom}. Correct the entry in MARINA.`}><Badge tone="orange">{`Moved · Was ${t.movedFrom}`}</Badge></span>}</td>;
  const course = ({ b }: MismoRow) => <td data-l="Batch · Course"><b>{b.courseCode}</b><small className="cl-sub cl-block cl-mono">{b.batchNumber}</small></td>;
  const paid = ({ t }: MismoRow) => <td data-l="Paid">{t.companyCharge ? <Badge tone="blue">Company Charge</Badge> : <><Badge tone="active">Paid</Badge>{t.lastPaidAt && <small className="cl-sub cl-block">{txWhen(t.lastPaidAt)}</small>}</>}</td>;
  return <>
    <ToolBar lines={rows.map(lineOfRow)} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} atLabel="Paid On · Newest First" today={today}>
      {encoding && <button type="button" className="portal-secondary" disabled={!shown.length} onClick={() => saveCsv(`MISMO-For-Encoding-${today}.csv`, mismoRowsCsv(shown))}>Excel / CSV</button>}
    </ToolBar>
    {!loaded ? <p className="portal-empty-copy">Loading…</p> : !shown.length ? <p className="portal-empty-copy">{rows.length ? "No trainees match these filters." : encoding ? "Nobody is waiting to be encoded." : "No details are missing."}</p> : <>
      <div className="st-wrap"><table className="cl-log st-log"><thead><tr><th className="st-no">#</th><th>Trainee</th><th>Batch · Course</th><th>Class Day</th>{encoding ? <><th>Birth Date</th><th>SRN</th><th>Rank</th><th>Paid</th><th>MARINA MISMO</th></> : <><th>Missing</th><th>Paid</th><th></th></>}</tr></thead><tbody>
        {paged.shown.map((row, i) => { const { b, t } = row; return <tr key={t.enrollmentId}>
          <td className="cl-no st-no">{paged.offset + i + 1}</td>{who(row)}{course(row)}
          <td data-l="Class Day"><ClassDay from={b.startsOn} to={b.endsOn} today={today} /></td>
          {encoding ? <>
            <td data-l="Birth Date" className="cl-mono">{t.birthdate}</td><td data-l="SRN" className="cl-mono">{t.srn}</td><td data-l="Rank">{t.rank ?? "—"}</td>{paid(row)}
            <td data-l=""><span className="cl-acts st-acts"><button type="button" className="st-b" onClick={() => onCopy(row)}>{copied === t.enrollmentId ? "Copied" : "Copy"}</button><label className="ms-tick"><input type="checkbox" checked={false} onChange={() => onEncode(t)} /> Encoded</label></span></td>
          </> : <>
            <td data-l="Missing">{mismoMissing(t).map((m) => <span key={m} className="st-need">{m}</span>)}</td>{paid(row)}
            <td data-l=""><button type="button" className="st-b p" onClick={() => onAdd(row)}>Add Details</button></td>
          </>}
        </tr>; })}
      </tbody></table></div>{paged.pager}</>}
  </>;
}

/** A missing SRN or birth date, added by the officer and saved in the audit log (owner, 5 Nov 2026). */
function AddDetails({ row, onClose, onSaved }: { row: MismoRow; onClose: () => void; onSaved: () => void }) {
  const need = mismoMissing(row.t), [srn, setSrn] = useState(""), [birthdate, setBirthdate] = useState(""), [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  async function save() {
    setBusy(true); setProblem("");
    try { await submit({ action: "mismo-details", enrollmentId: row.t.enrollmentId, ...(srn.trim() ? { srn: srn.trim() } : {}), ...(birthdate ? { birthdate } : {}) }); onSaved(); }
    catch (e) { setProblem(e instanceof Error ? e.message : "Could not save."); setBusy(false); }
  }
  return <Modal title={`Add Details · ${row.t.lastName}, ${row.t.firstName}`} onClose={onClose}><div className="portal-form">
    {problem && <div className="full"><Message kind="error" text={problem} /></div>}
    {need.includes("SRN") && <label>SRN<input inputMode="numeric" maxLength={20} value={srn} onChange={(e) => setSrn(e.target.value)} /></label>}
    {need.includes("Birth Date") && <label>Birth Date<input type="date" max={manilaToday()} value={birthdate} onChange={(e) => setBirthdate(e.target.value)} /></label>}
    <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="button" className="portal-primary" disabled={busy || (!srn.trim() && !birthdate)} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></div>
  </div></Modal>;
}

/** Everyone already encoded: Pick a Date First; a search looks across all dates. */
function EncodedList({ filter, setFilter, today, onCount, onUndo }: { filter: MismoFilter; setFilter: (f: MismoFilter) => void; today: string; onCount: (n: number | null) => void; onUndo: (id: string) => void }) {
  const p = usePeriod();
  const [data, setData] = useState<LogPayload | null>(null), [problem, setProblem] = useState(""), [tick, setTick] = useState(0), [sort, setSort] = useState<MismoSort>("at");
  useEffect(() => {
    let live = true;
    void fetch("/api/staff/mismo?log=1", { cache: "no-store" }).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error ?? "Could not load."); if (live) setData(b as LogPayload); })
      .catch((e) => { if (live) setProblem(e instanceof Error ? e.message : "Could not load."); });
    return () => { live = false; };
  }, [tick]);
  const entries = data?.entries ?? [], searching = !!filter.q.trim(), visible = p.picked || searching;
  const inDate = searching ? entries : entries.filter((e) => p.inRange(e.doneAt));
  const shown = mismoSorted(mismoFiltered(inDate, lineOfEntry, filter, today), sort, lineOfEntry);
  const paged = usePaged(shown);
  const count = visible ? shown.length : null;
  useEffect(() => { onCount(count); }, [count, onCount]);
  const older = (data?.history ?? []).filter((h) => p.inRange(h.submitted_at));
  async function undo(id: string) {
    setProblem("");
    try { await submit({ action: "mismo-entry", enrollmentId: id, done: false }); setTick((t) => t + 1); onUndo(id); }
    catch (e) { setProblem(e instanceof Error ? e.message : "Could not undo."); }
  }
  return <>
    <ToolBar lines={inDate.map(lineOfEntry)} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} atLabel="Encoded On · Newest First" today={today} />
    {problem && <Message kind="error" text={problem} />}
    {searching ? <p className="pd-label pd-pad">Searching All Dates · {shown.length} found</p> : <PeriodBar p={p} what="Encoded" count={`${shown.length} trainee${shown.length === 1 ? "" : "s"}`} waitText="Pick a date above, or search by name." />}
    {visible && (!data ? !problem && <p className="portal-empty-copy">Loading…</p> : !shown.length ? <p className="portal-empty-copy">Nobody was encoded in this period.</p> : <>
      <div className="st-wrap"><table className="cl-log st-log"><thead><tr><th className="st-no">#</th><th>Trainee</th><th>Batch · Course</th><th>Class Day</th><th>SRN</th><th>Encoded</th><th>By</th><th></th></tr></thead><tbody>
        {paged.shown.map((e, i) => <tr key={e.enrollmentId}>
          <td className="cl-no st-no">{paged.offset + i + 1}</td>
          <td data-l="Trainee"><b>{e.lastName}, {e.firstName}{e.middleName ? ` ${e.middleName}` : ""}</b>{e.cancelled && <span className="ms-chip" title="Cancelled after encoding. Remove the entry in MARINA."><Badge tone="cancelled">Cancelled</Badge></span>}</td>
          <td data-l="Batch · Course"><b>{e.code}</b><small className="cl-sub cl-block cl-mono">{e.batchNumber}</small></td>
          <td data-l="Class Day">{e.startsOn ? <ClassDay from={e.startsOn} to={e.endsOn} today={today} /> : "—"}</td>
          <td data-l="SRN" className="cl-mono">{e.srn ?? "—"}</td><td data-l="Encoded">{txWhen(e.doneAt)}</td><td data-l="By">{e.by}</td>
          <td data-l=""><button type="button" className="st-b" onClick={() => void undo(e.enrollmentId)}>Undo</button></td>
        </tr>)}
      </tbody></table></div>{paged.pager}</>)}
    {p.picked && older.length > 0 && <><h3 className="ms-old">Batches Marked Submitted Before 5 Nov 2026</h3><div className="st-wrap"><table className="cl-log st-log"><thead><tr><th>List Date</th><th>Batch</th><th>Course</th><th>Trainees</th><th>Submitted</th><th>By</th></tr></thead><tbody>
      {older.map((h) => { const b = one(h.batches as { batch_number: string; courses: unknown } | null), c = one(b?.courses as { name: string; code: string } | null); return <tr key={h.batch_id}><td data-l="List Date">{fmtDate(h.list_date)}</td><td data-l="Batch" className="cl-mono">{b?.batch_number ?? "—"}</td><td data-l="Course">{c?.code ?? "—"}</td><td data-l="Trainees" className="cl-mono">{h.trainee_count}</td><td data-l="Submitted">{txWhen(h.submitted_at)}</td><td data-l="By">{one(h.profiles)?.complete_name ?? "—"}</td></tr>; })}
    </tbody></table></div></>}
  </>;
}

function FinalList() {
  const span = useSpan("Daily");
  const { from, to } = span.range;
  const { data, error } = useMismo(span.ready ? from : "", to);
  // The cut-off is 4:00 PM on the batch's first class day in this period.
  const isReady = (b: MismoBatch) => { const cut = b.cutDate ?? from; return cut < span.today || (cut === span.today && manilaHour() >= 16); };
  return <div className="ms-stack">
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
        <p className="ms-sub"><b>{ok.length} trainee{ok.length === 1 ? "" : "s"} for MARINA</b> · Cut-Off {fmtDate(cut)}, 4:00 PM · {b.startsOn === b.endsOn ? fmtDate(b.startsOn) : `${fmtDate(b.startsOn)} – ${fmtDate(b.endsOn)}`} · {b.room ?? "Room not set"} · {b.instructor ?? "Instructor not set"}</p>
        <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Last Name</th><th>First Name</th><th>Middle Name</th><th>Birth Date</th><th>SRN</th><th>Rank</th><th>Course</th></tr></thead><tbody>
          {ok.map((t, i) => <tr key={t.enrollmentId}><td className="cl-no">{i + 1}</td><td><b>{t.lastName}</b></td><td>{t.firstName}</td><td>{t.middleName || "—"}</td><td className="cl-mono">{t.birthdate ?? "—"}</td><td className="cl-mono">{t.srn ?? "—"}</td><td>{t.rank ?? "—"}</td><td>{b.courseCode}</td></tr>)}
        </tbody></table></div>
        {out.length > 0 && <p className="ms-note">Paid after 4:00 PM, not on this list: {out.map((t) => `${t.lastName}, ${t.firstName}`).join("; ")}.{out.some((t) => !t.entryAt) ? " Still listed under For Encoding." : ""}</p>}
      </section>; })}
  </div>;
}

export function MismoList() {
  const today = manilaToday(), hour = manilaHour();
  const [stage, setStage] = useState<Stage>("For Encoding"), [filter, setFilter] = useState<MismoFilter>(NO_FILTER), [sort, setSort] = useState<MismoSort>("date");
  // A tick shows at once: the officer works through many in a row and should not wait on each save.
  const [justEncoded, setJustEncoded] = useState<string[]>([]), [problem, setProblem] = useState(""), [copied, setCopied] = useState(""), [adding, setAdding] = useState<MismoRow | null>(null), [encodedCount, setEncodedCount] = useState<number | null>(null);
  const day = useMismo(today, today), work = useMismo(addDays(today, -MISMO_BACK_DAYS), addDays(today, MISMO_AHEAD_DAYS), true);
  const rows = (work.data?.batches ?? []).flatMap((b) => b.trainees.map((t) => ({ b, t }))).filter((r) => !justEncoded.includes(r.t.enrollmentId));
  const toEncode = rows.filter((r) => mismoState(r.t) === "For Encoding"), toComplete = rows.filter((r) => mismoState(r.t) === "For Completion");
  const classes = day.data?.batches ?? [], unpaid = classes.flatMap((b) => b.trainees).filter((t) => !mismoListed(t)).length;
  function refresh() { work.reload(); day.reload(); }
  async function encode(t: MismoTrainee) {
    setProblem(""); setJustEncoded((c) => [...c, t.enrollmentId]);
    try { await submit({ action: "mismo-entry", enrollmentId: t.enrollmentId, done: true }); refresh(); }
    catch (e) { setJustEncoded((c) => c.filter((x) => x !== t.enrollmentId)); setProblem(e instanceof Error ? e.message : "Could not save."); }
  }
  async function copy({ t, b }: MismoRow) {
    try { await navigator.clipboard.writeText(mismoCopyText(t, b)); setCopied(t.enrollmentId); window.setTimeout(() => setCopied((c) => (c === t.enrollmentId ? "" : c)), 1400); }
    catch { setProblem("The browser refused to copy. Select the row and copy it by hand."); }
  }
  const counts: Record<Stage, string> = { "For Encoding": String(toEncode.length), "For Completion": String(toComplete.length), Encoded: encodedCount === null ? "—" : String(encodedCount), "Final List": String(classes.length), "Completion Records": "—" };
  const after11 = hour >= 11, after16 = hour >= 16;
  return <div className="portal-page cx ac ms-page">
    <div className="cx-head"><div><span className="portal-eyebrow">MISMO Compliance Officer</span><h1>MISMO List</h1></div></div>
    {problem && <Message kind="error" text={problem} />}
    {(work.error || day.error) && <Message kind="error" text={work.error || day.error} />}
    <div className="ms-strip">
      <div className={after11 && unpaid ? "hot" : ""}><span><b>11:00 AM · Unpaid: {unpaid}</b><small>Not listed here. Names only on the instructor&apos;s printout.</small></span>{after11 && unpaid > 0 ? <a className="st-b" href={pdfUrl(today, "unsettled")} target="_blank" rel="noreferrer">Print for the Instructor</a> : !after11 && <span className="st-need">Opens at 11:00 AM</span>}</div>
      <div className={after16 && classes.length ? "ok" : ""}><span><b>4:00 PM · Final List</b><small>{classes.length ? (after16 ? "Ready for MARINA." : "Made at 4:00 PM.") : "No STCW class today."}</small></span>{after16 && classes.length > 0 ? <button type="button" className="st-b p" onClick={() => setStage("Final List")}>Open Final List</button> : classes.length > 0 && <span className="st-need">Not Yet</span>}</div>
    </div>
    <div className="st-tabs five" role="tablist" aria-label="MISMO stages">{STAGES.map((s) => <button key={s} type="button" role="tab" aria-selected={stage === s} className={`st-tab${stage === s ? " on" : ""}`} onClick={() => { setStage(s); setFilter((f) => ({ ...f, batch: "" })); }}><span>{s}</span><b>{counts[s]}</b></button>)}</div>
    {stage === "Final List" ? <FinalList /> : stage === "Completion Records" ? <CompletionRecords /> : <section className="portal-panel cx-panel st-panel">
      {stage === "Encoded"
        ? <EncodedList filter={filter} setFilter={setFilter} today={today} onCount={setEncodedCount} onUndo={(id) => { setJustEncoded((c) => c.filter((x) => x !== id)); refresh(); }} />
        : <MismoWorkList key={stage} stage={stage} rows={stage === "For Encoding" ? toEncode : toComplete} loaded={!!work.data} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} today={today} copied={copied} onCopy={(r) => void copy(r)} onEncode={(t) => void encode(t)} onAdd={setAdding} />}
    </section>}
    {adding && <AddDetails row={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); refresh(); }} />}
  </div>;
}
