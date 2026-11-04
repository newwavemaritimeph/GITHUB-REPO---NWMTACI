"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { NO_REASON, ReasonField, reasonReady, reasonText, type ReasonValue } from "./reject-inline";

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
  const field = useRef<HTMLInputElement>(null), ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (kind === "text") field.current?.select(); else ok.current?.focus(); }, [kind]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(null); }; window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [onDone]);
  const title = opts.title ?? (kind === "confirm" ? "Please Confirm" : kind === "alert" ? "New Wave Portal" : "New Wave Portal");
  return <div className="nw-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && kind !== "alert") onDone(null); }}>
    <form className="nw-dialog" role="dialog" aria-modal="true" aria-labelledby="nw-dialog-title" onSubmit={(e) => { e.preventDefault(); onDone(kind === "text" ? value : "ok"); }}>
      <div className="nw-dialog-head"><span className="nw-dialog-mark" aria-hidden="true">NW</span><h2 id="nw-dialog-title">{title}</h2></div>
      <p className="nw-dialog-msg">{message}</p>
      {kind === "text" && <input ref={field} className="nw-dialog-input" value={value} onChange={(e) => setValue(e.target.value)} aria-label={message} />}
      <div className="nw-dialog-acts">
        {kind !== "alert" && <button type="button" className="nw-dialog-cancel" onClick={() => onDone(null)}>Cancel</button>}
        <button ref={ok} type="submit" className={opts.danger ? "nw-dialog-ok danger" : "nw-dialog-ok"}>{opts.okLabel ?? "OK"}</button>
      </div>
    </form>
  </div>;
}

function ReasonDialog({ message, reasons, opts, onDone }: { message: string; reasons: string[]; opts: Opts; onDone: (value: string | null) => void }) {
  const [why, setWhy] = useState<ReasonValue>(NO_REASON);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(null); }; window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [onDone]);
  return <div className="nw-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
    <form className="nw-dialog" role="dialog" aria-modal="true" aria-labelledby="nw-dialog-title" onSubmit={(e) => { e.preventDefault(); if (reasonReady(why)) onDone(reasonText(why)); }}>
      <div className="nw-dialog-head"><span className="nw-dialog-mark" aria-hidden="true">NW</span><h2 id="nw-dialog-title">{opts.title ?? "New Wave Portal"}</h2></div>
      <p className="nw-dialog-msg">{message}</p>
      <div className="nw-dialog-reason"><ReasonField reasons={reasons} value={why} onChange={setWhy} autoFocus /></div>
      <div className="nw-dialog-acts">
        <button type="button" className="nw-dialog-cancel" onClick={() => onDone(null)}>Cancel</button>
        <button type="submit" disabled={!reasonReady(why)} className={opts.danger ? "nw-dialog-ok danger" : "nw-dialog-ok"}>{opts.okLabel ?? "OK"}</button>
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
