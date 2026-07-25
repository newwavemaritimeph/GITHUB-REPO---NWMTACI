"use client";

import { useMemo, useState } from "react";

type Payment = { amount_centavos: number; method: string; received_at: string };
type Closing = { id: string; closing_date: string; opening_cash_centavos: number; cash_collections_centavos: number; online_collections_centavos: number; expenses_centavos: number; expected_cash_centavos: number; actual_cash_centavos?: number | null; variance_centavos?: number | null; status: string };
export type ClosingData = { payments: Payment[]; cashierClosings: Closing[] };

const pesos = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format((Number(centavos) || 0) / 100);
const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()); // YYYY-MM-DD

export function LiveCashierClosing({ data, reload }: { data: ClosingData; reload: () => Promise<void> }) {
  const [opening, setOpening] = useState("");
  const [actual, setActual] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const today = todayManila();

  const preview = useMemo(() => {
    const dayPayments = data.payments.filter((p) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(p.received_at)) === today);
    const cash = dayPayments.filter((p) => p.method === "Cash").reduce((s, p) => s + Number(p.amount_centavos), 0);
    const online = dayPayments.filter((p) => p.method !== "Cash").reduce((s, p) => s + Number(p.amount_centavos), 0);
    return { cash, online, count: dayPayments.length };
  }, [data.payments, today]);

  const openingCentavos = Math.round((Number(opening) || 0) * 100);
  const actualCentavos = Math.round((Number(actual) || 0) * 100);
  const expected = openingCentavos + preview.cash; // expenses/refunds are applied server-side on submit
  const variance = actualCentavos - expected;
  const alreadyClosed = data.cashierClosings.some((c) => c.closing_date === today);

  async function submit() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cashier-close", closingDate: today, openingCashCentavos: openingCentavos, actualCashCentavos: actualCentavos, remarks }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not submit the closing.");
      setOpening(""); setActual(""); setRemarks("");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit the closing.");
    } finally { setBusy(false); }
  }

  return (
    <div className="portal-page">
      <div className="portal-heading"><div><span className="portal-eyebrow">Cashier operations</span><h1>Opening / closing</h1><p>Record the opening float and count out the drawer at end of day. Collections are computed from posted payments.</p></div></div>

      <div className="finance-hero">
        <div><span>Expected cash · {today}</span><strong>{pesos(expected)}</strong><small>Opening + cash collections</small></div>
        <article><span>Cash collections</span><strong>{pesos(preview.cash)}</strong><small>{preview.count} payments today</small></article>
        <article><span>Online collections</span><strong>{pesos(preview.online)}</strong><small>Non-cash today</small></article>
        <article><span>Actual counted</span><strong>{pesos(actualCentavos)}</strong><small>As entered below</small></article>
        <article><span>Variance</span><strong style={{ color: variance === 0 ? "var(--green)" : "var(--red)" }}>{pesos(variance)}</strong><small>Actual − expected</small></article>
      </div>

      {message && <div className="portal-message error" role="alert">{message}</div>}

      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Submit today&apos;s closing</h2><p>Paid expenses are deducted from expected cash on submit.</p></div></div>
        <div className="portal-form" style={{ padding: "4px 0" }}>
          <label>Opening cash (PHP)<input type="number" min="0" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" /></label>
          <label>Actual counted cash (PHP)<input type="number" min="0" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="0.00" /></label>
          <label className="full">Remarks<textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
          <div className="full">
            <button className="portal-primary" disabled={busy || !opening || !actual} onClick={submit}>{busy ? "Submitting…" : alreadyClosed ? "Submit another closing" : "Submit closing"}</button>
            {alreadyClosed && <span style={{ marginLeft: 10, color: "var(--muted)", fontSize: 13 }}>A closing for today already exists.</span>}
          </div>
        </div>
      </section>

      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Recent closings</h2><p>Submitted drawer counts</p></div></div>
        <div className="portal-table"><table><thead><tr><th>Date</th><th>Opening</th><th>Cash</th><th>Online</th><th>Expenses</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Status</th></tr></thead><tbody>
          {data.cashierClosings.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.closing_date}</strong></td>
              <td>{pesos(c.opening_cash_centavos)}</td>
              <td>{pesos(c.cash_collections_centavos)}</td>
              <td>{pesos(c.online_collections_centavos)}</td>
              <td>{pesos(c.expenses_centavos)}</td>
              <td>{pesos(c.expected_cash_centavos)}</td>
              <td>{c.actual_cash_centavos == null ? "—" : pesos(c.actual_cash_centavos)}</td>
              <td style={{ color: (c.variance_centavos ?? 0) === 0 ? "var(--green)" : "var(--red)" }}>{c.variance_centavos == null ? "—" : pesos(c.variance_centavos)}</td>
              <td>{c.status}</td>
            </tr>
          ))}
          {!data.cashierClosings.length && <tr><td colSpan={9}><span className="portal-empty-copy">No closings submitted yet.</span></td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}
