"use client";

import { useMemo, useState } from "react";
import { ENDORSEMENT_OFFERS } from "@/lib/endorsement-catalog";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";

type PublicCategory = "STCW Courses" | "In-House Courses" | "Endorsed Trainings";
type PublicCourseRow = { id: string; course: string; code?: string; modality: string; duration: string };

const categories: PublicCategory[] = ["STCW Courses", "In-House Courses", "Endorsed Trainings"];

const endorsedCourses = Array.from(ENDORSEMENT_OFFERS.reduce((catalog, offer) => {
  const current = catalog.get(offer.course) ?? new Set<string>();
  current.add(offer.duration);
  catalog.set(offer.course, current);
  return catalog;
}, new Map<string, Set<string>>())).map(([course, durations]) => ({ course, duration: [...durations].join(" / "), modality: "Scheduled with an endorsed training provider" }));

function publicCategory(category: string): Exclude<PublicCategory, "Endorsed Trainings"> {
  return category === "Upcoming MARINA STCW" || category === "MARINA Domestic" ? "STCW Courses" : "In-House Courses";
}

export function PublicCourseCatalog() {
  const [category, setCategory] = useState<PublicCategory>("STCW Courses");
  const [query, setQuery] = useState("");
  const rows = useMemo<PublicCourseRow[]>(() => {
    const term = query.trim().toLowerCase();
    if (category === "Endorsed Trainings") return endorsedCourses.filter((item) => !term || `${item.course} ${item.duration}`.toLowerCase().includes(term)).map((item) => ({ ...item, id: `endorsed-${item.course}` }));
    return IN_HOUSE_COURSES.filter((course) => publicCategory(course.category) === category && (!term || `${course.code} ${course.course} ${course.modality} ${course.duration}`.toLowerCase().includes(term))).map((course) => ({ id: course.id, code: course.code, course: course.course, modality: course.modality, duration: course.duration }));
  }, [category, query]);

  return <div className="catalog-wrap">
    <div className="catalog-tabs" role="tablist" aria-label="Course categories">
      {categories.map((item) => <button key={item} role="tab" aria-selected={category === item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
    </div>
    <div className="public-filter catalog-filter">
      <label>Search courses<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Course name or code" /></label>
      <span className="catalog-count">{rows.length} course{rows.length === 1 ? "" : "s"}</span>
    </div>
    <div className="public-course-table" role="region" aria-label={`${category} list`} tabIndex={0}>
      <table><thead><tr><th>Course</th><th>Delivery</th><th>Duration</th></tr></thead><tbody>{rows.map((item) => {
        return <tr key={item.id}><td data-label="Course"><strong>{item.course}</strong>{item.code && <small className="course-code">{item.code}</small>}</td><td data-label="Delivery">{item.modality}</td><td data-label="Duration">{item.duration}</td></tr>;
      })}</tbody></table>
      {rows.length === 0 && <div className="catalog-empty">No course matches your search.</div>}
    </div>
    <p className="catalog-note">Course fees are confirmed privately during enrollment. Select a course during registration to see only schedules published by the Scheduler.</p>
  </div>;
}
