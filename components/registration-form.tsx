"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

const emptyApplicant = {
  srn: "", firstName: "", middleName: "", lastName: "", suffix: "", birthDate: "", placeOfBirth: "",
  address: "", mobile: "", email: "", company: "", rank: "", rankOther: "",
  emergencyContactName: "", emergencyContactMobile: "",
};

const steps = ["Applicant details", "Course selection", "Review and consent"] as const;
const upper = (value: string) => value.toUpperCase();

function Wizard() {
  const [step, setStep] = useState(0);
  const [applicant, setApplicant] = useState(emptyApplicant);
  const [courseCode, setCourseCode] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof typeof emptyApplicant>(key: K, value: string) => setApplicant((current) => ({ ...current, [key]: value }));

  // Live bookable courses (with a published, open, future schedule).
  useEffect(() => { let live = true; fetch("/api/public/courses").then((r) => r.json()).then((b) => { if (live) setCourses(b.courses ?? []); }).catch(() => {}); return () => { live = false; }; }, []);
  // Live schedules for the chosen course.
  useEffect(() => {
    if (!courseCode) { setSchedules([]); return; }
    let live = true; setLoadingSchedules(true); setScheduleId("");
    fetch(`/api/public/schedules?courseCode=${encodeURIComponent(courseCode)}`).then((r) => r.json()).then((b) => { if (live) setSchedules(b.schedules ?? []); }).catch(() => { if (live) setSchedules([]); }).finally(() => { if (live) setLoadingSchedules(false); });
    return () => { live = false; };
  }, [courseCode]);

  const courseName = useMemo(() => courses.find((c) => c.code === courseCode)?.name ?? "", [courses, courseCode]);
  const mobileDigits = applicant.mobile.replace(/\D/g, "");
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email);
  const mobileValid = mobileDigits.length >= 7;
  const emergencyMobileValid = applicant.emergencyContactMobile.replace(/\D/g, "").length >= 7;
  const rankValid = applicant.rank !== "" && (applicant.rank !== "OTHER" || applicant.rankOther.trim().length >= 2);
  const detailsValid =
    applicant.firstName.trim().length >= 2 && applicant.lastName.trim().length >= 2 && Boolean(applicant.birthDate) &&
    applicant.placeOfBirth.trim().length >= 2 && applicant.address.trim().length >= 8 && mobileValid && emailValid && rankValid &&
    applicant.emergencyContactName.trim().length >= 2 && emergencyMobileValid && (applicant.srn === "" || applicant.srn.length === 10);
  const selectionsValid = Boolean(courseCode && scheduleId);

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
      fd.set("courseCode", courseCode); fd.set("courseName", courseName); fd.set("scheduleId", scheduleId); fd.set("termsAccepted", "on");
      const response = await fetch("/api/public/registrations", { method: "POST", body: fd });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "We could not submit your enrollment. Please review your details and try again."); return; }
      setReference(body.reference);
    } catch {
      setError("We could not reach the server. Please check your connection and try again.");
    } finally { setSubmitting(false); }
  }

  if (reference) {
    return (
      <div className="reg-card reg-success">
        <span className="success-mark">✓</span>
        <h2>Enrollment received</h2>
        <p>Keep this reference. Use it with your registered email or mobile number to track your enrollment.</p>
        <div className="reference-block"><span>Registration reference</span><strong>{reference}</strong></div>
        <div className="reg-success-actions">
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
          <h2>Select your course</h2>
          <p className="wizard-hint">Pick a course, then an available schedule.</p>
          <div className="reg-grid">
            <Field label="Preferred course*" wide>
              <select value={courseCode} onChange={(e) => setCourseCode(e.target.value)}>
                <option value="">Select a course</option>
                {courses.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}
              </select>
            </Field>
          </div>
          {!courses.length && <div className="reg-notice"><strong>No published schedules are open right now</strong><p>Please check back soon or contact New Wave.</p></div>}
          {courseCode && (
            loadingSchedules ? <p className="wizard-hint">Loading schedules…</p> :
            schedules.length === 0 ? <div className="reg-notice"><strong>No published schedule for this course yet</strong><p>Please choose another course or contact New Wave.</p></div> :
            <div className="schedule-picker">
              {schedules.map((batch) => (
                <button key={batch.id} type="button" className={`schedule-option ${scheduleId === batch.id ? "selected" : ""}`} onClick={() => setScheduleId(batch.id)}>
                  <span className="schedule-body"><strong>{batch.label}</strong></span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="wizard-panel">
          <h2>Review and accept</h2>
          <div className="review-courses">
            <div className="review-course"><div><strong>{courseName}</strong><small>{schedules.find((s) => s.id === scheduleId)?.label ?? ""}</small></div></div>
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
