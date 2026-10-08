"use client";

import { useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/ui/kit";
import { SystemProvider, formatDate, fullName, useSystem } from "@/lib/system/store";

/* -------------------------------------------------------- trainee status --- */

function maskName(name: string) {
  return name
    .split(" ")
    .map((part) => (part.length <= 2 ? part : `${part[0]}${"•".repeat(Math.min(part.length - 1, 5))}`))
    .join(" ");
}

type CourseStatus = { course: string; code: string; schedule: string; status: string; balanceCentavos: number; certificate: string | null; ready: boolean; delivery: string | null };
type StatusResult = { firstName: string; nwmtaciNo: string; awaitingCourse: boolean; courses: CourseStatus[] };
const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Trainee status (owner, 8 Oct 2026): with the NWMTACI number and birth date,
 * each course with its schedule, enrollment status, balance, and whether the
 * certificate is printed and ready for pick-up.
 */
function StatusTab() {
  const [no, setNo] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState("");
  const canSearch = no.trim().length >= 4 && !!birthdate;

  async function search() {
    setBusy(true); setResult(null); setError("");
    try {
      const response = await fetch("/api/public/trainee-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nwmtaciNo: no, birthdate }) });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "We could not check your status. Please try again."); return; }
      setResult(body as StatusResult);
    } catch { setError("We could not reach the server. Please try again in a moment."); }
    finally { setBusy(false); }
  }

  const tone = (status: string) => (/enrolled/i.test(status) ? "green" : /cancel/i.test(status) ? "red" : "amber");

  return (
    <>
      <form className="search-card" onSubmit={(event) => { event.preventDefault(); if (canSearch && !busy) void search(); }}>
        <label>
          NWMTACI number
          <input value={no} onChange={(event) => setNo(event.target.value)} placeholder="NWMTACI-2026-0000" autoComplete="off" />
        </label>
        <label>
          Birth date
          <input type="date" value={birthdate} onChange={(event) => setBirthdate(event.target.value)} />
        </label>
        <button className="button button-primary button-block" disabled={!canSearch || busy}>{busy ? "Checking…" : "Check My Status"}</button>
        <p className="muted-text" style={{ margin: "6px 0 0" }}>Your NWMTACI number is on your enrollment confirmation email.</p>
      </form>

      {error && (
        <div className="status-result status-warning">
          <strong>No record matched</strong>
          <p>{error}</p>
        </div>
      )}
      {result && (
        <div className="status-result">
          <div className="status-head">
            <div><span className="eyebrow">{result.nwmtaciNo}</span><h2>Hello, {result.firstName}</h2></div>
          </div>
          {result.awaitingCourse && !result.courses.length && <p className="status-next">Your application is being screened. Our Registration team will confirm your course, schedule and fee.</p>}
          {result.courses.map((c, i) => (
            <div className="ts-course" key={`${c.code}-${i}`}>
              <div className="ts-head"><strong>{c.course}</strong><Pill tone={tone(c.status)}>{c.status}</Pill></div>
              <dl className="review-list">
                <div><dt>Schedule</dt><dd>{c.schedule}</dd></div>
                <div><dt>Balance</dt><dd>{c.balanceCentavos > 0 ? <span className="ts-due">{peso(c.balanceCentavos)} to pay at the Cashier</span> : "Fully paid"}</dd></div>
                {c.certificate && <div><dt>Certificate</dt><dd className={c.ready ? "ts-ready" : undefined}>{c.certificate}</dd></div>}
                {c.delivery && <div><dt>Delivery request</dt><dd>{c.delivery}</dd></div>}
              </dl>
              {c.ready && !c.delivery && <p className="ts-note">Can&apos;t come to the office? <Link href="/certificate-delivery">Request delivery by LBC</Link>.</p>}
            </div>
          ))}
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
              <h2>Verified Certificate</h2>
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
          TRAINEE STATUS
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
