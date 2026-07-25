"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SystemProvider, useSystem } from "@/lib/system/store";

const filters = ["All Courses", "STCW Courses", "In-House Courses"] as const;
type Filter = (typeof filters)[number];

/** STCW vs In-House derives from the course's catalog category. */
function isStcw(category: string) {
  return category === "Accredited MARINA STCW" || category === "MARINA Domestic";
}

const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "long", year: "numeric" }).toUpperCase();
const dayRange = (start: string, end: string) => {
  const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric" }).toUpperCase();
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
};

/** Group a course's open batches into [MONTH, [date ranges…]] so the public
 * catalog can list every available date per month without exposing seat counts. */
function groupByMonth(batches: { startsOn: string; endsOn: string }[]) {
  const map = new Map<string, string[]>();
  for (const batch of [...batches].sort((a, z) => a.startsOn.localeCompare(z.startsOn))) {
    const key = monthLabel(batch.startsOn);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(dayRange(batch.startsOn, batch.endsOn));
  }
  return [...map.entries()];
}

function Catalog() {
  const { state, openBatchesFor, ready } = useSystem();
  const [filter, setFilter] = useState<Filter>("All Courses");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return state.courses.filter((course) => course.active).filter((course) => {
      const matchesFilter =
        filter === "All Courses" ||
        (filter === "STCW Courses" && isStcw(course.category)) ||
        (filter === "In-House Courses" && !isStcw(course.category));
      const matchesTerm = !term || `${course.code} ${course.course} ${course.modality}`.toLowerCase().includes(term);
      return matchesFilter && matchesTerm;
    }).map((course) => {
      const schedules = ready ? openBatchesFor(course.code) : [];
      return { course, scheduleCount: schedules.length, months: groupByMonth(schedules) };
    });
  }, [state.courses, filter, query, openBatchesFor, ready]);

  return (
    <div className="catalog-wrap">
      <div className="catalog-tabs" role="tablist" aria-label="Course categories">
        {filters.map((item) => (
          <button key={item} role="tab" aria-selected={filter === item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
            {item}
          </button>
        ))}
      </div>
      <div className="public-filter catalog-filter">
        <label>
          Search courses
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Course name or code" />
        </label>
        <span className="catalog-count">
          {rows.length} course{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="course-grid">
        {rows.map(({ course, scheduleCount, months }) => (
          <article key={course.id} className="course-card-public">
            <span className={`course-badge ${isStcw(course.category) ? "stcw" : "inhouse"}`}>{isStcw(course.category) ? "STCW" : "In-House"}</span>
            <h3>{course.course}</h3>
            <small className="course-code">{course.code}</small>
            <dl className="course-facts">
              <div><dt>Duration</dt><dd>{course.duration}</dd></div>
              <div><dt>Modality</dt><dd>{course.modality}</dd></div>
            </dl>
            {scheduleCount > 0 ? (
              <div className="course-schedules">
                <span className="schedule-status open">● Open for enrollment</span>
                <div className="schedule-months">
                  {months.map(([month, ranges]) => (
                    <div key={month} className="schedule-month">
                      <span className="schedule-month-label">{month}</span>
                      <ul>
                        {ranges.map((range) => (
                          <li key={range}>{range}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <span className="schedule-status soon">Schedule to be announced</span>
            )}
            <Link className={`button button-primary button-small ${scheduleCount === 0 ? "button-muted" : ""}`} href="/register">
              {scheduleCount > 0 ? "Enroll Now" : "Ask about schedule"}
            </Link>
          </article>
        ))}
      </div>
      {rows.length === 0 && <div className="catalog-empty">No course matches your search.</div>}
      <p className="catalog-note">
        Available dates come directly from batches published by New Wave. Course fees are confirmed during enrollment.
      </p>
    </div>
  );
}

export function PublicCourseCatalog() {
  return (
    <SystemProvider>
      <Catalog />
    </SystemProvider>
  );
}
