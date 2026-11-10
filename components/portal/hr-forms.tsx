"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "./shared-ui";

/**
 * One window per HR form (owner, 10 Nov 2026: "Organize Forms, should not be an eyesore!").
 * Fields sit in a two-column grid (one column on phones), grouped under small section heads,
 * with the error inside the window and Cancel / Save at the bottom right.
 */
export type HrField = {
  key: string; label: string; type?: "text" | "email" | "date" | "time" | "number" | "select" | "textarea";
  options?: (string | [string, string])[]; required?: boolean; full?: boolean; placeholder?: string; min?: string; max?: string; step?: string;
  /** A small heading shown before this field (starts a section). */
  section?: string;
  show?: (v: Record<string, string>) => boolean;
};

export function HrFormModal({ title, fields, initial = {}, submitLabel = "Save", onSubmit, onClose, wide, note }: {
  title: string; fields: HrField[]; initial?: Record<string, string>; submitLabel?: string; wide?: boolean; note?: ReactNode;
  onSubmit: (values: Record<string, string>) => Promise<void>; onClose: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? ""])));
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }));
  return <Modal title={title} onClose={onClose} wide={wide}>
    <form className="portal-form hr-form" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr("");
      try { await onSubmit(v); onClose(); } catch (x) { setErr(x instanceof Error ? x.message : "Could not save."); } finally { setBusy(false); }
    }}>
      {err && <p className="hr-form-err full" role="alert">{err}</p>}
      {fields.filter((f) => !f.show || f.show(v)).map((f) => <FieldBox key={f.key} f={f} value={v[f.key]} onChange={set(f.key)} />)}
      {note && <div className="full hr-form-note">{note}</div>}
      <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button className="portal-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button></div>
    </form>
  </Modal>;
}

function FieldBox({ f, value, onChange }: { f: HrField; value: string; onChange: (e: { target: { value: string } }) => void }) {
  const common = { value, onChange, required: f.required, placeholder: f.placeholder };
  const input = f.type === "select"
    ? <select {...common}>{!f.required && <option value="">—</option>}{(f.options ?? []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return <option key={val} value={val}>{lab}</option>; })}</select>
    : f.type === "textarea" ? <textarea rows={3} {...common} />
    : <input type={f.type ?? "text"} min={f.min} max={f.max} step={f.step} {...common} />;
  return <>
    {f.section && <h3 className="hr-form-section full">{f.section}</h3>}
    <label className={f.full ? "full" : undefined}>{f.label}{input}</label>
  </>;
}

/** Pesos typed in the form ("1,500.50") to centavos; blank is 0. */
export const toCentavos = (s: string) => { const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
export const fromCentavos = (c?: number | null) => (c ? String(c / 100) : "");
