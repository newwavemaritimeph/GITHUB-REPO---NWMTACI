"use client";

import { useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/ui/kit";
import { SystemProvider, formatDate, formatDateRange, formatDateTime, fullName, useSystem } from "@/lib/system/store";
import { pesos } from "@/lib/endorsement-catalog";

type Result =
  | { kind: "none" }
  | { kind: "not-found" }
  | { kind: "registration"; reference: string; status: string; remarks?: string; submittedAt: string; course: string }
  | { kind: "enrollment"; enrollmentId: string };

function StatusSearch() {
  const { state, views, ready } = useSystem();
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result>({ kind: "none" });

  function search() {
    const ref = reference.trim().toUpperCase();
    const mail = email.trim().toLowerCase();
    const registration = state.registrations.find(
      (item) => item.reference.toUpperCase() === ref && item.email.toLowerCase() === mail,
    );
    if (registration) {
      const enrollment = state.enrollments.find((item) => item.id === registration.enrollmentId);
      if (enrollment) {
        setResult({ kind: "enrollment", enrollmentId: enrollment.id });
        return;
      }
      setResult({
        kind: "registration",
        reference: registration.reference,
        status: registration.status,
        remarks: registration.remarks,
        submittedAt: registration.submittedAt,
        course: registration.courseName,
      });
      return;
    }
    const enrollment = state.enrollments.find((item) => item.reference.toUpperCase() === ref);
    const trainee = enrollment ? state.trainees.find((item) => item.id === enrollment.traineeId) : undefined;
    if (enrollment && trainee?.email.toLowerCase() === mail) {
      setResult({ kind: "enrollment", enrollmentId: enrollment.id });
      return;
    }
    setResult({ kind: "not-found" });
  }

  const view = result.kind === "enrollment" ? views().find((item) => item.enrollment.id === result.enrollmentId) : undefined;

  return (
    <>
      <div className="search-card">
        <label>
          Registration or enrollment reference
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="REG-2026-000208"
            autoComplete="off"
          />
        </label>
        <label>
          Registered email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
        </label>
        <button
          className="button button-primary button-block"
          disabled={!ready || reference.trim().length < 6 || !email.includes("@")}
          onClick={search}
        >
          Check my status
        </button>
        <p>Both the reference and the registered email are required, so only you can see your record.</p>
      </div>

      {result.kind === "not-found" && (
        <div className="status-result status-warning">
          <strong>No record matched</strong>
          <p>Check the reference and the email address you registered with. They must match exactly.</p>
        </div>
      )}

      {result.kind === "registration" && (
        <div className="status-result">
          <div className="status-head">
            <div>
              <span className="eyebrow">{result.reference}</span>
              <h2>{result.course}</h2>
            </div>
            <Pill tone={result.status === "Rejected" ? "red" : result.status === "Approved" ? "green" : "amber"}>{result.status}</Pill>
          </div>
          <p>Submitted {formatDateTime(result.submittedAt)}.</p>
          <p>
            {result.status === "Rejected"
              ? (result.remarks ?? "This registration was not accepted. Please contact New Wave.")
              : "New Wave is reviewing your submission. Your enrollment and training fee appear here once the review is complete."}
          </p>
        </div>
      )}

      {view && (
        <div className="status-result">
          <div className="status-head">
            <div>
              <span className="eyebrow">{view.enrollment.reference}</span>
              <h2>{view.enrollment.courseName}</h2>
            </div>
            <Pill tone="green">{view.stage}</Pill>
          </div>
          <dl className="review-list">
            <div>
              <dt>Trainee</dt>
              <dd>{fullName(view.trainee)}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>{view.batch ? formatDateRange(view.batch.startsOn, view.batch.endsOn) : "To be scheduled"}</dd>
            </div>
            <div>
              <dt>Venue</dt>
              <dd>{view.batch?.venue ?? "—"}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>
                {view.paymentStatus} · {pesos(view.paidCentavos)} of {pesos(view.dueCentavos)}
              </dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>{pesos(view.balanceCentavos)}</dd>
            </div>
            <div>
              <dt>Instructions</dt>
              <dd>
                {view.enrollment.instructionsAcknowledgedAt
                  ? `Acknowledged ${formatDate(view.enrollment.instructionsAcknowledgedAt)}`
                  : view.enrollment.instructionsSentAt
                    ? "Sent — acknowledgment required"
                    : "Not yet sent"}
              </dd>
            </div>
            <div>
              <dt>Certificate</dt>
              <dd>{view.certificate?.status ?? "Pending attendance"}</dd>
            </div>
          </dl>
          <p className="status-next">
            <strong>Next step:</strong>{" "}
            {view.balanceCentavos > 0
              ? "Settle your remaining balance at the New Wave cashier, or contact us to arrange payment."
              : view.enrollment.instructionsSentAt && !view.enrollment.instructionsAcknowledgedAt
                ? "Confirm your training instructions with New Wave before your reporting date."
                : "Nothing is required from you right now."}
          </p>
          <Link className="button button-secondary" href="/contact">
            Contact New Wave
          </Link>
        </div>
      )}
    </>
  );
}

export function RegistrationStatus() {
  return (
    <SystemProvider>
      <StatusSearch />
    </SystemProvider>
  );
}
