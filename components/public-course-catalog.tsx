"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { automaticEndDate, courseDays, fitsInWeek, lastStartWeekday } from "@/lib/scheduling";

/**
 * Public Courses page (owner, 7 Oct 2026), read live from /api/public/catalog:
 * - STCW schedules: the five STCW courses New Wave runs, with the batches the
 *   Scheduler has opened. Picking a date opens registration with that batch.
 * - In-House courses: choose a category and course, pick a start date; the end
 *   date follows the duration (Sundays skipped, consecutive within the week).
 *   Apply opens registration with the course and date.
 * No seat counts or fees are shown; fees are confirmed during screening.
 */

type Batch = { id: string; number: string; startsOn: string; endsOn: string };
type StcwCourse = { code: string; name: string; duration: string; modality: string; category: string; batches: Batch[] };
type InHouseCourse = { code: string; name: string; duration: string; modality: string; category: string };

const tabs = ["STCW schedules", "In-House courses"] as const;
type Tab = (typeof tabs)[number];

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const monthLabel = (iso: string) => fmt(iso, { month: "long", year: "numeric" }).toUpperCase();
const dayRange = (start: string, end: string) => {
  const s = fmt(start, { weekday: "short", month: "short", day: "numeric" });
  return start === end ? s : `${s} – ${start.slice(0, 7) === end.slice(0, 7) ? fmt(end, { weekday: "short", day: "numeric" }) : fmt(end, { weekday: "short", month: "short", day: "numeric" })}`;
};
const longDate = (iso: string) => fmt(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const manilaTomorrow = () => { const d = new Date(Date.now() + 8 * 3600000 + 86400000); return d.toISOString().slice(0, 10); };

function groupByMonth(batches: Batch[]) {
  const map = new Map<string, Batch[]>();
  for (const b of batches) map.set(monthLabel(b.startsOn), [...(map.get(monthLabel(b.startsOn)) ?? []), b]);
  return [...map.entries()];
}

function StcwCard({ course }: { course: StcwCourse }) {
  const [picked, setPicked] = useState(course.batches[0]?.id ?? "");
  const chosen = course.batches.find((b) => b.id === picked);
  return <article className="course-card-public">
    <span className="course-badge stcw">STCW</span>
    <h3>{course.name}</h3>
    <small className="course-code">{course.code}</small>
    <dl className="course-facts">
      <div><dt>Duration</dt><dd>{course.duration}</dd></div>
      <div><dt>Modality</dt><dd>{course.modality}</dd></div>
    </dl>
    {course.batches.length ? <div className="course-schedules">
      <span className="schedule-status open">● Open for enrollment · pick a date</span>
      <div className="schedule-months">
        {groupByMonth(course.batches).map(([month, list]) => <div key={month} className="schedule-month">
          <span className="schedule-month-label">{month}</span>
          <ul>{list.map((b) => <li key={b.id}><button type="button" className={`schedule-chip${picked === b.id ? " on" : ""}`} aria-pressed={picked === b.id} onClick={() => setPicked(b.id)}>{dayRange(b.startsOn, b.endsOn)}</button></li>)}</ul>
        </div>)}
      </div>
    </div> : <span className="schedule-status soon">Schedule to be announced</span>}
    {chosen
      ? <Link className="button button-primary button-small" href={`/register?batch=${chosen.id}`}>Enroll · {dayRange(chosen.startsOn, chosen.endsOn)}</Link>
      : <Link className="button button-primary button-small button-muted" href="/register">Ask about schedule</Link>}
  </article>;
}

function InHousePicker({ courses }: { courses: InHouseCourse[] }) {
  const categories = useMemo(() => [...new Set(courses.map((c) => c.category))], [courses]);
  const [category, setCategory] = useState("");
  const [code, setCode] = useState("");
  const [start, setStart] = useState("");
  const shown = courses.filter((c) => !category || c.category === category);
  const course = courses.find((c) => c.code === code);
  const min = manilaTomorrow();
  const days = course ? courseDays(course.duration) : 0;
  const lastDay = course ? WEEKDAYS[lastStartWeekday(course.duration)] : "";
  const startOk = !!course && !!start && start >= min && fitsInWeek(start, course.duration);
  const end = startOk && course ? automaticEndDate(start, course.duration) : "";
  const problem = !course || !start ? "" : start < min ? "Choose a date from tomorrow onwards." : new Date(`${start}T00:00:00Z`).getUTCDay() === 0 ? "There is no training on Sundays. Choose Monday to Saturday." : !startOk ? (days >= 6 ? "This course runs Monday to Saturday, so it starts on a Monday." : `A ${days}-day course runs on consecutive days within one week, so it can start Monday to ${lastDay}.`) : "";
  return <section className="inhouse-picker">
    <div className="inhouse-fields">
      <label>Category<select value={category} onChange={(e) => { setCategory(e.target.value); setCode(""); setStart(""); }}><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Course<select value={code} onChange={(e) => { setCode(e.target.value); setStart(""); }}><option value="">Select a course ({shown.length})</option>
        {(category ? [category] : categories).map((cat) => <optgroup key={cat} label={cat}>{shown.filter((c) => c.category === cat).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</optgroup>)}
      </select></label>
      <label>Start date<input type="date" value={start} min={min} disabled={!course} onChange={(e) => setStart(e.target.value)} /></label>
    </div>
    {course ? <div className="inhouse-summary">
      <div className="inhouse-course"><span className="course-badge inhouse">In-House</span><h3>{course.name}</h3><small className="course-code">{course.code} · {course.category}</small>
        <dl className="course-facts"><div><dt>Duration</dt><dd>{course.duration}</dd></div><div><dt>Modality</dt><dd>{course.modality}</dd></div></dl>
      </div>
      <div className="inhouse-dates">
        <div><span>Starts</span><b>{startOk ? longDate(start) : "Pick a start date"}</b></div>
        <div><span>Ends</span><b>{end ? longDate(end) : "—"}</b></div>
        <p className="inhouse-note">{problem || (days >= 6 ? "Runs Monday to Saturday. No training on Sundays." : `Runs ${days} consecutive day${days === 1 ? "" : "s"}, Monday to Saturday. It can start Monday to ${lastDay}.`)}</p>
        {startOk ? <Link className="button button-primary" href={`/register?course=${encodeURIComponent(course.code)}&start=${start}`}>Apply for this date</Link> : <span className="button button-primary button-muted" aria-disabled="true">Apply for this date</span>}
      </div>
    </div> : <p className="catalog-empty">Choose a course to pick your training date.</p>}
  </section>;
}

export function PublicCourseCatalog() {
  const [tab, setTab] = useState<Tab>("STCW schedules");
  const [data, setData] = useState<{ stcw: StcwCourse[]; inHouse: InHouseCourse[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/public/catalog").then((r) => r.json()).then((b) => { if (live) setData({ stcw: b.stcw ?? [], inHouse: b.inHouse ?? [] }); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return <div className="catalog-wrap">
    <div className="catalog-tabs" role="tablist" aria-label="Course categories">
      {tabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
    </div>
    {!data ? <div className="catalog-empty">{failed ? "Courses could not be loaded. Please refresh the page." : "Loading courses…"}</div>
      : tab === "STCW schedules" ? <>
        <div className="course-grid">{data.stcw.map((c) => <StcwCard key={c.code} course={c} />)}</div>
        {!data.stcw.length && <div className="catalog-empty">No STCW schedules are open right now.</div>}
      </> : data.inHouse.length ? <InHousePicker courses={data.inHouse} /> : <div className="catalog-empty">No in-house courses are listed right now.</div>}
    <p className="catalog-note">Dates come from schedules published by New Wave. Course fees are confirmed by our Registration team during screening.</p>
  </div>;
}
