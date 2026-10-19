"use client";

import { useState } from "react";
import type { PortalData } from "../portal-live-app";
import { first, manilaToday, pesos2 } from "@/lib/portal-format";
import { Badge, Message, fmtDate, usePost as useRawPost } from "./shared-ui";
import { shrinkPhoto } from "./live-cashier";

/**
 * Other income (owner, 19 Oct 2026): endorsement rebates received from partner
 * centers for trainees endorsed to them, and any other income (rental, sale of
 * items, refunds from suppliers, interest). Each receipt gets an income number
 * (INC-) and a proof photo in Google Drive. The Cashier records; Accounting views;
 * only the Admin voids.
 */
type Proof = { fileId: string; link: string; name: string; mime: string };
type Income = { id: string; income_number: string; source: string; payer: string; amount_centavos: number; channel: string; reference?: string | null; received_on: string; notes?: string | null; proof_files?: Proof[] | null; void_reason?: string | null; voided_at?: string | null; partner_centers?: { name: string } | { name: string }[] | null };
type Extra = { otherIncome?: Income[]; rebatesReceived?: Record<string, string> };
type Form = { source: string; payer: string; amount: string; channel: string; reference: string; date: string; notes: string };
const SOURCES = ["Rental", "Sale of Items", "Refund from Supplier", "Interest", "Others"];
const toCentavos = (v: string) => { const n = Math.round(Number(String(v).replace(/,/g, "")) * 100); return Number.isFinite(n) && n > 0 ? n : 0; };

function usePost(reload: () => Promise<void>) {
  const raw = useRawPost(reload);
  return { busy: raw.busy, msg: raw.msg, post: async (body: Record<string, unknown>, text?: string) => { try { await raw.post(body, text); return true; } catch { return false; } } };
}

export function OtherIncome({ data, reload, canRecord, canVoid }: { data: PortalData; reload: () => Promise<void>; canRecord: boolean; canVoid: boolean }) {
  const x = data as unknown as Extra;
  const incomes = x.otherIncome ?? [];
  const received = x.rebatesReceived ?? {};
  const [tab, setTab] = useState<"Endorsement Rebates" | "Other Income">("Endorsement Rebates");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<Form | null>(null);
  const [proofs, setProofs] = useState<Proof[]>([]), [uploading, setUploading] = useState(""), [proofError, setProofError] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null), [reason, setReason] = useState("");
  const { busy, msg, post } = usePost(reload);
  const channels = [...new Set([...data.paymentMethods.filter((m) => m.active).map((m) => m.name), "Check"])];
  const today = manilaToday();

  // Endorsed enrollments with a rebate, grouped by partner center.
  const offers = new Map(data.offers.map((o) => [o.id, o]));
  const endorsed = data.enrollments.filter((e) => e.partner_offer_id && e.enrollment_status !== "Cancelled" && Number(e.rebate_centavos) > 0).map((e) => {
    const o = offers.get(e.partner_offer_id!);
    const t = first(e.trainees), c = first(e.courses), b = first(e.batches);
    return { e, partner: first(o?.partner_centers)?.name ?? "Partner center", trainee: t ? `${t.legal_last_name}, ${t.legal_first_name}` : "—", number: t?.trainee_number ?? "", course: c?.name ?? "—", date: b?.starts_on ?? e.scheduled_on ?? null, rebate: Number(e.rebate_centavos), income: received[e.id] ?? null };
  });
  const partners = [...new Set(endorsed.map((r) => r.partner))].sort();
  const due = endorsed.filter((r) => !r.income);
  const chosen = endorsed.filter((r) => picked.has(r.e.id));
  const chosenPartners = [...new Set(chosen.map((r) => r.partner))];
  const chosenTotal = chosen.reduce((s, r) => s + r.rebate, 0);
  const month = today.slice(0, 7);
  const live = incomes.filter((i) => !i.voided_at);
  const thisMonth = live.filter((i) => i.received_on.startsWith(month));
  const oldest = due.map((r) => r.date).filter(Boolean).sort()[0] as string | undefined;

  const blank = (amount: number): Form => ({ source: SOURCES[0], payer: "", amount: amount ? (amount / 100).toFixed(2) : "", channel: channels.includes("Cash") ? (amount ? channels.find((c) => c !== "Cash") ?? "Cash" : "Cash") : channels[0] ?? "Cash", reference: "", date: today, notes: "" });
  const open = (amount: number) => { setForm(blank(amount)); setProofs([]); setProofError(""); };
  async function attach(files: FileList | null, payer: string) {
    for (const original of Array.from(files ?? []).slice(0, 10 - proofs.length)) {
      setUploading(original.name); setProofError("");
      try {
        const file = await shrinkPhoto(original);
        const body = new FormData(); body.set("file", file); body.set("payee", payer || "INCOME"); body.set("folder", "income");
        const r = await fetch("/api/staff/expense-receipts", { method: "POST", body });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? "Could not upload the proof.");
        setProofs((all) => [...all, b as Proof]);
      } catch (e) { setProofError(e instanceof Error ? e.message : "Could not upload the proof."); }
      finally { setUploading(""); }
    }
  }
  async function save(rebate: boolean) {
    if (!form) return;
    const amount = toCentavos(form.amount);
    const payer = rebate ? chosenPartners[0] ?? "" : form.payer.trim();
    const problem = !amount ? "Enter the amount received." : form.channel !== "Cash" && !form.reference.trim() ? "Enter the reference number." : !proofs.length ? "Attach the proof photo." : !rebate && payer.length < 2 ? "Enter who paid." : "";
    if (problem) { setProofError(problem); return; }
    const notes = rebate && amount !== chosenTotal ? [`Rebates due ${pesos2(chosenTotal)}; received ${pesos2(amount)}.`, form.notes.trim()].filter(Boolean).join(" ") : form.notes.trim();
    const ok = await post({ action: "income-record", source: rebate ? "Endorsement Rebate" : form.source, payer, amountCentavos: amount, channel: form.channel, reference: form.reference.trim(), receivedOn: form.date, notes, proofFiles: proofs, enrollmentIds: rebate ? chosen.map((r) => r.e.id) : [] },
      rebate ? `Recorded ${pesos2(amount)} from ${payer} for ${chosen.length} trainee${chosen.length === 1 ? "" : "s"}.` : `Recorded ${pesos2(amount)} ${form.source.toLowerCase()} from ${payer}.`);
    if (ok) { setForm(null); setPicked(new Set()); setProofs([]); }
  }

  const formView = (rebate: boolean) => form && <div className="oi-form">
    <h3>{rebate ? `Record Rebate Received · ${chosenPartners[0] ?? ""}` : "Record Income"}</h3>
    <div className="pm-form">
      {!rebate && <><label>Source<select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Received From<input value={form.payer} maxLength={160} onChange={(e) => setForm({ ...form, payer: e.target.value })} placeholder="e.g. Harbor Review Center" /></label></>}
      <label>Amount Received (PHP)<input className="cx-mono" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
      <label>Channel<select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>{channels.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Reference No.<input className="cx-mono" value={form.reference} maxLength={80} onChange={(e) => setForm({ ...form, reference: e.target.value.toUpperCase() })} placeholder={form.channel === "Cash" ? "Not needed for cash" : "Required"} /></label>
      <label>Date Received<input type="date" value={form.date} max={today} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
      <label className="oi-wide">Notes<input value={form.notes} maxLength={300} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" /></label>
      <div className="oi-wide cx-receipts">
        <label className="cx-receipts-pick">Proof Photo (Required)<input type="file" accept="image/*,application/pdf" multiple disabled={!!uploading} onChange={(e) => { void attach(e.target.files, rebate ? chosenPartners[0] ?? "" : form.payer); e.target.value = ""; }} /></label>
        {(proofs.length > 0 || uploading) && <ul>{proofs.map((p) => <li key={p.fileId}><a href={p.link} target="_blank" rel="noreferrer">✓ {p.name}</a><button type="button" className="portal-secondary" onClick={() => setProofs((all) => all.filter((q) => q.fileId !== p.fileId))}>Remove</button></li>)}{uploading && <li><span>Uploading {uploading}…</span></li>}</ul>}
        <small>Deposit slip, transfer screenshot or official receipt. Saved in Google Drive.</small>
      </div>
    </div>
    {rebate && toCentavos(form.amount) > 0 && toCentavos(form.amount) !== chosenTotal && <p className="oi-warn">The amount differs from the {pesos2(chosenTotal)} due; the difference is noted on the income record.</p>}
    {proofError && <p className="oi-err">{proofError}</p>}
    <div className="pm-actions"><span /><span className="cx-acts"><button type="button" className="portal-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="portal-primary" disabled={busy || !!uploading} onClick={() => void save(rebate)}>{busy ? "Saving…" : "Save · Issue Income No."}</button></span></div>
  </div>;

  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">{canRecord ? "Accounting" : "Transactions"}</span><h1>Other Income</h1></div>
      <div className="cx-seg">{(["Endorsement Rebates", "Other Income"] as const).map((t) => <button key={t} type="button" className={tab === t ? "on" : ""} onClick={() => { setTab(t); setForm(null); }}>{t}</button>)}</div></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="cx-tiles ac-tiles">
      <div className="cx-tile"><span>Rebates Due From Partners</span><b>{pesos2(due.reduce((s, r) => s + r.rebate, 0))}</b><small>{due.length} endorsed trainee{due.length === 1 ? "" : "s"}</small></div>
      <div className="cx-tile"><span>Other Income This Month</span><b>{pesos2(thisMonth.reduce((s, i) => s + Number(i.amount_centavos), 0))}</b><small>{thisMonth.length} receipt{thisMonth.length === 1 ? "" : "s"}</small></div>
      <div className="cx-tile"><span>Oldest Rebate Due</span><b>{oldest ? fmtDate(oldest) : "—"}</b><small>{oldest ? "training date" : "nothing due"}</small></div>
    </div>

    {tab === "Endorsement Rebates" ? <section className="portal-panel cx-panel">
      <div className="panel-heading"><h2>Endorsement Rebates</h2><small>{canRecord ? "Tick the trainees the partner paid for, then Record Received" : "View only"}</small></div>
      {partners.length ? partners.map((p) => { const rows = endorsed.filter((r) => r.partner === p); const pd = rows.filter((r) => !r.income); return <div key={p} className="oi-partner">
        <div className="oi-partner-head"><b>{p}</b><span className="cx-mono">{pd.length ? `${pesos2(pd.reduce((s, r) => s + r.rebate, 0))} due · ${pd.length}` : "All received"}</span></div>
        <div className="portal-table"><table><thead><tr>{canRecord && <th />}<th>Trainee</th><th>Course</th><th>Training Date</th><th className="r">Rebate</th><th>Status</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.e.id} className={picked.has(r.e.id) ? "oi-sel" : r.income ? "oi-done" : ""}>
            {canRecord && <td>{!r.income && <input type="checkbox" aria-label={`Select ${r.trainee}`} checked={picked.has(r.e.id)} onChange={() => { const next = new Set(picked); if (next.has(r.e.id)) next.delete(r.e.id); else next.add(r.e.id); setPicked(next); setForm(null); }} />}</td>}
            <td><strong>{r.trainee}</strong><small className="tc-mono">{r.number} · {r.e.enrollment_number}</small></td>
            <td>{r.course}</td><td className="tc-nowrap">{r.date ? fmtDate(r.date) : "—"}</td>
            <td className="r cx-mono"><strong>{pesos2(r.rebate)}</strong></td>
            <td>{r.income ? <><Badge tone="green">Received</Badge><small className="tc-mono">{r.income}</small></> : <Badge tone="orange">Due</Badge>}</td>
          </tr>)}
        </tbody></table></div>
      </div>; }) : <p className="portal-empty-copy">No endorsed trainee with a rebate yet. Rebates come from each endorsed course&apos;s rebate in Endorsed Rates.</p>}
      {canRecord && endorsed.length > 0 && <div className="rb3-bar on"><span>{picked.size ? <>{picked.size} selected · <b className="cx-mono">{pesos2(chosenTotal)}</b>{chosenPartners.length > 1 && <span className="oi-err-inline"> · choose one partner at a time</span>}</> : "Nothing selected"}</span>
        <button type="button" className="portal-primary" disabled={!picked.size || chosenPartners.length > 1} onClick={() => open(chosenTotal)}>Record Received</button></div>}
      {formView(true)}
    </section> : <section className="portal-panel cx-panel">
      <div className="panel-heading"><h2>Other Income</h2>{canRecord && !form ? <button type="button" className="portal-primary" onClick={() => open(0)}>Record Income</button> : <small>All income received outside trainee fees</small>}</div>
      {formView(false)}
      {incomes.length ? <div className="portal-table"><table><thead><tr><th>Income No.</th><th>Date</th><th>Source</th><th>Received From</th><th>Channel</th><th className="r">Amount</th><th>Proof</th>{canVoid && <th />}</tr></thead><tbody>
        {incomes.map((i) => <tr key={i.id} className={i.voided_at ? "oi-done" : ""}>
          <td className="cx-mono"><strong>{i.income_number}</strong></td><td className="tc-nowrap">{fmtDate(i.received_on)}</td>
          <td><Badge tone={i.source === "Endorsement Rebate" ? "blue" : "green"}>{i.source}</Badge></td>
          <td>{i.payer}{i.notes && <small>{i.notes}</small>}</td>
          <td>{i.channel}<small className="tc-mono">{i.reference || "—"}</small></td>
          <td className="r cx-mono">{i.voided_at ? <s>{pesos2(Number(i.amount_centavos))}</s> : <strong>{pesos2(Number(i.amount_centavos))}</strong>}{i.voided_at && <small>VOID · {i.void_reason}</small>}</td>
          <td>{(i.proof_files ?? []).map((p, k) => <a key={p.fileId} className="oi-proof" href={p.link} target="_blank" rel="noreferrer">Proof {k + 1}</a>)}</td>
          {canVoid && <td>{!i.voided_at && (voiding === i.id
            ? <span className="oi-void"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason for the void" /><button type="button" className="portal-secondary" disabled={busy || reason.trim().length < 5} onClick={() => void post({ action: "income-void", id: i.id, reason: reason.trim() }, `${i.income_number} voided.`).then((ok) => { if (ok) { setVoiding(null); setReason(""); } })}>Void</button><button type="button" className="pm-link" onClick={() => setVoiding(null)}>Keep</button></span>
            : <button type="button" className="pm-link cm-remove" onClick={() => { setVoiding(i.id); setReason(""); }}>Void</button>)}</td>}
        </tr>)}
      </tbody></table></div> : <p className="portal-empty-copy">No other income recorded yet.</p>}
    </section>}
    <p className="ac-note">Endorsement rebates are what partner centers pay New Wave for trainees endorsed to them. Every receipt gets an income number and a proof photo in Google Drive, and appears in the Daily Summary Report under Other Income. Cash received counts in the cash drawer at closing.</p>
  </div>;
}
