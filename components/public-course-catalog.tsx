"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { courseDays } from "@/lib/scheduling";

/**
 * Public Courses page (owner, 7 Oct 2026), read live from /api/public/catalog.
 * It only informs: STCW courses list their dates as Open or Full (seat counts stay internal), and
 * In-House courses are listed by category with their duration. Trainees choose
 * their courses and schedules (up to five) inside the registration form.
 */

type Batch = { id: string; number: string; startsOn: string; endsOn: string; full: boolean };
type StcwCourse = { code: string; name: string; duration: string; modality: string; category: string; batches: Batch[] };
type InHouseCourse = { code: string; name: string; duration: string; modality: string; category: string };

type OtherCourse = { code: string; name: string };
type PackageCourse = { code: string; name: string; duration: string; price: number; regular: number; weeks: { monday: string; ends: string; full: boolean }[] };
const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
const tabs = ["STCW schedules", "Other STCW Courses", "In-House courses"] as const;
type Tab = (typeof tabs)[number];

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const monthLabel = (iso: string) => fmt(iso, { month: "long", year: "numeric" }).toUpperCase();
const dayRange = (start: string, end: string) => {
  const s = fmt(start, { weekday: "short", month: "short", day: "numeric" });
  return start === end ? s : `${s} – ${start.slice(0, 7) === end.slice(0, 7) ? `${fmt(end, { weekday: "short" })} ${Number(end.slice(8, 10))}` : fmt(end, { weekday: "short", month: "short", day: "numeric" })}`;
};
/** Day pattern under the duration, e.g. "Tue–Wed", from the first batch. */
const pattern = (b?: Batch) => (b ? (b.startsOn === b.endsOn ? fmt(b.startsOn, { weekday: "short" }) : `${fmt(b.startsOn, { weekday: "short" })}–${fmt(b.endsOn, { weekday: "short" })}`) : "");
const LATE = new Set(["CCMD"]);
const SHOWN = 6;

function groupByMonth(batches: Batch[]) {
  const map = new Map<string, Batch[]>();
  for (const b of batches) map.set(monthLabel(b.startsOn), [...(map.get(monthLabel(b.startsOn)) ?? []), b]);
  return [...map.entries()];
}

function StcwCard({ course }: { course: StcwCourse }) {
  const [all, setAll] = useState(false);
  const list = all ? course.batches : course.batches.slice(0, SHOWN);
  const open = course.batches.filter((b) => !b.full).length;
  return <article className="course-card-public">
    <span className="course-badge stcw">STCW</span>
    <h3>{course.name}</h3>
    <small className="course-code">{course.code}</small>
    <dl className="course-facts">
      <div><dt>Duration</dt><dd>{course.duration}{course.batches.length ? ` · ${pattern(course.batches[0])}` : ""}</dd></div>
      <div><dt>Modality</dt><dd>{course.modality}</dd></div>
    </dl>
    {course.batches.length ? <div className="course-schedules">
      <span className="schedule-status open">● {open} open date{open === 1 ? "" : "s"}</span>
      <div className="slot-months">
        {groupByMonth(list).map(([month, rows]) => <div key={month}>
          <span className="schedule-month-label">{month}</span>
          <ul className="slot-list">{rows.map((b) => <li key={b.id} className={b.full ? "full" : ""}><b>{dayRange(b.startsOn, b.endsOn)}</b><i className={b.full ? "full" : ""}>{b.full ? "Full" : "Open"}</i></li>)}</ul>
        </div>)}
      </div>
      {course.batches.length > SHOWN && <button type="button" className="slot-more" onClick={() => setAll((v) => !v)}>{all ? "Show Fewer Dates" : `+ ${course.batches.length - SHOWN} more dates`}</button>}
    </div> : <span className="schedule-status soon">Schedule to be announced</span>}
    <p className="slot-foot">{LATE.has(course.code) ? "Late enrollment open until the last training day" : "Choose this course in the registration form"}</p>
  </article>;
}

/** CCI Package (owner, 21 Oct 2026): Safety, Crowd and Crisis in one week at the package price. */
function PackageCard({ pkg }: { pkg: PackageCourse }) {
  const open = pkg.weeks.filter((w) => !w.full);
  const [week, setWeek] = useState(open[0]?.monday ?? "");
  return <article className="course-card-public pkg-card">
    <span className="course-badge pkg">Package</span>
    <h3>{pkg.name}</h3>
    <small className="course-code">{pkg.code}</small>
    <p className="pkg-price"><b>{peso(pkg.price)}</b>{pkg.regular > pkg.price && <s>{peso(pkg.regular)}</s>}</p>
    <dl className="course-facts"><div><dt>Duration</dt><dd>{pkg.duration} · Mon–Sat</dd></div></dl>
    {pkg.weeks.length ? <ul className="slot-list pkg-weeks">{pkg.weeks.slice(0, SHOWN).map((w) => <li key={w.monday} className={`${w.full ? "full" : ""}${week === w.monday ? " on" : ""}`}><button type="button" disabled={w.full} onClick={() => setWeek(w.monday)}><b>{dayRange(w.monday, w.ends)}</b><i className={w.full ? "full" : ""}>{w.full ? "Full" : week === w.monday ? "Selected" : "Open"}</i></button></li>)}</ul>
      : <span className="schedule-status soon">Schedule to be announced</span>}
    {week && <Link className="pkg-enroll" href={`/register?package=${pkg.code}&week=${week}`}>Enroll Now</Link>}
  </article>;
}

function InHouseList({ courses }: { courses: InHouseCourse[] }) {
  const categories = useMemo(() => [...new Set(courses.map((c) => c.category))], [courses]);
  const [category, setCategory] = useState(categories[0] ?? "");
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const rows = courses.filter((c) => (!category || c.category === category) && (!term || `${c.code} ${c.name}`.toLowerCase().includes(term)));
  return <section className="inhouse-picker">
    <div className="inhouse-fields two">
      <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All Categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Search<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Course name or code" /></label>
    </div>
    <p className="inhouse-note">All In-House courses are online. Choose the course and your start date in the registration form; training runs on consecutive days, Monday to Saturday, with no Sundays.</p>
    <div className="inhouse-table"><table><thead><tr><th>Course</th><th>Code</th><th>Duration</th><th>Modality</th></tr></thead><tbody>
      {rows.map((c) => <tr key={c.code}><td>{c.name}</td><td>{c.code}</td><td>{c.duration}{courseDays(c.duration) > 1 ? " (consecutive)" : ""}</td><td>{c.modality}</td></tr>)}
    </tbody></table>{!rows.length && <p className="catalog-empty">No course matches.</p>}</div>
  </section>;
}

/** Other STCW Courses (owner, 20 Oct 2026): held at partnered centers; the course only — Registration confirms the center, date and fee. */
function OtherList({ courses }: { courses: OtherCourse[] }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const rows = courses.filter((c) => !term || `${c.code} ${c.name}`.toLowerCase().includes(term));
  return <section className="inhouse-picker">
    <div className="inhouse-fields"><label>Search<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Course name or code" /></label></div>
    <p className="inhouse-note">These STCW courses are held at our partnered training centers. Choose the course in the registration form; our Registration team confirms the training center, schedule and fee with you.</p>
    <div className="inhouse-table"><table><thead><tr><th>Course</th><th>Code</th></tr></thead><tbody>
      {rows.map((c) => <tr key={c.code}><td>{c.name}</td><td>{c.code}</td></tr>)}
    </tbody></table>{!rows.length && <p className="catalog-empty">No course matches.</p>}</div>
  </section>;
}

export function PublicCourseCatalog() {
  const [tab, setTab] = useState<Tab>("STCW schedules");
  const [data, setData] = useState<{ stcw: StcwCourse[]; inHouse: InHouseCourse[]; other: OtherCourse[]; packages: PackageCourse[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/public/catalog").then((r) => r.json()).then((b) => { if (live) setData({ stcw: b.stcw ?? [], inHouse: b.inHouse ?? [], other: b.other ?? [], packages: b.packages ?? [] }); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return <div className="catalog-wrap">
    <div className="catalog-tabs" role="tablist" aria-label="Course categories">
      {tabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}{data ? <span>{item === "STCW schedules" ? data.stcw.length : item === "Other STCW Courses" ? data.other.length : data.inHouse.length}</span> : null}</button>)}
    </div>
    {!data ? <div className="catalog-empty">{failed ? "Courses could not be loaded. Please refresh the page." : "Loading courses…"}</div>
      : tab === "STCW schedules" ? <>
        <div className="course-grid">{data.packages.map((p) => <PackageCard key={p.code} pkg={p} />)}{data.stcw.map((c) => <StcwCard key={c.code} course={c} />)}</div>
        {!data.stcw.length && <div className="catalog-empty">No STCW schedules are open right now.</div>}
      </> : tab === "Other STCW Courses" ? (data.other.length ? <OtherList courses={data.other} /> : <div className="catalog-empty">No other STCW courses are listed right now.</div>) : data.inHouse.length ? <InHouseList courses={data.inHouse} /> : <div className="catalog-empty">No in-house courses are listed right now.</div>}
    <div className="register-banner"><div><b>Ready to enroll?</b><span>Choose up to 5 courses and their schedules in one registration.</span></div><Link className="button button-primary" href="/register">Register Now →</Link></div>
    <p className="catalog-note">Dates come from schedules published by New Wave. Enrollment for STCW courses closes at 7:00 AM on the training date. Course fees are confirmed by our Registration team during screening.</p>
  </div>;
}
