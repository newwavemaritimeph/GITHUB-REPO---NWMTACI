"use client";

import { useEffect, useState } from "react";
import { addDays, manilaToday } from "@/lib/portal-format";
import { MISMO_AHEAD_DAYS, MISMO_BACK_DAYS, MISMO_COURSE_CODES, finalList, mismoCsv, mismoListed, mismoState, type MismoBatch, type MismoDay, type MismoRemoved } from "@/lib/mismo";
import { BatchWindow, manilaHour, mismoPdfUrl, saveCsv } from "./batch-window";
import { Badge, Message, submit, txWhen, usePaged } from "./shared-ui";

/**
 * Training Reports (owner, 9 Nov 2026; was the MISMO List, 8 Oct and 5 Nov 2026): the MISMO Compliance Officer's STCW
 * batches, per course and per batch. A batch opens the Batch window, where each trainee has Copy and Encoded for the
 * MARINA MISMO System; the portal does not connect to MARINA. The 11:00 AM printout and the 4:00 PM final list stay.
 */

type Payload = MismoDay & { now: string; removed?: MismoRemoved[] };
const shortDay = (d: string) => (d ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : "—");
const classDays = (from: string, to: string) => (from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`);

function useMismo(from: string, to: string) {
  const key = `${from}:${to}`;
  const [state, setState] = useState<{ key: string; data: Payload | null; error: string }>({ key: "", data: null, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!from) return;
    let live = true;
    void fetch(`/api/staff/mismo?date=${from}&to=${to}`, { cache: "no-store" }).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error ?? "Could not load."); if (live) setState({ key, data: b as Payload, error: "" }); })
      .catch((e) => { if (live) setState((cur) => ({ key, data: cur.key === key ? cur.data : null, error: e instanceof Error ? e.message : "Could not load." })); });
    return () => { live = false; };
  }, [from, to, key, tick]);
  // Refresh every 2 minutes so payments recorded by the Cashier show up.
  useEffect(() => { const id = window.setInterval(() => setTick((t) => t + 1), 120_000); return () => window.clearInterval(id); }, []);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : "", reload: () => setTick((t) => t + 1) };
}

/** What one batch still needs: paid trainees, encoded, still to encode, and missing an SRN or birth date. */
export function batchStats(b: MismoBatch) {
  const listed = b.trainees.filter(mismoListed);
  return { total: b.trainees.length, listed: listed.length, encoded: listed.filter((t) => t.entryAt).length, toEncode: b.trainees.filter((t) => mismoState(t) === "For Encoding").length, missing: b.trainees.filter((t) => mismoState(t) === "For Completion").length };
}
/** A course's batches: in class today, upcoming (soonest first), then past batches with work left (all past ones with `allPast`). */
export function courseGroups(batches: MismoBatch[], code: string, today: string, allPast = false) {
  const own = batches.filter((b) => b.courseCode === code);
  const left = (b: MismoBatch) => { const s = batchStats(b); return s.toEncode + s.missing > 0; };
  return [
    { label: "Today", batches: own.filter((b) => b.startsOn <= today && today <= b.endsOn) },
    { label: "Upcoming", batches: own.filter((b) => b.startsOn > today).sort((a, z) => a.startsOn.localeCompare(z.startsOn)) },
    { label: allPast ? "Past" : "Past · Work Left", batches: own.filter((b) => b.endsOn < today && (allPast || left(b))).sort((a, z) => z.startsOn.localeCompare(a.startsOn)) },
  ].filter((g) => g.batches.length);
}

/** Trainees a voided payment took off MISMO: MARINA still has them, so each stays here until the officer has corrected it (owner, 5 Nov 2026). */
export function RemovedAlert({ rows, onCleared }: { rows: MismoRemoved[]; onCleared: () => void }) {
  const paged = usePaged(rows);
  const [busy, setBusy] = useState(""), [problem, setProblem] = useState("");
  if (!rows.length) return null;
  async function clear(id: string) {
    setBusy(id); setProblem("");
    try { await submit({ action: "mismo-alert-clear", alertId: id }); onCleared(); }
    catch (e) { setBusy(""); setProblem(e instanceof Error ? e.message : "Could not save."); }
  }
  return <section className="portal-panel cx-panel st-panel ms-alert">
    <div className="panel-heading"><h2>Payment Voided · Correct in MARINA</h2><span className="slot-count">{rows.length}</span></div>
    {problem && <Message kind="error" text={problem} />}
    <div className="st-wrap"><table className="cl-log st-log"><thead><tr><th>Trainee</th><th>Batch · Course</th><th>Class Day</th><th>Reason for Void</th><th>Removed</th><th></th></tr></thead><tbody>
      {paged.shown.map((r) => <tr key={r.id}>
        <td data-l="Trainee"><b>{r.name}</b>{r.srn && <small className="cl-sub cl-block cl-mono">{r.srn}</small>}</td>
        <td data-l="Batch · Course"><b>{r.code ?? "—"}</b><small className="cl-sub cl-block cl-mono">{r.batchNumber ?? "—"}</small></td>
        <td data-l="Class Day">{r.classStart ? shortDay(r.classStart) : "—"}</td>
        <td data-l="Reason for Void">{r.reason || "—"}</td>
        <td data-l="Removed">{txWhen(r.at)}</td>
        <td data-l=""><button type="button" className="st-b p" disabled={busy === r.id} onClick={() => void clear(r.id)}>{busy === r.id ? "Saving…" : "Corrected in MARINA"}</button></td>
      </tr>)}
    </tbody></table></div>{paged.pager}
  </section>;
}

/** The Final List of one batch: made at 4:00 PM on its first class day. */
function FinalCell({ b, today, hour }: { b: MismoBatch; today: string; hour: number }) {
  if (b.startsOn > today) return <span className="st-need">4:00 PM · {shortDay(b.startsOn)}</span>;
  if (b.startsOn === today && hour < 16) return <span className="st-need">Not Yet · 4:00 PM Today</span>;
  return <span className="cl-acts"><a className="st-b" href={mismoPdfUrl(b.startsOn, "final", b.id)} target="_blank" rel="noreferrer">Final List PDF</a><button type="button" className="st-b" disabled={!finalList(b).length} onClick={() => saveCsv(`MISMO-${b.batchNumber}-${b.startsOn}.csv`, mismoCsv(b))}>CSV</button></span>;
}

/** `initial` fills the page without loading (tests). */
export function TrainingReports({ initial }: { initial?: Payload }) {
  const today = manilaToday(), hour = manilaHour();
  const [course, setCourse] = useState(MISMO_COURSE_CODES[0]), [open, setOpen] = useState<MismoBatch | null>(null), [allPast, setAllPast] = useState(false);
  const loaded = useMismo(initial ? "" : addDays(today, -MISMO_BACK_DAYS), addDays(today, MISMO_AHEAD_DAYS));
  const data = initial ?? loaded.data, batches = data?.batches ?? [];
  const todays = batches.filter((b) => b.startsOn <= today && today <= b.endsOn), unpaid = todays.flatMap((b) => b.trainees).filter((t) => !mismoListed(t)).length;
  const toDo = (code: string) => batches.filter((b) => b.courseCode === code).reduce((n, b) => { const s = batchStats(b); return n + s.toEncode + s.missing; }, 0);
  const nameOf = (code: string) => batches.find((b) => b.courseCode === code)?.courseName ?? "";
  const groups = courseGroups(batches, course, today, allPast);
  const after11 = hour >= 11, after16 = hour >= 16;
  return <div className="portal-page cx ac ms-page">
    <div className="cx-head"><div><span className="portal-eyebrow">MISMO Compliance Officer</span><h1>Training Reports</h1></div></div>
    {loaded.error && <Message kind="error" text={loaded.error} />}
    <RemovedAlert rows={data?.removed ?? []} onCleared={loaded.reload} />
    <div className="ms-strip">
      <div className={after11 && unpaid ? "hot" : ""}><span><b>11:00 AM · Unpaid: {unpaid}</b><small>Names only on the instructor&apos;s printout.</small></span>{after11 && unpaid > 0 ? <a className="st-b" href={mismoPdfUrl(today, "unsettled")} target="_blank" rel="noreferrer">Print for the Instructor</a> : !after11 && <span className="st-need">Opens at 11:00 AM</span>}</div>
      <div className={after16 && todays.length ? "ok" : ""}><span><b>4:00 PM · Final List</b><small>{todays.length ? (after16 ? "Ready for MARINA in each batch below." : "Made at 4:00 PM for today's classes.") : "No STCW class today."}</small></span>{todays.length > 0 && !after16 && <span className="st-need">Not Yet</span>}</div>
    </div>
    <div className="tr-ctabs" role="tablist" aria-label="Courses">{MISMO_COURSE_CODES.map((code) => { const n = toDo(code); return <button key={code} type="button" role="tab" aria-selected={course === code} className={`tr-ctab${course === code ? " on" : ""}`} onClick={() => setCourse(code)}>
      <b>{code}</b><small>{nameOf(code) || " "}</small><span className={n ? "tr-todo" : "tr-todo none"}>{n ? `${n} To Encode` : "All Encoded"}</span></button>; })}</div>
    <section className="portal-panel cx-panel">
      <div className="panel-heading"><h2>{course} Batches</h2><button type="button" className="portal-secondary" onClick={() => setAllPast((v) => !v)}>{allPast ? "Past With Work Left Only" : "Show All Past Batches"}</button></div>
      {!data ? <p className="portal-empty-copy">{loaded.error ? "" : "Loading…"}</p> : !groups.length ? <p className="portal-empty-copy">No {course} batches today, upcoming, or with work left.</p>
        : <div className="portal-table cx-cards tr-table"><table>
          <thead><tr><th>Batch No.</th><th>Class Dates</th><th>Paid</th><th>Encoded</th><th>Missing Details</th><th>Final List</th></tr></thead>
          <tbody>{groups.flatMap((g) => [<tr key={g.label} className="nb-group"><td colSpan={6}>{g.label} · {g.batches.length}</td></tr>,
            ...g.batches.map((b) => { const s = batchStats(b); return <tr key={b.id}>
              <td data-l="Batch No."><button type="button" className="bs-open cl-mono" onClick={() => setOpen(b)} title="Open the trainees on this batch">{b.batchNumber}</button></td>
              <td data-l="Class Dates"><b>{classDays(b.startsOn, b.endsOn)}</b><small className="cl-sub cl-block">{b.room ?? "No room"} · {b.instructor ?? "No instructor"}</small></td>
              <td data-l="Paid" className="cl-mono">{s.listed} of {s.total}</td>
              <td data-l="Encoded"><Badge tone={s.listed && s.encoded === s.listed ? "green" : s.toEncode ? "orange" : "blue"}>{`${s.encoded} of ${s.listed}`}</Badge></td>
              <td data-l="Missing Details">{s.missing ? <Badge tone="red">{String(s.missing)}</Badge> : <span className="cl-mono">0</span>}</td>
              <td data-l="Final List"><FinalCell b={b} today={today} hour={hour} /></td>
            </tr>; })])}</tbody>
        </table></div>}
    </section>
    {open && <BatchWindow batchId={open.id} batchNumber={open.batchNumber} mismo onClose={() => { setOpen(null); loaded.reload(); }} onChanged={loaded.reload} />}
  </div>;
}
