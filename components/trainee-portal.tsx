"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, Modal, Pill, ToastProvider, useMoneyInput, useToast } from "@/components/ui/kit";
import { NewWaveLogo } from "./new-wave-logo";
import { StageTrack } from "./portal/shared";
import { pesos } from "@/lib/endorsement-catalog";
import {
  SystemProvider,
  formatDate,
  formatDateRange,
  formatDateTime,
  fullName,
  initials,
  useSystem,
} from "@/lib/system/store";
import type { EnrollmentView } from "@/lib/system/types";

function SignIn() {
  const { state, signInTrainee } = useSystem();
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState("");

  const sample = state.trainees[0]?.email;

  return (
    <main className="trainee-signin">
      <div className="signin-copy">
        <Link href="/" aria-label="New Wave home">
          <NewWaveLogo />
        </Link>
        <span className="eyebrow">Trainee portal</span>
        <h1>Track your training from one place.</h1>
        <p>
          Sign in with the email you registered with, or with your registration or enrollment reference. You will see your
          schedule, balance, payment options, instructions, attendance, and certificate status.
        </p>
        <ul className="signin-points">
          <li>Pay online and upload your proof for cashier verification</li>
          <li>Acknowledge training instructions before reporting</li>
          <li>Follow attendance and certificate release</li>
        </ul>
      </div>
      <div className="signin-card">
        <h2>Sign in</h2>
        <p>Use your registered email, REG reference, or ENR reference.</p>
        <label>
          Email or reference
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={sample ?? "name@example.com"}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const result = signInTrainee(identifier);
              if (!result.ok) setMessage(result.message);
            }}
          />
        </label>
        {message && (
          <p className="form-message" role="status">
            {message}
          </p>
        )}
        <button
          className="button button-primary button-block"
          onClick={() => {
            const result = signInTrainee(identifier);
            if (!result.ok) setMessage(result.message);
          }}
        >
          Open my portal
        </button>
        <p className="signin-help">
          Just registered? Your portal opens once New Wave reviews your submission and creates your enrollment. You can{" "}
          <Link href="/registration-search">check your status</Link> at any time.
        </p>
        {sample && (
          <button className="text-button" onClick={() => setIdentifier(sample)}>
            Use a sample trainee account
          </button>
        )}
      </div>
    </main>
  );
}

function PayModal({
  target,
  onClose,
}: {
  target: EnrollmentView | null;
  onClose: () => void;
}) {
  const { recordPayment } = useSystem();
  const toast = useToast();
  const money = useMoneyInput();
  const [method, setMethod] = useState<"GCash" | "Bank transfer" | "Card">("GCash");
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState("");

  const invalid = money.centavos <= 0 || (target ? money.centavos > target.balanceCentavos : true) || reference.trim().length < 4;

  return (
    <Modal
      open={Boolean(target)}
      title="Pay my training fee"
      description={target ? `${target.enrollment.reference} · balance ${pesos(target.balanceCentavos)}` : ""}
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={invalid}
            onClick={() => {
              if (!target) return;
              recordPayment({
                enrollmentId: target.enrollment.id,
                amountCentavos: money.centavos,
                method,
                referenceNumber: reference.trim(),
                proofFileName: proof || undefined,
                receivingAccount: method === "GCash" ? "GCash 0917-000-0000" : "BDO 0012-3456-7890",
                needsVerification: true,
                recordedBy: "Trainee portal",
              });
              toast("success", "Payment submitted. A cashier will verify your reference shortly.");
              money.reset();
              setReference("");
              setProof("");
              onClose();
            }}
          >
            Submit payment
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Amount (PHP)" hint={target ? `You may pay any amount up to ${pesos(target.balanceCentavos)}` : undefined}>
          <input inputMode="decimal" value={money.raw} onChange={(event) => money.setRaw(event.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Payment method">
          <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option>GCash</option>
            <option>Bank transfer</option>
            <option>Card</option>
          </select>
        </Field>
        <Field label="Transaction reference" full hint="Copy this from your payment confirmation.">
          <input value={reference} onChange={(event) => setReference(event.target.value.toUpperCase())} placeholder="e.g. 9923130445" />
        </Field>
        <Field label="Proof of payment" full hint="Optional here — the cashier compares your reference with the proof.">
          <input type="file" accept="image/*" onChange={(event) => setProof(event.target.files?.[0]?.name ?? "")} />
        </Field>
        <div className="form-full inline-note note-blue">
          <strong>Pay to</strong>
          <p>{method === "GCash" ? "GCash 0917-000-0000 (New Wave Maritime)" : method === "Card" ? "Card terminal at the cashier counter" : "BDO 0012-3456-7890 (New Wave Maritime Training and Assessment Center, Inc.)"}</p>
          <p>Your payment appears as “Pending verification” until a cashier confirms it and issues your official receipt.</p>
        </div>
      </div>
    </Modal>
  );
}

function Portal({ previewMode }: { previewMode: boolean }) {
  const { state, traineeViews, acknowledgeInstructions, signOutTrainee, createRequest } = useSystem();
  const toast = useToast();
  const [payFor, setPayFor] = useState<EnrollmentView | null>(null);
  const [tab, setTab] = useState<"Overview" | "Payments" | "Attendance" | "Documents">("Overview");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");

  const trainee = state.trainees.find((item) => item.id === state.traineeSessionId)!;
  const enrollments = traineeViews(trainee.id);
  const [selectedId, setSelectedId] = useState(enrollments[0]?.enrollment.id ?? "");
  const current = enrollments.find((item) => item.enrollment.id === selectedId) ?? enrollments[0];

  const notifications = state.notifications.filter(
    (item) => item.audience === "trainee" && item.traineeId === trainee.id,
  );

  if (!current) {
    return (
      <main className="trainee-shell">
        <header className="trainee-top">
          <Link href="/">
            <NewWaveLogo />
          </Link>
          <button className="text-button" onClick={signOutTrainee}>
            Sign out
          </button>
        </header>
        <div className="trainee-empty">
          <h1>Welcome, {trainee.firstName}.</h1>
          <p>You do not have an enrollment yet. Once New Wave approves your registration, your training details appear here.</p>
          <Link className="button button-primary" href="/register">
            Register for a course
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="trainee-shell">
      <header className="trainee-top">
        <Link href="/" aria-label="New Wave home">
          <NewWaveLogo />
        </Link>
        <nav>
          {(["Overview", "Payments", "Attendance", "Documents"] as const).map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </nav>
        <div className="trainee-identity">
          {previewMode && <Pill tone="blue">Preview</Pill>}
          <span className="avatar avatar-blue">{initials(fullName(trainee))}</span>
          <button className="text-button" onClick={signOutTrainee}>
            Sign out
          </button>
        </div>
      </header>

      <section className="trainee-hero">
        <div>
          <span className="eyebrow">Trainee portal</span>
          <h1>Welcome back, {trainee.firstName}.</h1>
          <p>
            {trainee.traineeNumber} · {enrollments.length} enrollment{enrollments.length === 1 ? "" : "s"} on record
          </p>
        </div>
        {enrollments.length > 1 && (
          <label className="inline-field">
            <span>Viewing</span>
            <select value={current.enrollment.id} onChange={(event) => setSelectedId(event.target.value)}>
              {enrollments.map((item) => (
                <option key={item.enrollment.id} value={item.enrollment.id}>
                  {item.enrollment.courseName} · {item.enrollment.reference}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <div className="trainee-body">
        {tab === "Overview" && (
          <>
            <section className="trainee-card training-card">
              <div className="training-top">
                <div>
                  <Pill tone="blue">{current.enrollment.status}</Pill>
                  <h2>{current.enrollment.courseName}</h2>
                  <p>
                    {current.enrollment.centerName} · {current.enrollment.reference}
                  </p>
                </div>
                {current.batch && (
                  <span className="big-date">
                    <b>{new Date(`${current.batch.startsOn}T00:00:00`).getDate()}</b>
                    {new Intl.DateTimeFormat("en-PH", { month: "short" }).format(new Date(`${current.batch.startsOn}T00:00:00`))}
                  </span>
                )}
              </div>

              <div className="training-details">
                <div>
                  <span>Training dates</span>
                  <strong>{current.batch ? formatDateRange(current.batch.startsOn, current.batch.endsOn) : "To be scheduled"}</strong>
                </div>
                <div>
                  <span>Reporting time</span>
                  <strong>8:00 AM</strong>
                </div>
                <div>
                  <span>Venue</span>
                  <strong>{current.batch?.venue ?? "—"}</strong>
                </div>
              </div>

              <StageTrack stage={current.stage} />

              <div className="training-actions">
                {current.balanceCentavos > 0 && (
                  <button className="button button-primary" onClick={() => setPayFor(current)}>
                    Pay {pesos(current.balanceCentavos)}
                  </button>
                )}
                {current.enrollment.instructionsSentAt && !current.enrollment.instructionsAcknowledgedAt && (
                  <button
                    className="button button-primary"
                    onClick={() => {
                      acknowledgeInstructions(current.enrollment.id);
                      toast("success", "Thank you. Your acknowledgment was recorded.");
                    }}
                  >
                    Acknowledge instructions
                  </button>
                )}
                <button className="button button-secondary" onClick={() => setRequestOpen(true)}>
                  Request a change
                </button>
              </div>
            </section>

            <aside className="trainee-side">
              <article>
                <span>Payment status</span>
                <strong className={current.paymentStatus === "Paid" ? "value-good" : "value-danger"}>{current.paymentStatus}</strong>
                <small>
                  {pesos(current.paidCentavos)} paid of {pesos(current.dueCentavos)}
                </small>
                <button className="link-button" onClick={() => setTab("Payments")}>
                  View payment history →
                </button>
              </article>
              <article>
                <span>Instructions</span>
                <strong>
                  {current.enrollment.instructionsAcknowledgedAt
                    ? "Acknowledged"
                    : current.enrollment.instructionsSentAt
                      ? "Acknowledgment required"
                      : "Not yet sent"}
                </strong>
                <small>
                  {current.enrollment.instructionsSentAt
                    ? `Sent ${formatDate(current.enrollment.instructionsSentAt)}`
                    : "Sent after your training fee is fully settled."}
                </small>
              </article>
              <article>
                <span>Certificate</span>
                <strong>{current.certificate?.status ?? "Pending attendance"}</strong>
                <small>{current.certificate?.certificateNumber ?? current.certificate?.blockedReason ?? "Updates after training completion."}</small>
              </article>
            </aside>

            <section className="trainee-card trainee-updates">
              <h2>Recent updates</h2>
              {notifications.length === 0 ? (
                <p className="muted-text">No updates yet. Notifications about payments, instructions, and certificates appear here.</p>
              ) : (
                notifications.slice(0, 6).map((item) => (
                  <article key={item.id}>
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                    </div>
                    <time>{formatDateTime(item.createdAt)}</time>
                  </article>
                ))
              )}
            </section>
          </>
        )}

        {tab === "Payments" && (
          <section className="trainee-card trainee-full">
            <div className="panel-head">
              <div>
                <h2>Payments and balance</h2>
                <p>Every charge, payment, and receipt on {current.enrollment.reference}.</p>
              </div>
              {current.balanceCentavos > 0 && (
                <button className="button button-primary button-small" onClick={() => setPayFor(current)}>
                  Pay {pesos(current.balanceCentavos)}
                </button>
              )}
            </div>
            <div className="mini-stats">
              <div>
                <span>Total due</span>
                <strong>{pesos(current.dueCentavos)}</strong>
              </div>
              <div>
                <span>Paid</span>
                <strong className="value-good">{pesos(current.paidCentavos)}</strong>
              </div>
              <div>
                <span>Balance</span>
                <strong className={current.balanceCentavos > 0 ? "value-danger" : "value-good"}>{pesos(current.balanceCentavos)}</strong>
              </div>
            </div>
            <div className="ledger-list">
              {current.entries.map((entry) => (
                <div key={entry.id} className={`ledger-row ledger-${entry.type}`}>
                  <div>
                    <strong>{entry.description}</strong>
                    <small>
                      {formatDateTime(entry.recordedAt)}
                      {entry.referenceNumber ? ` · Ref ${entry.referenceNumber}` : ""}
                      {entry.receiptNumber ? ` · Receipt ${entry.receiptNumber}` : ""}
                    </small>
                  </div>
                  <div className="ledger-amount">
                    <strong>{pesos(entry.amountCentavos)}</strong>
                    {entry.verification !== "Not required" && (
                      <Pill tone={entry.verification === "Verified" ? "green" : entry.verification === "Rejected" ? "red" : "amber"}>
                        {entry.verification}
                      </Pill>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "Attendance" && (
          <section className="trainee-card trainee-full">
            <div className="panel-head">
              <div>
                <h2>Attendance</h2>
                <p>Recorded per training session and verified by Training Operations.</p>
              </div>
              <Pill tone={current.attendanceComplete ? "green" : "amber"}>
                {current.attendance.filter((item) => item.record).length} of {current.attendance.length} recorded
              </Pill>
            </div>
            {current.attendance.length === 0 ? (
              <p className="muted-text">Attendance sessions appear once your batch begins.</p>
            ) : (
              <div className="attendance-list">
                {current.attendance.map(({ session, record }) => (
                  <div key={session.id} className="attendance-line">
                    <div>
                      <strong>{session.name}</strong>
                      <small>{formatDate(session.sessionDate)}</small>
                    </div>
                    <Pill
                      tone={
                        !record
                          ? "slate"
                          : record.status === "Present" || record.status === "Make-Up Completed"
                            ? "green"
                            : record.status === "Late"
                              ? "amber"
                              : "red"
                      }
                    >
                      {record?.status ?? "Not recorded"}
                    </Pill>
                    <small className="muted-text">{session.state}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "Documents" && (
          <section className="trainee-card trainee-full">
            <div className="panel-head">
              <div>
                <h2>Documents</h2>
                <p>Receipts, admission slip, and certificate become available as each step completes.</p>
              </div>
            </div>
            <div className="document-grid">
              {current.entries
                .filter((entry) => entry.receiptNumber)
                .map((entry) => (
                  <article key={entry.id}>
                    <span aria-hidden="true">◈</span>
                    <strong>Official receipt {entry.receiptNumber}</strong>
                    <small>
                      {pesos(entry.amountCentavos)} · {formatDate(entry.recordedAt)}
                    </small>
                    <Pill tone="green">Available</Pill>
                  </article>
                ))}
              <article>
                <span aria-hidden="true">▤</span>
                <strong>Admission slip</strong>
                <small>{current.enrollment.instructionsSentAt ? "Issued with your training instructions" : "Issued after full payment"}</small>
                <Pill tone={current.enrollment.instructionsSentAt ? "green" : "amber"}>
                  {current.enrollment.instructionsSentAt ? "Available" : "Pending"}
                </Pill>
              </article>
              <article>
                <span aria-hidden="true">◆</span>
                <strong>Certificate</strong>
                <small>{current.certificate?.certificateNumber ?? current.certificate?.blockedReason ?? "Pending attendance"}</small>
                <Pill tone={current.certificate?.status === "Released" ? "green" : "amber"}>{current.certificate?.status ?? "Pending"}</Pill>
              </article>
            </div>
          </section>
        )}
      </div>

      <PayModal target={payFor} onClose={() => setPayFor(null)} />

      <Modal
        open={requestOpen}
        title="Request a change"
        description={`${current.enrollment.reference} · ${current.enrollment.courseName}`}
        onClose={() => setRequestOpen(false)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setRequestOpen(false)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={requestReason.trim().length < 8}
              onClick={() => {
                const request = createRequest({
                  type: "Reschedule",
                  enrollmentId: current.enrollment.id,
                  traineeName: fullName(trainee),
                  reason: requestReason.trim(),
                  requestedBy: "Trainee portal",
                });
                toast("success", `${request.reference} submitted. New Wave will review it.`);
                setRequestReason("");
                setRequestOpen(false);
              }}
            >
              Submit request
            </button>
          </>
        }
      >
        <Field label="What do you need?" full hint="Rescheduling, corrections, and refunds are reviewed by New Wave staff.">
          <textarea rows={4} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} />
        </Field>
      </Modal>
    </main>
  );
}

function TraineeGate({ previewMode }: { previewMode: boolean }) {
  const { state, ready } = useSystem();
  if (!ready) {
    return (
      <div className="portal-loading">
        <NewWaveLogo />
        <p>Loading your portal…</p>
      </div>
    );
  }
  return state.traineeSessionId ? <Portal previewMode={previewMode} /> : <SignIn />;
}

export function TraineePortal({ previewMode = false }: { previewMode?: boolean }) {
  return (
    <SystemProvider>
      <ToastProvider>
        <TraineeGate previewMode={previewMode} />
      </ToastProvider>
    </SystemProvider>
  );
}
