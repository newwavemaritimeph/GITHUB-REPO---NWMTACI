"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VALIDATION_MESSAGES, isEmail, isPhContactNumber, isSrn } from "@/lib/validation";
import { automaticEndDate } from "@/lib/scheduling";

// Official New Wave channels shown on the application summary.
const FACEBOOK_URL = "https://www.facebook.com/newwavemtc";
const OFFICE = {
  address: "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000",
  mobile: "+63 948 847 6530",
  telephone: "8553 0310",
  email: "newwavemaritime@gmail.com",
};

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

// The course step is off for the dry run (owner instruction, 7 Oct 2026): the
// applicant sends personal details only and Registration assigns the course
// and schedule while screening. Set NEXT_PUBLIC_REGISTRATION_COURSE_STEP=on to
// bring it back.
const COURSE_STEP = process.env.NEXT_PUBLIC_REGISTRATION_COURSE_STEP === "on";
// Layout ("Quiet Checklist", Oct 2026): one page of numbered sections that
// collapse to a one-line summary once complete, a progress rail, and quiet
// underline fields. Applicants can reopen any finished section to edit it.
type SectionKey = "identification" | "personal" | "contact" | "emergency" | "courses" | "review";
const upper = (value: string) => value.toUpperCase();
const MAX_COURSES = 5;
/** A course picked on the public Courses page: an STCW batch, or an In-House course and start date. */
type Picked = { kind: "batch"; id: string } | { kind: "course"; code: string; start: string };
const pickedDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const pickedRange = (start: string, end: string) => (start === end ? pickedDate(start) : `${pickedDate(start)} – ${pickedDate(end)}`);

function Wizard() {
  const [open, setOpen] = useState<SectionKey>("identification");
  const [applicant, setApplicant] = useState(emptyApplicant);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selections, setSelections] = useState<Selection[]>([{ courseCode: "", scheduleId: "" }]);
  const [schedulesByCourse, setSchedulesByCourse] = useState<Record<string, Schedule[]>>({});
  const [loadingCourse, setLoadingCourse] = useState<Record<string, boolean>>({});
  const [accepted, setAccepted] = useState(false);
  const [reference, setReference] = useState("");
  const [applicationNumber, setApplicationNumber] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickedLabel, setPickedLabel] = useState<{ course: string; dates: string } | null>(null);
  // Result of the SRN lookup: "found" locks the identity fields to the trainee's
  // existing record; "none" just tells the applicant to fill the form in.
  const [lookup, setLookup] = useState<{ kind: "found" | "none"; text: string } | null>(null);
  const lookedUpSrn = useRef("");
  const locked = lookup?.kind === "found";

  const set = <K extends keyof typeof emptyApplicant>(key: K, value: string) => setApplicant((current) => ({ ...current, [key]: value }));

  // Live bookable courses (with a published, open schedule this week).
  useEffect(() => { if (!COURSE_STEP) return; let live = true; fetch("/api/public/courses").then((r) => r.json()).then((b) => { if (live) setCourses(b.courses ?? []); }).catch(() => {}); return () => { live = false; }; }, []);

  // The course chosen on the Courses page arrives in the URL (?batch= or ?course=&start=).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const batch = params.get("batch"), code = params.get("course"), start = params.get("start");
    const pick: Picked | null = batch ? { kind: "batch", id: batch } : code && start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? { kind: "course", code, start } : null;
    if (!pick) return;
    let live = true;
    fetch("/api/public/catalog").then((r) => r.json()).then((b: { stcw?: { code: string; name: string; batches: { id: string; startsOn: string; endsOn: string }[] }[]; inHouse?: { code: string; name: string; duration: string }[] }) => {
      if (!live) return;
      if (pick.kind === "batch") {
        const course = (b.stcw ?? []).find((c) => c.batches.some((x) => x.id === pick.id));
        const found = course?.batches.find((x) => x.id === pick.id);
        if (course && found) { setPicked(pick); setPickedLabel({ course: `${course.name} (${course.code})`, dates: pickedRange(found.startsOn, found.endsOn) }); }
      } else {
        const course = (b.inHouse ?? []).find((c) => c.code === pick.code);
        if (course) { setPicked(pick); setPickedLabel({ course: `${course.name} (${course.code})`, dates: pickedRange(pick.start, automaticEndDate(pick.start, course.duration)) }); }
      }
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  // Returning-applicant autofill: once a full 10-digit SRN is entered, look up the
  // saved trainee details and prefill the form (once per distinct SRN).
  useEffect(() => {
    const srn = applicant.srn;
    if (srn.length !== 10 || lookedUpSrn.current === srn) return;
    lookedUpSrn.current = srn;
    let live = true;
    const fd = new FormData(); fd.set("srn", srn);
    fetch("/api/public/trainee-lookup", { method: "POST", body: fd })
      .then((r) => r.json())
      .then((b) => {
        if (!live) return;
        if (!b.found || !b.applicant) {
          setLookup({ kind: "none", text: "No previous registration found for this SRN. Please fill in your details below." });
          return;
        }
        const a = { ...b.applicant } as Partial<typeof emptyApplicant>;
        // Map a saved rank that is not in our dropdown to the "OTHER" option.
        if (a.rank && !(RANKS as readonly string[]).includes(a.rank)) { a.rankOther = a.rank; a.rank = "OTHER"; }
        setApplicant((cur) => ({ ...cur, ...a, srn }));
        setLookup({ kind: "found", text: "Welcome back — we filled in your details. Your name and birth details are locked to your record; you can still update your address, contact, rank, manning agency, and emergency contact." });
      })
      .catch(() => { if (live) setLookup(null); });
    return () => { live = false; };
  }, [applicant.srn]);

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

  // The same checks the server runs (lib/validation), so the form never sends
  // something the server will reject with a vague error.
  const emailValid = isEmail(applicant.email);
  const mobileValid = isPhContactNumber(applicant.mobile);
  const emergencyMobileValid = isPhContactNumber(applicant.emergencyContactMobile);
  /** Message under a field, shown once something has been typed that does not pass. */
  const hint = (value: string, ok: boolean, message: string) => (value.trim() && !ok ? <small className="ql-error">{message}</small> : null);
  const rankValid = applicant.rank !== "" && (applicant.rank !== "OTHER" || applicant.rankOther.trim().length >= 2);
  const idValid = isSrn(applicant.srn);
  const personalValid = applicant.firstName.trim().length >= 2 && applicant.lastName.trim().length >= 2 && Boolean(applicant.birthDate) && applicant.placeOfBirth.trim().length >= 2 && rankValid;
  const contactValid = applicant.address.trim().length >= 8 && mobileValid && emailValid;
  const emergencyValid = applicant.emergencyContactName.trim().length >= 2 && emergencyMobileValid;
  const completeSelections = selections.filter((s) => s.courseCode && s.scheduleId);
  // Every row must be either fully complete or completely empty; at least one complete.
  const selectionsValid = !COURSE_STEP || completeSelections.length >= 1 && selections.every((s) => (!s.courseCode && !s.scheduleId) || (Boolean(s.courseCode) && Boolean(s.scheduleId)));

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
      if (COURSE_STEP) for (const s of completeSelections) fd.append("scheduleIds", s.scheduleId);
      if (picked?.kind === "batch" && !COURSE_STEP) fd.append("scheduleIds", picked.id);
      if (picked?.kind === "course") { fd.set("courseCode", picked.code); fd.set("startDate", picked.start); }
      fd.set("termsAccepted", "on");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      let response: Response;
      try {
        response = await fetch("/api/public/registrations", { method: "POST", body: fd, signal: controller.signal });
      } finally { clearTimeout(timer); }
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "We could not submit your application. Please review your details and try again."); return; }
      setReference(body.reference);
      setApplicationNumber(body.applicationNumber ?? "");
      setSubmittedAt(new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date()));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof DOMException && e.name === "AbortError" ? "The server took too long to respond. Please try again in a moment." : "We could not reach the server. Please check your connection and try again.");
    } finally { setSubmitting(false); }
  }

  if (reference) {
    // The enrollment number (NWMTACI-0000001) comes from migration 202610070003;
    // before it is applied the registration reference stands in.
    const number = applicationNumber || reference;
    const rank = applicant.rank === "OTHER" ? applicant.rankOther : applicant.rank;
    const fullNameText = [applicant.firstName, applicant.middleName, applicant.lastName, applicant.suffix].filter(Boolean).join(" ");
    const message = `Hi New Wave! My enrollment number is ${number}. Attached are my registration screenshot and valid ID.`;
    const copy = () => { void navigator.clipboard?.writeText(message).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined); };
    return (
      <div className="op-page">
        <div className="op-heading"><span className="op-check" aria-hidden="true">✓</span><h2>Application received</h2><p>Screenshot the card below and send it with your valid ID to our Facebook page.</p></div>
        <div className="op-layout">
          <div>
            <article className="op-pass" aria-label="Application acknowledgment">
              <div className="op-top">
                <div className="op-letterhead"><Image src="/brand/new-wave-emblem.png" alt="" width={34} height={34} unoptimized /><div><b>NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.</b><small>Online application acknowledgment</small></div></div>
                <div className="op-number"><div><span>{applicationNumber ? "ENROLLMENT NO." : "REFERENCE NO."}</span><strong>{number}</strong></div><em>FOR SCREENING</em></div>
              </div>
              <div className="op-perf" aria-hidden="true"><i /><i /></div>
              <table className="op-table"><tbody>
                <tr><th>Name</th><td>{fullNameText}</td></tr>
                <tr><th>SRN</th><td className="mono">{applicant.srn}</td></tr>
                <tr><th>Rank</th><td>{rank}</td></tr>
                <tr><th>Mobile</th><td>{applicant.mobile}</td></tr>
                <tr><th>Email</th><td className="lc">{applicant.email.toLowerCase()}</td></tr>
                {pickedLabel && <tr><th>Training</th><td>{pickedLabel.course}<br />{pickedLabel.dates}</td></tr>}
                <tr><th>Submitted</th><td>{submittedAt}</td></tr>
              </tbody></table>
              <div className="op-instructions">
                <b>INSTRUCTIONS</b>
                <ol>
                  <li><strong>Screenshot</strong> this acknowledgment.</li>
                  <li>Send it with a photo of your <strong>valid ID</strong> to <strong>facebook.com/newwavemtc</strong>.</li>
                  <li>Type your enrollment number <strong className="mono">{number}</strong> in the message.</li>
                </ol>
                <p>Our Registration team will confirm your course, schedule and fee on Facebook before you pay.</p>
              </div>
            </article>
            <div className="op-actions">
              <a className="op-fb" href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer">Send on Facebook</a>
              <button type="button" className="button button-secondary" onClick={() => window.print()}>Print or save</button>
            </div>
          </div>
          <div className="op-side">
            <section className="op-panel">
              <h3>Send to our Facebook page</h3>
              <p>Message <strong>facebook.com/newwavemtc</strong> with your screenshot and a photo of your valid ID. Copy this message:</p>
              <div className="op-message"><span>{message}</span><button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
              <a className="op-fb small" href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer">Open Facebook page</a>
            </section>
            <section className="op-panel">
              <h3>Contact details</h3>
              <p>{OFFICE.address}<br />Mobile: {OFFICE.mobile} · Telephone: {OFFICE.telephone}<br />Email: <span className="lc">{OFFICE.email}</span><br />Facebook: facebook.com/newwavemtc</p>
            </section>
            <section className="op-panel">
              <h3>Terms and conditions you accepted</h3>
              <div className="op-terms">{TERMS_SECTIONS.map((section) => <div key={section.heading}><strong>{section.heading}</strong><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}</div>
              <p className="op-fine">New Wave Maritime Training and Assessment Center reserves the right to amend, revise, or update these details without prior notice.</p>
            </section>
            <div className="reg-success-actions"><Link className="button button-secondary" href="/registration-search">Check application status</Link><Link className="button button-secondary" href="/courses">Browse courses</Link></div>
          </div>
        </div>
      </div>
    );
  }

  const rankText = applicant.rank === "OTHER" ? applicant.rankOther : applicant.rank;
  const nameText = [applicant.firstName, applicant.middleName, applicant.lastName, applicant.suffix].filter(Boolean).join(" ");
  const sections: { key: SectionKey; title: string; hint: string; done: boolean; summary: string }[] = [
    { key: "identification", title: "Identification", hint: "Start with your SRN. If you have trained with us before, we fill in your details.", done: idValid, summary: `SRN ${applicant.srn}${locked ? " · record found" : ""}` },
    { key: "personal", title: "Personal details", hint: "As written on your seaman's book or passport.", done: personalValid, summary: [nameText, applicant.birthDate, applicant.placeOfBirth, rankText].filter(Boolean).join(" · ") },
    { key: "contact", title: "Contact", hint: "How New Wave will reach you about your application.", done: contactValid, summary: [applicant.mobile, applicant.email].filter(Boolean).join(" · ") },
    { key: "emergency", title: "Emergency contact", hint: "Someone we can call if we cannot reach you.", done: emergencyValid, summary: [applicant.emergencyContactName, applicant.emergencyContactMobile].filter(Boolean).join(" · ") },
    ...(COURSE_STEP ? [{ key: "courses" as const, title: "Courses", hint: `Pick a course and an available schedule. Up to ${MAX_COURSES} per application.`, done: selectionsValid, summary: completeSelections.map((x) => x.courseCode).join(", ") }] : []),
  ];
  const doneCount = sections.filter((x) => x.done).length;
  const allDone = doneCount === sections.length;
  /** After saving a section, open the next unfinished one (or the review). */
  function next(from: SectionKey) {
    const i = sections.findIndex((x) => x.key === from);
    const target = sections.slice(i + 1).find((x) => !x.done) ?? sections.find((x) => !x.done);
    setOpen(target ? target.key : "review");
  }

  const body: Record<Exclude<SectionKey, "review">, React.ReactNode> = {
    identification: <>
      <div className="ql-grid caps-form">
        <Field label="SRN / MISMO number*" wide><input value={applicant.srn} onChange={(e) => set("srn", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="10 digits" autoFocus />{hint(applicant.srn, idValid, VALIDATION_MESSAGES.srn)}</Field>
      </div>
      {lookup && <p className={`ql-lookup ${lookup.kind}`}>{lookup.text}</p>}
    </>,
    personal: <div className="ql-grid caps-form">
      <Field label={locked ? "First name (from your record)" : "First name*"}><input value={applicant.firstName} readOnly={locked} onChange={(e) => set("firstName", upper(e.target.value))} /></Field>
      <Field label={locked ? "Middle name (from your record)" : "Middle name"}><input value={applicant.middleName} readOnly={locked} onChange={(e) => set("middleName", upper(e.target.value))} /></Field>
      <Field label={locked ? "Last name (from your record)" : "Last name*"}><input value={applicant.lastName} readOnly={locked} onChange={(e) => set("lastName", upper(e.target.value))} /></Field>
      <Field label="Suffix"><select value={applicant.suffix} disabled={locked} onChange={(e) => set("suffix", e.target.value)}>{SUFFIXES.map((item) => <option key={item || "none"} value={item}>{item || "None"}</option>)}</select></Field>
      <Field label={locked ? "Date of birth (from your record)" : "Date of birth*"}><input type="date" value={applicant.birthDate} readOnly={locked} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("birthDate", e.target.value)} /></Field>
      <Field label={locked ? "Place of birth (from your record)" : "Place of birth*"}><input value={applicant.placeOfBirth} readOnly={locked} onChange={(e) => set("placeOfBirth", upper(e.target.value))} /></Field>
      <Field label="Rank*"><select value={applicant.rank} onChange={(e) => set("rank", e.target.value)}><option value="">Select</option>{RANKS.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
      {applicant.rank === "OTHER" && <Field label="Specify rank*"><input value={applicant.rankOther} onChange={(e) => set("rankOther", upper(e.target.value))} /></Field>}
      <Field label="Company / manning agency" wide><input value={applicant.company} onChange={(e) => set("company", upper(e.target.value))} placeholder="Optional" /></Field>
    </div>,
    contact: <div className="ql-grid caps-form">
      <Field label="Complete address*" wide><input value={applicant.address} onChange={(e) => set("address", upper(e.target.value))} /></Field>
      <Field label="Mobile number*"><input value={applicant.mobile} onChange={(e) => set("mobile", e.target.value)} inputMode="tel" placeholder="09XX XXX XXXX" />{hint(applicant.mobile, mobileValid, VALIDATION_MESSAGES.contact)}</Field>
      <Field label="Email address*"><input type="email" value={applicant.email} onChange={(e) => set("email", e.target.value)} />{hint(applicant.email, emailValid, VALIDATION_MESSAGES.email)}</Field>
    </div>,
    emergency: <div className="ql-grid caps-form">
      <Field label="Contact person*"><input value={applicant.emergencyContactName} onChange={(e) => set("emergencyContactName", upper(e.target.value))} /></Field>
      <Field label="Contact number*"><input value={applicant.emergencyContactMobile} onChange={(e) => set("emergencyContactMobile", e.target.value)} inputMode="tel" placeholder="09XX XXX XXXX" />{hint(applicant.emergencyContactMobile, emergencyMobileValid, VALIDATION_MESSAGES.contact)}</Field>
    </div>,
    courses: <>
      {!courses.length && <div className="reg-notice"><strong>No published schedules are open this week</strong><p>Please check back soon or contact New Wave.</p></div>}
      {selections.map((sel, index) => {
        const list = schedulesByCourse[sel.courseCode] ?? [];
        const available = courses.filter((c) => c.code === sel.courseCode || !selections.some((x) => x.courseCode === c.code));
        return (
          <div key={index} className="ql-course">
            <div className="ql-grid"><Field label={`Course ${index + 1}*`} wide><select value={sel.courseCode} onChange={(e) => chooseCourse(index, e.target.value)}><option value="">Select a course</option>{available.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}</select></Field></div>
            {sel.courseCode && (loadingCourse[sel.courseCode] ? <p className="wizard-hint">Loading schedules…</p> : list.length === 0 ? <div className="reg-notice"><strong>No schedule this week for this course</strong><p>Please choose another course.</p></div> :
              <div className="schedule-picker">{list.map((batch) => <button key={batch.id} type="button" className={`schedule-option ${sel.scheduleId === batch.id ? "selected" : ""}`} onClick={() => chooseSchedule(index, batch.id)}><span className="schedule-body"><strong>{batch.label}</strong></span></button>)}</div>)}
            {selections.length > 1 && <button type="button" className="ql-link" onClick={() => removeSelection(index)}>Remove course {index + 1}</button>}
          </div>
        );
      })}
      {selections.length < MAX_COURSES && courses.length > 0 && <button type="button" className="ql-link" onClick={addSelection}>+ Add another course ({selections.length}/{MAX_COURSES})</button>}
    </>,
  };

  return (
    <div className="ql-form">
      <aside className="ql-rail" aria-label="Application progress">
        <strong>Your application</strong>
        <span className="ql-rail-count">{doneCount} of {sections.length} sections done</span>
        <span className="ql-bar" aria-hidden="true"><i style={{ width: `${Math.round((doneCount / sections.length) * 100)}%` }} /></span>
        <ol>
          {sections.map((x) => <li key={x.key}><button type="button" className={`${x.done ? "done" : ""} ${open === x.key ? "current" : ""}`} onClick={() => setOpen(x.key)}><i aria-hidden="true" />{x.title}</button></li>)}
        </ol>
        <button type="button" className="ql-rail-submit" disabled={!allDone} onClick={() => setOpen("review")}>Review and submit</button>
      </aside>

      <div className="ql-sections">
        {pickedLabel && <div className="ql-picked"><div><span>Selected training</span><strong>{pickedLabel.course}</strong><small>{pickedLabel.dates}</small></div><span className="ql-picked-actions"><Link href="/courses">Change</Link><button type="button" onClick={() => { setPicked(null); setPickedLabel(null); }}>Remove</button></span></div>}
        {sections.map((x, index) => {
          const isOpen = open === x.key;
          return (
            <section key={x.key} className={`ql-section${isOpen ? " open" : ""}${x.done ? " done" : ""}`}>
              <button type="button" className="ql-head" onClick={() => setOpen(x.key)} aria-expanded={isOpen}>
                <span className="ql-mark" aria-hidden="true">{x.done && !isOpen ? "✓" : index + 1}</span>
                <span className="ql-title"><h2>{index + 1}. {x.title}</h2><span>{isOpen ? x.hint : x.done ? x.summary : "Not started"}</span></span>
                {!isOpen && x.done && <span className="ql-edit">Edit</span>}
              </button>
              {isOpen && <div className="ql-body">
                {body[x.key as Exclude<SectionKey, "review">]}
                <div className="ql-actions"><button type="button" className="button button-primary" disabled={!x.done} onClick={() => next(x.key)}>Save and continue</button></div>
              </div>}
            </section>
          );
        })}

        <section className={`ql-section ql-review${open === "review" ? " open" : ""}`}>
          <button type="button" className="ql-head" onClick={() => allDone && setOpen("review")} aria-expanded={open === "review"} disabled={!allDone}>
            <span className="ql-mark" aria-hidden="true">{sections.length + 1}</span>
            <span className="ql-title"><h2>{sections.length + 1}. Review and submit</h2><span>{allDone ? "Accept the terms and send your application." : "Complete the sections above first."}</span></span>
          </button>
          {open === "review" && allDone && <div className="ql-body">
            {COURSE_STEP ? <div className="review-courses">{completeSelections.map((x, i) => <div key={i} className="review-course"><div><strong>{nameOf(x.courseCode)}</strong><small>{labelOf(x.courseCode, x.scheduleId)}</small></div></div>)}</div>
              : <p className="ql-note">{pickedLabel ? `Requested training: ${pickedLabel.course}, ${pickedLabel.dates}. Our Registration team will confirm it, and collect your requirements and payment.` : "After you submit, our Registration team will contact you to confirm your course and schedule, and to collect your requirements and payment."}</p>}
            <h3 className="review-subhead">Terms and conditions</h3>
            <div className="terms-box">
              {TERMS_SECTIONS.map((section) => <div key={section.heading} className="terms-section"><strong>{section.heading}</strong><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}
              <p className="terms-footer">New Wave Maritime Training and Assessment Center reserves the right to amend, revise, or update these details without prior notice.</p>
            </div>
            <label className="consent-row">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>I have read and accepted the New Wave Maritime Terms and Conditions, including the payment, cancellation, rescheduling, refund, make-up class, and certificate policies, and I confirm that the information I provided is complete and accurate.</span>
            </label>
            {error && <p className="form-message" role="alert">{error}</p>}
            <div className="ql-actions"><button className="button button-primary" type="button" disabled={!accepted || !selectionsValid || submitting} onClick={submit}>{submitting ? "Submitting…" : "Submit application"}</button></div>
          </div>}
        </section>
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
