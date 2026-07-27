"use client";

import { useMemo, useRef, useState } from "react";
import { parseCsv, downloadCsv } from "@/lib/csv";

/** Loose shapes for the accounting slices of the staff-operations payload. */
type Payment = { payment_number?: string; method: string; amount_centavos: number; reference_number?: string | null; received_at?: string; verification_state: string };
type Enrollment = { id: string; enrollment_number: string; selling_price_centavos: number; paid_centavos: number; charges_centavos?: number; discounts_centavos?: number; enrollment_status: string; trainees?: unknown; courses?: unknown };
/** Amount due = base price + other charges − rebates/discounts. */
const dueOf = (e: Enrollment) => Number(e.selling_price_centavos) + Number(e.charges_centavos ?? 0) - Number(e.discounts_centavos ?? 0);
type Channel = { id: string; code: string; name: string; requires_reference: boolean; allows_proof: boolean; active: boolean };
type Charge = { id: string; name: string; default_amount_centavos: number; active: boolean; used_count: number };
type Agency = { id: string; name: string; contact_name?: string | null; email?: string | null; mobile?: string | null; active: boolean };
type Expense = { id: string; expense_number: string; payee: string; category: string; amount_centavos: number; status: string; created_at: string };
type Payable = { id: string; description: string; amount_centavos: number; due_on?: string | null; status: string };
type Course = { id: string; code: string; name: string; delivery_type: string; standard_price_centavos: number };
type CenterRef = { name: string };
type CourseRef = { name: string; code?: string };
type Offer = { id: string; course_id?: string; duration_label: string; training_fee_centavos: number; rebate_centavos: number; partner_payable_centavos: number; partner_centers?: CenterRef | CenterRef[] | null; courses?: CourseRef | CourseRef[] | null };
export type AccountingData = {
  payments: Payment[]; enrollments: Enrollment[]; paymentMethods: Channel[];
  charges: Charge[]; agencies: Agency[]; expenses: Expense[]; payables: Payable[];
  courses: Course[]; offers: Offer[];
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaDay = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(value)) : "");
/** Inclusive [from,to] Manila-day range for Daily / Weekly (last 7d) / Monthly (this month). */
function rangeFor(span: "Daily" | "Weekly" | "Monthly"): { from: string; to: string } {
  const today = manilaDay(new Date().toISOString());
  if (span === "Daily") return { from: today, to: today };
  if (span === "Weekly") { const d = new Date(); d.setDate(d.getDate() - 6); return { from: manilaDay(d.toISOString()), to: today }; }
  return { from: today.slice(0, 8) + "01", to: today };
}

const pesos = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0 }).format((Number(centavos) || 0) / 100);
const num = (raw: string | null) => (raw == null || raw.trim() === "" ? null : Math.round(Number(raw) * 100));

export function LiveAccounting({ data, role, reload }: { data: AccountingData; role: string; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<"Overview" | "Sales" | "Pricelist" | "Vouchers" | "Reconciliation" | "Setup">("Overview");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canManage = role === "admin" || role === "accounting";

  async function post(body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The action could not be completed.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action could not be completed.");
    } finally { setBusy(false); }
  }

  const collections = useMemo(() => {
    const byChannel = new Map<string, { total: number; count: number }>();
    for (const payment of data.payments) {
      const key = payment.method || "Other";
      const entry = byChannel.get(key) ?? { total: 0, count: 0 };
      entry.total += Number(payment.amount_centavos); entry.count += 1; byChannel.set(key, entry);
    }
    return [...byChannel.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [data.payments]);
  const collectionTotal = collections.reduce((sum, [, v]) => sum + v.total, 0);
  const disbursements = data.expenses.filter((e) => e.status === "Paid" || e.status === "Approved");
  const disbursementTotal = disbursements.reduce((sum, e) => sum + Number(e.amount_centavos), 0);
  const receivables = data.enrollments.filter((e) => dueOf(e) - Number(e.paid_centavos) > 0 && e.enrollment_status !== "Cancelled");
  const receivableTotal = receivables.reduce((sum, e) => sum + (dueOf(e) - Number(e.paid_centavos)), 0);
  const payableTotal = data.payables.reduce((sum, p) => sum + Number(p.amount_centavos), 0);

  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div><span className="portal-eyebrow">Financial control</span><h1>Accounting</h1><p>Collections, disbursements, receivables, and setup — from the live Supabase ledger.</p></div>
      </div>
      <div className="portal-tabs">
        {(["Overview", "Sales", "Pricelist", "Vouchers", "Reconciliation", "Setup"] as const).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {message && <div className="portal-message error" role="alert">{message}</div>}

      {tab === "Overview" && (
        <>
          <div className="finance-hero">
            <div><span>Collections</span><strong>{pesos(collectionTotal)}</strong><small>{data.payments.length} posted payments</small></div>
            <article><span>Disbursements</span><strong>{pesos(disbursementTotal)}</strong><small>{disbursements.length} paid/approved</small></article>
            <article><span>Net</span><strong>{pesos(collectionTotal - disbursementTotal)}</strong><small>Collections − disbursements</small></article>
            <article><span>Receivables</span><strong>{pesos(receivableTotal)}</strong><small>{receivables.length} open balances</small></article>
          </div>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Collections by channel</h2><p>Posted payments grouped by method</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Channel</th><th>Payments</th><th>Total</th></tr></thead><tbody>
              {collections.map(([name, v]) => <tr key={name}><td><strong>{name}</strong></td><td>{v.count}</td><td>{pesos(v.total)}</td></tr>)}
              {!collections.length && <tr><td colSpan={3}><span className="portal-empty-copy">No payments yet.</span></td></tr>}
            </tbody></table></div>
          </section>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Receivables ageing</h2><p>Open enrollment balances</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Enrollment</th><th>Charged</th><th>Paid</th><th>Balance</th></tr></thead><tbody>
              {receivables.slice(0, 50).map((e) => <tr key={e.id}><td><strong>{e.enrollment_number}</strong>{(Number(e.charges_centavos ?? 0) > 0 || Number(e.discounts_centavos ?? 0) > 0) && <small>{Number(e.charges_centavos ?? 0) > 0 ? `+${pesos(e.charges_centavos ?? 0)} charges` : ""}{Number(e.discounts_centavos ?? 0) > 0 ? ` −${pesos(e.discounts_centavos ?? 0)} rebate` : ""}</small>}</td><td>{pesos(dueOf(e))}</td><td>{pesos(e.paid_centavos)}</td><td><strong>{pesos(dueOf(e) - Number(e.paid_centavos))}</strong></td></tr>)}
              {!receivables.length && <tr><td colSpan={4}><span className="portal-empty-copy">Every enrollment is settled.</span></td></tr>}
            </tbody></table></div>
          </section>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Monthly payables — reminder</h2><p>Recurring bills due</p></div><span>{pesos(payableTotal)}</span></div>
            <div className="portal-table"><table><thead><tr><th>Payable</th><th>Due</th><th>Status</th><th>Amount</th></tr></thead><tbody>
              {data.payables.map((p) => <tr key={p.id}><td>{p.description}</td><td>{p.due_on ?? "—"}</td><td>{p.status}</td><td>{pesos(p.amount_centavos)}</td></tr>)}
              {!data.payables.length && <tr><td colSpan={4}><span className="portal-empty-copy">No payables recorded.</span></td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}

      {tab === "Vouchers" && (
        <section className="portal-panel">
          <div className="panel-heading">
            <div><h2>Expense vouchers</h2><p>Raise a voucher; Accounting approves, rejects, or marks it paid.</p></div>
            <button className="portal-primary" disabled={busy} onClick={() => {
              const payee = window.prompt("Payee?"); if (!payee) return;
              const category = window.prompt("Category? (e.g. Supplies, Utilities)", "Supplies"); if (!category) return;
              const amt = num(window.prompt("Amount (PHP)?")); if (!amt) return;
              const purpose = window.prompt("Purpose / description?"); if (!purpose) return;
              void post({ action: "expense-create", payee, category, amountCentavos: amt, purpose });
            }}>+ Raise voucher</button>
          </div>
          <div className="portal-table"><table><thead><tr><th>Voucher</th><th>Payee</th><th>Category</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
            {data.expenses.map((e) => (
              <tr key={e.id}>
                <td><strong>{e.expense_number}</strong></td>
                <td>{e.payee}</td>
                <td>{e.category}</td>
                <td>{pesos(e.amount_centavos)}</td>
                <td>{e.status}</td>
                <td className="document-actions">
                  {canManage && e.status === "Pending" && <button disabled={busy} onClick={() => post({ action: "expense-decide", id: e.id, decision: "Approved" })}>Approve</button>}
                  {canManage && e.status === "Pending" && <button disabled={busy} onClick={() => post({ action: "expense-decide", id: e.id, decision: "Rejected" })}>Reject</button>}
                  {canManage && e.status === "Approved" && <button disabled={busy} onClick={() => post({ action: "expense-decide", id: e.id, decision: "Paid" })}>Mark paid</button>}
                </td>
              </tr>
            ))}
            {!data.expenses.length && <tr><td colSpan={6}><span className="portal-empty-copy">No vouchers yet.</span></td></tr>}
          </tbody></table></div>
        </section>
      )}

      {tab === "Sales" && <SalesReport payments={data.payments} payables={data.payables} />}

      {tab === "Pricelist" && <Pricelist data={data} canManage={canManage} busy={busy} post={post} />}

      {tab === "Reconciliation" && <Reconciliation payments={data.payments} channels={data.paymentMethods} />}

      {tab === "Setup" && (
        <>
          {!canManage && <div className="portal-message error">Only Admin and Accounting can edit setup.</div>}
          <SetupList title="Payment channels" description="Modes offered at the cashier" rows={data.paymentMethods.map((c) => ({ id: c.id, primary: c.name, secondary: `${c.requires_reference ? "Reference required" : "No reference"} · ${c.code}`, active: c.active }))}
            canManage={canManage} busy={busy}
            onAdd={() => { const name = window.prompt("Channel name?"); if (name) void post({ action: "channel-save", name, requiresReference: window.confirm("Requires a reference number? OK = yes"), allowsProof: true }); }}
            onEdit={(id, cur) => { const name = window.prompt("Channel name?", cur); if (name) void post({ action: "channel-save", id, name, requiresReference: window.confirm("Requires a reference number? OK = yes"), allowsProof: true }); }}
            onArchive={(id, active, name) => post({ action: "channel-save", id, name, active: !active })} />

          <SetupList title="Other charges" description="Uniform, reprinting, make-up, etc." rows={data.charges.map((c) => ({ id: c.id, primary: c.name, secondary: `Default ${pesos(c.default_amount_centavos)}`, active: c.active }))}
            canManage={canManage} busy={busy}
            onAdd={() => { const name = window.prompt("Charge name?"); if (!name) return; const amt = num(window.prompt("Default amount (PHP)?", "0")); void post({ action: "charge-save", name, defaultAmountCentavos: amt ?? 0 }); }}
            onEdit={(id, cur) => { const name = window.prompt("Charge name?", cur); if (!name) return; const amt = num(window.prompt("Default amount (PHP)?", "0")); void post({ action: "charge-save", id, name, defaultAmountCentavos: amt ?? 0 }); }}
            onArchive={(id, active, name) => post({ action: "charge-save", id, name, active: !active })} />

          <SetupList title="Marketing agencies" description="Referring consultancies" rows={data.agencies.map((a) => ({ id: a.id, primary: a.name, secondary: [a.contact_name, a.email, a.mobile].filter(Boolean).join(" · ") || "—", active: a.active }))}
            canManage={canManage} busy={busy}
            onAdd={() => { const name = window.prompt("Agency name?"); if (name) void post({ action: "agency-save", name }); }}
            onEdit={(id, cur) => { const name = window.prompt("Agency name?", cur); if (name) void post({ action: "agency-save", id, name }); }}
            onArchive={(id, active, name) => post({ action: "agency-save", id, name, active: !active })} />

          <SetupList title="Monthly payables" description="Recurring bills (rent, utilities, remittances)" rows={data.payables.map((p) => ({ id: p.id, primary: p.description, secondary: `${pesos(p.amount_centavos)}${p.due_on ? ` · due ${p.due_on}` : ""}`, active: true }))}
            canManage={canManage} busy={busy} removable
            onAdd={() => { const description = window.prompt("Payable description?"); if (!description) return; const amt = num(window.prompt("Amount (PHP)?")); if (!amt) return; const dueOn = window.prompt("Due date (YYYY-MM-DD, optional)?") || null; void post({ action: "payable-save", description, amountCentavos: amt, dueOn }); }}
            onEdit={(id, cur) => { const description = window.prompt("Payable description?", cur); if (!description) return; const amt = num(window.prompt("Amount (PHP)?")); if (!amt) return; void post({ action: "payable-save", id, description, amountCentavos: amt }); }}
            onRemove={(id) => { if (window.confirm("Remove this payable?")) void post({ action: "payable-save", id, description: "x", remove: true }); }} />
        </>
      )}
    </div>
  );
}

/* ---- Date-sensitive sales + payables ---- */
function SalesReport({ payments, payables }: { payments: Payment[]; payables: Payable[] }) {
  const [span, setSpan] = useState<"Daily" | "Weekly" | "Monthly">("Daily");
  const view = useMemo(() => {
    const { from, to } = rangeFor(span);
    const inRange = payments.filter((p) => { const d = manilaDay(p.received_at); return d >= from && d <= to; });
    const byChannel = new Map<string, { total: number; count: number }>();
    for (const p of inRange) { const k = p.method || "Other"; const e = byChannel.get(k) ?? { total: 0, count: 0 }; e.total += Number(p.amount_centavos); e.count += 1; byChannel.set(k, e); }
    const duePayables = payables.filter((p) => p.due_on && p.due_on >= from && p.due_on <= to);
    return { from, to, total: inRange.reduce((s, p) => s + Number(p.amount_centavos), 0), count: inRange.length, channels: [...byChannel.entries()].sort((a, b) => b[1].total - a[1].total), duePayables, payableTotal: duePayables.reduce((s, p) => s + Number(p.amount_centavos), 0) };
  }, [payments, payables, span]);

  return (
    <>
      <div className="portal-tabs" style={{ marginTop: -4 }}>
        {(["Daily", "Weekly", "Monthly"] as const).map((s) => <button key={s} className={span === s ? "active" : ""} onClick={() => setSpan(s)}>{s}</button>)}
      </div>
      <div className="finance-hero">
        <div><span>Sales · {span}</span><strong>{pesos(view.total)}</strong><small>{view.from} → {view.to}</small></div>
        <article><span>Payments</span><strong>{view.count}</strong><small>posted in range</small></article>
        <article><span>Payables due</span><strong>{pesos(view.payableTotal)}</strong><small>{view.duePayables.length} in range</small></article>
      </div>
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Sales by channel</h2><p>Collections {view.from} → {view.to}</p></div><span>{pesos(view.total)}</span></div>
        <div className="portal-table"><table><thead><tr><th>Channel</th><th>Payments</th><th>Total</th></tr></thead><tbody>
          {view.channels.map(([name, v]) => <tr key={name}><td><strong>{name}</strong></td><td>{v.count}</td><td>{pesos(v.total)}</td></tr>)}
          {!view.channels.length && <tr><td colSpan={3}><span className="portal-empty-copy">No sales in this period.</span></td></tr>}
        </tbody></table></div>
      </section>
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Payables due in period</h2><p>Recurring bills with a due date in range</p></div><span>{pesos(view.payableTotal)}</span></div>
        <div className="portal-table"><table><thead><tr><th>Payable</th><th>Due</th><th>Status</th><th>Amount</th></tr></thead><tbody>
          {view.duePayables.map((p) => <tr key={p.id}><td>{p.description}</td><td>{p.due_on}</td><td>{p.status}</td><td>{pesos(p.amount_centavos)}</td></tr>)}
          {!view.duePayables.length && <tr><td colSpan={4}><span className="portal-empty-copy">No payables due in this period.</span></td></tr>}
        </tbody></table></div>
      </section>
    </>
  );
}

/* ---- Small styled modal (replaces native window.prompt) ---- */
function EditModal({ title, subtitle, children, onClose, onSave, saveLabel = "Save changes", busy }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void; onSave: () => void; saveLabel?: string; busy?: boolean }) {
  return (
    <div className="portal-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="portal-modal" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
        <header><div><span className="portal-eyebrow">Accounting · pricing</span><h2 id="edit-modal-title">{title}</h2>{subtitle && <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 13 }}>{subtitle}</p>}</div><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
        <form className="portal-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          {children}
          <div className="portal-form-actions full"><button type="button" className="portal-secondary" onClick={onClose}>Cancel</button><button type="submit" className="portal-primary" disabled={busy}>{busy ? "Saving…" : saveLabel}</button></div>
        </form>
      </section>
    </div>
  );
}

type PriceEdit = { kind: "course"; id: string; label: string; price: string } | { kind: "offer"; id: string; label: string; fee: string; rebate: string };

/* ---- Pricelist: course prices + endorsed-offer rates/rebates ---- */
function Pricelist({ data, canManage, busy, post }: { data: AccountingData; canManage: boolean; busy: boolean; post: (body: Record<string, unknown>) => Promise<void> }) {
  const [edit, setEdit] = useState<PriceEdit | null>(null);
  const [error, setError] = useState("");
  const pesoFromInput = (raw: string) => { const n = Number(raw); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

  async function save() {
    if (!edit) return;
    setError("");
    if (edit.kind === "course") {
      const price = pesoFromInput(edit.price);
      if (price == null) { setError("Enter a valid price."); return; }
      await post({ action: "course-price-save", courseId: edit.id, priceCentavos: price });
    } else {
      const fee = pesoFromInput(edit.fee); const rebate = pesoFromInput(edit.rebate);
      if (fee == null || rebate == null) { setError("Enter valid amounts."); return; }
      if (rebate > fee) { setError("Rebate cannot exceed the training fee."); return; }
      await post({ action: "offer-rate-save", offerId: edit.id, trainingFeeCentavos: fee, rebateCentavos: rebate });
    }
    setEdit(null);
  }

  return (
    <>
      {!canManage && <div className="portal-message error">Only Admin and Accounting can edit pricing.</div>}
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Training pricelist</h2><p>Standard course prices (applies to new enrollments)</p></div></div>
        <div className="portal-table"><table><thead><tr><th>Course</th><th>Type</th><th>Price</th><th></th></tr></thead><tbody>
          {data.courses.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.name}</strong><small>{c.code}</small></td>
              <td>{c.delivery_type}</td>
              <td>{pesos(c.standard_price_centavos)}</td>
              <td className="document-actions">{canManage && <button disabled={busy} onClick={() => { setError(""); setEdit({ kind: "course", id: c.id, label: c.name, price: String(c.standard_price_centavos / 100) }); }}>Edit price</button>}</td>
            </tr>
          ))}
          {!data.courses.length && <tr><td colSpan={4}><span className="portal-empty-copy">No courses.</span></td></tr>}
        </tbody></table></div>
      </section>

      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Endorsement rates &amp; rebates</h2><p>Partner-endorsed offers — training fee, New Wave rebate, partner payable</p></div></div>
        <div className="portal-table"><table><thead><tr><th>Course · Center</th><th>Duration</th><th>Training fee</th><th>Rebate</th><th>Partner payable</th><th></th></tr></thead><tbody>
          {data.offers.map((o) => {
            const center = one(o.partner_centers)?.name ?? "—"; const course = data.courses.find((c) => c.id === o.course_id)?.name ?? one(o.courses)?.name ?? "—";
            return <tr key={o.id}>
              <td><strong>{course}</strong><small>{center}</small></td>
              <td>{o.duration_label}</td>
              <td>{pesos(o.training_fee_centavos)}</td>
              <td>{pesos(o.rebate_centavos)}</td>
              <td>{pesos(o.partner_payable_centavos)}</td>
              <td className="document-actions">{canManage && <button disabled={busy} onClick={() => { setError(""); setEdit({ kind: "offer", id: o.id, label: `${course} · ${center}`, fee: String(o.training_fee_centavos / 100), rebate: String(o.rebate_centavos / 100) }); }}>Edit rate</button>}</td>
            </tr>;
          })}
          {!data.offers.length && <tr><td colSpan={6}><span className="portal-empty-copy">No endorsed offers.</span></td></tr>}
        </tbody></table></div>
      </section>

      {edit && edit.kind === "course" && (
        <EditModal title="Edit course price" subtitle={edit.label} busy={busy} onClose={() => setEdit(null)} onSave={save}>
          {error && <div className="portal-message error full">{error}</div>}
          <label className="full">Price (PHP)<input type="number" min="0" step="0.01" autoFocus value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></label>
        </EditModal>
      )}
      {edit && edit.kind === "offer" && (
        <EditModal title="Edit endorsement rate" subtitle={edit.label} busy={busy} onClose={() => setEdit(null)} onSave={save}>
          {error && <div className="portal-message error full">{error}</div>}
          <label>Training fee (PHP)<input type="number" min="0" step="0.01" autoFocus value={edit.fee} onChange={(e) => setEdit({ ...edit, fee: e.target.value })} /></label>
          <label>New Wave rebate (PHP)<input type="number" min="0" step="0.01" value={edit.rebate} onChange={(e) => setEdit({ ...edit, rebate: e.target.value })} /></label>
          <p className="portal-form-note full">Partner payable is computed automatically as fee − rebate: {(() => { const f = Number(edit.fee) || 0; const r = Number(edit.rebate) || 0; return pesos(Math.max(0, Math.round((f - r) * 100))); })()}</p>
        </EditModal>
      )}
    </>
  );
}

/* ---- Bank & GCash reconciliation (session-only; no store/DB writes) ---- */

type BankRow = { line: number; reference: string; amountCentavos: number | null; date: string; raw: string };
const normalizeRef = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();
const parseAmount = (value: string): number | null => {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null;
};
const isoDay = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
};

function Reconciliation({ payments, channels }: { payments: Payment[]; channels: Channel[] }) {
  const active = channels.filter((c) => c.active);
  const [channel, setChannel] = useState(active.find((c) => c.name !== "Cash")?.name ?? active[0]?.name ?? "");
  const [rows, setRows] = useState<BankRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError("");
    try {
      const grid = parseCsv(await file.text());
      if (grid.length < 2) throw new Error("The file has no data rows.");
      const header = grid[0].map((h) => h.trim().toLowerCase());
      const findCol = (keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));
      const refCol = findCol(["reference", "ref no", "ref", "transaction id", "txn", "confirmation"]);
      const amtCol = findCol(["amount", "credit", "value", "paid"]);
      const dateCol = findCol(["date", "time", "posted"]);
      if (refCol === -1 && amtCol === -1) throw new Error("Could not find a Reference or Amount column in the header.");
      const parsed: BankRow[] = grid.slice(1).map((cells, i) => ({
        line: i + 2,
        reference: refCol === -1 ? "" : (cells[refCol] ?? "").trim(),
        amountCentavos: amtCol === -1 ? null : parseAmount(cells[amtCol] ?? ""),
        date: dateCol === -1 ? "" : isoDay((cells[dateCol] ?? "").trim()),
        raw: cells.join(" · "),
      }));
      setRows(parsed);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
      setRows([]); setFileName("");
    }
  }

  const result = useMemo(() => {
    const ledger = payments.filter((p) => p.method === channel);
    const usedLedger = new Set<number>();
    const matched: { bank: BankRow; payment: Payment; via: string }[] = [];
    const bankOnly: BankRow[] = [];
    for (const bank of rows) {
      const bankRef = normalizeRef(bank.reference);
      let idx = -1; let via = "";
      if (bankRef) idx = ledger.findIndex((p, li) => !usedLedger.has(li) && p.reference_number && normalizeRef(p.reference_number) === bankRef);
      if (idx !== -1) via = "reference";
      else if (bank.amountCentavos != null) {
        idx = ledger.findIndex((p, li) => !usedLedger.has(li) && Number(p.amount_centavos) === bank.amountCentavos && (!bank.date || isoDay(p.received_at) === bank.date));
        if (idx !== -1) via = "amount + date";
      }
      if (idx !== -1) { usedLedger.add(idx); matched.push({ bank, payment: ledger[idx], via }); }
      else bankOnly.push(bank);
    }
    const systemOnly = ledger.filter((_, li) => !usedLedger.has(li));
    return { matched, bankOnly, systemOnly, ledgerCount: ledger.length };
  }, [rows, payments, channel]);

  function exportCsv() {
    const out: (string | number)[][] = [["Status", "Reference", "Amount (PHP)", "Date", "Matched via", "Payment no."]];
    for (const m of result.matched) out.push(["Matched", m.bank.reference, ((m.bank.amountCentavos ?? 0) / 100).toFixed(2), m.bank.date, m.via, m.payment.payment_number ?? ""]);
    for (const b of result.bankOnly) out.push(["In bank file only", b.reference, b.amountCentavos == null ? "" : (b.amountCentavos / 100).toFixed(2), b.date, "", ""]);
    for (const p of result.systemOnly) out.push(["In system only", p.reference_number ?? "", (Number(p.amount_centavos) / 100).toFixed(2), isoDay(p.received_at), "", p.payment_number ?? ""]);
    downloadCsv(`reconciliation-${channel}-${isoDay(new Date().toISOString())}.csv`, out);
  }

  return (
    <>
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Bank &amp; GCash reconciliation</h2><p>Upload a channel&apos;s transaction history (CSV) and match it against posted payments. Session-only — nothing is saved.</p></div></div>
        <div className="portal-form" style={{ padding: "4px 0" }}>
          <label>Channel<select value={channel} onChange={(e) => { setChannel(e.target.value); }}>
            {active.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select></label>
          <div className="full" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
            <button className="portal-primary" type="button" onClick={() => fileRef.current?.click()}>Upload transaction history</button>
            {fileName && <span style={{ color: "var(--muted)", fontSize: 13 }}>{fileName} · {rows.length} rows</span>}
            {rows.length > 0 && <button type="button" onClick={exportCsv}>Download reconciliation CSV</button>}
          </div>
        </div>
        {error && <div className="portal-message error" role="alert">{error}</div>}
      </section>

      {rows.length > 0 && (
        <>
          <div className="finance-hero">
            <div><span>Matched</span><strong>{result.matched.length}</strong><small>Bank rows found in the ledger</small></div>
            <article><span>In bank file only</span><strong>{result.bankOnly.length}</strong><small>No posted payment</small></article>
            <article><span>In system only</span><strong>{result.systemOnly.length}</strong><small>Not on the statement</small></article>
            <article><span>Ledger rows</span><strong>{result.ledgerCount}</strong><small>{channel} payments</small></article>
          </div>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>In bank file only</h2><p>Statement rows with no matching posted payment — investigate</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Line</th><th>Reference</th><th>Amount</th><th>Date</th></tr></thead><tbody>
              {result.bankOnly.map((b) => <tr key={b.line}><td>{b.line}</td><td><strong>{b.reference || "—"}</strong></td><td>{b.amountCentavos == null ? "—" : pesos(b.amountCentavos)}</td><td>{b.date || "—"}</td></tr>)}
              {!result.bankOnly.length && <tr><td colSpan={4}><span className="portal-empty-copy">Every statement row matched a payment.</span></td></tr>}
            </tbody></table></div>
          </section>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>In system only</h2><p>Posted {channel} payments not on the uploaded statement</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Payment</th><th>Reference</th><th>Amount</th><th>Date</th></tr></thead><tbody>
              {result.systemOnly.map((p, i) => <tr key={p.payment_number ?? i}><td><strong>{p.payment_number ?? "—"}</strong></td><td>{p.reference_number ?? "—"}</td><td>{pesos(p.amount_centavos)}</td><td>{isoDay(p.received_at) || "—"}</td></tr>)}
              {!result.systemOnly.length && <tr><td colSpan={4}><span className="portal-empty-copy">Every posted payment is on the statement.</span></td></tr>}
            </tbody></table></div>
          </section>

          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Matched</h2><p>Statement rows reconciled to the ledger</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Reference</th><th>Amount</th><th>Date</th><th>Via</th><th>Payment</th></tr></thead><tbody>
              {result.matched.map((m) => <tr key={m.bank.line}><td><strong>{m.bank.reference || "—"}</strong></td><td>{m.bank.amountCentavos == null ? "—" : pesos(m.bank.amountCentavos)}</td><td>{m.bank.date || "—"}</td><td>{m.via}</td><td>{m.payment.payment_number ?? "—"}</td></tr>)}
              {!result.matched.length && <tr><td colSpan={5}><span className="portal-empty-copy">No rows matched — check the channel and file columns.</span></td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}
    </>
  );
}

type SetupRow = { id: string; primary: string; secondary: string; active: boolean };
function SetupList({ title, description, rows, canManage, busy, onAdd, onEdit, onArchive, onRemove, removable }: {
  title: string; description: string; rows: SetupRow[]; canManage: boolean; busy: boolean;
  onAdd: () => void; onEdit: (id: string, current: string) => void;
  onArchive?: (id: string, active: boolean, name: string) => void; onRemove?: (id: string) => void; removable?: boolean;
}) {
  return (
    <section className="portal-panel">
      <div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div>{canManage && <button className="portal-primary" disabled={busy} onClick={onAdd}>+ Add</button>}</div>
      <div className="portal-table"><table><thead><tr><th>Name</th><th>Details</th><th>Status</th><th></th></tr></thead><tbody>
        {rows.map((row) => (
          <tr key={row.id} className={row.active ? "" : "row-muted"}>
            <td><strong>{row.primary}</strong></td>
            <td>{row.secondary}</td>
            <td>{row.active ? "Active" : "Archived"}</td>
            <td className="document-actions">
              {canManage && <button onClick={() => onEdit(row.id, row.primary)} disabled={busy}>Edit</button>}
              {canManage && removable && onRemove && <button onClick={() => onRemove(row.id)} disabled={busy}>Remove</button>}
              {canManage && !removable && onArchive && <button onClick={() => onArchive(row.id, row.active, row.primary)} disabled={busy}>{row.active ? "Archive" : "Restore"}</button>}
            </td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={4}><span className="portal-empty-copy">Nothing yet.</span></td></tr>}
      </tbody></table></div>
    </section>
  );
}
