"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EVALUATION_QUESTIONS, EVALUATION_RATINGS, EVALUATION_TEXT_MAX, RATING_SCALE } from "@/lib/evaluation-form";

type Context = { traineeName: string; courseName: string; courseCode: string; startsOn: string | null; endsOn: string | null; inHouse: boolean; alreadySubmitted: boolean };

const day = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d.slice(0, 10)}T12:00:00+08:00`));
const navy = "#123F63", muted = "#35607a", field: React.CSSProperties = { width: "100%", marginTop: 6, borderRadius: 8, border: "1px solid #9EE3F1", padding: 10, fontFamily: "inherit", fontSize: 16, boxSizing: "border-box" };

/** One statement rated 1–5 as a radio group (keyboard and screen-reader friendly). */
function Rating({ index, label, value, onChange }: { index: number; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: "16px 0" }}>
      <legend style={{ fontSize: 15, fontWeight: 600, color: navy, marginBottom: 8 }}>{index + 1}. {label}</legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} title={RATING_SCALE[n - 1]} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: 8, cursor: "pointer",
            border: `1px solid ${value === n ? "#F25615" : "#9EE3F1"}`, background: value === n ? "#F25615" : "#fff", color: value === n ? "#fff" : "#0571D0" }}>
            <input type="radio" name={`rating-${index}`} value={n} checked={value === n} onChange={() => onChange(n)} aria-label={`${n} – ${RATING_SCALE[n - 1]}`}
              style={{ position: "absolute", opacity: 0, inset: 0, margin: 0, cursor: "pointer" }} />
            <span style={{ fontSize: 18, fontWeight: 700 }}>{n}</span>
            <span style={{ fontSize: 10.5, lineHeight: 1.1, textAlign: "center" }}>{RATING_SCALE[n - 1]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Training evaluation in the portal, replacing Google Forms (owner, 20 Oct 2026). */
export function FeedbackForm({ token }: { token: string }) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loadError, setLoadError] = useState("");
  const [ratings, setRatings] = useState<number[]>(() => EVALUATION_RATINGS.map(() => 0));
  const [liked, setLiked] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [recommend, setRecommend] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"" | "submitted" | "already">("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/public/feedback?token=${encodeURIComponent(token)}`).then((r) => r.json()).then((body) => {
      if (!active) return;
      if (body.error) setLoadError(body.error); else { setCtx(body); if (body.alreadySubmitted) setDone("already"); }
    }).catch(() => active && setLoadError("Could not load this evaluation form."));
    return () => { active = false; };
  }, [token]);

  const complete = ratings.every((r) => r >= 1) && (recommend === "Yes" || recommend === "No");

  async function submit() {
    if (!complete) { setError("Please rate every statement and answer whether you would recommend New Wave."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/public/feedback", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, answers: { ratings, liked: liked.trim(), suggestions: suggestions.trim(), recommend } }) });
      const body = await r.json().catch(() => ({}));
      if (r.status === 409) { setDone("already"); return; }
      if (!r.ok) throw new Error(body.error ?? "Could not submit your evaluation.");
      setDone("submitted");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your evaluation."); }
    finally { setBusy(false); }
  }

  const shell: React.CSSProperties = { minHeight: "100vh", background: "linear-gradient(160deg,#0571D0,#123F63)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", fontFamily: "system-ui, sans-serif" };
  const card: React.CSSProperties = { background: "#fff", borderRadius: 16, maxWidth: 640, width: "100%", padding: "28px 22px", boxShadow: "0 18px 50px rgba(0,0,0,.25)", boxSizing: "border-box" };

  if (loadError) return <main style={shell}><div style={card}><h1 style={{ color: navy, margin: 0, fontSize: 22 }}>Training Evaluation</h1><p role="alert" style={{ color: "#b3261e" }}>{loadError}</p></div></main>;
  if (!ctx) return <main style={shell}><div style={card}><p style={{ color: navy }}>Loading…</p></div></main>;

  const dates = ctx.startsOn ? (ctx.endsOn && ctx.endsOn !== ctx.startsOn ? `${day(ctx.startsOn)} – ${day(ctx.endsOn)}` : day(ctx.startsOn)) : "";

  return (
    <main style={shell}>
      <div style={card}>
        <div style={{ fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#0571D0", fontWeight: 700 }}>New Wave Maritime Training</div>
        <h1 style={{ color: navy, margin: "6px 0 10px", fontSize: 24 }}>Training Evaluation</h1>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0, color: muted, fontSize: 15 }}>
          <dt style={{ fontWeight: 600, color: navy }}>Trainee</dt><dd style={{ margin: 0 }}>{ctx.traineeName}</dd>
          <dt style={{ fontWeight: 600, color: navy }}>Course</dt><dd style={{ margin: 0 }}>{ctx.courseName}{ctx.courseCode ? ` (${ctx.courseCode})` : ""}</dd>
          {dates && <><dt style={{ fontWeight: 600, color: navy }}>Training Dates</dt><dd style={{ margin: 0 }}>{dates}</dd></>}
        </dl>
        {done ? (
          <div role="status" style={{ marginTop: 18, padding: "18px 16px", background: "#eaf8ee", border: "1px solid #b6e3c4", borderRadius: 12 }}>
            <strong style={{ color: navy, fontSize: 18 }}>{done === "submitted" ? "Thank you. Your evaluation was submitted." : "This evaluation was already submitted."}</strong>
            {done === "submitted" && ctx.inHouse && <p style={{ color: muted, margin: "8px 0 0" }}>Your certificate will be prepared once your fee is settled.</p>}
            <p style={{ margin: "12px 0 0" }}><Link href="/registration-search" style={{ color: "#0571D0", fontWeight: 600 }}>Back to My Status</Link></p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }}>
            <p style={{ color: muted, margin: "14px 0 0" }}>Rate each statement from 1 (Poor) to 5 (Excellent).</p>
            {EVALUATION_RATINGS.map((q, i) => <Rating key={q} index={i} label={q} value={ratings[i]} onChange={(v) => setRatings((rs) => rs.map((r, j) => (j === i ? v : r)))} />)}
            <label style={{ display: "block", margin: "16px 0" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: navy }}>{EVALUATION_QUESTIONS.liked}</span>
              <textarea value={liked} onChange={(e) => setLiked(e.target.value)} rows={3} maxLength={EVALUATION_TEXT_MAX} style={field} />
            </label>
            <label style={{ display: "block", margin: "16px 0" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: navy }}>{EVALUATION_QUESTIONS.suggestions}</span>
              <textarea value={suggestions} onChange={(e) => setSuggestions(e.target.value)} rows={3} maxLength={EVALUATION_TEXT_MAX} style={field} />
            </label>
            <label style={{ display: "block", margin: "16px 0" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: navy }}>{EVALUATION_QUESTIONS.recommend} <span style={{ color: "#F25615" }}>*</span></span>
              <select value={recommend} onChange={(e) => setRecommend(e.target.value)} required style={{ ...field, minHeight: 46, background: "#fff" }}>
                <option value="">Select…</option><option value="Yes">Yes</option><option value="No">No</option>
              </select>
            </label>
            {error && <p role="alert" style={{ color: "#b3261e", margin: "6px 0" }}>{error}</p>}
            <button type="submit" disabled={busy || !complete}
              style={{ marginTop: 8, width: "100%", minHeight: 48, borderRadius: 10, border: 0, cursor: busy || !complete ? "not-allowed" : "pointer",
                background: "#F25615", color: "#fff", fontSize: 16, fontWeight: 700, opacity: busy || !complete ? 0.6 : 1 }}>
              {busy ? "Submitting…" : "Submit Evaluation"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
