"use client";

import { useState } from "react";
import type { PortalData } from "../portal-live-app";
import { DEFAULT_CATEGORY_TEMPLATES, INSTRUCTION_PLACEHOLDERS, fillPlaceholders, linesOf, moduleSheetSteps, policyPairs, sheetSteps, type CategoryTemplate, type InstructionCategory } from "@/lib/instruction-templates";
import { Message, usePost } from "./shared-ui";

/**
 * Admin › Configuration › Training Instructions (owner, 3 Nov 2026; Design 11): one template for
 * STCW courses and one for In-House courses, with a preview of the sheet Registration generates.
 */
const LABEL: Record<InstructionCategory, string> = { STCW: "STCW Courses", "In-House": "In-House Courses" };
const SAMPLE: Record<InstructionCategory, Record<string, string>> = {
  STCW: { trainee: "Juan Dela Cruz", course: "PSCMT - Crowd Management", dates: "Nov 10, 2026 - Nov 11, 2026", time: "8:00 AM - 5:00 PM", room: "Room 2", classroom_link: "", class_code: "" },
  "In-House": { trainee: "Maria Santos", course: "HPT - Hazardous Products Training", dates: "Nov 12, 2026", time: "Self-paced", room: "Google Classroom", classroom_link: "classroom.google.com/c/NjM5", class_code: "x7k2pqm" },
};

export function InstructionTemplates({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const [cat, setCat] = useState<InstructionCategory>("STCW");
  const [edits, setEdits] = useState<Partial<Record<InstructionCategory, CategoryTemplate>>>({});
  const { busy, msg, post } = usePost(reload);
  const saved = (category: InstructionCategory) => data.instructionCategories?.find((t) => t.category === category) ?? DEFAULT_CATEGORY_TEMPLATES[category];
  const t = edits[cat] ?? saved(cat);
  const set = (key: "subject" | "bring" | "reminders" | "policies") => (ev: { target: { value: string } }) => setEdits((cur) => ({ ...cur, [cat]: { ...t, [key]: ev.target.value } }));
  const save = () => void post({ action: "instruction-category-save", category: cat, subject: t.subject, bring: t.bring, reminders: t.reminders, policies: t.policies }, `${LABEL[cat]} template saved.`)
    .then(() => setEdits((cur) => { const next = { ...cur }; delete next[cat]; return next; })).catch(() => undefined);
  const sample = SAMPLE[cat], fill = (text: string) => fillPlaceholders(text, sample), asModule = cat === "In-House", bringTitle = asModule ? "What You Need" : "What to Bring";
  const bullets = (text: string) => <ul>{linesOf(text).map((l, i) => <li key={i}>{fill(l)}</li>)}</ul>;
  const card = (title: string, tone: string, body: React.ReactNode) => <div className={`it-card ${tone}`}><h4>{title}</h4>{body}</div>;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Configuration</span><h1>Training Instructions</h1></div>
      <div className="cx-seg">{(["STCW", "In-House"] as InstructionCategory[]).map((c) => <button key={c} type="button" className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{LABEL[c]}</button>)}</div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="it-grid">
      <section className="portal-panel cx-panel it-form">
        <label>Subject<input value={t.subject} maxLength={200} onChange={set("subject")} /></label>
        <label>{bringTitle} (One per Line)<textarea rows={4} value={t.bring} onChange={set("bring")} /></label>
        <label>Reminders (One per Line)<textarea rows={5} value={t.reminders} onChange={set("reminders")} /></label>
        <label>Policies (One per Line)<textarea rows={5} value={t.policies} onChange={set("policies")} /></label>
        <div className="it-chips"><span>Placeholders</span>{INSTRUCTION_PLACEHOLDERS.map((p) => <code key={p}>{p}</code>)}</div>
        <div className="it-save"><button type="button" className="portal-primary" disabled={busy || !t.subject.trim()} onClick={save}>{busy ? "Saving…" : `Save ${LABEL[cat]} Template`}</button></div>
      </section>
      <section className="portal-panel cx-panel it-paper" aria-label={`Preview of ${LABEL[cat]}`}>
        <div className="it-title"><b>TRAINING INSTRUCTIONS</b><span>{LABEL[cat]}</span></div>
        <p className="it-subject">{fill(t.subject)}</p>
        <div className="it-cards">
          {card("When", "b", <p><b>{sample.dates}</b><br />{sample.time}</p>)}
          {card("Where", "n", <p><b>{sample.room}</b>{sample.class_code && <><br />{sample.classroom_link} · code {sample.class_code}</>}</p>)}
          {card(bringTitle, "o", bullets(t.bring))}
          {card("Reminders", "g", bullets(t.reminders))}
        </div>
        <h4 className="it-sub">Your Steps</h4>
        <ol className="it-steps">{(asModule ? moduleSheetSteps(true) : sheetSteps(false, false)).map(([title, text]) => <li key={title}><b>{title}</b><span>{text}</span></li>)}</ol>
        <h4 className="it-sub">Policies</h4>
        <div className="it-pol">{policyPairs(t.policies).map(([k, v], i) => <p key={i}>{k && <b>{k}: </b>}{fill(v)}</p>)}</div>
      </section>
    </div>
  </div>;
}
