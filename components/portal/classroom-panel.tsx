"use client";

import { useEffect, useState } from "react";
import type { PortalData } from "../portal-live-app";
import { Message, submit } from "./shared-ui";

type ClassroomClass = { id: string; name: string; section?: string; alternateLink?: string; enrollmentCode?: string };

const RESULT_TEXT: Record<string, { kind: "success" | "error"; text: string }> = {
  connected: { kind: "success", text: "Google Classroom is connected. Link each course to its class below." },
  cancelled: { kind: "error", text: "Google sign-in was cancelled. Nothing changed." },
  invalid: { kind: "error", text: "The Google sign-in could not be verified. Please try Connect again." },
  "no-refresh": { kind: "error", text: "Google did not grant offline access. Remove New Wave's access in your Google Account › Security › Third-party access, then connect again." },
  "missing-scope": { kind: "error", text: "Please tick every permission on Google's screen (classes and rosters), then connect again." },
  "needs-migration": { kind: "error", text: "Apply database update 202610070013 first, then connect again." },
  "not-configured": { kind: "error", text: "Google Classroom is not set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel." },
  error: { kind: "error", text: "Google Classroom could not be connected. Please try again." },
};

/**
 * Google Classroom connection (Instructions › Templates): connect the Gmail that
 * owns New Wave's classes, then link the selected course to one of its classes.
 * Once linked, generating instructions also invites the trainee to that class.
 */
export function ClassroomPanel({ data, courseId, reload }: { data: PortalData; courseId: string; reload: () => Promise<void> }) {
  const status = data.classroom;
  const [classes, setClasses] = useState<ClassroomClass[] | null>(null);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const linkedId = courseId ? data.classroomCourseIds?.[courseId] ?? "" : "";

  // Result of the Google sign-in redirect (?classroom=connected, …), shown once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("classroom");
    if (!result) return;
    const text = RESULT_TEXT[result];
    params.delete("classroom");
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    if (text) queueMicrotask(() => setMsg(text));
  }, []);

  async function act(body: Record<string, unknown>, success?: string) {
    setBusy(true); setMsg(null);
    try { const r = await submit(body); if (success) setMsg({ kind: "success", text: success }); return r; }
    catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Something went wrong." }); return null; }
    finally { setBusy(false); }
  }
  async function loadClasses() {
    const r = await act({ action: "classroom-classes" }) as { classes?: ClassroomClass[] } | null;
    if (r?.classes) { setClasses(r.classes); setPicked(linkedId || ""); }
  }
  async function link() {
    const r = await act({ action: "classroom-course-link", courseId, classroomCourseId: picked || null }, picked ? "Course linked. Trainees will be invited to this class when instructions are generated." : "Class unlinked from this course.");
    if (r) await reload();
  }
  async function disconnect() {
    if (!window.confirm("Disconnect Google Classroom? Trainees will no longer be invited automatically until it is connected again.")) return;
    if (await act({ action: "classroom-disconnect" }, "Google Classroom disconnected.")) { setClasses(null); await reload(); }
  }

  return <section className="gc-panel">
    <div className="gc-head">
      <div>
        <b>Google Classroom</b>
        <small>{!status?.configured ? "Not set up yet: add the Google keys in Vercel (see the setup steps)." : status.connected ? `Connected as ${status.accountEmail}. Trainees are invited to the linked class when instructions are generated.` : "Connect the Gmail that owns New Wave's classes. You sign in on Google's own page; the portal never sees the password."}</small>
      </div>
      {status?.configured && (status.connected
        ? <button type="button" className="portal-secondary" disabled={busy} onClick={disconnect}>Disconnect</button>
        : <button type="button" className="portal-primary gc-connect" onClick={() => window.location.assign("/api/google/classroom/connect")}>Connect Google Classroom</button>)}
    </div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    {status?.connected && <div className="gc-link">
      {!courseId ? <small>Choose a course below to link it to a Google Classroom class.</small> : <>
        <span>Class for this course: <b>{linkedId ? (classes?.find((c) => c.id === linkedId)?.name ?? "Linked") : "Not linked"}</b></span>
        {classes === null
          ? <button type="button" className="portal-secondary" disabled={busy} onClick={loadClasses}>{busy ? "Loading…" : linkedId ? "Change class" : "Choose class"}</button>
          : <span className="gc-pick">
            <select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Google Classroom class">
              <option value="">No Class (Unlink)</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.section ? ` · ${c.section}` : ""}</option>)}
            </select>
            <button type="button" className="portal-primary" disabled={busy || picked === linkedId} onClick={link}>Save</button>
          </span>}
      </>}
    </div>}
  </section>;
}
