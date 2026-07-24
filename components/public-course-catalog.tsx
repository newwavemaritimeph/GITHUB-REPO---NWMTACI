"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
import { SystemProvider, useSystem } from "@/lib/system/store";

const filters = ["All Courses", "STCW Courses", "In-House Courses"] as const;
type Filter = (typeof filters)[number];

/** STCW vs In-House derives from the course's catalog category. */
function isStcw(category: string) {
  return category === "Upcoming MARINA STCW" || category === "MARINA Domestic";
}

function Catalog() {
  const { openBatchesFor, seats, ready } = useSystem();
  const [filter, setFilter] = useState<Filter>("All Courses");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return IN_HOUSE_COURSES.filter((course) => {
      const matchesFilter =
        filter === "All Courses" ||
        (filter === "STCW Courses" && isStcw(course.category)) ||
        (filter === "In-House Courses" && !isStcw(course.category));
      const matchesTerm = !term || `${course.code} ${course.course} ${course.modality}`.toLowerCase().includes(term);
      return matchesFilter && matchesTerm;
    }).map((course) => {
      const schedules = ready ? openBatchesFor(course.code) : [];
      const availableSlots = schedules.reduce((sum, batch) => sum + seats(batch.id).available, 0);
      return { course, scheduleCount: schedules.length, availableSlots };
    });
  }, [filter, query, openBatchesFor, seats, ready]);

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
        {rows.map(({ course, scheduleCount, availableSlots }) => (
          <article key={course.id} className="course-card-public">
            <span className={`course-badge ${isStcw(course.category) ? "stcw" : "inhouse"}`}>{isStcw(course.category) ? "STCW" : "In-House"}</span>
            <h3>{course.course}</h3>
            <small className="course-code">{course.code}</small>
            <dl className="course-facts">
              <div><dt>Duration</dt><dd>{course.duration}</dd></div>
              <div><dt>Modality</dt><dd>{course.modality}</dd></div>
              <div><dt>Available schedules</dt><dd>{scheduleCount > 0 ? scheduleCount : "None yet"}</dd></div>
              <div><dt>Available slots</dt><dd>{scheduleCount > 0 ? availableSlots : "—"}</dd></div>
            </dl>
            <Link className={`button button-primary button-small ${scheduleCount === 0 ? "button-muted" : ""}`} href="/register">
              {scheduleCount > 0 ? "Enroll Now" : "Ask about schedule"}
            </Link>
          </article>
        ))}
      </div>
      {rows.length === 0 && <div className="catalog-empty">No course matches your search.</div>}
      <p className="catalog-note">
        Schedules and slots come directly from batches published by New Wave. Course fees are confirmed during enrollment.
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
