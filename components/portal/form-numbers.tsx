"use client";

import { Fragment, useState } from "react";
import { DOCUMENT_FORMS, controlIsSet, startControl, type DocumentControl, type FormCode } from "@/lib/document-controls";
import { usePaged } from "./shared-ui";

export type DocumentControlRow = { form_code: string; form_no: string | null; revision_no: string | null; revision_date: string | null; issued_date: string | null; updated_by: string | null; updated_at: string | null; profiles?: { complete_name: string } | { complete_name: string }[] | null };

const FIELDS: { key: keyof DocumentControl; label: string; placeholder?: string }[] = [
  { key: "formNo", label: "Form No." }, { key: "revisionNo", label: "Revision No." },
  { key: "revisionDate", label: "Revision Date", placeholder: "MM/DD/YYYY" }, { key: "issuedDate", label: "Issued Date", placeholder: "MM/DD/YYYY" },
];
const same = (a: DocumentControl, b: DocumentControl) => FIELDS.every((f) => a[f.key].trim() === b[f.key].trim());
const changedOn = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(iso));

/**
 * Configuration › Form Numbers (owner, 5 Nov 2026): the details printed on every form, saved together.
 * Accounting and the Admin; each change goes to the audit log with the old and new values.
 */
export function FormNumbers({ rows, busy, post }: { rows: DocumentControlRow[]; busy: boolean; post: (body: Record<string, unknown>) => Promise<void> }) {
  const saved = new Map(rows.map((r) => [r.form_code, r]));
  const base = (code: FormCode): DocumentControl => { const r = saved.get(code); return r ? { formNo: r.form_no ?? "", revisionNo: r.revision_no ?? "", revisionDate: r.revision_date ?? "", issuedDate: r.issued_date ?? "" } : startControl(code); };
  const [edits, setEdits] = useState<Partial<Record<FormCode, DocumentControl>>>({});
  const [filter, setFilter] = useState<"All" | "Set" | "Not Set">("All"), [query, setQuery] = useState(""), [done, setDone] = useState("");
  const current = DOCUMENT_FORMS.map((form) => ({ form, value: edits[form.code] ?? base(form.code) }));
  const dirty = current.filter((c) => !same(c.value, base(c.form.code)));
  const q = query.trim().toLowerCase();
  const count = (f: typeof filter) => current.filter((c) => f === "All" || (f === "Set") === controlIsSet(c.value)).length;
  const shown = current.filter((c) => (filter === "All" || (filter === "Set") === controlIsSet(c.value)) && (!q || `${c.form.name} ${c.form.group} ${c.value.formNo}`.toLowerCase().includes(q)));
  const pg = usePaged(shown);
  const set = (code: FormCode, value: DocumentControl) => { setDone(""); setEdits({ ...edits, [code]: value }); };
  const lastChanged = (code: FormCode, value: DocumentControl) => {
    const r = saved.get(code);
    if (r?.updated_by && r.updated_at) { const who = Array.isArray(r.profiles) ? r.profiles[0]?.complete_name : r.profiles?.complete_name; return `${changedOn(r.updated_at)}${who ? ` · ${who}` : ""}`; }
    return controlIsSet(value) ? "Starting Value" : "Not Yet Set";
  };
  async function save() {
    try {
      await post({ action: "document-controls-save", rows: dirty.map((c) => ({ formCode: c.form.code, formNo: c.value.formNo.trim(), revisionNo: c.value.revisionNo.trim(), revisionDate: c.value.revisionDate.trim(), issuedDate: c.value.issuedDate.trim() })) });
      setEdits({}); setDone(`Saved ${dirty.length} form${dirty.length === 1 ? "" : "s"}. The next print shows the new details.`);
    } catch { /* the page shows the error */ }
  }
  return <section className="portal-panel cx-panel rb3">
    <div className="panel-heading"><h2>Form Numbers</h2>
      <div className="pm-tools"><input className="pm-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search forms" aria-label="Search forms" />
        <div className="cx-seg">{(["All", "Set", "Not Set"] as const).map((f) => <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f} <span className="cx-mono">{count(f)}</span></button>)}</div></div></div>
    {done && <div className="portal-message success">{done}</div>}
    <div className="rb3-wrap"><table className="rb3-table"><thead><tr><th>Form</th>{FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}<th>Last Changed</th></tr></thead>
      <tbody>{pg.shown.map(({ form, value }, i) => {
        const head = i === 0 || pg.shown[i - 1].form.group !== form.group ? form.group : "";
        const note = (form as { note?: string }).note;
        return <Fragment key={form.code}>
          {head && <tr className="pm-details"><td colSpan={6}><b>{head}</b></td></tr>}
          <tr className={same(value, base(form.code)) ? "" : "dirty"}>
            <td><b>{form.name}</b>{note && <small>{note}</small>}</td>
            {FIELDS.map((f) => <td key={f.key}><input className="cm-text cx-mono" aria-label={`${f.label} for ${form.name}`} placeholder={f.placeholder ?? ""} maxLength={f.key === "formNo" ? 40 : 20} value={value[f.key]} onChange={(e) => set(form.code, { ...value, [f.key]: e.target.value })} /></td>)}
            <td className="fn-changed">{lastChanged(form.code, value)}</td>
          </tr>
        </Fragment>;
      })}
      {!shown.length && <tr><td colSpan={6}><span className="portal-empty-copy">Nothing to show.</span></td></tr>}</tbody></table></div>
    {pg.pager}
    <div className={`rb3-bar${dirty.length ? " on" : ""}`}><span>{dirty.length ? `${dirty.length} form${dirty.length === 1 ? "" : "s"} changed` : "No changes"}</span>
      <span className="cx-acts"><button type="button" className="portal-secondary" disabled={!dirty.length || busy} onClick={() => { setEdits({}); setDone(""); }}>Discard</button><button type="button" className="portal-primary" disabled={!dirty.length || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save Changes"}</button></span></div>
  </section>;
}
