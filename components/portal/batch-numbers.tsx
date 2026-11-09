"use client";

import { useState } from "react";
import type { Batch, PortalData } from "../portal-live-app";
import { addDays, first, manilaToday } from "@/lib/portal-format";
import { Message, usePaged, usePost } from "./shared-ui";

/** One course's MARINA-style counter (migration 202610290065): 26-506-024 is year, course number, running number. */
export type BatchSeries = { course_id: string; middle: string; series_year: number; next_number: number };

export const batchNumberOf = (year: number, middle: string, n: number) => `${String(year % 100).padStart(2, "0")}-${middle}-${String(n).padStart(3, "0")}`;
/** The number the next batch takes: the first at or after n that no batch has (migration 202610290085 skips the same way). */
export function firstFreeBatchNumber(year: number, middle: string, n: number, taken: Set<string>) {
  let k = n;
  while (taken.has(batchNumberOf(year, middle, k))) k += 1;
  return batchNumberOf(year, middle, k);
}
export const BATCH_NO = /^[0-9A-Z][0-9A-Z-]{2,29}$/;
export const COURSE_NO = /^[0-9A-Za-z]{1,6}$/;
/** Why a typed batch number cannot be saved, or null. `usedBy` is the batch that already has it. */
export function batchNumberProblem(value: string, usedBy?: Batch | null, courseCode?: string) {
  if (!value) return "Enter a batch number.";
  if (!BATCH_NO.test(value)) return "Use letters, digits and dashes.";
  if (usedBy) return `Already used by ${courseCode ?? "another batch"} · ${short(usedBy.starts_on)}.`;
  return null;
}
const manilaYear = () => Number(manilaToday().slice(0, 4));
const short = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));
const dates = (a: string, b: string) => (a === b ? short(a) : a.slice(0, 7) === b.slice(0, 7) ? `${short(a)}–${Number(b.slice(8, 10))}` : `${short(a)} – ${short(b)}`);
const drop = <T,>(all: Record<string, T>, key: string) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key));
const codeOf = (data: PortalData, courseId: string) => data.courses.find((c) => c.id === courseId)?.code ?? "";
const nameOf = (data: PortalData, b: Batch) => first(b.courses)?.name ?? data.courses.find((c) => c.id === b.course_id)?.name ?? "";

/**
 * Schedules › Batch Numbers (owner, 9 Nov 2026; design/batch-numbers-prototype.html): the Admin sets the next number of
 * each STCW course's counter and renames upcoming batches. The server checks every number again.
 */
export function BatchNumbers({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [view, setView] = useState<"next" | "up">("next");
  const { busy, msg, post } = usePost(reload);
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Schedules</span><h1>Batch Numbers</h1></div>
      <span className="cx-seg" role="tablist" aria-label="View">{([["next", "Next Number"], ["up", "Upcoming Batches"]] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{t}</button>)}</span></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="ac-stack">{view === "next" ? <NextNumbers data={data} busy={busy} post={post} /> : <UpcomingBatches data={data} busy={busy} post={post} />}</div>
  </div>;
}

type Post = ReturnType<typeof usePost>["post"];

function NextNumbers({ data, busy, post }: { data: PortalData; busy: boolean; post: Post }) {
  const year = manilaYear();
  const taken = new Set(data.batches.map((b) => b.batch_number));
  const series = [...(data.batchNumberSeries ?? [])].sort((a, b) => codeOf(data, a.course_id).localeCompare(codeOf(data, b.course_id)));
  const [edit, setEdit] = useState<Record<string, { middle: string; next: string }>>({});
  const [adding, setAdding] = useState(false), [add, setAdd] = useState({ courseId: "", middle: "", next: "001" });
  // A counter from an earlier year starts over at 001 (migration 202610290065).
  const current = (s: BatchSeries) => (s.series_year === year ? s.next_number : 1);
  const open = data.courses.filter((c) => c.delivery_type === "In-House" && c.code !== "CCI" && !series.some((s) => s.course_id === c.id)).sort((a, b) => a.code.localeCompare(b.code));
  const highest = (middle: string) => data.batches.map((b) => b.batch_number).filter((n) => n.startsWith(`${String(year % 100).padStart(2, "0")}-${middle}-`)).sort().at(-1) ?? "—";
  const save = (courseId: string, middle: string, next: number, done: () => void) => void post({ action: "batch-series-save", courseId, middle, nextNumber: next }, `Saved. The next ${codeOf(data, courseId)} batch takes ${firstFreeBatchNumber(year, middle, next, taken)}.`).then(done).catch(() => undefined);
  return <section className="portal-panel cx-panel">
    <div className="panel-heading"><h2>Next Number</h2><button type="button" className="portal-secondary" disabled={adding || !open.length} onClick={() => setAdding(true)}>Add a Course</button></div>
    <div className="portal-table cx-cards bn-table"><table>
      <thead><tr><th>Course</th><th>Course No.</th><th>Next No.</th><th>Next Batch No.</th><th>Highest Used</th><th /></tr></thead>
      <tbody>{series.map((s) => {
        const e = edit[s.course_id] ?? { middle: s.middle, next: String(current(s)).padStart(3, "0") };
        const middle = e.middle.trim(), next = Number(e.next);
        const okMiddle = COURSE_NO.test(middle), okNext = Number.isInteger(next) && next > 0 && next < 1000;
        const typed = okMiddle && okNext ? batchNumberOf(year, middle, next) : "";
        const usedBy = typed ? data.batches.find((b) => b.batch_number === typed) : undefined;
        const changed = middle !== s.middle || next !== current(s);
        const course = data.courses.find((c) => c.id === s.course_id);
        return <tr key={s.course_id}>
          <td data-l="Course"><b>{course?.code ?? "Course"}</b><small className="cl-sub cl-block">{course?.name}</small></td>
          <td data-l="Course No."><input className="cl-in cl-mono bn-in" aria-label={`Course number for ${course?.code}`} value={e.middle} onChange={(ev) => setEdit({ ...edit, [s.course_id]: { ...e, middle: ev.target.value } })} /></td>
          <td data-l="Next No."><input className="cl-in cl-mono bn-in" inputMode="numeric" aria-label={`Next number for ${course?.code}`} value={e.next} onChange={(ev) => setEdit({ ...edit, [s.course_id]: { ...e, next: ev.target.value } })} /></td>
          <td data-l="Next Batch No."><b className="cl-mono">{typed || "—"}</b>
            {!okMiddle ? <small className="bn-msg bad">Use letters or digits only.</small> : !okNext ? <small className="bn-msg bad">Use a number from 1 to 999.</small> : usedBy ? <small className="bn-msg warn">Already used by {codeOf(data, usedBy.course_id)} · {short(usedBy.starts_on)}. The next batch takes {firstFreeBatchNumber(year, middle, next, taken)}.</small> : null}</td>
          <td data-l="Highest Used" className="cl-mono">{highest(s.middle)}</td>
          <td data-l=""><button type="button" className={changed ? "portal-primary" : "portal-secondary"} disabled={busy || !changed || !okMiddle || !okNext} onClick={() => save(s.course_id, middle, next, () => setEdit((all) => drop(all, s.course_id)))}>Save</button></td>
        </tr>;
      })}</tbody>
    </table></div>
    {!series.length && <p className="portal-empty-copy">No course has its own batch numbers yet.</p>}
    {adding && <div className="bn-add">
      <label>Course<select className="cl-in" value={add.courseId} onChange={(ev) => setAdd({ ...add, courseId: ev.target.value })}><option value="">Select a Course</option>{open.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
      <label>Course No.<input className="cl-in cl-mono" value={add.middle} placeholder="e.g. 510" onChange={(ev) => setAdd({ ...add, middle: ev.target.value })} /></label>
      <label>First No.<input className="cl-in cl-mono" inputMode="numeric" value={add.next} onChange={(ev) => setAdd({ ...add, next: ev.target.value })} /></label>
      <button type="button" className="portal-secondary" onClick={() => setAdding(false)}>Cancel</button>
      <button type="button" className="portal-primary" disabled={busy || !add.courseId || !COURSE_NO.test(add.middle.trim()) || !(Number(add.next) > 0 && Number(add.next) < 1000)} onClick={() => save(add.courseId, add.middle.trim(), Number(add.next), () => { setAdding(false); setAdd({ courseId: "", middle: "", next: "001" }); })}>Add</button>
    </div>}
    <p className="ac-foot bn-foot"><span>Every other course is numbered automatically (BCH).</span><span>Restarts at 001 every January.</span></p>
  </section>;
}

const PERIODS = ["This Week", "This Month", "Next Month"] as const;
function periodRange(period: (typeof PERIODS)[number], today: string): [string, string] {
  const monthEnd = (d: string) => { const [y, m] = d.split("-").map(Number); return `${d.slice(0, 8)}${new Date(Date.UTC(y, m, 0)).getUTCDate()}`; };
  if (period === "This Week") return [today, addDays(today, 6)];
  if (period === "This Month") return [today, monthEnd(today)];
  const next = addDays(monthEnd(today), 1);
  return [next, monthEnd(next)];
}

function UpcomingBatches({ data, busy, post }: { data: PortalData; busy: boolean; post: Post }) {
  const today = manilaToday();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("This Month"), [q, setQ] = useState(""), [draft, setDraft] = useState<Record<string, string>>({});
  const term = q.trim().toLowerCase();
  const [from, to] = periodRange(period, today);
  const list = data.batches.filter((b) => !b.partner_offer_id && b.status !== "Cancelled" && b.ends_on >= today && (term ? `${b.batch_number} ${codeOf(data, b.course_id)} ${nameOf(data, b)}`.toLowerCase().includes(term) : b.starts_on >= from && b.starts_on <= to))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.batch_number.localeCompare(b.batch_number));
  const paged = usePaged(list);
  return <section className="portal-panel cx-panel">
    <div className="panel-heading"><h2>Upcoming Batches</h2><span className="cx-seg" role="group" aria-label="Period">{PERIODS.map((p) => <button key={p} type="button" className={period === p && !term ? "on" : ""} onClick={() => { setPeriod(p); setQ(""); }}>{p}</button>)}</span></div>
    <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search batches" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search batch number or course" /></div>
    {paged.shown.length ? <div className="portal-table cx-cards bn-table"><table>
      <thead><tr><th>Starts</th><th>Course</th><th>Batch No.</th><th>Trainees</th><th /></tr></thead>
      <tbody>{paged.shown.map((b) => {
        const value = (draft[b.id] ?? b.batch_number).trim().toUpperCase();
        const usedBy = value !== b.batch_number ? data.batches.find((x) => x.batch_number === value && x.id !== b.id) : undefined;
        const problem = batchNumberProblem(value, usedBy, usedBy ? codeOf(data, usedBy.course_id) : undefined);
        const changed = value !== b.batch_number;
        return <tr key={b.id}>
          <td data-l="Starts"><b>{dates(b.starts_on, b.ends_on)}</b></td>
          <td data-l="Course"><b>{codeOf(data, b.course_id)}</b><small className="cl-sub cl-block">{nameOf(data, b)}</small></td>
          <td data-l="Batch No."><input className="cl-in cl-mono bn-wide" aria-label={`Batch number, ${codeOf(data, b.course_id)} ${dates(b.starts_on, b.ends_on)}`} value={draft[b.id] ?? b.batch_number} onChange={(e) => setDraft({ ...draft, [b.id]: e.target.value })} />{changed && problem && <small className="bn-msg bad">{problem}</small>}</td>
          <td data-l="Trainees" className="cl-mono">{b.confirmed_count}</td>
          <td data-l=""><button type="button" className={changed ? "portal-primary" : "portal-secondary"} disabled={busy || !changed || !!problem} onClick={() => void post({ action: "batch-rename", batchId: b.id, batchNumber: value }, `Renamed ${b.batch_number} to ${value}.`).then(() => setDraft((all) => drop(all, b.id))).catch(() => undefined)}>Save</button></td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="portal-empty-copy">{term ? "No batch matches." : "No batches on these dates."}</p>}
    {term && <p className="ac-foot">Searching all upcoming dates · {list.length} found</p>}
    {paged.pager}
  </section>;
}
