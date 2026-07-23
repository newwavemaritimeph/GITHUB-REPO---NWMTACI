"use client";

import { useMemo, useState } from "react";
import { DataTable, EmptyState, Field, Modal, Pill, ProgressBar, SearchInput, Segmented, StatCard, useToast } from "@/components/ui/kit";
import { pesos } from "@/lib/endorsement-catalog";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
import { formatDate, formatDateRange, todayIso, useSystem } from "@/lib/system/store";
import { batchPatternLabel, courseDays, planBatches } from "@/lib/scheduling";
import type { Batch } from "@/lib/system/types";
import { PageHeader, Panel } from "./shared";

const filters = ["Published", "Draft", "Ongoing", "Completed", "All"] as const;

export function SchedulesModule() {
  const { state, seats, createBatch, publishBatch, setBatchStatus } = useSystem();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof filters)[number]>("Published");
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return state.batches
      .filter((batch) => {
        const matchesFilter =
          filter === "All" ||
          (filter === "Published" && batch.publishedAt !== null && (batch.status === "Open" || batch.status === "Full")) ||
          (filter === "Draft" && (batch.status === "Draft" || batch.publishedAt === null)) ||
          (filter === "Ongoing" && batch.status === "Ongoing") ||
          (filter === "Completed" && (batch.status === "Completed" || batch.status === "Cancelled"));
        const haystack = `${batch.batchNumber} ${batch.courseName} ${batch.instructor} ${batch.venue}`.toLowerCase();
        return matchesFilter && (!term || haystack.includes(term));
      })
      .sort((left, right) => left.startsOn.localeCompare(right.startsOn));
  }, [filter, query, state.batches]);

  const openSeats = state.batches
    .filter((batch) => batch.status === "Open")
    .reduce((sum, batch) => sum + seats(batch.id).available, 0);
  const todayBatches = state.batches.filter((batch) => batch.startsOn <= todayIso() && batch.endsOn >= todayIso());

  return (
    <div className="page">
      <PageHeader
        eyebrow="Training operations"
        title="Schedules & resources"
        description="Capacity-safe batches, instructors, venues, and publication control for the public website."
        actions={
          <>
            <button className="secondary-button" onClick={() => setAutoOpen(true)}>
              Auto-open schedules
            </button>
            <button className="primary-button" onClick={() => setNewOpen(true)}>
              + New batch
            </button>
          </>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label="Open batches" value={String(state.batches.filter((batch) => batch.status === "Open").length)} note={`${openSeats} slots available`} tone={0} icon="□" />
        <StatCard label="Running today" value={String(todayBatches.length)} note={todayBatches.map((batch) => batch.venue).join(", ") || "No class today"} tone={3} icon="◉" />
        <StatCard label="Awaiting publication" value={String(state.batches.filter((batch) => batch.publishedAt === null && batch.status !== "Cancelled").length)} note="Hidden from the public site" tone={1} icon="!" />
        <StatCard label="Full batches" value={String(state.batches.filter((batch) => batch.status === "Full").length)} note="Preserved for history" tone={2} icon="✓" />
      </div>

      <Panel padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search batch, course, instructor, or venue" />
          <Segmented options={filters} value={filter} onChange={setFilter} />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No batches in this view" text="Create a batch and publish it so it appears on the public registration form." />
        ) : (
          <DataTable columns={["Batch", "Course", "Dates", "Venue & instructor", "Capacity", "Fee", "Status", ""]} minWidth={1080}>
            {rows.map((batch) => {
              const seat = seats(batch.id);
              return (
                <tr key={batch.id}>
                  <td>
                    <strong>{batch.batchNumber}</strong>
                    <small>{batch.publishedAt ? `Published ${formatDate(batch.publishedAt)}` : "Not published"}</small>
                  </td>
                  <td>
                    <strong>{batch.courseName}</strong>
                    <small>{batch.courseCode}</small>
                  </td>
                  <td>
                    {formatDateRange(batch.startsOn, batch.endsOn)}
                    <small>{batch.trainingDays} training day{batch.trainingDays === 1 ? "" : "s"}</small>
                  </td>
                  <td>
                    {batch.venue}
                    <small>{batch.instructor}</small>
                  </td>
                  <td className="capacity-cell">
                    <ProgressBar value={seat.taken} max={seat.capacity} />
                    <small>
                      {seat.taken}/{seat.capacity} · {seat.available} open
                    </small>
                  </td>
                  <td>
                    <strong>{pesos(batch.feeCentavos)}</strong>
                  </td>
                  <td>
                    <Pill
                      tone={
                        batch.status === "Open"
                          ? "green"
                          : batch.status === "Full"
                            ? "amber"
                            : batch.status === "Ongoing"
                              ? "blue"
                              : batch.status === "Cancelled"
                                ? "red"
                                : "slate"
                      }
                    >
                      {batch.status}
                    </Pill>
                  </td>
                  <td className="cell-actions">
                    {batch.publishedAt === null && batch.status !== "Cancelled" ? (
                      <button
                        className="ghost-button"
                        onClick={() => {
                          publishBatch(batch.id);
                          toast("success", `${batch.batchNumber} is now visible on the public registration form.`);
                        }}
                      >
                        Publish
                      </button>
                    ) : batch.status !== "Cancelled" && batch.status !== "Completed" ? (
                      <button
                        className="ghost-button ghost-danger"
                        onClick={() => {
                          setBatchStatus(batch.id, "Cancelled");
                          toast("warning", `${batch.batchNumber} cancelled.`);
                        }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <span className="muted-text">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <AutoOpenModal
        open={autoOpen}
        onClose={() => setAutoOpen(false)}
        onCreate={(batches) => {
          batches.forEach((batch) => {
            const created = createBatch(batch);
            publishBatch(created.id);
          });
          toast("success", `${batches.length} schedule${batches.length === 1 ? "" : "s"} opened and published.`);
          setAutoOpen(false);
          setFilter("Published");
        }}
      />

      <NewBatchModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={(input) => {
          const batch = createBatch(input);
          toast("success", `${batch.batchNumber} created as a draft. Publish it when it is ready.`);
          setNewOpen(false);
          setFilter("Draft");
        }}
      />
    </div>
  );
}

function NewBatchModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    batchNumber: string;
    courseCode: string;
    courseName: string;
    centerName: string;
    startsOn: string;
    endsOn: string;
    mode: string;
    venue: string;
    capacity: number;
    instructor: string;
    enrollmentDeadline: string;
    feeCentavos: number;
    trainingDays: number;
  }) => void;
}) {
  const [courseCode, setCourseCode] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [days, setDays] = useState(1);
  const [capacity, setCapacity] = useState(20);
  const [venue, setVenue] = useState("Room 301");
  const [instructor, setInstructor] = useState("Capt. Ruel Aquino");

  const course = IN_HOUSE_COURSES.find((item) => item.code === courseCode);
  const endsOn = useMemo(() => {
    if (!startsOn) return "";
    const date = new Date(`${startsOn}T00:00:00`);
    date.setDate(date.getDate() + Math.max(1, days) - 1);
    return date.toISOString().slice(0, 10);
  }, [days, startsOn]);

  const valid = Boolean(course && startsOn && startsOn > todayIso() && days > 0 && capacity > 0);

  return (
    <Modal
      open={open}
      title="New training batch"
      description="Batches start as drafts. Publishing makes them selectable during public registration."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!valid}
            onClick={() => {
              if (!course) return;
              const deadline = new Date(`${startsOn}T17:00:00`);
              deadline.setDate(deadline.getDate() - 1);
              onCreate({
                batchNumber: `${course.code}-${new Date().getFullYear()}-${String(Math.floor(100 + Math.random() * 899))}`,
                courseCode: course.code,
                courseName: course.course,
                centerName: "New Wave Maritime",
                startsOn,
                endsOn,
                mode: course.modality,
                venue,
                capacity,
                instructor,
                enrollmentDeadline: deadline.toISOString(),
                feeCentavos: course.priceCentavos,
                trainingDays: days,
              });
            }}
          >
            Create draft batch
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Course" full>
          <select value={courseCode} onChange={(event) => setCourseCode(event.target.value)}>
            <option value="">Select a course</option>
            {IN_HOUSE_COURSES.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code} — {item.course}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start date" hint="Must be a future date">
          <input type="date" value={startsOn} min={todayIso()} onChange={(event) => setStartsOn(event.target.value)} />
        </Field>
        <Field label="Training days" hint={endsOn ? `Ends ${formatDate(endsOn)}` : undefined}>
          <input type="number" min={1} max={20} value={days} onChange={(event) => setDays(Number(event.target.value))} />
        </Field>
        <Field label="Capacity">
          <input type="number" min={1} max={60} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} />
        </Field>
        <Field label="Venue">
          <select value={venue} onChange={(event) => setVenue(event.target.value)}>
            <option>Room 301</option>
            <option>Room 205</option>
            <option>Room 102</option>
            <option>Training yard</option>
            <option>Simulator lab</option>
          </select>
        </Field>
        <Field label="Instructor" full>
          <select value={instructor} onChange={(event) => setInstructor(event.target.value)}>
            <option>Capt. Ruel Aquino</option>
            <option>Engr. Dan Cruz</option>
            <option>Dr. Vina Lopez</option>
            <option>Ms. Karen Diaz</option>
            <option>Mr. Alvin Reyes</option>
          </select>
        </Field>
        {course && (
          <div className="form-full inline-note note-blue">
            <strong>{course.course}</strong>
            <p>
              {course.duration} · {course.modality} · fee {pesos(course.priceCentavos)} charged automatically on every enrollment
              in this batch.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Opens several batches at once from a course's weekly start pattern, so future
 * schedules exist on the public site without anyone picking dates by hand.
 * Endorsed partner courses have no New Wave pattern, so they take the date as picked.
 */
function AutoOpenModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (batches: Omit<Batch, "id" | "status" | "publishedAt">[]) => void;
}) {
  const [courseCode, setCourseCode] = useState("");
  const [from, setFrom] = useState(todayIso());
  const [count, setCount] = useState(4);
  const [endorsed, setEndorsed] = useState(false);
  const [capacity, setCapacity] = useState(20);
  const [venue, setVenue] = useState("Room 301");
  const [instructor, setInstructor] = useState("Capt. Ruel Aquino");

  const course = IN_HOUSE_COURSES.find((item) => item.code === courseCode);
  const planned = course
    ? planBatches({ code: course.code, durationLabel: course.duration, from, count: endorsed ? 1 : count, endorsed })
    : [];

  return (
    <Modal
      open={open}
      title="Auto-open schedules"
      description="Generates future batches from the course's start pattern and publishes them."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!course || planned.length === 0}
            onClick={() => {
              if (!course) return;
              onCreate(
                planned.map((slot, index) => {
                  const deadline = new Date(`${slot.startsOn}T17:00:00`);
                  deadline.setDate(deadline.getDate() - 1);
                  return {
                    batchNumber: `${course.code}-${new Date(`${slot.startsOn}T00:00:00`).getFullYear()}-${String(Math.floor(100 + Math.random() * 899) + index).slice(0, 3)}`,
                    courseCode: course.code,
                    courseName: course.course,
                    centerName: endorsed ? "Endorsed partner center" : "New Wave Maritime",
                    startsOn: slot.startsOn,
                    endsOn: slot.endsOn,
                    mode: course.modality,
                    venue,
                    capacity,
                    instructor,
                    enrollmentDeadline: deadline.toISOString(),
                    feeCentavos: course.priceCentavos,
                    trainingDays: courseDays(course.duration),
                  };
                }),
              );
            }}
          >
            Open {planned.length} schedule{planned.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Course" full>
          <select value={courseCode} onChange={(event) => setCourseCode(event.target.value)}>
            <option value="">Select a course</option>
            {IN_HOUSE_COURSES.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code} — {item.course}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Open from" hint={endorsed ? "Used exactly as picked" : "The first matching date on or after this"}>
          <input type="date" value={from} min={todayIso()} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="How many" hint={endorsed ? "Endorsed courses open one at a time" : "Consecutive batches to open"}>
          <input
            type="number"
            min={1}
            max={12}
            value={count}
            disabled={endorsed}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </Field>
        <Field label="Capacity">
          <input type="number" min={1} max={60} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} />
        </Field>
        <Field label="Venue">
          <select value={venue} onChange={(event) => setVenue(event.target.value)}>
            <option>Room 301</option>
            <option>Room 205</option>
            <option>Room 102</option>
            <option>Training yard</option>
            <option>Simulator lab</option>
          </select>
        </Field>
        <Field label="Instructor" full>
          <select value={instructor} onChange={(event) => setInstructor(event.target.value)}>
            <option>Capt. Ruel Aquino</option>
            <option>Engr. Dan Cruz</option>
            <option>Dr. Vina Lopez</option>
            <option>Ms. Karen Diaz</option>
            <option>Mr. Alvin Reyes</option>
          </select>
        </Field>
        <label className="consent-row form-full">
          <input type="checkbox" checked={endorsed} onChange={(event) => setEndorsed(event.target.checked)} />
          <span>
            This is an endorsed partner course. New Wave&apos;s weekly start pattern does not apply, so the date above is used
            exactly as picked.
          </span>
        </label>
        {course && (
          <div className="form-full inline-note note-blue">
            <strong>{endorsed ? "Endorsed schedule" : batchPatternLabel(course.code, course.duration)}</strong>
            {planned.length === 0 ? (
              <p>No date matching this pattern was found. Try a different starting point.</p>
            ) : (
              <p>
                {planned
                  .map((slot) => `${formatDate(slot.startsOn)} – ${formatDate(slot.endsOn)}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
