"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Test = { traineeName: string; courseName: string; courseCode: string; passingPercent: number; passMark: number; questions: { q: string; options: string[] }[]; attempts: number; passed: boolean; best: { score: number; total: number; percent: number } | null };
type Result = { score: number; total: number; percent: number; passed: boolean; passMark: number; attempts: number };

const navy = "#123F63", muted = "#35607a";

/** Course post-test (owner, 20 Oct 2026): 10 questions, pass mark from the Admin (70%), unlimited retakes, answers never shown. */
export function PostTestForm({ token }: { token: string }) {
  const [test, setTest] = useState<Test | null>(null), [loadError, setLoadError] = useState("");
  const [picks, setPicks] = useState<(number | null)[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/public/post-test?token=${encodeURIComponent(token)}`, { cache: "no-store" }).then((r) => r.json()).then((body) => {
      if (!active) return;
      if (body.error) setLoadError(body.error); else { setTest(body); setPicks(body.questions.map(() => null)); }
    }).catch(() => active && setLoadError("Could not load the post-test."));
    return () => { active = false; };
  }, [token]);

  async function submit() {
    if (!test || picks.some((p) => p == null)) { setError("Please answer every question."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/public/post-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, picks }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? "Your answers could not be saved.");
      setResult(body); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError(e instanceof Error ? e.message : "Your answers could not be saved."); } finally { setBusy(false); }
  }
  const retake = () => { if (!test) return; setResult(null); setPicks(test.questions.map(() => null)); setTest({ ...test, attempts: result?.attempts ?? test.attempts }); window.scrollTo({ top: 0 }); };

  const shell: React.CSSProperties = { minHeight: "100vh", background: "linear-gradient(160deg,#0571D0,#123F63)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 16px", fontFamily: "system-ui, sans-serif" };
  const card: React.CSSProperties = { background: "#fff", borderRadius: 16, maxWidth: 680, width: "100%", padding: "26px 20px", boxShadow: "0 18px 50px rgba(0,0,0,.25)", boxSizing: "border-box" };
  if (loadError) return <main style={shell}><div style={card}><h1 style={{ color: navy, margin: 0, fontSize: 22 }}>Course Post-Test</h1><p role="alert" style={{ color: "#b3261e" }}>{loadError}</p></div></main>;
  if (!test) return <main style={shell}><div style={card}><p style={{ color: navy }}>Loading…</p></div></main>;
  const answered = picks.filter((p) => p != null).length;
  const passedBefore = test.passed && !result;

  return <main style={shell}><div style={card}>
    <div style={{ fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#0571D0", fontWeight: 700 }}>New Wave Maritime Training</div>
    <h1 style={{ color: navy, margin: "6px 0 10px", fontSize: 24 }}>Course Post-Test</h1>
    <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0, color: muted, fontSize: 15 }}>
      <dt style={{ fontWeight: 600, color: navy }}>Trainee</dt><dd style={{ margin: 0 }}>{test.traineeName}</dd>
      <dt style={{ fontWeight: 600, color: navy }}>Course</dt><dd style={{ margin: 0 }}>{test.courseName}{test.courseCode ? ` (${test.courseCode})` : ""}</dd>
    </dl>
    {result ? <div role="status" style={{ marginTop: 18, padding: "18px 16px", borderRadius: 12, background: result.passed ? "#eaf8ee" : "#fdecea", border: `1px solid ${result.passed ? "#b6e3c4" : "#f5c2bc"}` }}>
      <strong style={{ color: result.passed ? "#0a7a3e" : "#b42318", fontSize: 19 }}>{result.passed ? "✓ Passed" : "✗ Not passed yet"}</strong>
      <p style={{ margin: "8px 0", fontSize: 30, fontWeight: 700, color: navy }}>{result.score}/{result.total} <span style={{ fontSize: 15, fontWeight: 500, color: muted }}>{result.percent}% · passing score {test.passingPercent}%</span></p>
      {result.passed ? <p style={{ margin: 0, color: muted }}>Your result is saved. Your certificate is released once your fee is settled and your training evaluation is submitted.</p>
        : <><p style={{ margin: "0 0 12px", color: muted }}>You need at least {result.passMark} correct answers. Review the course topics and take the test again. There is no limit on retakes.</p>
          <button type="button" onClick={retake} style={{ minHeight: 46, padding: "0 20px", borderRadius: 10, border: 0, background: "#F25615", color: "#fff", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>Retake the Test</button></>}
      <p style={{ margin: "12px 0 0" }}><Link href="/registration-search" style={{ color: "#0571D0", fontWeight: 600 }}>Back to My Status</Link></p>
    </div> : passedBefore ? <div role="status" style={{ marginTop: 18, padding: "18px 16px", borderRadius: 12, background: "#eaf8ee", border: "1px solid #b6e3c4" }}>
      <strong style={{ color: "#0a7a3e", fontSize: 18 }}>✓ You already passed this post-test{test.best ? ` (${test.best.score}/${test.best.total})` : ""}.</strong>
      <p style={{ margin: "12px 0 0" }}><Link href="/registration-search" style={{ color: "#0571D0", fontWeight: 600 }}>Back to My Status</Link></p>
    </div> : <form onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }}>
      <p style={{ background: "#e2effc", color: "#0b5cad", borderRadius: 10, padding: "10px 12px", fontSize: 14.5, margin: "16px 0" }}>{test.questions.length} questions. Choose one answer each. You pass with {test.passingPercent}% ({test.passMark} correct).{test.attempts ? ` This is retake ${test.attempts}.` : ""}</p>
      {test.questions.map((q, i) => <fieldset key={i} style={{ border: "1px solid #d8e4ec", borderRadius: 12, padding: "12px 12px 6px", margin: "0 0 12px" }}>
        <legend style={{ fontSize: 15, fontWeight: 700, color: navy, padding: "0 4px" }}>{i + 1}. {q.q}</legend>
        {q.options.map((o, k) => <label key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: `1px solid ${picks[i] === k ? "#0571D0" : "#d8e4ec"}`, background: picks[i] === k ? "#e2effc" : "#fff", borderRadius: 10, padding: "10px 12px", margin: "0 0 8px", cursor: "pointer", fontSize: 15 }}>
          <input type="radio" name={`q${i}`} checked={picks[i] === k} onChange={() => setPicks((ps) => ps.map((p, j) => (j === i ? k : p)))} style={{ marginTop: 3, width: 18, height: 18, flex: "none" }} /><span>{o}</span></label>)}
      </fieldset>)}
      {error && <p role="alert" style={{ color: "#b3261e" }}>{error}</p>}
      <button type="submit" disabled={busy || answered < test.questions.length} style={{ width: "100%", minHeight: 48, borderRadius: 10, border: 0, background: "#F25615", color: "#fff", fontSize: 16, fontWeight: 700, opacity: busy || answered < test.questions.length ? 0.6 : 1, cursor: "pointer" }}>{busy ? "Submitting…" : "Submit Answers"}</button>
      {answered < test.questions.length && <p style={{ color: muted, fontSize: 13.5, textAlign: "center" }}>Answer all {test.questions.length} questions to submit ({answered} answered).</p>}
    </form>}
  </div></main>;
}
