"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SUFFIXES = ["", "JR.", "SR.", "II", "III", "IV", "V"] as const;
const RANKS = [
  "MASTER", "CHIEF OFFICER", "SECOND OFFICER", "THIRD OFFICER", "DECK CADET",
  "CHIEF ENGINEER", "SECOND ENGINEER", "THIRD ENGINEER", "FOURTH ENGINEER", "ENGINE CADET",
  "BOSUN", "ABLE SEAMAN", "ORDINARY SEAMAN", "OILER", "WIPER", "FITTER", "MESSMAN", "CHIEF COOK",
  "ELECTRICIAN", "PUMPMAN", "OTHER",
] as const;

/** The full New Wave Terms and Conditions, accepted with a single checkbox. */
const TERMS_SECTIONS: { heading: string; items: string[] }[] = [
  { heading: "1. Payment Terms", items: ["Full payment or a minimum of 50% down payment is required upon enrollment.", "Full payment must be settled before the completion of the training.", "Full payment is required for a 1-day course of New Wave."] },
  { heading: "2. Cancellation Policy", items: ["Enrollment cancellations must be communicated to the Training Center prior to the scheduled training date.", "Applicable cancellation charges and deductions shall be in accordance with the Refund Policy of the Training Center."] },
  { heading: "3. Rescheduling Policy", items: ["Trainees unable to attend a scheduled session for courses of one (1) to two (2) days may request to have their training rescheduled.", "Rescheduling is subject to slot availability and approval of the Training Center.", "Applicable reschedule charges and deductions shall be in accordance with the Refund Policy of the Training Center."] },
  { heading: "4. Refund Policy", items: ["Refund requests made at least five (5) days before the scheduled training date shall be subject to a Php 350.00 processing fee.", "Refund requests made within five (5) days before the scheduled training date shall be subject to a deduction of 50% of the course fee plus a Php 250.00 processing fee."] },
  { heading: "5. Make-up Class Policy", items: ["Make-up classes are available only for courses of three (3) days or more, subject to schedule availability and approval.", "Trainees unable to attend a scheduled session due to valid reasons must immediately inform the Training Center.", "A make-up class fee of Php 350.00 per training day shall be charged."] },
  { heading: "6. Issuance of Certificate of Completion", items: ["Certificates of Completion shall be issued only to trainees who have successfully completed all course requirements and settled all outstanding balances."] },
];

type Course = { code: string; name: string };
type Schedule = { id: string; label: string; availableSlots: number };
type Selection = { courseCode: string; scheduleId: string };

const emptyApplicant = {
  srn: "", firstName: "", middleName: "", lastName: "", suffix: "", birthDate: "", placeOfBirth: "",
  address: "", mobile: "", email: "", company: "", rank: "", rankOther: "",
  emergencyContactName: "", emergencyContactMobile: "",
};

const steps = ["Applicant details", "Course selection", "Review and consent"] as const;
const upper = (value: string) => value.toUpperCase();
const MAX_COURSES = 5;

function Wizard() {
  const [step, setStep] = useState(0);
  const [applicant, setApplicant] = useState(emptyApplicant);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selections, setSelections] = useState<Selection[]>([{ courseCode: "", scheduleId: "" }]);
  const [schedulesByCourse, setSchedulesByCourse] = useState<Record<string, Schedule[]>>({});
  const [loadingCourse, setLoadingCourse] = useState<Record<string, boolean>>({});
  const [accepted, setAccepted] = useState(false);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof typeof emptyApplicant>(key: K, value: string) => setApplicant((current) => ({ ...current, [key]: value }));

  // Live bookable courses (with a published, open schedule this week).
  useEffect(() => { let live = true; fetch("/api/public/courses").then((r) => r.json()).then((b) => { if (live) setCourses(b.courses ?? []); }).catch(() => {}); return () => { live = false; }; }, []);

  async function ensureSchedules(code: string) {
    if (!code || schedulesByCourse[code] || loadingCourse[code]) return;
    setLoadingCourse((l) => ({ ...l, [code]: true }));
    try { const r = await fetch(`/api/public/schedules?courseCode=${encodeURIComponent(code)}`); const b = await r.json(); setSchedulesByCourse((m) => ({ ...m, [code]: b.schedules ?? [] })); }
    catch { setSchedulesByCourse((m) => ({ ...m, [code]: [] })); }
    finally { setLoadingCourse((l) => ({ ...l, [code]: false })); }
  }

  function chooseCourse(index: number, code: string) {
    setSelections((cur) => cur.map((s, i) => (i === index ? { courseCode: code, scheduleId: "" } : s)));
    if (code) void ensureSchedules(code);
  }
  function chooseSchedule(index: number, id: string) {
    setSelections((cur) => cur.map((s, i) => (i === index ? { ...s, scheduleId: id } : s)));
  }
  function addSelection() { setSelections((cur) => (cur.length < MAX_COURSES ? [...cur, { courseCode: "", scheduleId: "" }] : cur)); }
  function removeSelection(index: number) { setSelections((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== index) : cur)); }

  const nameOf = (code: string) => courses.find((c) => c.code === code)?.name ?? "";
  const labelOf = (code: string, id: string) => (schedulesByCourse[code] ?? []).find((s) => s.id === id)?.label ?? "";

  const mobileDigits = applicant.mobile.replace(/\D/g, "");
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email);
  const mobileValid = mobileDigits.length >= 7;
  const emergencyMobileValid = applicant.emergencyContactMobile.replace(/\D/g, "").length >= 7;
  const rankValid = applicant.rank !== "" && (applicant.rank !== "OTHER" || applicant.rankOther.trim().length >= 2);
  const detailsValid =
    applicant.firstName.trim().length >= 2 && applicant.lastName.trim().length >= 2 && Boolean(applicant.birthDate) &&
    applicant.placeOfBirth.trim().length >= 2 && applicant.address.trim().length >= 8 && mobileValid && emailValid && rankValid &&
    applicant.emergencyContactName.trim().length >= 2 && emergencyMobileValid && (applicant.srn === "" || applicant.srn.length === 10);
  const completeSelections = selections.filter((s) => s.courseCode && s.scheduleId);
  // Every row must be either fully complete or completely empty; at least one complete.
  const selectionsValid = completeSelections.length >= 1 && selections.every((s) => (!s.courseCode && !s.scheduleId) || (Boolean(s.courseCode) && Boolean(s.scheduleId)));

  async function submit() {
    setError("");
    setSubmitting(true);
    try {
      const rank = applicant.rank === "OTHER" ? applicant.rankOther.trim() : applicant.rank;
      const fd = new FormData();
      fd.set("firstName", applicant.firstName); fd.set("middleName", applicant.middleName); fd.set("lastName", applicant.lastName); fd.set("suffix", applicant.suffix);
      fd.set("srn", applicant.srn); fd.set("email", applicant.email.toLowerCase()); fd.set("presentAddress", applicant.address); fd.set("mobile", applicant.mobile);
      fd.set("placeOfBirth", applicant.placeOfBirth); fd.set("birthDate", applicant.birthDate); fd.set("rank", rank); fd.set("company", applicant.company);
      fd.set("emergencyContactName", applicant.emergencyContactName); fd.set("emergencyContactMobile", applicant.emergencyContactMobile);
      for (const s of completeSelections) fd.append("scheduleIds", s.scheduleId);
      fd.set("termsAccepted", "on");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      let response: Response;
      try {
        response = await fetch("/api/public/registrations", { method: "POST", body: fd, signal: controller.signal });
      } finally { clearTimeout(timer); }
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "We could not submit your enrollment. Please review your details and try again."); return; }
      setReference(body.reference);
    } catch (e) {
      setError(e instanceof DOMException && e.name === "AbortError" ? "The server took too long to respond. Please try again in a moment." : "We could not reach the server. Please check your connection and try again.");
    } finally { setSubmitting(false); }
  }

  if (reference) {
    return (
      <div className="reg-card reg-success">
        <span className="success-mark">✓</span>
        <h2>Enrollment received</h2>
        <p>Keep this reference. Use it with your registered email or mobile number to track your enrollment.</p>
        <div className="reference-block"><span>Registration reference</span><strong>{reference}</strong></div>

        <div className="reg-next-steps" style={{ textAlign: "left", marginTop: 20 }}>
          <h3 style={{ margin: "0 0 8px", color: "#123F63" }}>Next steps</h3>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            <li><strong>Screenshot this confirmation</strong> (with your registration reference).</li>
            <li>Send the screenshot together with a <strong>valid ID</strong> to our official Facebook page{" "}
              <a href="https://web.facebook.com/newwavemtc" target="_blank" rel="noopener noreferrer">facebook.com/newwavemtc</a>{" "}
              or email <a href="mailto:newwavemaritime@gmail.com">newwavemaritime@gmail.com</a>.</li>
            <li>Settle your training fee through an official payment channel below, then send the payment screenshot for verification.</li>
          </ol>
        </div>

        <div className="reg-payment-channels" style={{ textAlign: "left", marginTop: 18, padding: 14, border: "1px solid #9EE3F1", borderRadius: 10, background: "#F5FCFE" }}>
          <h3 style={{ margin: "0 0 10px", color: "#F25615", letterSpacing: ".02em" }}>New Wave — Official payment channels</h3>
          <div style={{ marginBottom: 10 }}>
            <strong style={{ color: "#123F63" }}>UnionBank of the Philippines</strong>
            <div>New Wave Maritime</div>
            <div style={{ fontFamily: "monospace", fontSize: "1.05em", letterSpacing: ".04em" }}>002280021128</div>
          </div>
          <div>
            <strong style={{ color: "#123F63" }}>GCash</strong>
            <div>Ap**l C.</div>
            <div style={{ fontFamily: "monospace", fontSize: "1.05em", letterSpacing: ".04em" }}>0993 380 2997</div>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: ".85em", color: "#456" }}>Always confirm the account name before sending. Keep your payment receipt for verification.</p>
        </div>

        <div className="reg-success-actions" style={{ marginTop: 18 }}>
          <Link className="button button-primary" href="/registration-search">Check enrollment status</Link>
          <Link className="button button-secondary" href="/courses">Browse courses</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="reg-card">
      <ol className="wizard-steps">
        {steps.map((label, index) => (
          <li key={label} className={index === step ? "current" : index < step ? "done" : ""}><span>{index < step ? "✓" : index + 1}</span>{label}</li>
        ))}
      </ol>
      {error && <p className="form-message" role="alert">{error}</p>}

      {step === 0 && (
        <>
          <section className="wizard-panel">
            <h2>Applicant details</h2>
            <p className="wizard-hint">All fields are required except the middle name, suffix, SRN, and company.</p>
            <div className="reg-grid caps-form">
              <Field label="SRN / MISMO number (optional)" wide><input value={applicant.srn} onChange={(e) => set("srn", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="10 DIGITS" /></Field>
              <Field label="First name*"><input value={applicant.firstName} onChange={(e) => set("firstName", upper(e.target.value))} /></Field>
              <Field label="Middle name"><input value={applicant.middleName} onChange={(e) => set("middleName", upper(e.target.value))} /></Field>
              <Field label="Last name*"><input value={applicant.lastName} onChange={(e) => set("lastName", upper(e.target.value))} /></Field>
              <Field label="Suffix"><select value={applicant.suffix} onChange={(e) => set("suffix", e.target.value)}>{SUFFIXES.map((item) => <option key={item || "none"} value={item}>{item || "None"}</option>)}</select></Field>
              <Field label="Date of birth*"><input type="date" value={applicant.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("birthDate", e.target.value)} /></Field>
              <Field label="Place of birth*"><input value={applicant.placeOfBirth} onChange={(e) => set("placeOfBirth", upper(e.target.value))} /></Field>
              <Field label="Complete address*" wide><input value={applicant.address} onChange={(e) => set("address", upper(e.target.value))} /></Field>
              <Field label="Mobile number*"><input value={applicant.mobile} onChange={(e) => set("mobile", e.target.value)} inputMode="tel" placeholder="09XX XXX XXXX" /></Field>
              <Field label="Email address*"><input type="email" value={applicant.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Rank*"><select value={applicant.rank} onChange={(e) => set("rank", e.target.value)}><option value="">SELECT</option>{RANKS.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              {applicant.rank === "OTHER" && <Field label="Specify rank*"><input value={applicant.rankOther} onChange={(e) => set("rankOther", upper(e.target.value))} /></Field>}
              <Field label="Company / manning agency" wide><input value={applicant.company} onChange={(e) => set("company", upper(e.target.value))} /></Field>
            </div>
          </section>
          <section className="wizard-panel">
            <h2>Emergency contact</h2>
            <div className="reg-grid caps-form">
              <Field label="Contact person*"><input value={applicant.emergencyContactName} onChange={(e) => set("emergencyContactName", upper(e.target.value))} /></Field>
              <Field label="Contact number*"><input value={applicant.emergencyContactMobile} onChange={(e) => set("emergencyContactMobile", e.target.value)} inputMode="tel" /></Field>
            </div>
          </section>
        </>
      )}

      {step === 1 && (
        <section className="wizard-panel">
          <h2>Select your courses</h2>
          <p className="wizard-hint">Pick a course and an available schedule. You can add up to {MAX_COURSES} courses in one submission.</p>
          {!courses.length && <div className="reg-notice"><strong>No published schedules are open this week</strong><p>Please check back soon or contact New Wave.</p></div>}
          {selections.map((sel, index) => {
            const list = schedulesByCourse[sel.courseCode] ?? [];
            const available = courses.filter((c) => c.code === sel.courseCode || !selections.some((s) => s.courseCode === c.code));
            return (
              <div key={index} className="reg-selection" style={{ border: "1px solid #cfe6ef", borderRadius: 12, padding: 14, margin: "0 0 14px" }}>
                <div className="reg-grid">
                  <Field label={`Course ${index + 1}*`} wide>
                    <select value={sel.courseCode} onChange={(e) => chooseCourse(index, e.target.value)}>
                      <option value="">Select a course</option>
                      {available.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}
                    </select>
                  </Field>
                </div>
                {sel.courseCode && (
                  loadingCourse[sel.courseCode] ? <p className="wizard-hint">Loading schedules…</p> :
                  list.length === 0 ? <div className="reg-notice"><strong>No schedule this week for this course</strong><p>Please choose another course.</p></div> :
                  <div className="schedule-picker">
                    {list.map((batch) => (
                      <button key={batch.id} type="button" className={`schedule-option ${sel.scheduleId === batch.id ? "selected" : ""}`} onClick={() => chooseSchedule(index, batch.id)}>
                        <span className="schedule-body"><strong>{batch.label}</strong></span>
                      </button>
                    ))}
                  </div>
                )}
                {selections.length > 1 && <button type="button" className="button button-secondary" style={{ marginTop: 10 }} onClick={() => removeSelection(index)}>Remove course {index + 1}</button>}
              </div>
            );
          })}
          {selections.length < MAX_COURSES && courses.length > 0 && (
            <button type="button" className="button button-secondary" onClick={addSelection}>+ Add another course ({selections.length}/{MAX_COURSES})</button>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="wizard-panel">
          <h2>Review and accept</h2>
          <div className="review-courses">
            {completeSelections.map((s, i) => (
              <div key={i} className="review-course"><div><strong>{nameOf(s.courseCode)}</strong><small>{labelOf(s.courseCode, s.scheduleId)}</small></div></div>
            ))}
          </div>
          <h3 className="review-subhead">Terms and Conditions</h3>
          <div className="terms-box">
            {TERMS_SECTIONS.map((section) => (
              <div key={section.heading} className="terms-section"><strong>{section.heading}</strong><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>
            ))}
            <p className="terms-footer">New Wave Maritime Training and Assessment Center reserves the right to amend, revise, or update these details without prior notice.</p>
          </div>
          <label className="consent-row">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>I have read and accepted the New Wave Maritime Terms and Conditions, including the payment, cancellation, rescheduling, refund, make-up class, and certificate policies, and I confirm that the information I provided is complete and accurate.</span>
          </label>
        </section>
      )}

      <div className="wizard-actions">
        <button className="button button-secondary" type="button" disabled={step === 0 || submitting} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
        {step < 2 ? (
          <button className="button button-primary" type="button" disabled={step === 0 ? !detailsValid : !selectionsValid} onClick={() => setStep((s) => s + 1)}>Continue</button>
        ) : (
          <button className="button button-primary" type="button" disabled={!accepted || !selectionsValid || submitting} onClick={submit}>{submitting ? "Submitting…" : "Submit enrollment"}</button>
        )}
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? "span-2" : ""}>{label}{children}</label>;
}

export function RegistrationForm() {
  return <Wizard />;
}
