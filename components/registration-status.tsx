"use client";

import { useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/ui/kit";
import { SystemProvider, formatDate, fullName, useSystem } from "@/lib/system/store";

/* ----------------------------------------------------- enrollment status --- */

function maskName(name: string) {
  return name
    .split(" ")
    .map((part) => (part.length <= 2 ? part : `${part[0]}${"•".repeat(Math.min(part.length - 1, 5))}`))
    .join(" ");
}

function StatusTab() {
  const [srn, setSrn] = useState("");
  const [reference, setReference] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ reference: string; status: string; nextStep: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const srnReady = srn.length === 10;
  const refReady = reference.trim().length >= 6 && contact.trim().length >= 4;
  const canSearch = srnReady || refReady;

  async function search() {
    setBusy(true); setResult(null); setNotFound(false); setError("");
    try {
      const fd = new FormData();
      if (srnReady) fd.set("srn", srn);
      else { fd.set("reference", reference.trim()); fd.set("email", contact.trim()); }
      const response = await fetch("/api/public/registration-search", { method: "POST", body: fd });
      const body = await response.json();
      if (response.status === 404 || body.status === "Not found") { setNotFound(true); return; }
      if (!response.ok) { setError(body.error ?? "We could not check your status. Please try again."); return; }
      setResult({ reference: body.reference, status: body.status, nextStep: body.nextStep });
    } catch { setError("We could not reach the server. Please try again in a moment."); }
    finally { setBusy(false); }
  }

  const tone = (status: string) => (/enrolled|approved|released|active/i.test(status) ? "green" : /cancel|reject|not found/i.test(status) ? "red" : "amber");

  return (
    <>
      <form className="search-card" onSubmit={(event) => { event.preventDefault(); if (canSearch && !busy) void search(); }}>
        <label>
          SRN / MISMO number
          <input value={srn} onChange={(event) => setSrn(event.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="10 DIGITS" autoComplete="off" />
        </label>
        <p className="muted-text" style={{ margin: "2px 0 8px" }}>Enter your SRN to check your status — or use your reference and registered email below.</p>
        <label>
          Registration reference
          <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="REG-2026-000208" autoComplete="off" />
        </label>
        <label>
          Registered email
          <input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="name@example.com" />
        </label>
        <button className="button button-primary button-block" disabled={!canSearch || busy}>{busy ? "Checking…" : "Check my status"}</button>
      </form>

      {notFound && (
        <div className="status-result status-warning">
          <strong>No record matched</strong>
          <p>Check your SRN, or the reference and registered email. They must match exactly.</p>
        </div>
      )}
      {error && (
        <div className="status-result status-warning">
          <strong>Something went wrong</strong>
          <p>{error}</p>
        </div>
      )}
      {result && (
        <div className="status-result">
          <div className="status-head">
            <div><span className="eyebrow">{result.reference}</span><h2>Enrollment status</h2></div>
            <Pill tone={tone(result.status)}>{result.status}</Pill>
          </div>
          <p className="status-next"><strong>Next step:</strong> {result.nextStep}</p>
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
