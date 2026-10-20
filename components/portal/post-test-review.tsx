"use client";

import { useCallback, useEffect, useState } from "react";
import type { PostTestQuestion } from "@/lib/post-test";

type CourseRow = { id: string; code: string; name: string; approvedAt: string | null; passingPercent: number; saved: number; drafted: boolean };
type Loaded = { course: { id: string; code: string; name: string }; approved: boolean; approvedAt: string | null; passingPercent: number; questions: PostTestQuestion[]; source: "saved" | "draft" | "none" };

/**
 * Admin › Configuration › Post-Tests (owner, 20 Oct 2026): review the drafted
 * questions for each course, correct them, set the pass mark and approve. Only
 * approved courses have a live post-test.
 */
export function PostTestReview() {
  const [list, setList] = useState<CourseRow[] | null>(null), [ready, setReady] = useState(true);
  const [q, setQ] = useState(""), [filter, setFilter] = useState<"All" | "To Review" | "Approved">("To Review");
  const [pickedId, setPickedId] = useState<string | null>(null), [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<PostTestQuestion[]>([]), [pass, setPass] = useState(70);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadList = useCallback(async () => {
    const r = await fetch("/api/staff/post-tests", { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ kind: "err", text: body.error ?? "Could not load the courses." }); return; }
    setList(body.courses); setReady(body.ready);
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/staff/post-tests", { cache: "no-store" }).then((r) => r.json().then((body) => ({ ok: r.ok, body }))).then(({ ok, body }) => {
      if (!active) return;
      if (!ok) setMsg({ kind: "err", text: body.error ?? "Could not load the courses." }); else { setList(body.courses); setReady(body.ready); }
    }).catch(() => active && setMsg({ kind: "err", text: "Could not load the courses." }));
    return () => { active = false; };
  }, []);

  async function open(id: string) {
    setPickedId(id); setLoaded(null); setMsg(null);
    const r = await fetch(`/api/staff/post-tests?courseId=${id}`, { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ kind: "err", text: body.error ?? "Could not load the questions." }); return; }
    setLoaded(body); setDraft(body.questions.map((x: PostTestQuestion) => ({ ...x, options: [...x.options] }))); setPass(body.passingPercent);
  }
  async function save(approve: boolean) {
    if (!loaded) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/staff/post-tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", courseId: loaded.course.id, questions: draft, passingPercent: pass, approve }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? "Could not save.");
      setMsg({ kind: "ok", text: approve ? `${loaded.course.code} post-test approved. Trainees of this course now take it, and it is in their end-of-training email.` : "Saved. Approve it when the questions are checked." });
      await Promise.all([loadList(), open(loaded.course.id)]);
    } catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not save." }); } finally { setBusy(false); }
  }
  async function unapprove() {
    if (!loaded) return;
    setBusy(true);
    const r = await fetch("/api/staff/post-tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unapprove", courseId: loaded.course.id }) });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ kind: "err", text: body.error ?? "Could not change it." }); return; }
    setMsg({ kind: "ok", text: "Post-test taken offline. Certificates of this course release without it until it is approved again." });
    await Promise.all([loadList(), open(loaded.course.id)]);
  }
  const set = (i: number, patch: Partial<PostTestQuestion>) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const term = q.trim().toLowerCase();
  const shown = (list ?? []).filter((c) => (!term || `${c.code} ${c.name}`.toLowerCase().includes(term)) && (filter === "All" || (filter === "Approved" ? !!c.approvedAt : !c.approvedAt)));
  const approvedCount = (list ?? []).filter((c) => c.approvedAt).length;

  return <div className="portal-page cx">
    <div className="cx-head"><div><span className="portal-eyebrow">Configuration</span><h1>Post-Tests</h1></div></div>
    {!ready && <div className="portal-message error">Apply database update 202610200048 first; until then the drafts can be read but not saved.</div>}
    <p className="ac-note">Draft questions were written from each certificate&apos;s course description. Check each course with an instructor, correct anything wrong, then Approve. A course&apos;s post-test is live only after approval; until then its certificates release without one. {list ? `${approvedCount} of ${list.length} approved.` : ""}</p>
    {msg && <div className={`portal-message ${msg.kind === "ok" ? "success" : "error"}`}>{msg.text}</div>}
    <div className="pt-grid">
      <section className="portal-panel cx-panel pt-list"><div className="pm-tools"><input className="pm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search course" aria-label="Search courses" />
        <div className="cx-seg">{(["To Review", "Approved", "All"] as const).map((f) => <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>)}</div></div>
        <div className="pt-courses">{list === null ? <p className="portal-empty-copy">Loading…</p> : shown.map((c) => <button key={c.id} type="button" className={c.id === pickedId ? "on" : ""} onClick={() => void open(c.id)}><b className="cx-mono">{c.code}</b> · {c.name}<small>{c.approvedAt ? `✓ Approved · pass ${c.passingPercent}%` : c.saved ? `${c.saved} questions saved · to approve` : c.drafted ? "10 draft questions · to review" : "No questions yet"}</small></button>)}
          {list && !shown.length && <p className="portal-empty-copy">No courses match.</p>}</div>
      </section>
      <section className="portal-panel cx-panel">
        {!pickedId ? <p className="portal-empty-copy">Pick a course to review its questions.</p> : !loaded ? <p className="portal-empty-copy">Loading…</p> : <>
          <div className="panel-heading"><h2>{loaded.course.code} · {loaded.course.name}</h2>
            <span className={`ac-chip ${loaded.approved ? "ok" : "warn"}`}>{loaded.approved ? "Approved · Live" : loaded.source === "draft" ? "Draft" : loaded.source === "saved" ? "Saved · Not Live" : "No Questions"}</span></div>
          <div className="pt-pass"><label>Passing Score (%)<input type="number" min={1} max={100} value={pass} onChange={(e) => setPass(Math.max(1, Math.min(100, Number(e.target.value) || 70)))} /></label>
            <span className="muted-text">{draft.length} questions · pass with {Math.ceil((draft.length * pass) / 100)} correct · unlimited retakes</span></div>
          {draft.map((x, i) => <fieldset key={i} className="pt-q"><legend>Question {i + 1}</legend>
            <textarea value={x.q} rows={2} onChange={(e) => set(i, { q: e.target.value })} aria-label={`Question ${i + 1}`} />
            {x.options.map((o, k) => <label key={k} className={`pt-opt${x.answer === k ? " on" : ""}`}><input type="radio" name={`ans-${i}`} checked={x.answer === k} onChange={() => set(i, { answer: k })} aria-label={`Mark choice ${"ABCD"[k]} correct`} /><b>{"ABCD"[k]}</b><input value={o} onChange={(e) => set(i, { options: x.options.map((v, j) => (j === k ? e.target.value : v)) })} aria-label={`Choice ${"ABCD"[k]}`} /></label>)}
            <label className="pt-why">Why<input value={x.why ?? ""} onChange={(e) => set(i, { why: e.target.value })} placeholder="One line: why the marked answer is correct" /></label>
            {draft.length > 10 && <button type="button" className="pm-link" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>Remove Question</button>}
          </fieldset>)}
          <div className="pm-actions"><button type="button" className="portal-secondary" onClick={() => setDraft((d) => [...d, { q: "", options: ["", "", "", ""], answer: 0, why: "" }])}>Add Question</button>
            <span className="cx-acts">{loaded.approved && <button type="button" className="portal-secondary" disabled={busy} onClick={() => void unapprove()}>Take Offline</button>}
              <button type="button" className="portal-secondary" disabled={busy || !ready} onClick={() => void save(false)}>Save</button>
              <button type="button" className="portal-primary" disabled={busy || !ready} onClick={() => void save(true)}>{loaded.approved ? "Save and Keep Live" : "Approve and Publish"}</button></span></div>
        </>}
      </section>
    </div>
  </div>;
}
