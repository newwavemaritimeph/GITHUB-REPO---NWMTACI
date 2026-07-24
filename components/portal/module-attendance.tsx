"use client";

import { useState } from "react";
import { Avatar, EmptyState, Pill, StatCard, useToast } from "@/components/ui/kit";
import { formatDate, fullName, todayIso, useSystem } from "@/lib/system/store";
import type { AttendanceStatus } from "@/lib/domain";
import { PageHeader, Panel } from "./shared";

const statuses: AttendanceStatus[] = ["Present", "Late", "Absent", "Incomplete", "Make-Up Required", "Make-Up Completed"];

export function AttendanceModule() {
  const { state, views, markAttendance, setSessionState } = useSystem();
  const toast = useToast();
  // Selection falls back to whatever is running today, so the module always opens
  // on something useful without an effect syncing state after render.
  const [pickedBatchId, setPickedBatchId] = useState("");
  const [pickedSessionId, setPickedSessionId] = useState("");

  const trainingBatches = state.batches
    .filter((batch) => state.attendanceSessions.some((session) => session.batchId === batch.id))
    .sort((left, right) => right.startsOn.localeCompare(left.startsOn));

  const batchId = trainingBatches.some((batch) => batch.id === pickedBatchId)
    ? pickedBatchId
    : (trainingBatches.find((batch) => batch.startsOn <= todayIso() && batch.endsOn >= todayIso())?.id ??
      trainingBatches[0]?.id ??
      "");

  const sessions = state.attendanceSessions
    .filter((item) => item.batchId === batchId)
    .sort((left, right) => left.dayNumber - right.dayNumber);

  const sessionId = sessions.some((item) => item.id === pickedSessionId)
    ? pickedSessionId
    : (sessions.find((item) => item.state === "Open")?.id ??
      sessions.find((item) => item.sessionDate === todayIso())?.id ??
      sessions[0]?.id ??
      "");

  const setBatchId = (next: string) => {
    setPickedBatchId(next);
    setPickedSessionId("");
  };
  const setSessionId = (next: string) => setPickedSessionId(next);

  const session = sessions.find((item) => item.id === sessionId);
  const batch = state.batches.find((item) => item.id === batchId);
  const roster = views().filter((item) => item.enrollment.batchId === batchId && item.enrollment.status !== "Cancelled");
  const records = state.attendanceRecords.filter((record) => record.sessionId === sessionId);
  const recordFor = (enrollmentId: string) => records.find((record) => record.enrollmentId === enrollmentId);

  const present = records.filter((record) => record.status === "Present").length;
  const late = records.filter((record) => record.status === "Late").length;
  const absent = records.filter((record) => record.status === "Absent").length;
  const unrecorded = roster.length - records.length;
  const editable = session?.state === "Open" || session?.state === "Planned";

  return (
    <div className="page">
      <PageHeader
        eyebrow="Staff-controlled attendance"
        title="Attendance checker"
        description="Open a session, record check-in and check-out, then submit and verify to unlock certificate eligibility."
      />

      <Panel padded={false}>
        <div className="toolbar toolbar-wrap">
          <label className="inline-field">
            <span>Batch</span>
            <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
              {trainingBatches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.batchNumber} — {item.courseName}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Session</span>
            <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
              {sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {formatDate(item.sessionDate)} · {item.state}
                </option>
              ))}
            </select>
          </label>
          {session && (
            <div className="toolbar-end">
              {session.state === "Planned" && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setSessionState(session.id, "Open");
                    toast("success", "Attendance session opened for printed-sheet recording.");
                  }}
                >
                  Open session
                </button>
              )}
              {session.state === "Open" && (
                <button
                  className="primary-button"
                  disabled={unrecorded > 0}
                  onClick={() => {
                    setSessionState(session.id, "Submitted");
                    toast("success", "Instructor submitted the attendance sheet.");
                  }}
                >
                  {unrecorded > 0 ? `${unrecorded} trainee${unrecorded === 1 ? "" : "s"} unrecorded` : "Submit attendance"}
                </button>
              )}
              {session.state === "Submitted" && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setSessionState(session.id, "Verified");
                    toast("success", "Training Operations verified this session.");
                  }}
                >
                  Verify session
                </button>
              )}
              {session.state === "Verified" && <Pill tone="green">Verified and locked</Pill>}
            </div>
          )}
        </div>
      </Panel>

      {!session || roster.length === 0 ? (
        <Panel>
          <EmptyState
            title="No attendance roster yet"
            text="Pick a batch that already has enrollments, or approve a registration first so a trainee appears on this sheet."
          />
        </Panel>
      ) : (
        <>
          <div className="stat-grid stat-grid-4">
            <StatCard label="Enrolled" value={String(roster.length)} note={batch?.venue ?? ""} tone={0} icon="◎" />
            <StatCard label="Present" value={String(present)} note={`${late} late`} tone={2} icon="✓" />
            <StatCard label="Absent" value={String(absent)} note="Needs make-up" tone={5} icon="!" />
            <StatCard label="Not recorded" value={String(unrecorded)} note={session.state === "Verified" ? "Session locked" : "Awaiting entry"} tone={1} icon="□" />
          </div>

          <Panel
            title={`${batch?.batchNumber ?? ""} · ${session.name}`}
            description={`${formatDate(session.sessionDate)} · 8:00 AM–5:00 PM · ${session.state}`}
          >
            <div className="roster">
              {roster.map((item) => {
                const record = recordFor(item.enrollment.id);
                return (
                  <div key={item.enrollment.id} className="roster-row">
                    <div className="roster-person">
                      <Avatar name={fullName(item.trainee)} />
                      <div>
                        <strong>{fullName(item.trainee)}</strong>
                        <small>
                          {item.trainee.traineeNumber} · {item.enrollment.reference}
                        </small>
                      </div>
                    </div>
                    <div className="roster-times">
                      <span>{record ? "On the printed sheet" : "Not yet recorded"}</span>
                    </div>
                    <select
                      className="roster-status"
                      value={record?.status ?? ""}
                      disabled={!editable}
                      onChange={(event) => {
                        markAttendance({
                          sessionId: session.id,
                          enrollmentId: item.enrollment.id,
                          status: event.target.value as AttendanceStatus,
                          method: "Manual",
                          manualReason: "Recorded by staff in the attendance checker.",
                        });
                        toast("info", `${fullName(item.trainee)} marked ${event.target.value}.`);
                      }}
                    >
                      <option value="" disabled>
                        Not recorded
                      </option>
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Session progress" description="Certificates unlock only when every session of a batch is verified.">
            <div className="session-strip">
              {sessions.map((item) => (
                <button
                  key={item.id}
                  className={`session-chip ${item.id === sessionId ? "active" : ""} chip-${item.state.toLowerCase()}`}
                  onClick={() => setSessionId(item.id)}
                >
                  <strong>{item.name}</strong>
                  <small>{formatDate(item.sessionDate)}</small>
                  <Pill tone={item.state === "Verified" ? "green" : item.state === "Submitted" ? "blue" : item.state === "Open" ? "amber" : "slate"}>
                    {item.state}
                  </Pill>
                </button>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
