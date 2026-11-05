"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PortalData, Enrollment } from "../portal-live-app";
import { matchClassroomLine } from "@/lib/admin-imports";
import { classroomJoin } from "@/lib/classroom";
import { canSendInstructions, emailResult, instructionSendText, type InstructionEmail } from "@/lib/instruction-email-status";
import { isOnlineMode } from "@/lib/instruction-templates";
import { first } from "@/lib/portal-format";
import { VALIDATION_MESSAGES, isEmail, normalizeEmail } from "@/lib/validation";
import { Badge, Message, Modal, fmtDate, submit } from "./shared-ui";

/**
 * Training Instructions (owner, 5 Nov 2026; design/send-instructions-prototype.html).
 * The Instructions button opens one window: the address it goes to, the last send, and the
 * Google Classroom class. One send and one resend (owner, 5 Nov 2026), then the button goes away; a failed email does not
 * use up a send. Orange for the first send, blue for the resend, and no remarks on the row (Option 2).
 */

type ClassRow = { id: string; name: string };
type Notice = { ok: boolean; text: string };

// shortcut: loaded once per page visit; a class added in Google shows after a page reload.
let classList: ClassRow[] | null = null;

export const instructionsCountOf = (data: PortalData, e: Enrollment) => data.instructionsCount?.[e.id] ?? (e.instructions_sent_at ? 1 : 0);

const pdfOf = (e: Enrollment) => `/api/documents/training-instructions/${e.id}`;

function LastSent({ email }: { email: InstructionEmail }) {
  const result = emailResult(email.state);
  return <span className="iw-last" title={email.last_error ?? undefined}><span className="lc">{email.to}</span> · {fmtDate(email.sent_at ?? email.created_at)}{email.with_class ? " · With Classroom Link" : ""} <Badge tone={result === "Sent" ? "green" : result === "Failed" ? "red" : "pending"}>{result}</Badge></span>;
}

export function InstructionsButton({ data, enrollment: e, reload }: { data: PortalData; enrollment: Enrollment; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const count = instructionsCountOf(data, e);
  // An open window stays until it is closed, so the result of the last send can be read.
  if (!["Enrolled", "Open Schedule"].includes(e.enrollment_status) || (!open && !canSendInstructions(count, data.instructionEmails?.[e.id]?.state))) return null;
  return <span className="gi" onClick={(ev) => ev.stopPropagation()}>
    <button type="button" className={`gi-btn${count ? "" : " first"}`} onClick={() => setOpen(true)}>Instructions</button>
    {/* Outside the table and action rows, so their button styles do not apply; still inside the portal's own styles. */}
    {open && createPortal(<InstructionsWindow data={data} enrollment={e} reload={reload} onClose={() => setOpen(false)} />, document.querySelector(".portal-shell") ?? document.body)}
  </span>;
}

export function InstructionsWindow({ data, enrollment: e, reload, onClose }: { data: PortalData; enrollment: Enrollment; reload: () => Promise<void>; onClose: () => void }) {
  const t = first(e.trainees), b = first(e.batches), c = first(e.courses), course = data.courses.find((x) => x.id === e.course_id);
  const onRecord = t?.email ?? data.trainees.find((x) => x.id === e.trainee_id)?.email ?? "";
  const email = data.instructionEmails?.[e.id];
  // A batch with its own class (CCMD) goes first, as in the email itself.
  const batchClass = e.batch_id ? data.batchClasses?.[e.batch_id] : undefined;
  const classId = batchClass ? undefined : data.classroomCourseIds?.[e.course_id];
  const join = batchClass ? classroomJoin(batchClass.link, batchClass.code) : classroomJoin(course?.google_classroom_link, data.classroomCodes?.[e.course_id]);
  const linked = !!(join.url || join.code);
  const online = isOnlineMode(b?.mode ?? course?.training_mode);
  const needsClass = !linked && online, connected = !!data.classroom?.connected;
  const suggestion = (list: ClassRow[]) => (course ? list.find((x) => matchClassroomLine({ link: "", classCode: null, code: "", name: x.name, startsOn: null }, [course], []).course)?.id ?? "" : "");

  const [to, setTo] = useState(onRecord);
  const [save, setSave] = useState(true);
  const [invite, setInvite] = useState(true);
  const [classes, setClasses] = useState(classList);
  const [pick, setPick] = useState(() => (needsClass && classList ? suggestion(classList) : ""));
  const [classError, setClassError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Notice | null>(null);

  useEffect(() => {
    if (classList || !connected || (!linked && !online)) return;
    let live = true;
    submit({ action: "classroom-classes" }).then((r: { classes?: ClassRow[] }) => {
      classList = [...(r.classes ?? [])].sort((x, y) => x.name.localeCompare(y.name));
      if (!live) return;
      setClasses(classList);
      if (needsClass) setPick(suggestion(classList));
    }).catch((err: unknown) => { if (live) setClassError(err instanceof Error ? err.message : "Could not load the classes."); });
    return () => { live = false; };
    // Loads once when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typed = to.trim(), valid = isEmail(typed), changed = normalizeEmail(typed) !== normalizeEmail(onRecord), saving = changed && save;
  const canInvite = !!classId || !!pick, withClass = linked || !!pick;
  const schedule = b ? `${fmtDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` - ${fmtDate(b.ends_on)}` : ""} · ${b.venue || b.mode}` : e.scheduled_on ? fmtDate(e.scheduled_on) : "To Be Scheduled";

  async function send() {
    setBusy(true); setError("");
    try {
      // The class is saved first, so this email already carries its button.
      if (needsClass && pick) await submit({ action: "classroom-course-link", courseId: e.course_id, classroomCourseId: pick });
      const sent = await submit({ action: "send-instructions", enrollmentId: e.id, to: typed, saveEmail: saving, invite: canInvite && invite });
      await reload();
      setResult(instructionSendText(sent, saving, changed && !save ? onRecord : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the instructions.");
    } finally {
      setBusy(false);
    }
  }

  const inviteTick = canInvite && <label className="iw-tick"><input type="checkbox" checked={invite} onChange={(ev) => setInvite(ev.target.checked)} /> Also send a Google Classroom invitation to this email</label>;

  return <Modal title="Training Instructions" onClose={onClose}>
    <div className="iw">
      {error && <Message kind="error" text={error} />}
      {result && <Message kind={result.ok ? "success" : "error"} text={result.text} />}
      <section className="iw-box">
        <label className="iw-head" htmlFor="iw-to">Send To</label>
        <input id="iw-to" className={`iw-field lc${valid ? "" : " bad"}`} type="email" autoComplete="off" spellCheck={false} value={to} onChange={(ev) => setTo(ev.target.value)} />
        {!valid && <p className="iw-err" role="alert">{VALIDATION_MESSAGES.email}</p>}
        {valid && changed && <>
          <label className="iw-tick"><input type="checkbox" checked={save} onChange={(ev) => setSave(ev.target.checked)} /> Save as the Trainee&apos;s Email</label>
          <p className="iw-hint lc">{save ? `Replaces ${onRecord || "the blank email"} on the trainee's record.` : `This one time only. The record keeps ${onRecord || "no email"}.`}</p>
        </>}
        {email && <p className="iw-lastrow"><span className="iw-label">Last Sent</span> <LastSent email={email} /></p>}
      </section>

      <dl className="iw-facts">
        <dt>Course</dt><dd>{c?.code} · {c?.name}</dd>
        <dt>Schedule</dt><dd>{schedule}</dd>
      </dl>

      {linked ? <section className="iw-box">
        <div className="iw-head iw-headrow">Google Classroom <Badge tone="green">Linked</Badge></div>
        {classId && classes?.find((x) => x.id === classId) && <b className="iw-name">{classes.find((x) => x.id === classId)?.name}</b>}
        <p className="iw-line">{join.code && <>Class Code <span className="iw-code lc">{join.code}</span> · </>}{join.url && <a href={join.url} target="_blank" rel="noreferrer">Open Classroom</a>}</p>
        {inviteTick}
      </section> : !online ? <section className="iw-box">
        <div className="iw-head iw-headrow">Google Classroom <Badge tone="blue">No Class Needed</Badge></div>
        <p className="iw-line">This course is face to face. The email goes out without a Classroom button.</p>
      </section> : <section className="iw-box">
        <div className="iw-head iw-headrow">Google Classroom <Badge tone="pending">Not Linked</Badge></div>
        {!connected ? <p className="iw-line">Google Classroom is not connected, so the email goes out without a Classroom button.</p> : classError ? <p className="iw-err">{classError}</p> : <>
          <label className="iw-line" htmlFor="iw-class">Choose the Class for This Course</label>
          <select id="iw-class" className="iw-field" value={pick} disabled={!classes} onChange={(ev) => setPick(ev.target.value)}>
            <option value="">{classes ? "Send Without a Class" : "Loading Classes…"}</option>
            {classes?.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === suggestion(classes) ? " (Suggested)" : ""}</option>)}
          </select>
          {inviteTick}
          {pick && <p className="iw-hint">Saved to this course, so the next trainees get it too.</p>}
        </>}
      </section>}
    </div>
    <footer className="iw-foot">
      {!result && <button type="button" className="portal-secondary" onClick={onClose}>Cancel</button>}
      <a className="portal-secondary" href={pdfOf(e)} target="_blank" rel="noreferrer">View PDF</a>
      {result ? <button type="button" className="portal-primary" onClick={onClose}>Close</button> : <button type="button" className="portal-primary" disabled={busy || !valid} onClick={() => void send()}>{busy ? "Sending…" : withClass ? "Send With Classroom Link" : "Send"}</button>}
    </footer>
  </Modal>;
}
