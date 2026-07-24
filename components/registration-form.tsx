"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
import { pesos } from "@/lib/endorsement-catalog";
import { SystemProvider, formatDateRange, useSystem } from "@/lib/system/store";
import type { Applicant, ConsentType } from "@/lib/system/types";

const CONSENT_VERSION = "2026-07-03-r01";
const MAX_COURSES = 5;

type Selection = { courseCode: string; batchId: string };

const emptyApplicant = {
  firstName: "", middleName: "", lastName: "", suffix: "", birthDate: "", gender: "", nationality: "Filipino", civilStatus: "",
  address: "", mobile: "", email: "", srn: "", seafarerStatus: "", company: "", rank: "",
  emergencyContactName: "", emergencyContactRelation: "", emergencyContactMobile: "",
  sourceOfInquiry: "", referralSource: "", promoCode: "", additionalNotes: "",
};

/** The four consent boxes a trainee must tick, and the policy text captured with each. */
const CONSENTS: { key: string; consentType: ConsentType; label: string; policy: string }[] = [
  {
    key: "accuracy",
    consentType: "Accuracy of Information",
    label: "I confirm that the information I provided is complete and accurate.",
    policy: "You are responsible for the accuracy of your details. Corrections after submission are made through a controlled request and may affect scheduling and certificate names.",
  },
  {
    key: "privacy",
    consentType: "Data Privacy Notice",
    label: "I agree to the collection and processing of my information for registration and training purposes.",
    policy: "New Wave Maritime collects your personal and seafarer information solely for registration, training coordination, records, and required communication, and protects it under the Data Privacy Act.",
  },
  {
    key: "terms",
    consentType: "Training Terms and Conditions",
    label: "I have read and accepted the training terms and payment policies.",
    policy: "Training fees are billed per approved course. A slot is confirmed once payment is recorded. Fees are non-transferable between trainees and are subject to the published payment policy.",
  },
  {
    key: "cancellation",
    consentType: "Cancellation Policy",
    label: "I have read and accepted the cancellation and rescheduling policies.",
    policy: "Cancellations and reschedules are subject to approval and cut-off dates. Rescheduling within the cut-off window may incur a fee. Certificates are released only after verified completion.",
  },
];

const steps = ["Applicant details", "Course selection", "Review and consent"] as const;

function Wizard() {
  const { state, openBatchesFor, seats, submitRegistration } = useSystem();
  const [step, setStep] = useState(0);
  const [applicant, setApplicant] = useState(emptyApplicant);
  const [selections, setSelections] = useState<Selection[]>([{ courseCode: "", batchId: "" }]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  const set = <K extends keyof typeof emptyApplicant>(key: K, value: string) =>
    setApplicant((current) => ({ ...current, [key]: value }));

  const batchOf = (batchId: string) => state.batches.find((item) => item.id === batchId);
  const courseOf = (code: string) => IN_HOUSE_COURSES.find((item) => item.code === code);

  // Courses that currently have at least one open, published, future batch.
  const bookableCourses = useMemo(
    () => IN_HOUSE_COURSES.filter((course) => openBatchesFor(course.code).length > 0),
    [openBatchesFor],
  );

  const pickedCourses = selections.map((item) => item.courseCode).filter(Boolean);
  const pickedBatches = selections.map((item) => item.batchId).filter(Boolean);

  function overlaps(a: string, b: string) {
    const left = batchOf(a);
    const right = batchOf(b);
    if (!left || !right) return false;
    return left.startsOn <= right.endsOn && right.startsOn <= left.endsOn;
  }
  const scheduleConflict = selections.some((item, index) =>
    selections.some((other, otherIndex) => otherIndex > index && item.batchId && other.batchId && overlaps(item.batchId, other.batchId)),
  );

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email);
  const mobileValid = applicant.mobile.replace(/\D/g, "").length >= 7;
  const detailsValid =
    applicant.firstName.trim().length >= 2 && applicant.lastName.trim().length >= 2 && Boolean(applicant.birthDate) &&
    applicant.address.trim().length >= 5 && emailValid && mobileValid &&
    applicant.emergencyContactName.trim().length >= 2 && applicant.emergencyContactMobile.replace(/\D/g, "").length >= 7;
  const selectionsValid =
    selections.length >= 1 && selections.every((item) => item.courseCode && item.batchId) && !scheduleConflict;
  const allAccepted = CONSENTS.every((consent) => accepted[consent.key]);

  function addCourse() {
    if (selections.length >= MAX_COURSES) return;
    setSelections((current) => [...current, { courseCode: "", batchId: "" }]);
  }
  function removeCourse(index: number) {
    setSelections((current) => current.filter((_, i) => i !== index));
  }
  function updateSelection(index: number, patch: Partial<Selection>) {
    setSelections((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function submit() {
    setError("");
    // Revalidate slots at the moment of submission.
    const stale = selections.find((item) => seats(item.batchId).available <= 0);
    if (stale) {
      setError("This schedule is no longer available. Please select another schedule.");
      return;
    }
    const applicantRecord: Applicant = {
      ...applicant,
      middleName: applicant.middleName || undefined,
      suffix: applicant.suffix || undefined,
      srn: applicant.srn || undefined,
      company: applicant.company || undefined,
      rank: applicant.rank || undefined,
      gender: applicant.gender || undefined,
      civilStatus: applicant.civilStatus || undefined,
      seafarerStatus: applicant.seafarerStatus || undefined,
      emergencyContactRelation: applicant.emergencyContactRelation || undefined,
      sourceOfInquiry: applicant.sourceOfInquiry || undefined,
      referralSource: applicant.referralSource || undefined,
      promoCode: applicant.promoCode || undefined,
      additionalNotes: applicant.additionalNotes || undefined,
    };
    const submission = submitRegistration({
      applicant: applicantRecord,
      selections: selections.map((item) => ({
        courseCode: item.courseCode,
        courseName: courseOf(item.courseCode)?.course ?? item.courseCode,
        batchId: item.batchId,
      })),
      consents: CONSENTS.map((consent) => ({
        consentType: consent.consentType,
        version: CONSENT_VERSION,
        textSnapshot: consent.policy,
      })),
      sessionRef: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined,
    });
    setReference(submission.reference);
  }

  if (!state.settings.onlineRegistrationOpen) {
    return (
      <div className="reg-card reg-closed">
        <h2>Online registration is temporarily closed</h2>
        <p>New Wave has paused new online submissions. Please contact the center so we can assist you directly.</p>
        <Link className="button button-primary" href="/contact">
          Contact New Wave
        </Link>
      </div>
    );
  }

  if (reference) {
    return (
      <div className="reg-card reg-success">
        <span className="success-mark">✓</span>
        <h2>Registration received</h2>
        <p>
          Keep this reference. Use it together with your registered email or mobile number to check the status of every course
          you selected.
        </p>
        <div className="reference-block">
          <span>Registration reference</span>
          <strong>{reference}</strong>
        </div>
        <p className="reg-note">
          Each approved course will receive its own enrollment number. Track everything under one reference on the enrollment
          status page.
        </p>
        <div className="reg-success-actions">
          <Link className="button button-primary" href="/registration-search">
            Check enrollment status
          </Link>
          <Link className="button button-secondary" href="/">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="reg-card">
      <ol className="wizard-steps">
        {steps.map((label, index) => (
          <li key={label} className={index === step ? "current" : index < step ? "done" : ""}>
            <span>{index < step ? "✓" : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <p className="form-message" role="alert">
          {error}
        </p>
      )}

      {step === 0 && (
        <>
          <section className="wizard-panel">
            <h2>Personal information</h2>
            <div className="reg-grid">
              <Field label="First name*"><input value={applicant.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
              <Field label="Middle name"><input value={applicant.middleName} onChange={(e) => set("middleName", e.target.value)} /></Field>
              <Field label="Last name*"><input value={applicant.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
              <Field label="Suffix"><input value={applicant.suffix} onChange={(e) => set("suffix", e.target.value)} placeholder="Jr., III" /></Field>
              <Field label="Date of birth*"><input type="date" value={applicant.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("birthDate", e.target.value)} /></Field>
              <Field label="Gender">
                <select value={applicant.gender} onChange={(e) => set("gender", e.target.value)}>
                  <option value="">Select</option><option>Male</option><option>Female</option><option>Prefer not to say</option>
                </select>
              </Field>
              <Field label="Nationality"><input value={applicant.nationality} onChange={(e) => set("nationality", e.target.value)} /></Field>
              <Field label="Civil status">
                <select value={applicant.civilStatus} onChange={(e) => set("civilStatus", e.target.value)}>
                  <option value="">Select</option><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option><option>Divorced</option>
                </select>
              </Field>
              <Field label="Complete address*" wide><input value={applicant.address} onChange={(e) => set("address", e.target.value)} /></Field>
              <Field label="Mobile number*"><input value={applicant.mobile} onChange={(e) => set("mobile", e.target.value)} inputMode="tel" placeholder="09XX XXX XXXX" /></Field>
              <Field label="Email address*"><input type="email" value={applicant.email} onChange={(e) => set("email", e.target.value)} /></Field>
            </div>
          </section>
          <section className="wizard-panel">
            <h2>Seafarer information</h2>
            <div className="reg-grid">
              <Field label="SRN / MISMO number"><input value={applicant.srn} onChange={(e) => set("srn", e.target.value)} placeholder="10 digits" /></Field>
              <Field label="Seafarer status">
                <select value={applicant.seafarerStatus} onChange={(e) => set("seafarerStatus", e.target.value)}>
                  <option value="">Select</option><option>Active seafarer</option><option>Aspiring seafarer</option><option>Officer</option><option>Rating</option><option>Non-seafarer</option>
                </select>
              </Field>
              <Field label="Company or vessel"><input value={applicant.company} onChange={(e) => set("company", e.target.value)} /></Field>
              <Field label="Position or rank"><input value={applicant.rank} onChange={(e) => set("rank", e.target.value)} /></Field>
            </div>
          </section>
          <section className="wizard-panel">
            <h2>Emergency contact</h2>
            <div className="reg-grid">
              <Field label="Contact person*"><input value={applicant.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} /></Field>
              <Field label="Relationship"><input value={applicant.emergencyContactRelation} onChange={(e) => set("emergencyContactRelation", e.target.value)} /></Field>
              <Field label="Contact number*"><input value={applicant.emergencyContactMobile} onChange={(e) => set("emergencyContactMobile", e.target.value)} inputMode="tel" /></Field>
            </div>
          </section>
        </>
      )}

      {step === 1 && (
        <section className="wizard-panel">
          <h2>Select your courses</h2>
          <p className="wizard-hint">Choose 1 to {MAX_COURSES} courses. Pick a course first, then an available schedule. Schedules come only from batches published by New Wave.</p>
          <div className="selection-list">
            {selections.map((selection, index) => {
              const schedules = selection.courseCode ? openBatchesFor(selection.courseCode) : [];
              const course = courseOf(selection.courseCode);
              return (
                <div key={index} className="selection-block">
                  <div className="selection-block-head">
                    <strong>Course {index + 1}</strong>
                    {selections.length > 1 && (
                      <button type="button" className="text-button" onClick={() => removeCourse(index)}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="reg-grid">
                    <Field label="Preferred course*" wide>
                      <select value={selection.courseCode} onChange={(e) => updateSelection(index, { courseCode: e.target.value, batchId: "" })}>
                        <option value="">Select a course</option>
                        {bookableCourses.map((item) => (
                          <option key={item.id} value={item.code} disabled={pickedCourses.includes(item.code) && item.code !== selection.courseCode}>
                            {item.code} — {item.course}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {course && (
                    <div className="course-summary">
                      <div><span>Duration</span><strong>{course.duration}</strong></div>
                      <div><span>Modality</span><strong>{course.modality}</strong></div>
                      <div><span>Category</span><strong>{course.category}</strong></div>
                    </div>
                  )}
                  {selection.courseCode && schedules.length === 0 && (
                    <div className="reg-notice"><strong>No published schedule for this course yet</strong><p>Please choose another course or contact New Wave.</p></div>
                  )}
                  {schedules.length > 0 && (
                    <div className="schedule-picker">
                      {schedules.map((batch) => {
                        const seat = seats(batch.id);
                        const takenElsewhere = pickedBatches.includes(batch.id) && selection.batchId !== batch.id;
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            className={`schedule-option ${selection.batchId === batch.id ? "selected" : ""}`}
                            disabled={takenElsewhere}
                            onClick={() => updateSelection(index, { batchId: batch.id })}
                          >
                            <span className="schedule-body">
                              <strong>{formatDateRange(batch.startsOn, batch.endsOn)}</strong>
                              <small>{batch.mode} · {batch.venue} · {batch.batchNumber}</small>
                              <small>{takenElsewhere ? "Already selected above" : `${seat.available} of ${seat.capacity} slots available`}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {scheduleConflict && (
            <div className="reg-notice reg-notice-warn"><strong>Schedule conflict</strong><p>Two selected schedules overlap. Adjust one before continuing.</p></div>
          )}
          <button type="button" className="button button-secondary add-course" disabled={selections.length >= MAX_COURSES} onClick={addCourse}>
            {selections.length >= MAX_COURSES ? "Maximum of five courses reached" : "Add More Course +"}
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="wizard-panel">
          <h2>Review and accept</h2>
          <div className="reg-grid">
            <Field label="Source of inquiry"><input value={applicant.sourceOfInquiry} onChange={(e) => set("sourceOfInquiry", e.target.value)} placeholder="Facebook, referral, walk-in…" /></Field>
            <Field label="Referral source"><input value={applicant.referralSource} onChange={(e) => set("referralSource", e.target.value)} /></Field>
            <Field label="Promo code"><input value={applicant.promoCode} onChange={(e) => set("promoCode", e.target.value)} /></Field>
            <Field label="Additional notes" wide><input value={applicant.additionalNotes} onChange={(e) => set("additionalNotes", e.target.value)} /></Field>
          </div>

          <h3 className="review-subhead">Selected courses</h3>
          <div className="review-courses">
            {selections.map((selection, index) => {
              const batch = batchOf(selection.batchId);
              const course = courseOf(selection.courseCode);
              return (
                <div key={index} className="review-course">
                  <div>
                    <strong>{course?.course}</strong>
                    <small>{batch ? `${formatDateRange(batch.startsOn, batch.endsOn)} · ${batch.mode} · ${batch.venue}` : ""}</small>
                  </div>
                  <span>{batch ? pesos(batch.feeCentavos) : ""}</span>
                </div>
              );
            })}
            <div className="review-course review-total">
              <strong>Estimated total</strong>
              <span>{pesos(selections.reduce((sum, item) => sum + (batchOf(item.batchId)?.feeCentavos ?? 0), 0))}</span>
            </div>
          </div>

          <h3 className="review-subhead">Consent and policies</h3>
          <div className="consent-blocks">
            {CONSENTS.map((consent) => (
              <details key={consent.key} className="policy-block">
                <summary>{consent.consentType}</summary>
                <p>{consent.policy}</p>
              </details>
            ))}
            {CONSENTS.map((consent) => (
              <label key={`chk-${consent.key}`} className="consent-row">
                <input type="checkbox" checked={Boolean(accepted[consent.key])} onChange={(e) => setAccepted((current) => ({ ...current, [consent.key]: e.target.checked }))} />
                <span>{consent.label}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <div className="wizard-actions">
        <button className="button button-secondary" type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Back
        </button>
        {step < 2 ? (
          <button className="button button-primary" type="button" disabled={step === 0 ? !detailsValid : !selectionsValid} onClick={() => setStep((s) => s + 1)}>
            Continue
          </button>
        ) : (
          <button className="button button-primary" type="button" disabled={!allAccepted || !selectionsValid} onClick={submit}>
            Submit enrollment
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? "span-2" : ""}>
      {label}
      {children}
    </label>
  );
}

export function RegistrationForm() {
  return (
    <SystemProvider>
      <Wizard />
    </SystemProvider>
  );
}
