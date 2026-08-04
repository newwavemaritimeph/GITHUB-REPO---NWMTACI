"use client";

import { useMemo, useState } from "react";

type Trainee = { id: string; trainee_number: string; legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; birthdate: string; email: string; mobile: string; account_state: string; registered_at: string };
type Enrollment = { id: string; enrollment_number: string; trainee_id: string; enrollment_status: string; selling_price_centavos: number; paid_centavos: number; charges_centavos?: number; discounts_centavos?: number; courses?: unknown; batches?: unknown };
type Payment = { id: string; payment_number: string; trainee_id: string; amount_centavos: number; method: string; reference_number?: string | null; received_at: string; verification_state: string };
export type SearchData = { trainees: Trainee[]; enrollments: Enrollment[]; payments: Payment[] };

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const pesos = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0 }).format((Number(centavos) || 0) / 100);
const fullName = (t: Trainee) => `${t.legal_first_name} ${t.legal_middle_name ?? ""} ${t.legal_last_name}`.replace(/\s+/g, " ").trim();
const dueCentavos = (e: Enrollment) => Number(e.selling_price_centavos) + Number(e.charges_centavos ?? 0) - Number(e.discounts_centavos ?? 0);
const when = (value: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(value));

export function LiveSearchTrainee({ data }: { data: SearchData }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return data.trainees
      .filter((t) => `${fullName(t)} ${t.trainee_number} ${t.email} ${t.mobile}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [query, data.trainees]);

  const selected = selectedId ? data.trainees.find((t) => t.id === selectedId) ?? null : null;
  const enrollments = selected ? data.enrollments.filter((e) => e.trainee_id === selected.id) : [];
  const payments = selected ? data.payments.filter((p) => p.trainee_id === selected.id) : [];
  const paidTotal = payments.reduce((s, p) => s + Number(p.amount_centavos), 0);
  const dueTotal = enrollments.reduce((s, e) => s + dueCentavos(e), 0);

  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div><span className="portal-eyebrow">Administration</span><h1>Search trainee</h1><p>Look up any trainee by name, number, email, or mobile — then review their enrollments and payments.</p></div>
      </div>

      <section className="portal-panel">
        <label className="full" style={{ display: "block" }}>
          <span className="portal-eyebrow">Find a trainee</span>
          <input value={query} onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }} placeholder="Type at least 2 characters…" style={{ width: "100%", marginTop: 6 }} />
        </label>
        {query.trim().length >= 2 && !selected && (
          <div className="portal-table" style={{ marginTop: 12 }}><table><thead><tr><th>Trainee</th><th>Number</th><th>Contact</th><th></th></tr></thead><tbody>
            {matches.map((t) => (
              <tr key={t.id}>
                <td><strong>{fullName(t)}</strong></td>
                <td>{t.trainee_number}</td>
                <td className="lc">{t.email}<small>{t.mobile}</small></td>
                <td className="document-actions"><button onClick={() => setSelectedId(t.id)}>Open</button></td>
              </tr>
            ))}
            {!matches.length && <tr><td colSpan={4}><span className="portal-empty-copy">No trainees match that search.</span></td></tr>}
          </tbody></table></div>
        )}
      </section>

      {selected && (
        <>
          <section className="portal-panel">
            <div className="panel-heading">
              <div><h2>{fullName(selected)}</h2><p>{selected.trainee_number} · {selected.account_state}</p></div>
              <button className="portal-secondary" onClick={() => { setSelectedId(null); }}>← Back to results</button>
            </div>
            <div className="finance-hero">
              <div><span>Email</span><strong className="lc" style={{ fontSize: 16 }}>{selected.email}</strong><small>{selected.mobile}</small></div>
              <article><span>Enrollments</span><strong>{enrollments.length}</strong><small>All statuses</small></article>
              <article><span>Total due</span><strong>{pesos(dueTotal)}</strong><small>Price + charges − rebates</small></article>
              <article><span>Total paid</span><strong>{pesos(paidTotal)}</strong><small>{payments.length} payments</small></article>
            </div>
          </section>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Enrollments</h2><p>Courses this trainee is enrolled in</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Enrollment</th><th>Course</th><th>Status</th><th>Due</th><th>Paid</th><th>Balance</th></tr></thead><tbody>
              {enrollments.map((e) => { const c = one(e.courses as { name: string } | { name: string }[] | null | undefined); const due = dueCentavos(e); const paid = Number(e.paid_centavos); const balance = Math.max(0, due - paid); return (
                <tr key={e.id}><td><strong>{e.enrollment_number}</strong></td><td>{c?.name ?? "—"}</td><td>{e.enrollment_status}</td><td>{pesos(due)}</td><td>{pesos(paid)}</td><td><strong>{pesos(balance)}</strong></td></tr>
              ); })}
              {!enrollments.length && <tr><td colSpan={6}><span className="portal-empty-copy">No enrollments on record.</span></td></tr>}
            </tbody></table></div>
          </section>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Payments</h2><p>Posted payment ledger</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Payment</th><th>Method</th><th>Reference</th><th>Received</th><th>State</th><th>Amount</th></tr></thead><tbody>
              {payments.map((p) => (
                <tr key={p.id}><td><strong>{p.payment_number}</strong></td><td>{p.method}</td><td>{p.reference_number || "—"}</td><td>{when(p.received_at)}</td><td>{p.verification_state}</td><td><strong>{pesos(p.amount_centavos)}</strong></td></tr>
              ))}
              {!payments.length && <tr><td colSpan={6}><span className="portal-empty-copy">No payments on record.</span></td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}
    </div>
  );
}
