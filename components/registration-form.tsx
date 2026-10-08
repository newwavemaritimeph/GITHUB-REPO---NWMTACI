"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VALIDATION_MESSAGES, isEmail, isPhContactNumber, isSrn } from "@/lib/validation";
import { automaticEndDate, fitsInWeek } from "@/lib/scheduling";
import { MAX_COURSES, ORDER_RULE_TEXT, orderConflict, type PickRange } from "@/lib/course-selection";

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

/** Live catalog (/api/public/catalog): STCW courses with batches, In-House courses for a start date. */
type CatalogBatch = { id: string; number: string; startsOn: string; endsOn: string; full: boolean };
type StcwCourse = { code: string; name: string; duration: string; modality: string; category: string; batches: CatalogBatch[] };
type InHouseCourse = { code: string; name: string; duration: string; modality: string; category: string };
type Catalog = { stcw: StcwCourse[]; inHouse: InHouseCourse[] };
/** One course row on the form: an STCW batch, or an In-House start date. */
type Row = { code: string; batchId: string; start: string };
type Training = { code: string; name: string; duration: string; modality: string; start: string; end: string };
const EMPTY_ROW: Row = { code: "", batchId: "", start: "" };

const emptyApplicant = {
  srn: "", firstName: "", middleName: "", lastName: "", suffix: "", birthDate: "", placeOfBirth: "",
  address: "", mobile: "", email: "", company: "", rank: "", rankOther: "", referralCode: "", enrollmentType: "",
  emergencyContactName: "", emergencyContactMobile: "",
};

// Courses (owner, 7 Oct 2026): the trainee chooses up to five courses here, each
// on an open STCW batch or (In-House, online) a start date. Safety → Crowd →
// Crisis order is enforced (lib/course-selection), here and on the server.
// Layout ("Quiet Checklist", Oct 2026): one page of numbered sections that
// collapse to a one-line summary once complete, a progress rail, and quiet
// underline fields. Applicants can reopen any finished section to edit it.
/** Enrollment type (owner, 8 Oct 2026): the first question on the form. */
const ENROLLMENT_TYPES: [string, string, string][] = [["Online enrollment", "Online enrollment", "I'm registering on my own, online"], ["Walk-in", "Walk-in", "I'm at the New Wave office"], ["Agency", "Agency", "My agency or consultancy sent me"]];
type SectionKey = "enrollment" | "identification" | "personal" | "contact" | "emergency" | "courses" | "review";
const upper = (value: string) => value.toUpperCase();
const pickedDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const pickedRange = (start: string, end: string) => (start === end ? pickedDate(start) : `${pickedDate(start)} – ${pickedDate(end)}`);
const weekday = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const chipRange = (start: string, end: string) => { const f = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { ...o, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)); const a = f(start, { weekday: "short", month: "short", day: "numeric" }); return start === end ? a : `${a} – ${(start.slice(0, 7) === end.slice(0, 7) ? `${f(end, { weekday: "short" })} ${Number(end.slice(8, 10))}` : f(end, { weekday: "short", month: "short", day: "numeric" }))}`; };
const manilaTomorrow = () => new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10);

function Wizard() {
  const [open, setOpen] = useState<SectionKey>("enrollment");
  const [applicant, setApplicant] = useState(emptyApplicant);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rows, setRows] = useState<Row[]>([EMPTY_ROW]);
  const [submittedTrainings, setSubmittedTrainings] = useState<Training[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [reference, setReference] = useState("");
  const [applicationNumber, setApplicationNumber] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Result of the SRN lookup: "found" locks the identity fields to the trainee's
  // existing record; "none" just tells the applicant to fill the form in.
  const [lookup, setLookup] = useState<{ kind: "found" | "none"; text: string } | null>(null);
  const lookedUpSrn = useRef("");
  const locked = lookup?.kind === "found";

  const set = <K extends keyof typeof emptyApplicant>(key: K, value: string) => setApplicant((current) => ({ ...current, [key]: value }));
  // Referral code from an agency or consultancy (8 Oct 2026): checked as the applicant types; only the agency name comes back.
  const referralInput = applicant.referralCode.replace(/[^A-Za-z0-9]/g, "");
  const [checked, setChecked] = useState<{ code: string; name: string | null } | null>(null);
  useEffect(() => {
    if (referralInput.length < 4) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/public/referral-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: referralInput }) })
        .then(async (r) => { const body = await r.json().catch(() => ({})) as { name?: string }; setChecked({ code: referralInput, name: r.ok && body.name ? body.name : null }); })
        .catch(() => setChecked({ code: referralInput, name: null }));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [referralInput]);
  const referral: { state: "idle" | "checking" | "ok" | "bad"; name?: string } = referralInput.length < 4 ? { state: "idle" } : checked?.code !== referralInput ? { state: "checking" } : checked.name ? { state: "ok", name: checked.name } : { state: "bad" };

  // Live catalog; a course chosen earlier arrives in the URL (?batch= or ?course=&start=)
  // and fills the first row.
  useEffect(() => {
    let live = true;
    fetch("/api/public/catalog").then((r) => r.json()).then((b: Catalog) => {
      if (!live) return;
      const next = { stcw: b.stcw ?? [], inHouse: b.inHouse ?? [] };
      setCatalog(next);
      const params = new URLSearchParams(window.location.search);
      const batch = params.get("batch"), code = params.get("course"), start = params.get("start");
      const course = batch ? next.stcw.find((c) => c.batches.some((x) => x.id === batch && !x.full)) : null;
      if (course && batch) setRows([{ code: course.code, batchId: batch, start: "" }]);
      else if (code && start && /^\d{4}-\d{2}-\d{2}$/.test(start) && next.inHouse.some((c) => c.code === code)) setRows([{ code, batchId: "", start }]);
    }).catch(() => { if (live) setCatalog({ stcw: [], inHouse: [] }); });
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

  const stcwOf = (code: string) => catalog?.stcw.find((c) => c.code === code) ?? null;
  const inHouseOf = (code: string) => catalog?.inHouse.find((c) => c.code === code) ?? null;
  const tomorrow = manilaTomorrow();
  /** The dates a row covers, once it has a batch or a valid start date. */
  function rangeOf(row: Row): PickRange | null {
    const st = stcwOf(row.code);
    if (st) { const b = st.batches.find((x) => x.id === row.batchId); return b ? { code: row.code, start: b.startsOn, end: b.endsOn } : null; }
    const ih = inHouseOf(row.code);
    if (ih && row.start && row.start >= tomorrow && fitsInWeek(row.start, ih.duration)) return { code: row.code, start: row.start, end: automaticEndDate(row.start, ih.duration) };
    return null;
  }
  const othersOf = (index: number) => rows.map((r, i) => (i === index ? null : rangeOf(r))).filter((r): r is PickRange => !!r);
  /** Why a row is not complete yet ("" when it is). */
  function rowProblem(row: Row, index: number) {
    if (!row.code) return "";
    const range = rangeOf(row);
    const ih = inHouseOf(row.code);
    if (!range) return stcwOf(row.code) ? "Choose a schedule." : !row.start ? "Choose a start date." : row.start < tomorrow ? "Choose a date from tomorrow onwards." : `A ${ih ? ih.duration : ""} course runs on consecutive days within one week (no Sundays).`;
    return orderConflict(range, othersOf(index)) ?? "";
  }
  const setRow = (index: number, patch: Partial<Row>) => setRows((cur) => cur.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  function addRow() { setRows((cur) => (cur.length < MAX_COURSES ? [...cur, EMPTY_ROW] : cur)); }
  function removeRow(index: number) { setRows((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== index) : [EMPTY_ROW])); }
  /** The chosen trainings in date order, for the schedule table and the summary. */
  const trainings: Training[] = rows.map((r) => { const range = rangeOf(r); const c = stcwOf(r.code) ?? inHouseOf(r.code); return range && c ? { code: c.code, name: c.name, duration: c.duration, modality: c.modality, start: range.start, end: range.end } : null; })
    .filter((t): t is Training => !!t).sort((a, b) => a.start.localeCompare(b.start));

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
  // At least one course; every chosen course needs a valid schedule that respects the order.
  const selectionsValid = trainings.length >= 1 && rows.every((r, i) => !r.code || (!!rangeOf(r) && !rowProblem(r, i)));

  async function submit() {
    setError("");
    setSubmitting(true);
    try {
      const rank = applicant.rank === "OTHER" ? applicant.rankOther.trim() : applicant.rank;
      const fd = new FormData();
      fd.set("firstName", applicant.firstName); fd.set("middleName", applicant.middleName); fd.set("lastName", applicant.lastName); fd.set("suffix", applicant.suffix);
      fd.set("srn", applicant.srn); fd.set("email", applicant.email.toLowerCase()); fd.set("presentAddress", applicant.address); fd.set("mobile", applicant.mobile);
      fd.set("placeOfBirth", applicant.placeOfBirth); fd.set("birthDate", applicant.birthDate); fd.set("rank", rank); fd.set("company", applicant.company); fd.set("enrollmentType", applicant.enrollmentType); if (applicant.enrollmentType === "Agency" && referral.state === "ok") fd.set("referralCode", applicant.referralCode);
      fd.set("emergencyContactName", applicant.emergencyContactName); fd.set("emergencyContactMobile", applicant.emergencyContactMobile);
      for (const r of rows) {
        if (!r.code || !rangeOf(r)) continue;
        if (stcwOf(r.code)) fd.append("scheduleIds", r.batchId);
        else { fd.append("courseCodes", r.code); fd.append("startDates", r.start); }
      }
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
      setSubmittedTrainings(trainings);
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
        <div className="op-heading"><span className="op-check" aria-hidden="true">✓</span><h2>Application Received</h2><p>Screenshot the card below and send it with your valid ID to our Facebook page.</p></div>
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
                <tr><th>Submitted</th><td>{submittedAt}</td></tr>
              </tbody></table>
              {submittedTrainings.length > 0 && <div className="op-trainings">
                <div className="op-trainings-head"><span>TRAININGS APPLIED FOR</span><span>{submittedTrainings.length} COURSE{submittedTrainings.length === 1 ? "" : "S"}</span></div>
                {submittedTrainings.map((t, i) => <div className="op-training" key={t.code}><i>{i + 1}</i><div><b>{t.name}</b><small>{t.code} · {t.duration} · {t.modality}</small></div><div className="op-training-date">{chipRange(t.start, t.end).replace(/^\w+, /, "")}<small>{t.start === t.end ? weekday(t.start) : `${weekday(t.start).slice(0, 3)} – ${weekday(t.end).slice(0, 3)}`}</small></div></div>)}
              </div>}
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
              <button type="button" className="button button-secondary" onClick={() => window.print()}>Print or Save</button>
            </div>
          </div>
          <div className="op-side">
            <section className="op-panel">
              <h3>Send to Our Facebook Page</h3>
              <p>Message <strong>facebook.com/newwavemtc</strong> with your screenshot and a photo of your valid ID. Copy this message:</p>
              <div className="op-message"><span>{message}</span><button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
              <a className="op-fb small" href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer">Open Facebook Page</a>
            </section>
            <section className="op-panel">
              <h3>Contact Details</h3>
              <p>{OFFICE.address}<br />Mobile: {OFFICE.mobile} · Telephone: {OFFICE.telephone}<br />Email: <span className="lc">{OFFICE.email}</span><br />Facebook: facebook.com/newwavemtc</p>
            </section>
            <section className="op-panel">
              <h3>Terms and Conditions You Accepted</h3>
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
  const enrollmentValid = applicant.enrollmentType === "Online enrollment" || applicant.enrollmentType === "Walk-in" || (applicant.enrollmentType === "Agency" && referral.state === "ok");
  const sections: { key: SectionKey; title: string; hint: string; done: boolean; summary: string }[] = [
    { key: "enrollment", title: "Enrollment type", hint: "How are you enrolling?", done: enrollmentValid, summary: applicant.enrollmentType === "Agency" && referral.name ? `Agency · ${referral.name}` : applicant.enrollmentType },
    { key: "identification", title: "Identification", hint: "Start with your SRN. If you have trained with us before, we fill in your details.", done: idValid, summary: `SRN ${applicant.srn}${locked ? " · record found" : ""}` },
    { key: "personal", title: "Personal details", hint: "As written on your seaman's book or passport.", done: personalValid, summary: [nameText, applicant.birthDate, applicant.placeOfBirth, rankText].filter(Boolean).join(" · ") },
    { key: "contact", title: "Contact", hint: "How New Wave will reach you about your application.", done: contactValid, summary: [applicant.mobile, applicant.email].filter(Boolean).join(" · ") },
    { key: "emergency", title: "Emergency contact", hint: "Someone we can call if we cannot reach you.", done: emergencyValid, summary: [applicant.emergencyContactName, applicant.emergencyContactMobile].filter(Boolean).join(" · ") },
    { key: "courses", title: "Courses", hint: `Choose up to ${MAX_COURSES} courses and a schedule for each. ${ORDER_RULE_TEXT}`, done: selectionsValid, summary: trainings.map((t) => `${t.code} ${pickedRange(t.start, t.end)}`).join(" · ") },
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
    enrollment: <>
      <div className="ql-types" role="radiogroup" aria-label="Enrollment type">
        {ENROLLMENT_TYPES.map(([value, title, text]) => <button key={value} type="button" role="radio" aria-checked={applicant.enrollmentType === value} className={applicant.enrollmentType === value ? "on" : ""} onClick={() => { set("enrollmentType", value); if (value !== "Agency") set("referralCode", ""); }}><b>{title}</b><small>{text}</small></button>)}
      </div>
      {applicant.enrollmentType === "Agency" && <div className="ql-grid caps-form" style={{ marginTop: 16 }}>
        <Field label="Referral Code*" wide><input value={applicant.referralCode} onChange={(e) => set("referralCode", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="Type the code from your agency" autoComplete="off" maxLength={24} autoFocus />
          {referral.state === "ok" && <small className="ref-ok">✓ Referred by {referral.name}</small>}
          {referral.state === "bad" && <small className="ref-bad">Code not recognised. Check with your agency.</small>}
          {referral.state === "checking" && <small className="ref-wait">Checking…</small>}</Field>
        <p className="wizard-hint span-2">No code? Ask your agency, or choose Online enrollment.</p>
      </div>}
    </>,
    identification: <>
      <div className="ql-grid caps-form">
        <Field label="SRN / MISMO Number*" wide><input value={applicant.srn} onChange={(e) => set("srn", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="10 digits" autoFocus />{hint(applicant.srn, idValid, VALIDATION_MESSAGES.srn)}</Field>
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
      {applicant.rank === "OTHER" && <Field label="Specify Rank*"><input value={applicant.rankOther} onChange={(e) => set("rankOther", upper(e.target.value))} /></Field>}
      <Field label="Company / Manning Agency" wide><input value={applicant.company} onChange={(e) => set("company", upper(e.target.value))} placeholder="Optional" /></Field>
    </div>,
    contact: <div className="ql-grid caps-form">
      <Field label="Complete Address*" wide><input value={applicant.address} onChange={(e) => set("address", upper(e.target.value))} /></Field>
      <Field label="Mobile Number*"><input value={applicant.mobile} onChange={(e) => set("mobile", e.target.value)} inputMode="tel" placeholder="09XX XXX XXXX" />{hint(applicant.mobile, mobileValid, VALIDATION_MESSAGES.contact)}</Field>
      <Field label="Email Address*"><input type="email" value={applicant.email} onChange={(e) => set("email", e.target.value)} />{hint(applicant.email, emailValid, VALIDATION_MESSAGES.email)}</Field>
    </div>,
    emergency: <div className="ql-grid caps-form">
      <Field label="Contact Person*"><input value={applicant.emergencyContactName} onChange={(e) => set("emergencyContactName", upper(e.target.value))} /></Field>
      <Field label="Contact Number*"><input value={applicant.emergencyContactMobile} onChange={(e) => set("emergencyContactMobile", e.target.value)} inputMode="tel" placeholder="09XX XXX XXXX" />{hint(applicant.emergencyContactMobile, emergencyMobileValid, VALIDATION_MESSAGES.contact)}</Field>
    </div>,
    courses: <>
      {!catalog ? <p className="wizard-hint">Loading courses…</p> : <>
        <p className="ql-rule"><b>Order Rule:</b> {ORDER_RULE_TEXT} Dates that break it are greyed out.</p>
        {rows.map((row, index) => {
          const taken = new Set(rows.filter((_, i) => i !== index).map((r) => r.code).filter(Boolean));
          const st = stcwOf(row.code), ih = inHouseOf(row.code);
          const categories = [...new Set(catalog.inHouse.map((c) => c.category))];
          const others = othersOf(index);
          const problem = rowProblem(row, index);
          return <div key={index} className="ql-course">
            <div className="ql-course-head"><b>Course {index + 1}</b>{(rows.length > 1 || row.code) && <button type="button" className="ql-link" onClick={() => removeRow(index)}>Remove</button>}</div>
            <select className="ql-course-select" value={row.code} aria-label={`Course ${index + 1}`} onChange={(e) => setRow(index, { code: e.target.value, batchId: "", start: "" })}>
              <option value="">Select a Course</option>
              <optgroup label="STCW (Scheduled Batches)">{catalog.stcw.filter((c) => !taken.has(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</optgroup>
              {categories.map((cat) => <optgroup key={cat} label={`${cat} · online`}>{catalog.inHouse.filter((c) => c.category === cat && !taken.has(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</optgroup>)}
            </select>
            {st && (st.batches.length ? <div className="ql-chips" role="radiogroup" aria-label="Schedule">{st.batches.map((b) => {
              const conflict = orderConflict({ code: st.code, start: b.startsOn, end: b.endsOn }, others);
              const disabled = b.full || !!conflict, on = row.batchId === b.id;
              return <button type="button" role="radio" aria-checked={on} key={b.id} disabled={disabled && !on} className={`ql-chip${on ? " on" : ""}${disabled ? " off" : ""}`} onClick={() => setRow(index, { batchId: b.id })}><b>{on ? "✓ " : ""}{chipRange(b.startsOn, b.endsOn)}</b><small>{b.full ? "Full" : conflict ?? "Open"}</small></button>;
            })}</div> : <p className="ql-error">No open schedule for this course yet. Please choose another course.</p>)}
            {ih && <div className="ql-dates">
              <label><span>Start date</span><input type="date" value={row.start} min={tomorrow} onChange={(e) => setRow(index, { start: e.target.value })} /></label>
              <div className="ql-ends"><span>Ends</span><b>{rangeOf(row) ? pickedDate(rangeOf(row)!.end) : "—"}</b><small>{ih.duration} · online · Monday to Saturday</small></div>
            </div>}
            {row.code && problem && <p className="ql-rule-note">{problem}</p>}
          </div>;
        })}
        {rows.length < MAX_COURSES && <button type="button" className="ql-link" onClick={addRow}>+ Add Another Course ({rows.length}/{MAX_COURSES})</button>}
        {trainings.length > 0 && <div className="ql-schedule"><h4>Your Training Schedule</h4><table><thead><tr><th>#</th><th>Course</th><th>Dates</th></tr></thead><tbody>{trainings.map((t, i) => <tr key={t.code}><td>{i + 1}</td><td><b>{t.name}</b><small>{t.code} · {t.modality}</small></td><td>{pickedRange(t.start, t.end)}</td></tr>)}</tbody></table></div>}
      </>}
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
        <button type="button" className="ql-rail-submit" disabled={!allDone} onClick={() => setOpen("review")}>Review and Submit</button>
      </aside>

      <div className="ql-sections">
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
                <div className="ql-actions"><button type="button" className="button button-primary" disabled={!x.done} onClick={() => next(x.key)}>Save and Continue</button></div>
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
            <div className="ql-schedule"><h4>Your Training Schedule</h4><table><thead><tr><th>#</th><th>Course</th><th>Dates</th></tr></thead><tbody>{trainings.map((t, i) => <tr key={t.code}><td>{i + 1}</td><td><b>{t.name}</b><small>{t.code} · {t.modality}</small></td><td>{pickedRange(t.start, t.end)}</td></tr>)}</tbody></table></div>
            <p className="ql-note">Your seats are held while our Registration team screens your application, confirms the fees, and collects your requirements and payment.</p>
            <h3 className="review-subhead">Terms and Conditions</h3>
            <div className="terms-box">
              {TERMS_SECTIONS.map((section) => <div key={section.heading} className="terms-section"><strong>{section.heading}</strong><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}
              <p className="terms-footer">New Wave Maritime Training and Assessment Center reserves the right to amend, revise, or update these details without prior notice.</p>
            </div>
            <label className="consent-row">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>I have read and accepted the New Wave Maritime Terms and Conditions, including the payment, cancellation, rescheduling, refund, make-up class, and certificate policies, and I confirm that the information I provided is complete and accurate.</span>
            </label>
            {error && <p className="form-message" role="alert">{error}</p>}
            <div className="ql-actions"><button className="button button-primary" type="button" disabled={!accepted || !selectionsValid || submitting} onClick={submit}>{submitting ? "Submitting…" : "Submit Application"}</button></div>
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
