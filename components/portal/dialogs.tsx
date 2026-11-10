"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { NO_REASON, ReasonField, reasonReady, reasonText, type ReasonValue } from "./reject-inline";
import { useDialogFocus } from "./shared-ui";

/**
 * Titles that state the action and buttons with a specific verb (owner, 10 Nov 2026 polish pass): a question such as
 * "Archive Maria Sample?" becomes the title, the rest stays as the explanation, the button reads "Archive", and
 * destructive verbs use the red button. Callers that pass a title or okLabel keep theirs.
 */
const DANGER = /^(archive|remove|delete|void|reject|cancel|revoke|return|discard|clear|deactivate|suspend|finalize)\b/i;
const VERB = /^(approve|archive|remove|delete|void|reject|cancel|revoke|return|issue|finalize|release|send|post|save|submit|restore|discard|clear|mark|record|print|reprint|move|assign|close|open|lock|unlock|publish|confirm|proceed|replace|apply|reset|deactivate|activate|suspend)\b/i;
export function dialogWording(kind: "text" | "confirm" | "alert", message: string, opts: { title?: string; okLabel?: string; danger?: boolean }) {
  const q = kind === "confirm" && !opts.title ? message.match(/^([^?]{3,90}\?)\s*([\s\S]*)$/) : null;
  const title = opts.title ?? (q ? q[1] : kind === "confirm" ? "Confirm" : "New Wave Portal");
  const body = q ? q[2].trim() : message;
  const verb = (q ? q[1] : message).match(VERB)?.[1];
  const okLabel = opts.okLabel ?? (kind === "alert" ? "Close" : kind === "text" ? "Save" : verb ? verb[0].toUpperCase() + verb.slice(1).toLowerCase() : "Confirm");
  const danger = opts.danger ?? (kind === "confirm" && DANGER.test(q ? q[1] : message));
  return { title, body, okLabel, danger };
}

/**
 * New Wave pop-ups (owner, 29 Oct 2026: "Improve all browser pop ups"). Drop-in, promise-based
 * replacements for window.prompt / confirm / alert, drawn as a portal-styled dialog instead of
 * the browser's grey box. Each call mounts its own dialog and removes it when answered.
 */
type Kind = "text" | "confirm" | "alert";
type Opts = { title?: string; okLabel?: string; danger?: boolean };

function open<T>(kind: Kind, message: string, initial: string, opts: Opts, done: (value: string | null) => T): Promise<T> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const finish = (value: string | null) => { root.unmount(); host.remove(); resolve(done(value)); };
    root.render(<Dialog kind={kind} message={message} initial={initial} opts={opts} onDone={finish} />);
  });
}

function Dialog({ kind, message, initial, opts, onDone }: { kind: Kind; message: string; initial: string; opts: Opts; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const field = useRef<HTMLInputElement>(null), ok = useRef<HTMLButtonElement>(null), box = useRef<HTMLFormElement>(null);
  useEffect(() => { if (kind === "text") field.current?.select(); else ok.current?.focus(); }, [kind]);
  useDialogFocus(box, () => onDone(null));
  const w = dialogWording(kind, message, opts), title = w.title;
  return <div className="nw-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && kind !== "alert") onDone(null); }}>
    <form ref={box} className="nw-dialog" role="dialog" aria-modal="true" aria-labelledby="nw-dialog-title" onSubmit={(e) => { e.preventDefault(); onDone(kind === "text" ? value : "ok"); }}>
      <div className="nw-dialog-head"><span className="nw-dialog-mark" aria-hidden="true">NW</span><h2 id="nw-dialog-title">{title}</h2></div>
      {w.body && <p className="nw-dialog-msg">{w.body}</p>}
      {kind === "text" && <input ref={field} className="nw-dialog-input" value={value} onChange={(e) => setValue(e.target.value)} aria-label={message} />}
      <div className="nw-dialog-acts">
        {kind !== "alert" && <button type="button" className="nw-dialog-cancel" onClick={() => onDone(null)}>Cancel</button>}
        <button ref={ok} type="submit" className={w.danger ? "nw-dialog-ok danger" : "nw-dialog-ok"}>{w.okLabel}</button>
      </div>
    </form>
  </div>;
}

function ReasonDialog({ message, reasons, opts, onDone }: { message: string; reasons: string[]; opts: Opts; onDone: (value: string | null) => void }) {
  const [why, setWhy] = useState<ReasonValue>(NO_REASON);
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box, () => onDone(null));
  return <div className="nw-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
    <form ref={box} className="nw-dialog" role="dialog" aria-modal="true" aria-labelledby="nw-dialog-title" onSubmit={(e) => { e.preventDefault(); if (reasonReady(why)) onDone(reasonText(why)); }}>
      <div className="nw-dialog-head"><span className="nw-dialog-mark" aria-hidden="true">NW</span><h2 id="nw-dialog-title">{opts.title ?? "New Wave Portal"}</h2></div>
      <p className="nw-dialog-msg">{message}</p>
      <div className="nw-dialog-reason"><ReasonField reasons={reasons} value={why} onChange={setWhy} autoFocus /></div>
      <div className="nw-dialog-acts">
        <button type="button" className="nw-dialog-cancel" onClick={() => onDone(null)}>Cancel</button>
        <button type="submit" disabled={!reasonReady(why)} className={opts.danger ? "nw-dialog-ok danger" : "nw-dialog-ok"}>{opts.okLabel ?? "Submit"}</button>
      </div>
    </form>
  </div>;
}

/** A dropdown of reasons and a note, instead of typing (owner, 4 Nov 2026): the reason text, or null when cancelled. */
export const askReason = (message: string, reasons: string[], opts: Opts = {}) => new Promise<string | null>((resolve) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<ReasonDialog message={message} reasons={reasons} opts={opts} onDone={(value) => { root.unmount(); host.remove(); resolve(value); }} />);
});

/** Like window.prompt: the typed text, or null when cancelled. */
export const askText = (message: string, initial = "", opts: Opts = {}) => open("text", message, initial, opts, (v) => v);
/** Like window.confirm: true when the user clicks OK. */
export const askConfirm = (message: string, opts: Opts = {}) => open("confirm", message, "", opts, (v) => v !== null);
/** Like window.alert. */
export const showAlert = (message: string, opts: Opts = {}) => open("alert", message, "", opts, () => undefined);
