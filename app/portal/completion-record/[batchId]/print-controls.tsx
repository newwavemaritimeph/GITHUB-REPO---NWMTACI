"use client";

import { useState } from "react";

/** Toolbar for the completion record; hidden when printing. Printing is recorded (print count and audit log). */
export function CompletionPrintControls({ batchId, title, complete }: { batchId: string; title: string; complete: boolean }) {
  const [error, setError] = useState("");
  async function print() {
    setError("");
    const r = await fetch("/api/staff/completion-records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "printed", batchId }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setError(b.error ?? "Could not record the print."); return; }
    window.print();
  }
  return <div className="tcr-toolbar">
    <div><b>Training Completion and Record of Assessment Report · {title}</b><span>{error || "Print on A4, landscape, at 100% scale."}</span></div>
    <span><button type="button" disabled={!complete} onClick={() => void print()}>Print</button><button type="button" className="ghost" onClick={() => window.close()}>Close</button></span>
  </div>;
}
