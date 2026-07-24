"use client";

import { useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/ui/kit";
import { SystemProvider, formatDate, formatDateRange, formatDateTime, fullName, useSystem } from "@/lib/system/store";
import { pesos } from "@/lib/endorsement-catalog";

/* ----------------------------------------------------- enrollment status --- */

function maskName(name: string) {
  return name
    .split(" ")
    .map((part) => (part.length <= 2 ? part : `${part[0]}${"•".repeat(Math.min(part.length - 1, 5))}`))
    .join(" ");
}

function StatusTab() {
  const { state, view, submissionSelections, ready } = useSystem();
  const [reference, setReference] = useState("");
  const [contact, setContact] = useState("");
  const [result, setResult] = useState<"idle" | "not-found" | string>("idle");

  function search() {
    const ref = reference.trim().toLowerCase();
    const contactValue = contact.trim().toLowerCase();
    const submission = state.submissions.find(
      (item) =>
        item.reference.toLowerCase() === ref &&
        (item.applicant.email.toLowerCase() === contactValue || item.applicant.mobile.replace(/\D/g, "") === contact.replace(/\D/g, "")),
    );
    setResult(submission ? submission.id : "not-found");
  }

  const submission = typeof result === "string" && result !== "idle" && result !== "not-found"
    ? state.submissions.find((item) => item.id === result)
    : undefined;
  const selections = submission ? submissionSelections(submission.id) : [];

  return (
    <>
      <form
        className="search-card"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <label>
          Registration reference
          <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="NWM-REG-2026-000208" autoComplete="off" />
        </label>
        <label>
          Registered email or mobile number
          <input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="name@example.com or 09XX XXX XXXX" />
        </label>
        <button className="button button-primary button-block" disabled={!ready || reference.trim().length < 6 || contact.trim().length < 4}>
          Check my status
        </button>
        <p>Both the reference and your registered email or mobile number are required, so only you can see your record.</p>
      </form>

      {result === "not-found" && (
        <div className="status-result status-warning">
          <strong>No record matched</strong>
          <p>Check the reference and the email or mobile number you registered with. They must match exactly.</p>
        </div>
      )}

      {submission && (
        <div className="status-result">
          <div className="status-head">
            <div>
              <span className="eyebrow">{submission.reference}</span>
              <h2>{fullName(submission.applicant)}</h2>
            </div>
            <Pill tone={submission.status === "Approved" ? "green" : submission.status === "Rejected" ? "red" : "amber"}>{submission.status}</Pill>
          </div>
          <p className="status-next">
            <strong>Status:</strong> {submission.publicStatusMessage}
          </p>
          <p className="muted-text">Submitted {formatDateTime(submission.submittedAt)}</p>

          <h3 className="review-subhead">Your courses</h3>
          <div className="status-courses">
            {selections.map((selection) => {
              const batch = state.batches.find((item) => item.id === selection.batchId);
              const enrollmentView = selection.createdEnrollmentId ? view(selection.createdEnrollmentId) : undefined;
              return (
                <div key={selection.id} className="status-course">
                  <div className="status-course-head">
                    <div>
                      <strong>{selection.courseName}</strong>
                      <small>
                        {selection.courseCode} · {batch ? formatDateRange(batch.startsOn, batch.endsOn) : "Schedule pending"}
                        {batch ? ` · ${batch.mode}` : ""}
                      </small>
                    </div>
                    <Pill tone={selection.status === "Approved" ? "green" : selection.status === "Rejected" || selection.status === "Cancelled" ? "red" : "amber"}>
                      {selection.status}
                    </Pill>
                  </div>
                  {enrollmentView ? (
                    <dl className="status-course-detail">
                      <div><dt>Enrollment</dt><dd>{enrollmentView.enrollment.reference}</dd></div>
                      <div><dt>Payment</dt><dd>{enrollmentView.paymentStatus} · {pesos(enrollmentView.paidCentavos)} of {pesos(enrollmentView.dueCentavos)}</dd></div>
                      <div><dt>Balance</dt><dd>{pesos(enrollmentView.balanceCentavos)}</dd></div>
                      <div><dt>Admission slip</dt><dd>{enrollmentView.enrollment.instructionsSentAt ? "Ready" : "Pending payment"}</dd></div>
                      <div><dt>Training</dt><dd>{enrollmentView.enrollment.completedAt ? "Completed" : enrollmentView.stage}</dd></div>
                      <div><dt>Certificate</dt><dd>{enrollmentView.certificate?.status ?? "Pending"}</dd></div>
                    </dl>
                  ) : (
                    <p className="muted-text status-course-note">This course is still being reviewed. An enrollment number is issued once it is approved.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------ certificate verification --- */

function VerifyTab() {
  const { state, view, ready } = useSystem();
  const [number, setNumber] = useState("");
  const [result, setResult] = useState<"idle" | "not-found" | string>("idle");

  function verify() {
    const target = number.trim().toLowerCase();
    const certificate = state.certificates.find((item) => item.certificateNumber?.toLowerCase() === target);
    setResult(certificate ? certificate.id : "not-found");
  }

  const certificate = typeof result === "string" && result !== "idle" && result !== "not-found"
    ? state.certificates.find((item) => item.id === result)
    : undefined;
  const enrollmentView = certificate ? view(certificate.enrollmentId) : undefined;

  return (
    <>
      <form
        className="search-card"
        onSubmit={(event) => {
          event.preventDefault();
          verify();
        }}
      >
        <label>
          Certificate number
          <input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="NWM-CCMI-2026-000118" autoComplete="off" />
        </label>
        <button className="button button-primary button-block" disabled={!ready || number.trim().length < 6}>
          Verify certificate
        </button>
        <p>No email or reference is needed. Verification confirms authenticity from the certificate number alone.</p>
      </form>

      {result === "not-found" && (
        <div className="status-result status-warning">
          <strong>Certificate not found</strong>
          <p>No certificate matches that number. Check the number printed on the document.</p>
        </div>
      )}

      {certificate && enrollmentView && (
        <div className="status-result">
          <div className="status-head">
            <div>
              <span className="eyebrow">{certificate.certificateNumber}</span>
              <h2>Verified certificate</h2>
            </div>
            <Pill tone={certificate.status === "Released" ? "green" : certificate.status === "Cancelled" ? "red" : "amber"}>{certificate.status}</Pill>
          </div>
          <dl className="review-list">
            <div><dt>Trainee</dt><dd>{maskName(fullName(enrollmentView.trainee))}</dd></div>
            <div><dt>Course</dt><dd>{enrollmentView.enrollment.courseName}</dd></div>
            <div><dt>Course code</dt><dd>{enrollmentView.enrollment.courseCode}</dd></div>
            <div><dt>Completion date</dt><dd>{formatDate(enrollmentView.enrollment.completedAt)}</dd></div>
            <div><dt>Certificate number</dt><dd>{certificate.certificateNumber}</dd></div>
            <div><dt>Issuing center</dt><dd>{state.settings.organizationName}</dd></div>
            <div><dt>Status</dt><dd>{certificate.status}</dd></div>
          </dl>
        </div>
      )}
    </>
  );
}

function Page() {
  const [tab, setTab] = useState<"status" | "verify">("status");
  return (
    <div className="status-page-wrap">
      <div className="status-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "status"} className={tab === "status" ? "active" : ""} onClick={() => setTab("status")}>
          ENROLLMENT STATUS
        </button>
        <button role="tab" aria-selected={tab === "verify"} className={tab === "verify" ? "active" : ""} onClick={() => setTab("verify")}>
          CERTIFICATE VERIFICATION
        </button>
      </div>
      {tab === "status" ? <StatusTab /> : <VerifyTab />}
      <p className="reg-note status-help">
        Registering for the first time? <Link href="/register">Start an enrollment form</Link>.
      </p>
    </div>
  );
}

export function RegistrationStatus() {
  return (
    <SystemProvider>
      <Page />
    </SystemProvider>
  );
}
