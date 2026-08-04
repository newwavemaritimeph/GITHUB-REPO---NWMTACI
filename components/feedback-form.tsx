"use client";

import { useEffect, useState } from "react";

type Context = { traineeName: string; courseName: string; inHouse: boolean; alreadySubmitted: boolean };

function Stars({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ margin: "14px 0" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#123F63", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`}
            style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid #9EE3F1", cursor: "pointer",
              background: n <= value ? "#F25615" : "#fff", color: n <= value ? "#fff" : "#0571D0", fontSize: 18, fontWeight: 700 }}>★</button>
        ))}
      </div>
    </div>
  );
}

export function FeedbackForm({ token }: { token: string }) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loadError, setLoadError] = useState("");
  const [overall, setOverall] = useState(0);
  const [instructor, setInstructor] = useState(0);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/public/feedback?token=${encodeURIComponent(token)}`).then((r) => r.json()).then((body) => {
      if (!active) return;
      if (body.error) setLoadError(body.error); else { setCtx(body); if (body.alreadySubmitted) setDone(true); }
    }).catch(() => active && setLoadError("Could not load this feedback form."));
    return () => { active = false; };
  }, [token]);

  async function submit() {
    if (!overall) { setError("Please give an overall rating."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/public/feedback", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, overallRating: overall, instructorRating: instructor || undefined, comments: comments.trim() || undefined }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Could not submit your feedback.");
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your feedback."); }
    finally { setBusy(false); }
  }

  const shell: React.CSSProperties = { minHeight: "100vh", background: "linear-gradient(160deg,#0571D0,#123F63)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "system-ui, sans-serif" };
  const card: React.CSSProperties = { background: "#fff", borderRadius: 16, maxWidth: 560, width: "100%", padding: "28px 26px", boxShadow: "0 18px 50px rgba(0,0,0,.25)" };

  if (loadError) return <main style={shell}><div style={card}><h1 style={{ color: "#123F63", margin: 0, fontSize: 22 }}>Feedback</h1><p style={{ color: "#b3261e" }}>{loadError}</p></div></main>;
  if (!ctx) return <main style={shell}><div style={card}><p style={{ color: "#123F63" }}>Loading…</p></div></main>;

  return (
    <main style={shell}>
      <div style={card}>
        <div style={{ fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "#0571D0", fontWeight: 700 }}>New Wave Maritime Training</div>
        <h1 style={{ color: "#123F63", margin: "6px 0 2px", fontSize: 24 }}>Training feedback</h1>
        <p style={{ color: "#35607a", marginTop: 4 }}>{ctx.courseName}</p>
        {done ? (
          <div style={{ marginTop: 18, padding: "18px 16px", background: "#eaf8ee", border: "1px solid #b6e3c4", borderRadius: 12 }}>
            <strong style={{ color: "#123F63", fontSize: 18 }}>Thank you, {ctx.traineeName.split(" ")[0] || "there"}!</strong>
            <p style={{ color: "#35607a", margin: "8px 0 0" }}>Your feedback has been recorded as your attendance for this online training.{ctx.inHouse ? " Your training certificate is now being prepared for printing." : ""}</p>
          </div>
        ) : (
          <>
            <p style={{ color: "#35607a" }}>Hi <strong>{ctx.traineeName}</strong> — submitting this form records your attendance for the online training. Please rate your experience.</p>
            <Stars label="Overall training experience" value={overall} onChange={setOverall} />
            <Stars label="Instructor" value={instructor} onChange={setInstructor} />
            <label style={{ display: "block", margin: "14px 0" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#123F63" }}>Comments (optional)</span>
              <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={4}
                style={{ width: "100%", marginTop: 6, borderRadius: 8, border: "1px solid #9EE3F1", padding: 10, fontFamily: "inherit", fontSize: 14 }} />
            </label>
            {error && <p style={{ color: "#b3261e", margin: "6px 0" }}>{error}</p>}
            <button type="button" onClick={() => void submit()} disabled={busy}
              style={{ marginTop: 8, width: "100%", padding: "13px", borderRadius: 10, border: 0, cursor: "pointer",
                background: "#F25615", color: "#fff", fontSize: 16, fontWeight: 700, opacity: busy ? 0.7 : 1 }}>
              {busy ? "Submitting…" : "Submit feedback & attendance"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
