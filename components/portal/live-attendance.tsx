"use client";

import { useEffect, useState } from "react";

/**
 * Attendance for the live Supabase workspace.
 *
 * Sessions are generated from the batch's training dates on first load. A
 * session must be opened before scanning, submitted by the instructor, then
 * verified by Training Operations — only then does it count towards a
 * certificate. Verified sessions are locked.
 */

type Batch = { id: string; batch_number: string; starts_on: string; ends_on: string; venue?: string | null };
type Session = {
  id: string;
  session_name: string;
  starts_at: string;
  ends_at: string;
  state: "Planned" | "Open" | "Submitted" | "Verified";
  batch_training_dates?: { training_date: string } | { training_date: string }[] | null;
};
type Record_ = {
  id: string;
  session_id: string;
  enrollment_id: string;
  status: string;
  method: string;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
};
type RosterRow = {
  id: string;
  enrollment_number: string;
  trainees?:
    | { trainee_number: string; legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string }
    | { trainee_number: string; legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string }[]
    | null;
};

const STATUSES = ["Present", "Late", "Absent", "Incomplete", "Make-Up Required", "Make-Up Completed"] as const;

const first = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

const personName = (row: RosterRow) => {
  const trainee = first(row.trainees);
  if (!trainee) return row.enrollment_number;
  return `${trainee.legal_first_name} ${trainee.legal_middle_name ?? ""} ${trainee.legal_last_name}`.replace(/\s+/g, " ").trim();
};

const time = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(value)) : "—";

const date = (value: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(value));

export function LiveAttendance({ batches }: { batches: Batch[] }) {
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [records, setRecords] = useState<Record_[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [canVerify, setCanVerify] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Bumped after every mutation to re-read the server's copy of the truth.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!batchId) return undefined;
    let cancelled = false;
    const controller = new AbortController();

    // State is only touched in the async continuation, never synchronously in
    // the effect body, so a batch change cannot cascade renders.
    fetch(`/api/staff/attendance?batchId=${encodeURIComponent(batchId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setError(body.error ?? "Unable to load attendance.");
          setLoading(false);
          return;
        }
        const list: Session[] = body.sessions ?? [];
        setSessions(list);
        setRecords(body.records ?? []);
        setRoster(body.roster ?? []);
        setCanVerify(Boolean(body.canVerify));
        setSessionId((current) =>
          list.some((item) => item.id === current)
            ? current
            : ((list.find((item) => item.state === "Open") ?? list[0])?.id ?? ""),
        );
        setError("");
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError(caught instanceof Error ? caught.message : "Unable to load attendance.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [batchId, reloadToken]);

  async function send(payload: Record<string, unknown>) {
    setMessage("");
    setError("");
    const response = await fetch("/api/staff/attendance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "That action could not be completed.");
      return;
    }
    setMessage("Recorded with server time.");
    setReloadToken((token) => token + 1);
  }

  const session = sessions.find((item) => item.id === sessionId);
  const forSession = records.filter((item) => item.session_id === sessionId);
  const recordOf = (enrollmentId: string) => forSession.find((item) => item.enrollment_id === enrollmentId);
  const counts = {
    present: forSession.filter((item) => item.status === "Present").length,
    late: forSession.filter((item) => item.status === "Late").length,
    absent: forSession.filter((item) => item.status === "Absent").length,
    missing: roster.length - forSession.length,
  };
  const locked = session?.state === "Verified";

  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div>
          <span className="portal-eyebrow">Staff-controlled attendance</span>
          <h1>Attendance checker</h1>
          <p>Open a session, record check-in and check-out, then submit and verify to unlock certificate eligibility.</p>
        </div>
      </div>

      {error && <div className="portal-message error" role="alert">{error}</div>}
      {message && !error && <div className="portal-message success" role="status">{message}</div>}

      <section className="portal-panel" style={{ padding: 16, marginBottom: 16 }}>
        <div className="toolbar toolbar-wrap" style={{ background: "transparent", border: 0, padding: 0 }}>
          <label className="inline-field">
            <span>Batch</span>
            <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batch_number} · {date(batch.starts_on)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Session</span>
            <select value={sessionId} onChange={(event) => setSessionId(event.target.value)} disabled={sessions.length === 0}>
              {sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.session_name} · {date(item.starts_at)} · {item.state}
                </option>
              ))}
            </select>
          </label>
          {session && (
            <div className="toolbar-end">
              {session.state === "Planned" && (
                <button className="portal-primary" onClick={() => void send({ action: "set-state", sessionId: session.id, state: "Open" })}>
                  Open session
                </button>
              )}
              {session.state === "Open" && (
                <button
                  className="portal-primary"
                  disabled={counts.missing > 0}
                  onClick={() => void send({ action: "set-state", sessionId: session.id, state: "Submitted" })}
                >
                  {counts.missing > 0 ? `${counts.missing} unrecorded` : "Submit attendance"}
                </button>
              )}
              {session.state === "Submitted" && canVerify && (
                <button className="portal-primary" onClick={() => void send({ action: "set-state", sessionId: session.id, state: "Verified" })}>
                  Verify session
                </button>
              )}
              {session.state === "Submitted" && !canVerify && <span className="portal-badge orange">Awaiting verification</span>}
              {locked && <span className="portal-badge green">Verified and locked</span>}
            </div>
          )}
        </div>
      </section>

      {loading ? (
        <section className="portal-panel empty-state">
          <p>Loading attendance…</p>
        </section>
      ) : !session || roster.length === 0 ? (
        <section className="portal-panel empty-state">
          <span aria-hidden="true">✓</span>
          <h2>No attendance roster yet</h2>
          <p>Choose a batch that already has enrollments, or create an enrollment so a trainee appears on this sheet.</p>
        </section>
      ) : (
        <>
          <div className="metric-grid compact-metrics">
            {[
              ["Enrolled", String(roster.length), "On this batch", "◎"],
              ["Present", String(counts.present), `${counts.late} late`, "✓"],
              ["Absent", String(counts.absent), "Needs make-up", "!"],
              ["Not recorded", String(counts.missing), locked ? "Session locked" : "Awaiting entry", "□"],
            ].map(([label, value, note, icon], index) => (
              <article key={label}>
                <div className={`metric-symbol symbol-${index}`} aria-hidden="true">{icon}</div>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{note}</small>
              </article>
            ))}
          </div>

          <section className="portal-panel portal-table" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Trainee</th>
                  <th>Enrollment</th>
                  <th>Check in</th>
                  <th>Check out</th>
                  <th>QR</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((row) => {
                  const record = recordOf(row.id);
                  const trainee = first(row.trainees);
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{personName(row)}</strong>
                        <small>{trainee?.trainee_number}</small>
                      </td>
                      <td>{row.enrollment_number}</td>
                      <td>{time(record?.checked_in_at)}</td>
                      <td>{time(record?.checked_out_at)}</td>
                      <td className="cell-actions">
                        <button
                          className="ghost-button"
                          disabled={session.state !== "Open"}
                          onClick={() => void send({ action: "scan", sessionId: session.id, enrollmentId: row.id, scanType: "check-in" })}
                        >
                          Scan in
                        </button>
                        <button
                          className="ghost-button"
                          disabled={session.state !== "Open"}
                          onClick={() => void send({ action: "scan", sessionId: session.id, enrollmentId: row.id, scanType: "check-out" })}
                        >
                          Scan out
                        </button>
                      </td>
                      <td>
                        <select
                          className="roster-status"
                          value={record?.status ?? ""}
                          disabled={locked}
                          onChange={(event) =>
                            void send({
                              action: "mark",
                              sessionId: session.id,
                              enrollmentId: row.id,
                              status: event.target.value,
                              reason: "Recorded by staff in the attendance checker.",
                            })
                          }
                        >
                          <option value="" disabled>
                            Not recorded
                          </option>
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="portal-panel" style={{ padding: 16, marginTop: 16 }}>
            <div className="panel-heading">
              <div>
                <h2>Session progress</h2>
                <p>A certificate only becomes eligible once every session of the batch is verified.</p>
              </div>
            </div>
            <div className="session-strip">
              {sessions.map((item) => (
                <button
                  key={item.id}
                  className={`session-chip ${item.id === sessionId ? "active" : ""}`}
                  onClick={() => setSessionId(item.id)}
                >
                  <strong>{item.session_name}</strong>
                  <small>{date(item.starts_at)}</small>
                  <span
                    className={`portal-badge ${item.state === "Verified" ? "green" : item.state === "Submitted" ? "blue" : item.state === "Open" ? "orange" : ""}`}
                  >
                    {item.state}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
