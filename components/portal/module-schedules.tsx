"use client";

import { useMemo, useState } from "react";
import { DataTable, EmptyState, Field, Modal, Pill, ProgressBar, SearchInput, Segmented, StatCard, useToast } from "@/components/ui/kit";
import { pesos } from "@/lib/endorsement-catalog";
import { formatDate, formatDateRange, todayIso, useSystem } from "@/lib/system/store";
import { batchPatternLabel, monthlyBatchStarts } from "@/lib/scheduling";
import type { Role } from "@/lib/system/types";
import { PageHeader, Panel } from "./shared";

const filters = ["Published", "Draft", "Ongoing", "Completed", "All"] as const;

export function SchedulesModule({ role }: { role: Role }) {
  const { state, seats, createBatch, autoOpenMonth, publishBatch, setBatchStatus } = useSystem();
  // Registration can browse schedules but may not open, publish, or cancel batches.
  const readOnly = role === "Registration";
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
        description={
          readOnly
            ? "View published batches, dates, venues, and capacity. Opening or changing batches is handled by Training Operations."
            : "Capacity-safe batches, instructors, venues, and publication control for the public website."
        }
        actions={
          readOnly ? undefined : (
            <>
              <button className="secondary-button" onClick={() => setAutoOpen(true)}>
                Auto-open schedules
              </button>
              <button className="primary-button" onClick={() => setNewOpen(true)}>
                + New batch
              </button>
            </>
          )
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
                    {readOnly ? (
                      <span className="muted-text">—</span>
                    ) : batch.publishedAt === null && batch.status !== "Cancelled" ? (
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
        isScheduled={(courseCode, startsOn) =>
          state.batches.some((batch) => batch.courseCode === courseCode && batch.startsOn === startsOn && batch.status !== "Cancelled")
        }
        onRun={(input) => {
          const created = autoOpenMonth(input);
          toast(
            created > 0 ? "success" : "info",
            created > 0
              ? `${created} schedule${created === 1 ? "" : "s"} opened and published.`
              : "No new schedules — those dates are already open or in the past.",
          );
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
  const { state } = useSystem();
  const [courseCode, setCourseCode] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [days, setDays] = useState(1);
  const [capacity, setCapacity] = useState(20);
  const [venue, setVenue] = useState("Room 301");
  const [instructor, setInstructor] = useState("Capt. Ruel Aquino");

  const activeCourses = state.courses.filter((item) => item.active);
  const course = state.courses.find((item) => item.code === courseCode);
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
            {activeCourses.map((item) => (
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
            {state.classrooms.filter((room) => room.active).map((room) => (
              <option key={room.id}>{room.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Instructor" full>
          <select value={instructor} onChange={(event) => setInstructor(event.target.value)}>
            {state.instructors.filter((item) => item.active).map((item) => (
              <option key={item.id}>{item.name}</option>
            ))}
          </select>
        </Field>
        {course && (
          <div className="form-full inline-note note-blue">
            <strong>{course.course}</strong>
            <p>
              {course.duration} · {course.modality} · fee {pesos(course.priceCentavos)} charged automatically on every enrollment
              in this batch.
            </p>
            <p>
              Instruction template:{" "}
              {course.instructionTemplate ? "set for this course" : "not set — generic instruction email will be used"} ·
              Certificate template: {course.certificateTemplate ? course.certificateTemplate : "none yet"}.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Opens a whole month of schedules from a course's weekly start pattern, so the
 * public site always has upcoming dates without anyone picking them by hand. Runs
 * idempotently — dates already scheduled or in the past are skipped.
 */
function AutoOpenModal({
  open,
  onClose,
  onRun,
  isScheduled,
}: {
  open: boolean;
  onClose: () => void;
  onRun: (input: { courseCode: string; year: number; month: number; capacity: number; venue: string; instructor: string }) => void;
  isScheduled: (courseCode: string, startsOn: string) => boolean;
}) {
  const { state } = useSystem();
  const now = new Date();
  const [courseCode, setCourseCode] = useState("");
  const [monthKey, setMonthKey] = useState(`${now.getFullYear()}-${now.getMonth() + 1}`);
  const [capacity, setCapacity] = useState(20);
  const [venue, setVenue] = useState("Room 301");
  const [instructor, setInstructor] = useState("Capt. Ruel Aquino");

  const [year, month] = monthKey.split("-").map(Number);
  const activeCourses = state.courses.filter((item) => item.active);
  const course = state.courses.find((item) => item.code === courseCode);
  const preview = useMemo(
    () =>
      course
        ? monthlyBatchStarts(course.code, course.duration, year, month).filter(
            (iso) => iso > todayIso() && !isScheduled(course.code, iso),
          )
        : [],
    [course, year, month, isScheduled],
  );

  // Offer the current month plus the next five.
  const monthOptions = Array.from({ length: 6 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { key: `${date.getFullYear()}-${date.getMonth() + 1}`, label: `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}` };
  });

  return (
    <Modal
      open={open}
      title="Auto-open schedules for a month"
      description="Generates and publishes every batch matching the course's start pattern in the chosen month."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!course || preview.length === 0}
            onClick={() => course && onRun({ courseCode: course.code, year, month, capacity, venue, instructor })}
          >
            Open {preview.length} schedule{preview.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Course" full>
          <select value={courseCode} onChange={(event) => setCourseCode(event.target.value)}>
            <option value="">Select a course</option>
            {activeCourses.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code} — {item.course}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Month">
          <select value={monthKey} onChange={(event) => setMonthKey(event.target.value)}>
            {monthOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Capacity">
          <input type="number" min={1} max={60} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} />
        </Field>
        <Field label="Venue">
          <select value={venue} onChange={(event) => setVenue(event.target.value)}>
            {state.classrooms.filter((room) => room.active).map((room) => (
              <option key={room.id}>{room.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Instructor" full>
          <select value={instructor} onChange={(event) => setInstructor(event.target.value)}>
            {state.instructors.filter((item) => item.active).map((item) => (
              <option key={item.id}>{item.name}</option>
            ))}
          </select>
        </Field>
        {course && (
          <div className="form-full inline-note note-blue">
            <strong>{batchPatternLabel(course.code, course.duration)}</strong>
            {preview.length === 0 ? (
              <p>No new dates for this month — every pattern date is already open or in the past.</p>
            ) : (
              <p>{preview.map((iso) => formatDate(iso)).join(" · ")}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
