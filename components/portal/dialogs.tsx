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
  // A typed answer: the question itself is the title (Accent Sheet, owner 11 Nov 2026), unless the caller names one.
  const ask = kind === "text" && !opts.title ? message.match(/^([^\n]{3,120})\n?([\s\S]*)$/) : null;
  const title = opts.title ?? (q ? q[1] : ask ? ask[1] : kind === "confirm" ? "Confirm" : "New Wave Portal");
  const body = q ? q[2].trim() : ask ? ask[2].trim() : message;
  const verb = (q ? q[1] : message).match(VERB)?.[1];
  const okLabel = opts.okLabel ?? (kind === "alert" ? "Close" : kind === "text" ? "Submit" : verb ? verb[0].toUpperCase() + verb.slice(1).toLowerCase() : "Confirm");
  const danger = opts.danger ?? (kind === "confirm" && DANGER.test(q ? q[1] : message));
  return { title, body, okLabel, danger };
}

/**
 * New Wave pop-ups (owner, 29 Oct 2026: "Improve all browser pop ups"). Drop-in, promise-based
 * replacements for window.prompt / confirm / alert, drawn as a portal-styled dialog instead of
 * the browser's grey box. Each call mounts its own dialog and removes it when answered.
 */
type Kind = "text" | "confirm" | "alert";
/**
 * Accent Sheet (owner, 11 Nov 2026): a coloured top edge (orange; red when destructive; blue for a notice), a small
 * section label, the title stating the action, an optional record box naming exactly what is affected, and
 * full-width buttons. `record` = [what, detail]; `label` names the text field; `required` keeps the button off until filled.
 */
type Opts = { title?: string; okLabel?: string; danger?: boolean; eyebrow?: string; record?: [string, string]; label?: string; required?: boolean; multiline?: boolean };
const isReasonAsk = (message: string, opts: Opts) => opts.required ?? (opts.label === "Reason" || /^(why|what should|reason)/i.test(message.trim()));

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
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null), ok = useRef<HTMLButtonElement>(null), box = useRef<HTMLFormElement>(null);
  useEffect(() => { if (kind === "text") field.current?.select(); else ok.current?.focus(); }, [kind]);
  useDialogFocus(box, () => onDone(null));
  const w = dialogWording(kind, message, opts), reason = kind === "text" && isReasonAsk(message, opts), long = kind === "text" && (opts.multiline ?? reason);
  const tone = w.danger ? " danger" : kind === "alert" ? " info" : "";
  return <div className="nw-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && kind !== "alert") onDone(null); }}>
    <form ref={box} className={`nw-dialog nw-sheet${tone}`} role="dialog" aria-modal="true" aria-labelledby="nw-dialog-title" onSubmit={(e) => { e.preventDefault(); if (reason && !value.trim()) return; onDone(kind === "text" ? value : "ok"); }}>
      <span className="nw-sheet-eyebrow">{opts.eyebrow ?? "New Wave Portal"}</span>
      <h2 id="nw-dialog-title" className="nw-sheet-title">{w.title}</h2>
      {opts.record && <div className="nw-sheet-rec"><b>{opts.record[0]}</b><span>{opts.record[1]}</span></div>}
      {w.body && <p className="nw-dialog-msg">{w.body}</p>}
      {kind === "text" && <label className="nw-sheet-field">{(opts.label ?? (reason ? "Reason" : "")) && <span>{opts.label ?? "Reason"}</span>}
        {long ? <textarea ref={field} className="nw-dialog-input" rows={3} maxLength={300} value={value} onChange={(e) => setValue(e.target.value)} aria-label={opts.label ?? w.title} />
          : <input ref={field} className="nw-dialog-input" value={value} onChange={(e) => setValue(e.target.value)} aria-label={opts.label ?? w.title} />}
        {long && <small>{value.length} / 300</small>}</label>}
      <div className="nw-dialog-acts">
        {kind !== "alert" && <button type="button" className="nw-dialog-cancel" onClick={() => onDone(null)}>Cancel</button>}
        <button ref={ok} type="submit" disabled={reason && !value.trim()} className={w.danger ? "nw-dialog-ok danger" : "nw-dialog-ok"}>{w.okLabel}</button>
      </div>
    </form>
  </div>;
}

function ReasonDialog({ message, reasons, opts, onDone }: { message: string; reasons: string[]; opts: Opts; onDone: (value: string | null) => void }) {
  const [why, setWhy] = useState<ReasonValue>(NO_REASON);
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box, () => onDone(null));
  return <div className="nw-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
    <form ref={box} className={`nw-dialog nw-sheet${opts.danger ? " danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby="nw-dialog-title" onSubmit={(e) => { e.preventDefault(); if (reasonReady(why)) onDone(reasonText(why)); }}>
      <span className="nw-sheet-eyebrow">{opts.eyebrow ?? "New Wave Portal"}</span>
      <h2 id="nw-dialog-title" className="nw-sheet-title">{opts.title ?? message}</h2>
      {opts.record && <div className="nw-sheet-rec"><b>{opts.record[0]}</b><span>{opts.record[1]}</span></div>}
      {opts.title && <p className="nw-dialog-msg">{message}</p>}
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
