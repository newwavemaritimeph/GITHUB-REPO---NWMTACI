"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/ui/kit";

/* -------------------------------------------------------- trainee status --- */

type CourseStatus = {
  course: string; code: string; enrollmentNumber: string; schedule: string; status: string; trainingFinished: boolean;
  feeCentavos: number; paidCentavos: number; balanceCentavos: number;
  certificate: string | null; certificateNumber: string | null; releasedAt: string | null; ready: boolean; delivery: string | null;
  evaluation: { needed: boolean; submitted: boolean; url: string | null };
  postTest?: { needed: boolean; passed: boolean; best: { score: number; total: number } | null; attempts: number; url: string | null };
};
type PaymentRow = { paymentNumber: string; receivedAt: string; method: string; referenceNumber: string | null; amountCentavos: number; valid: boolean };
type ProofRow = { submittedAt: string; method: string; amountCentavos: number; reference: string; state: string; reason: string | null };
type StatusResult = { firstName: string; nwmtaciNo: string; awaitingCourse: boolean; courses: CourseStatus[]; payments: PaymentRow[]; proofs?: ProofRow[] };
const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(iso));
const mono: React.CSSProperties = { fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" };

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 13, fontWeight: 600, background: done ? "#e7f6ec" : "#f1f4f7", color: done ? "#15803d" : "#5f7180", border: `1px solid ${done ? "#b6e3c4" : "#dfe7ee"}` }}>{done ? "✓" : "○"} {children}</span>;
}

/**
 * Trainee status (owner, 8 Oct 2026; SRN and NWMTACI No., fees, payments,
 * evaluation and certificate, owner, 20 Oct 2026).
 */
function StatusTab() {
  const [srn, setSrn] = useState("");
  const [no, setNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState("");
  const canSearch = srn.replace(/\D/g, "").length === 10 && no.trim().length >= 4;

  async function search() {
    setBusy(true); setResult(null); setError("");
    try {
      const response = await fetch("/api/public/trainee-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ srn, nwmtaciNo: no }) });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "We could not check your status. Please try again."); return; }
      setResult(body as StatusResult);
    } catch { setError("We could not reach the server. Please try again in a moment."); }
    finally { setBusy(false); }
  }

  const tone = (status: string) => (/enrolled/i.test(status) ? "green" : /cancel/i.test(status) ? "red" : "amber");
  const active = result?.courses.filter((c) => !/cancel/i.test(c.status)) ?? [];
  const total = (k: "feeCentavos" | "paidCentavos" | "balanceCentavos") => active.reduce((s, c) => s + c[k], 0);

  return (
    <>
      <form className="search-card" onSubmit={(event) => { event.preventDefault(); if (canSearch && !busy) void search(); }}>
        <label>
          SRN (Seafarer&apos;s Registration No.)
          <input value={srn} onChange={(event) => setSrn(event.target.value)} placeholder="0000000000" inputMode="numeric" autoComplete="off" maxLength={14} />
        </label>
        <label>
          NWMTACI No.
          <input value={no} onChange={(event) => setNo(event.target.value)} placeholder="NWMTACI-2026-0000" autoComplete="off" />
        </label>
        <button className="button button-primary button-block" disabled={!canSearch || busy}>{busy ? "Checking…" : "Check My Status"}</button>
        <p className="muted-text" style={{ margin: "6px 0 0" }}>Your NWMTACI number is on your enrollment confirmation email.</p>
      </form>

      {error && (
        <div className="status-result status-warning">
          <strong>No Record Matched</strong>
          <p>{error}</p>
        </div>
      )}
      {result && (
        <div className="status-result">
          <div className="status-head">
            <div><span className="eyebrow">{result.nwmtaciNo}</span><h2>Hello, {result.firstName}</h2></div>
          </div>
          {result.awaitingCourse && !result.courses.length && <p className="status-next">Your application is being screened. Our Registration team will confirm your course, schedule and fee.</p>}
          {result.courses.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, margin: "12px 0" }}>
              {([["Total Fees", total("feeCentavos"), "#123F63"], ["Paid", total("paidCentavos"), "#15803d"], ["Balance", total("balanceCentavos"), total("balanceCentavos") > 0 ? "#b42318" : "#123F63"]] as const).map(([label, value, color]) => (
                <div key={label} style={{ border: "1px solid #dfe7ee", borderRadius: 12, padding: "10px 14px", background: "#f7fafb" }}>
                  <div style={{ fontSize: 13, color: "#5f7180", fontWeight: 600 }}>{label}</div>
                  <div style={{ ...mono, fontSize: 20, fontWeight: 700, color }}>{peso(value)}</div>
                </div>
              ))}
            </div>
          )}
          {result.courses.map((c, i) => (
            <div className="ts-course" key={`${c.enrollmentNumber}-${i}`}>
              <div className="ts-head"><strong>{c.course}</strong><Pill tone={tone(c.status)}>{c.status}</Pill></div>
              <dl className="review-list">
                {c.enrollmentNumber && <div><dt>Enrollment No.</dt><dd style={mono}>{c.enrollmentNumber}</dd></div>}
                <div><dt>Schedule</dt><dd>{c.schedule}</dd></div>
                <div><dt>Fee</dt><dd style={mono}>{peso(c.feeCentavos)}</dd></div>
                <div><dt>Paid</dt><dd style={mono}>{peso(c.paidCentavos)}</dd></div>
                <div><dt>Balance</dt><dd>{c.balanceCentavos > 0 ? <span className="ts-due"><span style={mono}>{peso(c.balanceCentavos)}</span> to pay at the Cashier</span> : "Fully paid"}</dd></div>
                {c.certificate && <div><dt>Certificate</dt><dd className={c.ready ? "ts-ready" : undefined}>{c.certificate}</dd></div>}
                {c.delivery && <div><dt>Delivery Request</dt><dd>{c.delivery}</dd></div>}
              </dl>
              {!/cancel/i.test(c.status) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <Step done={c.trainingFinished}>Training Finished</Step>
                  <Step done={c.balanceCentavos <= 0}>Paid</Step>
                  {c.postTest?.needed && <Step done={c.postTest.passed}>{c.postTest.passed && c.postTest.best ? `Post-Test ${c.postTest.best.score}/${c.postTest.best.total}` : "Post-Test"}</Step>}
                  {c.evaluation.needed && <Step done={c.evaluation.submitted}>Evaluation</Step>}
                  {c.certificate !== null && <Step done={!!c.certificateNumber}>Certificate{c.certificateNumber && <> <span style={mono}>{c.certificateNumber}</span> · {c.releasedAt ? `Released ${day(c.releasedAt)}` : "Ready for Release"}</>}</Step>}
                </div>
              )}
              {c.postTest?.url && <Link className="button button-primary" href={c.postTest.url} style={{ marginTop: 12, marginRight: 8, display: "inline-flex" }}>{c.postTest.attempts ? "Retake Post-Test" : "Take Post-Test"}</Link>}
              {c.evaluation.url && <Link className="button button-primary" href={c.evaluation.url} style={{ marginTop: 12, display: "inline-flex" }}>Evaluate Training</Link>}
              {c.ready && !c.delivery && <p className="ts-note">Can&apos;t come to the office? <Link href="/certificate-delivery">Request delivery by LBC</Link>.</p>}
            </div>
          ))}
          {result.payments.length > 0 && (
            <div className="ts-course">
              <strong>Payments</strong>
              <div className="data-table" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Receipt</th><th>Date</th><th>Paid By</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                  <tbody>
                    {result.payments.map((p) => (
                      <tr key={p.paymentNumber} style={p.valid ? undefined : { color: "#8a9aa8" }}>
                        <td style={mono}>{p.paymentNumber}{!p.valid && <> <Pill tone="red">Void</Pill></>}</td>
                        <td>{day(p.receivedAt)}</td>
                        <td>{p.method}{p.referenceNumber && <small style={{ display: "block", ...mono }}>Ref. {p.referenceNumber}</small>}</td>
                        <td style={{ ...mono, textAlign: "right", textDecoration: p.valid ? undefined : "line-through" }}>{peso(p.amountCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!!result.proofs?.length && (
            <div className="ts-course">
              <strong>Proofs of Payment</strong>
              <div className="data-table" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Sent</th><th>Paid By</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {result.proofs.map((p, i) => (
                      <tr key={i}>
                        <td>{day(p.submittedAt)}</td>
                        <td>{p.method}{p.reference && <small style={{ display: "block", ...mono }}>Ref. {p.reference}</small>}</td>
                        <td style={{ ...mono, textAlign: "right" }}>{peso(p.amountCentavos)}</td>
                        <td><Pill tone={p.state === "Receipt Issued" ? "green" : p.state === "Not Valid" ? "red" : "amber"}>{p.state}</Pill>{p.reason && <small style={{ display: "block" }}>{p.reason}</small>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------ certificate verification --- */

/** Verify a certificate by the code printed on it (owner, 20 Oct 2026); the QR code opens the same page. */
function VerifyTab() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const normalized = code.toUpperCase().replace(/\s+/g, "");
  return (
    <form className="search-card" onSubmit={(event) => { event.preventDefault(); if (normalized.length >= 4) router.push(`/verify/${encodeURIComponent(normalized)}`); }}>
      <h2 style={{ margin: "0 0 12px", color: "#123F63" }}>Verify a Certificate</h2>
      <label>
        Verification Code
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="8KX4-Q2PM-7TZD" autoComplete="off" autoCapitalize="characters" />
      </label>
      <button className="button button-primary button-block" disabled={normalized.length < 4}>Verify Certificate</button>
      <p>Or scan the QR code on the certificate.</p>
    </form>
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
  return <Page />;
}
