"use client";

import { useEffect, useState } from "react";
import { shrinkProof } from "@/lib/proof-shrink";

type Channel = { name: string; accountDetails: string };

const box: React.CSSProperties = { border: "2px dashed #35CCFA", borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, background: "#fff" };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 14, fontWeight: 600, color: "#123F63" };
const input: React.CSSProperties = { border: "1px solid #cfdbe3", borderRadius: 9, padding: "9px 10px", font: "inherit", fontWeight: 400 };
const chip = (on: boolean): React.CSSProperties => ({ border: `1px solid ${on ? "#123F63" : "#cfdbe3"}`, background: on ? "#123F63" : "#fff", color: on ? "#fff" : "#123F63", borderRadius: 99, padding: "7px 16px", fontWeight: 600, cursor: "pointer" });

/**
 * Upload Proof of Payment (owner, 29 Oct 2026): optional, after registration and on
 * Trainee Status. The file goes to New Wave's Google Drive for the Cashier to view;
 * the Cashier records the payment and issues the receipt.
 */
export function ProofUpload({ srn, nwmtaciNo, onSent }: { srn: string; nwmtaciNo: string; onSent?: () => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [mode, setMode] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/public/payment-proof").then((r) => r.json()).then((b: { channels?: Channel[]; enabled?: boolean }) => {
      if (!live) return;
      const list = b.enabled === false ? [] : b.channels ?? [];
      setChannels(list); setMode(list[0]?.name ?? "");
    }).catch(() => live && setChannels([]));
    return () => { live = false; };
  }, []);

  async function send() {
    setError("");
    if (!mode || !(Number(amount) > 0) || reference.trim().length < 3 || !file) { setError("Add the mode of payment, the amount, the reference number and the photo."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("srn", srn); fd.set("nwmtaciNo", nwmtaciNo); fd.set("mode", mode); fd.set("amount", amount); fd.set("reference", reference.trim());
      fd.set("proof", await shrinkProof(file));
      const response = await fetch("/api/public/payment-proof", { method: "POST", body: fd });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error ?? "We could not send your proof. Please try again."); return; }
      setSent(true); onSent?.();
    } catch (e) { setError(e instanceof Error ? e.message : "We could not send your proof. Please try again."); }
    finally { setBusy(false); }
  }

  if (!channels?.length) return null;
  if (sent) return <div style={{ background: "#e5f1fb", color: "#0571D0", borderRadius: 12, padding: "12px 16px", fontWeight: 600 }}>Proof received. The Cashier will check it and issue your official receipt. You can follow it on the Trainee Status page.</div>;
  const details = channels.find((c) => c.name === mode)?.accountDetails;
  return (
    <div style={box}>
      <h3 style={{ margin: 0, color: "#123F63" }}>Upload Proof of Payment <small style={{ fontSize: 12, color: "#5f7180", background: "#eef4f8", borderRadius: 99, padding: "2px 9px", marginLeft: 6 }}>Optional</small></h3>
      <div style={field}>Mode of Payment
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{channels.map((c) => <button type="button" key={c.name} style={chip(mode === c.name)} onClick={() => setMode(c.name)} aria-pressed={mode === c.name}>{c.name}</button>)}</div>
        {details && <span style={{ fontWeight: 400, color: "#33475a", whiteSpace: "pre-line", background: "#f4f8fa", borderRadius: 8, padding: "8px 10px" }}>{details}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <label style={field}>Amount Sent (₱)<input style={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label>
        <label style={field}>Reference No.<input style={input} value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="From your receipt or screenshot" maxLength={80} /></label>
      </div>
      <label style={field}>Photo or PDF of the Proof<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><span style={{ fontWeight: 400, fontSize: 13, color: "#5f7180" }}>Large phone photos are made smaller before sending.</span></label>
      {error && <p style={{ margin: 0, color: "#b42318", fontSize: 14 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, color: "#5f7180" }}>Paying cash at the office? Skip this.</span>
        <button type="button" className="button button-primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send Proof"}</button>
      </div>
    </div>
  );
}
