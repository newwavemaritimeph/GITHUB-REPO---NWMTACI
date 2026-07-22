"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SystemProvider, formatDate, formatDateRange, todayIso, useSystem } from "@/lib/system/store";

function SchedulesList() {
  const { state, ready, seats } = useSystem();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return state.batches
      .filter(
        (batch) =>
          batch.publishedAt !== null &&
          batch.startsOn > todayIso() &&
          batch.status !== "Cancelled" &&
          seats(batch.id).available > 0 &&
          (!term || `${batch.courseName} ${batch.batchNumber} ${batch.venue}`.toLowerCase().includes(term)),
      )
      .sort((left, right) => left.startsOn.localeCompare(right.startsOn));
  }, [query, seats, state.batches]);

  if (!ready) return <p className="muted-text">Loading published schedules…</p>;

  if (rows.length === 0) {
    return (
      <div className="schedule-empty">
        <div className="calendar-mark">{new Date().getDate()}</div>
        <h2>No open schedule right now</h2>
        <p>
          Full, ongoing, and past batches are hidden automatically. Approved dates appear as soon as Training Operations
          publishes them.
        </p>
        <Link className="button button-primary" href="/contact">
          Ask about upcoming dates
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="public-filter">
        <label>
          Search schedules
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Course, batch, or venue" />
        </label>
        <span className="catalog-count">
          {rows.length} open batch{rows.length === 1 ? "" : "es"}
        </span>
      </div>
      <div className="schedule-cards">
        {rows.map((batch) => {
          const seat = seats(batch.id);
          return (
            <article key={batch.id}>
              <span className="schedule-date">
                <b>{new Date(`${batch.startsOn}T00:00:00`).getDate()}</b>
                {new Intl.DateTimeFormat("en-PH", { month: "short" }).format(new Date(`${batch.startsOn}T00:00:00`))}
              </span>
              <div>
                <h3>{batch.courseName}</h3>
                <p>
                  {formatDateRange(batch.startsOn, batch.endsOn)} · {batch.mode}
                </p>
                <p className="schedule-meta">
                  {batch.venue} · {batch.batchNumber} · enrollment closes {formatDate(batch.enrollmentDeadline)}
                </p>
              </div>
              <div className="schedule-cta">
                <span className={seat.available <= 3 ? "slots low" : "slots"}>
                  {seat.available} slot{seat.available === 1 ? "" : "s"} left
                </span>
                <Link className="button button-primary button-small" href="/register">
                  Register
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function PublicSchedules() {
  return (
    <SystemProvider>
      <SchedulesList />
    </SystemProvider>
  );
}
