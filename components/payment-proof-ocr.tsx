"use client";

import { useRef, useState } from "react";
import { findPaymentReference } from "@/lib/payment-reference";

type Props = {
  onFileChange?: (file: File | null) => void;
  onReferenceDetected?: (reference: string) => void;
  onConfirmedChange?: (confirmed: boolean) => void;
};

export function PaymentProofOcr({ onFileChange = () => undefined, onReferenceDetected = () => undefined, onConfirmedChange = () => undefined }: Props = {}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "reading" | "ready" | "error">("idle");
  const [detected, setDetected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [fileName, setFileName] = useState("");

  async function readProof(file?: File) {
    if (!file) return;
    setFileName(file.name); setDetected(""); setConfirmed(false); setState("reading");
    onFileChange(file); onConfirmedChange(false);
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      const result = await worker.recognize(file);
      await worker.terminate();
      const reference = findPaymentReference(result.data.text);
      setDetected(reference); onReferenceDetected(reference); setState("ready");
    } catch { setState("error"); }
  }

  function clearProof() {
    if (inputRef.current) inputRef.current.value = "";
    setState("idle"); setFileName(""); setDetected(""); setConfirmed(false);
    onFileChange(null); onConfirmedChange(false);
  }

  return <section className="payment-proof-box full" aria-labelledby="ocr-title">
    <div className="ocr-callout">
      <span aria-hidden="true">▣</span><div><strong id="ocr-title">Payment screenshot (optional)</strong><p>Upload a screenshot for local reference reading, or leave it empty and type the reference manually.</p></div>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={state === "reading"}>{state === "reading" ? "Reading…" : state === "idle" ? "Choose screenshot" : "Replace"}</button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void readProof(event.target.files?.[0])} />
    </div>
    {state !== "idle" && <div className="ocr-result" aria-live="polite"><div><span>Selected proof</span><strong>{fileName}</strong></div>
      {state === "reading" && <p>Reading the transaction reference in this browser…</p>}
      {state === "ready" && <p>{detected ? <>Detected reference: <strong>{detected}</strong>. You may correct it in the reference field below.</> : "No reference was detected. Enter it manually below."}</p>}
      {state === "error" && <p>The screenshot could not be read automatically. Enter the reference manually below.</p>}
      {state !== "reading" && <label className="ocr-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); onConfirmedChange(event.target.checked); }}/><span>I compared the entered reference with the original screenshot.</span></label>}
      <button type="button" className="text-button" onClick={clearProof}>Remove screenshot</button>
    </div>}
  </section>;
}
