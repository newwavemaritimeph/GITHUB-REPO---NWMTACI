"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
import { pesos } from "@/lib/endorsement-catalog";
import { SystemProvider, formatDateRange, useSystem } from "@/lib/system/store";
import type { Applicant } from "@/lib/system/types";

const CONSENT_VERSION = "2026-07-03-r01";
const MAX_COURSES = 5;

const SUFFIXES = ["", "JR.", "SR.", "II", "III", "IV", "V"] as const;
const RANKS = [
  "MASTER", "CHIEF OFFICER", "SECOND OFFICER", "THIRD OFFICER", "DECK CADET",
  "CHIEF ENGINEER", "SECOND ENGINEER", "THIRD ENGINEER", "FOURTH ENGINEER", "ENGINE CADET",
  "BOSUN", "ABLE SEAMAN", "ORDINARY SEAMAN", "OILER", "WIPER", "FITTER", "MESSMAN", "CHIEF COOK",
  "ELECTRICIAN", "PUMPMAN", "OTHER",
] as const;

/** The full New Wave Terms and Conditions, accepted with a single checkbox. */
const TERMS_SECTIONS: { heading: string; items: string[] }[] = [
  {
    heading: "1. Payment Terms",
    items: [
      "Full payment or a minimum of 50% down payment is required upon enrollment.",
      "Full payment must be settled before the completion of the training.",
      "Full payment is required for a 1-day course of New Wave.",
    ],
  },
  {
    heading: "2. Cancellation Policy",
    items: [
      "Enrollment cancellations must be communicated to the Training Center prior to the scheduled training date.",
      "Applicable cancellation charges and deductions shall be in accordance with the Refund Policy of the Training Center.",
    ],
  },
  {
    heading: "3. Rescheduling Policy",
    items: [
      "Trainees unable to attend a scheduled session for courses of one (1) to two (2) days may request to have their training rescheduled.",
      "Rescheduling is subject to slot availability and approval of the Training Center.",
      "Applicable reschedule charges and deductions shall be in accordance with the Refund Policy of the Training Center.",
    ],
  },
  {
    heading: "4. Refund Policy",
    items: [
      "Refund requests made at least five (5) days before the scheduled training date shall be subject to a Php 350.00 processing fee.",
      "Refund requests made within five (5) days before the scheduled training date shall be subject to a deduction of 50% of the course fee plus a Php 250.00 processing fee.",
    ],
  },
  {
    heading: "5. Make-up Class Policy",
    items: [
      "Make-up classes are available only for courses of three (3) days or more, subject to schedule availability and approval.",
      "Trainees unable to attend a scheduled session due to valid reasons must immediately inform the Training Center.",
      "A make-up class fee of Php 350.00 per training day shall be charged.",
    ],
  },
  {
    heading: "6. Issuance of Certificate of Completion",
    items: [
      "Certificates of Completion shall be issued only to trainees who have successfully completed all course requirements and settled all outstanding balances.",
    ],
  },
];

const TERMS_SNAPSHOT = TERMS_SECTIONS.map((section) => `${section.heading}\n- ${section.items.join("\n- ")}`).join("\n\n");

type Selection = { courseCode: string; batchId: string };

const emptyApplicant = {
  srn: "", firstName: "", middleName: "", lastName: "", suffix: "", birthDate: "", nationality: "FILIPINO",
  address: "", mobile: "", email: "", seafarerStatus: "", company: "", rank: "", rankOther: "",
  emergencyContactName: "", emergencyContactRelation: "", emergencyContactMobile: "",
  sourceOfInquiry: "", referralSource: "", promoCode: "",
};

const steps = ["Applicant details", "Course selection", "Review and consent"] as const;
const upper = (value: string) => value.toUpperCase();

function Wizard() {
  const { state, openBatchesFor, seats, submitRegistration } = useSystem();
  const [step, setStep] = useState(0);
  const [applicant, setApplicant] = useState(emptyApplicant);
  const [selections, setSelections] = useState<Selection[]>([{ courseCode: "", batchId: "" }]);
  const [accepted, setAccepted] = useState(false);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  const set = <K extends keyof typeof emptyApplicant>(key: K, value: string) =>
    setApplicant((current) => ({ ...current, [key]: value }));

  const batchOf = (batchId: string) => state.batches.find((item) => item.id === batchId);
  const courseOf = (code: string) => IN_HOUSE_COURSES.find((item) => item.code === code);

  // Entering a full SRN pulls the existing trainee's details so repeat clients
  // never re-type their record. The SRN is the first field for this reason.
  function onSrnChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    setApplicant((current) => {
      const next = { ...current, srn: digits };
      if (digits.length === 10) {
        const match = state.trainees.find((trainee) => (trainee.srn ?? "").replace(/\D/g, "") === digits);
        if (match) {
          next.firstName = upper(match.firstName);
          next.middleName = upper(match.middleName ?? "");
          next.lastName = upper(match.lastName);
          next.suffix = upper(match.suffix ?? "");
          next.birthDate = match.birthDate;
          next.nationality = upper(match.nationality ?? "FILIPINO");
          next.address = upper(match.address ?? "");
          next.mobile = match.mobile;
          next.email = match.email;
          next.company = upper(match.company ?? "");
          next.seafarerStatus = match.seafarerStatus ?? "";
          const rankUpper = upper(match.rank ?? "");
          if (rankUpper && (RANKS as readonly string[]).includes(rankUpper)) next.rank = rankUpper;
          else if (rankUpper) { next.rank = "OTHER"; next.rankOther = rankUpper; }
          next.emergencyContactName = upper(match.emergencyContactName ?? "");
          next.emergencyContactRelation = upper(match.emergencyContactRelation ?? "");
          next.emergencyContactMobile = match.emergencyContactMobile ?? "";
        }
      }
      return next;
    });
  }

  const mobileDigits = applicant.mobile.replace(/\D/g, "");
  const mobileExists = mobileDigits.length >= 7 && state.trainees.some((trainee) => trainee.mobile.replace(/\D/g, "") === mobileDigits);

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
  const mobileValid = mobileDigits.length >= 7;
  const emergencyMobileValid = applicant.emergencyContactMobile.replace(/\D/g, "").length >= 7;
  const rankValid = applicant.rank !== "" && (applicant.rank !== "OTHER" || applicant.rankOther.trim().length >= 2);
  // Every field is required except the middle name (and the optional suffix dropdown).
  const detailsValid =
    applicant.srn.length === 10 && applicant.firstName.trim().length >= 2 && applicant.lastName.trim().length >= 2 &&
    Boolean(applicant.birthDate) && applicant.nationality.trim().length >= 2 && applicant.address.trim().length >= 5 &&
    mobileValid && emailValid && Boolean(applicant.seafarerStatus) && rankValid && applicant.company.trim().length >= 1 &&
    applicant.emergencyContactName.trim().length >= 2 && applicant.emergencyContactRelation.trim().length >= 2 && emergencyMobileValid;
  const selectionsValid = selections.length >= 1 && selections.every((item) => item.courseCode && item.batchId) && !scheduleConflict;

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
    const stale = selections.find((item) => seats(item.batchId).available <= 0);
    if (stale) {
      setError("This schedule is no longer available. Please select another schedule.");
      return;
    }
    const rank = applicant.rank === "OTHER" ? applicant.rankOther.trim() : applicant.rank;
    const applicantRecord: Applicant = {
      firstName: applicant.firstName,
      middleName: applicant.middleName || undefined,
      lastName: applicant.lastName,
      suffix: applicant.suffix || undefined,
      birthDate: applicant.birthDate,
      nationality: applicant.nationality || undefined,
      address: applicant.address,
      mobile: applicant.mobile,
      email: applicant.email.toLowerCase(),
      srn: applicant.srn,
      seafarerStatus: applicant.seafarerStatus || undefined,
      company: applicant.company || undefined,
      rank: rank || undefined,
      emergencyContactName: applicant.emergencyContactName,
      emergencyContactRelation: applicant.emergencyContactRelation || undefined,
      emergencyContactMobile: applicant.emergencyContactMobile,
      sourceOfInquiry: applicant.sourceOfInquiry || undefined,
      referralSource: applicant.referralSource || undefined,
      promoCode: applicant.promoCode || undefined,
    };
    const submission = submitRegistration({
      applicant: applicantRecord,
      selections: selections.map((item) => ({
        courseCode: item.courseCode,
        courseName: courseOf(item.courseCode)?.course ?? item.courseCode,
        batchId: item.batchId,
      })),
      consents: [{ consentType: "Training Terms and Conditions", version: CONSENT_VERSION, textSnapshot: TERMS_SNAPSHOT }],
      sessionRef: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined,
    });
    setReference(submission.reference);
  }

  if (!state.settings.onlineRegistrationOpen) {
    return (
      <div className="reg-card reg-closed">
        <h2>Online enrollment is temporarily closed</h2>
        <p>New Wave has paused new online submissions. Please contact the center so we can assist you directly.</p>
      </div>
    );
  }

  if (reference) {
    return (
      <div className="reg-card reg-success">
        <span className="success-mark">✓</span>
        <h2>Enrollment received</h2>
        <p>Keep this reference. Use it with your registered email or mobile number to track every course you selected.</p>
        <div className="reference-block">
          <span>Registration reference</span>
          <strong>{reference}</strong>
        </div>
        <div className="reg-success-actions">
          <Link className="button button-primary" href="/registration-search">
            Check enrollment status
          </Link>
          <Link className="button button-secondary" href="/courses">
            Browse courses
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
            <h2>Applicant details</h2>
            <p className="wizard-hint">Enter your SRN first — if you have trained with New Wave before, your details fill in automatically. All fields are required except the middle name.</p>
            <div className="reg-grid caps-form">
              <Field label="SRN / MISMO number*" wide>
                <input value={applicant.srn} onChange={(e) => onSrnChange(e.target.value)} inputMode="numeric" placeholder="10 DIGITS" />
              </Field>
              <Field label="First name*"><input value={applicant.firstName} onChange={(e) => set("firstName", upper(e.target.value))} /></Field>
              <Field label="Middle name"><input value={applicant.middleName} onChange={(e) => set("middleName", upper(e.target.value))} /></Field>
              <Field label="Last name*"><input value={applicant.lastName} onChange={(e) => set("lastName", upper(e.target.value))} /></Field>
              <Field label="Suffix">
                <select value={applicant.suffix} onChange={(e) => set("suffix", e.target.value)}>
                  {SUFFIXES.map((item) => <option key={item || "none"} value={item}>{item || "None"}</option>)}
                </select>
              </Field>
              <Field label="Date of birth*"><input type="date" value={applicant.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("birthDate", e.target.value)} /></Field>
              <Field label="Nationality*"><input value={applicant.nationality} onChange={(e) => set("nationality", upper(e.target.value))} /></Field>
              <Field label="Complete address*" wide><input value={applicant.address} onChange={(e) => set("address", upper(e.target.value))} /></Field>
              <Field label="Mobile number*">
                <input value={applicant.mobile} onChange={(e) => set("mobile", e.target.value)} inputMode="tel" placeholder="09XX XXX XXXX" />
                {mobileExists && <small className="field-error">A record already exists with this mobile number. Enter your SRN to load it.</small>}
              </Field>
              <Field label="Email address*"><input type="email" value={applicant.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Seafarer status*">
                <select value={applicant.seafarerStatus} onChange={(e) => set("seafarerStatus", e.target.value)}>
                  <option value="">SELECT</option><option>Active seafarer</option><option>Aspiring seafarer</option><option>Officer</option><option>Rating</option><option>Non-seafarer</option>
                </select>
              </Field>
              <Field label="Rank*">
                <select value={applicant.rank} onChange={(e) => set("rank", e.target.value)}>
                  <option value="">SELECT</option>
                  {RANKS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </Field>
              {applicant.rank === "OTHER" && (
                <Field label="Specify rank*"><input value={applicant.rankOther} onChange={(e) => set("rankOther", upper(e.target.value))} /></Field>
              )}
              <Field label="Company / manning agency*" wide><input value={applicant.company} onChange={(e) => set("company", upper(e.target.value))} /></Field>
            </div>
          </section>
          <section className="wizard-panel">
            <h2>Emergency contact</h2>
            <div className="reg-grid caps-form">
              <Field label="Contact person*"><input value={applicant.emergencyContactName} onChange={(e) => set("emergencyContactName", upper(e.target.value))} /></Field>
              <Field label="Relationship*"><input value={applicant.emergencyContactRelation} onChange={(e) => set("emergencyContactRelation", upper(e.target.value))} /></Field>
              <Field label="Contact number*"><input value={applicant.emergencyContactMobile} onChange={(e) => set("emergencyContactMobile", e.target.value)} inputMode="tel" /></Field>
            </div>
          </section>
        </>
      )}

      {step === 1 && (
        <section className="wizard-panel">
          <h2>Select your courses</h2>
          <p className="wizard-hint">Choose 1 to {MAX_COURSES} courses. Pick a course first, then an available schedule.</p>
          <div className="selection-list">
            {selections.map((selection, index) => {
              const schedules = selection.courseCode ? openBatchesFor(selection.courseCode) : [];
              const course = courseOf(selection.courseCode);
              return (
                <div key={index} className="selection-block">
                  <div className="selection-block-head">
                    <strong>Course {index + 1}</strong>
                    {selections.length > 1 && (
                      <button type="button" className="text-button" onClick={() => removeCourse(index)}>Remove</button>
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
                          <button key={batch.id} type="button" className={`schedule-option ${selection.batchId === batch.id ? "selected" : ""}`} disabled={takenElsewhere} onClick={() => updateSelection(index, { batchId: batch.id })}>
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
          <div className="reg-grid caps-form">
            <Field label="Source of inquiry"><input value={applicant.sourceOfInquiry} onChange={(e) => set("sourceOfInquiry", upper(e.target.value))} placeholder="FACEBOOK, REFERRAL, WALK-IN…" /></Field>
            <Field label="Referral source"><input value={applicant.referralSource} onChange={(e) => set("referralSource", upper(e.target.value))} /></Field>
            <Field label="Promo code"><input value={applicant.promoCode} onChange={(e) => set("promoCode", upper(e.target.value))} /></Field>
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

          <h3 className="review-subhead">Terms and Conditions</h3>
          <div className="terms-box">
            {TERMS_SECTIONS.map((section) => (
              <div key={section.heading} className="terms-section">
                <strong>{section.heading}</strong>
                <ul>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
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
        <button className="button button-secondary" type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
        {step < 2 ? (
          <button className="button button-primary" type="button" disabled={step === 0 ? !detailsValid : !selectionsValid} onClick={() => setStep((s) => s + 1)}>Continue</button>
        ) : (
          <button className="button button-primary" type="button" disabled={!accepted || !selectionsValid} onClick={submit}>Submit enrollment</button>
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
