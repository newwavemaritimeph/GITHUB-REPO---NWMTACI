"use client";

import { useEffect, useState } from "react";
import { addDays, manilaToday, pesos2 } from "@/lib/portal-format";
import { balanceAt, finalList, leftOff, mismoCsv, owesAt, unsettledAt11, type MismoDay } from "@/lib/mismo";
import { Badge, Message, usePost } from "./shared-ui";

/**
 * MARINA MISMO Compliance Officer (owner, 8 Oct 2026). For the five STCW
 * courses in class on a day: who still owes at 11:00 AM (printed for the
 * instructor), and the final list of trainees settled by 4:00 PM for the
 * MARINA MISMO Portal (Excel/CSV, PDF, mark as submitted).
 */

type History = { batch_id: string; list_date: string; trainee_count: number; submitted_at: string; profiles?: { complete_name: string } | { complete_name: string }[] | null; batches?: { batch_number: string; courses: { name: string; code: string } | { name: string; code: string }[] | null } | { batch_number: string; courses: unknown }[] | null };
type Payload = MismoDay & { now: string; history: History[] };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const longDay = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const fmt = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
/** Manila hour now (0–23). */
const manilaHour = () => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Manila" }).format(new Date()));

function useMismo(date: string) {
  const [state, setState] = useState<{ date: string; data: Payload | null; error: string; tick: number }>({ date: "", data: null, error: "", tick: 0 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch(`/api/staff/mismo?date=${date}`, { cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Could not load."); if (live) setState({ date, data: b as Payload, error: "", tick }); })
      .catch((e) => { if (live) setState({ date, data: null, error: e instanceof Error ? e.message : "Could not load.", tick }); });
    return () => { live = false; };
  }, [date, tick]);
  // Refresh every 2 minutes so payments recorded by the Cashier show up.
  useEffect(() => { const id = window.setInterval(() => setTick((t) => t + 1), 120_000); return () => window.clearInterval(id); }, []);
  return { data: state.date === date ? state.data : null, error: state.date === date ? state.error : "", reload: () => setTick((t) => t + 1) };
}

function DayPicker({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const today = manilaToday();
  return <div className="ac-day"><button type="button" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>‹</button><input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /><button type="button" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</button></div>;
}
function Head({ title, date, setDate }: { title: string; date?: string; setDate?: (d: string) => void }) {
  return <div className="cx-head"><div><span className="portal-eyebrow">MISMO Compliance Officer</span><h1>{title}</h1></div>{date && setDate && <DayPicker date={date} setDate={setDate} />}</div>;
}
const pdfUrl = (date: string, list: "final" | "unsettled", batch?: string) => `/api/documents/mismo?date=${date}&list=${list}${batch ? `&batch=${batch}` : ""}`;

export function MismoDashboard({ go }: { go: (m: string) => void }) {
  const [date, setDate] = useState(manilaToday());
  const { data, error } = useMismo(date);
  const isToday = date === manilaToday();
  const hour = isToday ? manilaHour() : 24;
  const trainees = data ? data.batches.flatMap((b) => b.trainees.map((t) => ({ t, b }))) : [];
  const owingNow = trainees.filter(({ t }) => owesAt(t, hour >= 16 ? "16" : "now"));
  const at11 = trainees.filter(({ t }) => owesAt(t, "11"));
  const submitted = data ? data.batches.filter((b) => b.submittedAt).length : 0;
  return <div className="portal-page cx ac ms-page">
    <Head title="Dashboard" date={date} setDate={setDate} />
    <p className="ac-note">{longDay(date)}{data ? ` · STCW classes: ${data.batches.map((b) => b.courseCode).join(", ") || "none"}` : ""}</p>
    {error && <Message kind="error" text={error} />}
    {data && data.batches.length > 0 && (hour < 11
      ? <div className="ms-banner blue"><b>The 11:00 AM list opens at 11:00 AM.</b><span>Right now {owingNow.length} trainee{owingNow.length === 1 ? "" : "s"} still owe a balance.</span></div>
      : hour < 16
        ? at11.length > 0 && <div className="ms-banner red"><b>{at11.length} trainee{at11.length === 1 ? "" : "s"} not settled as of 11:00 AM</b><span>Print the list and give it to the instructor so they send the trainees to the Cashier.</span><a className="ms-bbtn" href={pdfUrl(date, "unsettled")} target="_blank" rel="noreferrer">Print for the Instructor</a></div>
        : <div className="ms-banner green"><b>4:00 PM cut-off passed.</b><span>The final list for the MARINA MISMO Portal is ready. {submitted} of {data.batches.length} batches submitted.</span><button type="button" className="ms-bbtn" onClick={() => go("Final list")}>Open Final List</button></div>)}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Today&apos;s STCW Trainees</h2></div>
          <div className="cx-tiles ac-tiles ac-tiles-in">
            <div className="cx-tile ac-count" style={{ ["--c" as string]: "#0a7a3e" }}><span>Settled</span><b>{trainees.length - owingNow.length}</b></div>
            <div className={`cx-tile ac-count${owingNow.length ? " cl-overdue" : ""}`} style={{ ["--c" as string]: "#b42318" }}><span>{hour >= 16 ? "Not settled (left off)" : "Not settled yet"}</span><b>{owingNow.length}</b></div>
            <div className="cx-tile ac-total ac-count"><span>In class</span><b>{trainees.length}</b></div>
          </div>
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Deadlines</h2></div>
          <dl className="ac-lines"><div><dt>11:00 AM</dt><dd>{hour >= 11 ? "List ready" : "Not yet"}</dd></div><div><dt>4:00 PM</dt><dd>{hour >= 16 ? "Final list ready" : "Cut-off"}</dd></div><div><dt>Submitted to MARINA</dt><dd>{submitted} of {data?.batches.length ?? 0}</dd></div></dl>
          <p className="ac-foot">After 4:00 PM, trainees who still owe are left off the MARINA list automatically.</p>
        </section>
      </div>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Pending Balances at 11:00 AM</h2>{hour >= 11 && at11.length > 0 && <a className="portal-secondary" href={pdfUrl(date, "unsettled")} target="_blank" rel="noreferrer">Print All Batches</a>}</div>
        {!data ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : !data.batches.length ? <p className="portal-empty-copy">No STCW class on this day.</p> : hour < 11 ? <p className="portal-empty-copy">The list is taken at 11:00 AM.</p> : at11.length ? <>
          {/* Per batch (owner, 9 Oct 2026): each batch with its trainees still owing at 11:00 AM, their total, and its own print. */}
          {data.batches.map((b) => { const owing = unsettledAt11(b); if (!owing.length) return null; const total = owing.reduce((s, t) => s + balanceAt(t, "11"), 0); return <div key={b.id} className="ms-batch">
            <div className="ms-bhead"><div><b>{b.batchNumber} · {b.courseCode}</b><span>{b.room ?? "Room not set"} · {b.instructor ?? "Instructor not set"}</span></div><span className="cl-acts"><span className="ms-btotal">{owing.length} trainee{owing.length === 1 ? "" : "s"} · <b className="cl-mono">{pesos2(total)}</b></span><a className="portal-secondary" href={pdfUrl(date, "unsettled", b.id)} target="_blank" rel="noreferrer">Print</a></span></div>
            <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Trainee</th><th>Balance at 11:00</th><th>Now</th></tr></thead><tbody>
              {owing.map((t, i) => <tr key={t.enrollmentId}><td className="cl-no">{i + 1}</td><td><b>{t.lastName}, {t.firstName}</b></td><td className="cl-mono">{pesos2(balanceAt(t, "11"))}</td><td>{owesAt(t, "now") ? <Badge tone="red">{pesos2(balanceAt(t, "now"))} due</Badge> : <Badge tone="green">Paid Since</Badge>}</td></tr>)}
            </tbody></table></div>
          </div>; })}
          <p className="ac-foot">Total pending at 11:00 AM: {at11.length} trainee{at11.length === 1 ? "" : "s"} · {pesos2(at11.reduce((s, x) => s + balanceAt(x.t, "11"), 0))}. Print a batch and give it to its instructor.</p></> : <p className="portal-empty-copy">Everyone in today&apos;s STCW classes had settled by 11:00 AM.</p>}
      </section>
    </div>
  </div>;
}

export function MismoFinalList() {
  const [date, setDate] = useState(manilaToday());
  const { data, error, reload } = useMismo(date);
  const { busy, msg, post } = usePost(async () => reload());
  const isToday = date === manilaToday();
  const ready = !isToday || manilaHour() >= 16;
  const csv = (b: MismoDay["batches"][number]) => {
    const url = URL.createObjectURL(new Blob(["﻿" + mismoCsv(b)], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = `MISMO-${b.batchNumber}-${date}.csv`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return <div className="portal-page cx ac ms-page">
    <Head title="Final List" date={date} setDate={setDate} />
    <p className="ac-note">{longDay(date)} · trainees settled by 4:00 PM, for the MARINA MISMO Portal</p>
    {error && <Message kind="error" text={error} />}
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {!data ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : !data.batches.length ? <section className="portal-panel cx-panel"><p className="portal-empty-copy">No STCW class on this day.</p></section>
      : !ready ? <div className="ms-banner amber"><b>The final list is made at 4:00 PM.</b><span>Trainees who settle before then are included.</span></div>
      : data.batches.map((b) => { const ok = finalList(b), out = leftOff(b); return <section className="portal-panel cx-panel" key={b.id}>
        <div className="panel-heading"><h2>{b.batchNumber} · {b.courseName}</h2><span className="cl-acts">
          <button type="button" className="portal-secondary" disabled={!ok.length} onClick={() => csv(b)}>Excel / CSV</button>
          <a className="portal-secondary" href={pdfUrl(date, "final", b.id)} target="_blank" rel="noreferrer">Print PDF</a>
          {b.submittedAt ? <Badge tone="green">Submitted {fmt(b.submittedAt)}</Badge> : <button type="button" className="portal-primary" disabled={busy || !ok.length} onClick={() => void post({ action: "mismo-submit", batchId: b.id, listDate: date, enrollmentIds: ok.map((t) => t.enrollmentId) }, "Recorded as submitted to MARINA.").catch(() => undefined)}>Mark as Submitted</button>}
        </span></div>
        <p className="ms-sub"><b>{ok.length} trainee{ok.length === 1 ? "" : "s"} for MARINA</b> · {b.startsOn === b.endsOn ? b.startsOn : `${b.startsOn} to ${b.endsOn}`} · {b.room ?? "Room not set"} · {b.instructor ?? "Instructor not set"}{out.length ? ` · ${out.length} left off (unpaid at 4:00 PM)` : ""}</p>
        <div className="cl-wrap"><table className="cl-log"><thead><tr><th>#</th><th>Last Name</th><th>First Name</th><th>Middle Name</th><th>Birth Date</th><th>SRN</th><th>Rank</th><th>Course</th></tr></thead><tbody>
          {ok.map((t, i) => <tr key={t.enrollmentId}><td className="cl-no">{i + 1}</td><td><b>{t.lastName}</b></td><td>{t.firstName}</td><td>{t.middleName || "—"}</td><td className="cl-mono">{t.birthdate ?? "—"}</td><td className="cl-mono">{t.srn ?? "—"}</td><td>{t.rank ?? "—"}</td><td>{b.courseCode}</td></tr>)}
          {out.map((t) => <tr key={t.enrollmentId} className="ms-out"><td className="cl-no">—</td><td>{t.lastName}</td><td>{t.firstName}</td><td>{t.middleName || "—"}</td><td className="cl-mono">{t.birthdate ?? "—"}</td><td className="cl-mono">{t.srn ?? "—"}</td><td>{t.rank ?? "—"}</td><td>Left off · {pesos2(balanceAt(t, "16"))} unpaid</td></tr>)}
        </tbody></table></div>
      </section>; })}
  </div>;
}

export function MismoSubmissions() {
  const { data, error } = useMismo(manilaToday());
  const rows = data?.history ?? [];
  return <div className="portal-page cx ac ms-page">
    <Head title="Submissions" />
    {error && <Message kind="error" text={error} />}
    <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Submitted to the MARINA MISMO Portal</h2><span className="slot-count">{rows.length}</span></div>
      {rows.length ? <div className="cl-wrap"><table className="cl-log"><thead><tr><th>List Date</th><th>Batch</th><th>Course</th><th>Trainees</th><th>Submitted</th><th>By</th></tr></thead><tbody>
        {rows.map((h) => { const b = one(h.batches as { batch_number: string; courses: unknown } | null); const c = one(b?.courses as { name: string; code: string } | null); return <tr key={h.batch_id}><td>{h.list_date}</td><td className="cl-mono">{b?.batch_number ?? "—"}</td><td>{c?.code ?? "—"}</td><td className="cl-mono">{h.trainee_count}</td><td>{fmt(h.submitted_at)}</td><td>{one(h.profiles)?.complete_name ?? "—"}</td></tr>; })}
      </tbody></table></div> : <p className="portal-empty-copy">{data ? "Nothing submitted yet." : error ? "" : "Loading…"}</p>}
    </section>
  </div>;
}
