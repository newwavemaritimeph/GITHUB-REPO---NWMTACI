"use client";

import { useMemo, useState } from "react";

/** Loose shapes for the accounting slices of the staff-operations payload. */
type Payment = { method: string; amount_centavos: number; verification_state: string };
type Enrollment = { id: string; enrollment_number: string; selling_price_centavos: number; paid_centavos: number; enrollment_status: string; trainees?: unknown; courses?: unknown };
type Channel = { id: string; code: string; name: string; requires_reference: boolean; allows_proof: boolean; active: boolean };
type Charge = { id: string; name: string; default_amount_centavos: number; active: boolean; used_count: number };
type Agency = { id: string; name: string; contact_name?: string | null; email?: string | null; mobile?: string | null; active: boolean };
type Expense = { id: string; expense_number: string; payee: string; category: string; amount_centavos: number; status: string; created_at: string };
type Payable = { id: string; description: string; amount_centavos: number; due_on?: string | null; status: string };
export type AccountingData = {
  payments: Payment[]; enrollments: Enrollment[]; paymentMethods: Channel[];
  charges: Charge[]; agencies: Agency[]; expenses: Expense[]; payables: Payable[];
};

const pesos = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0 }).format((Number(centavos) || 0) / 100);
const num = (raw: string | null) => (raw == null || raw.trim() === "" ? null : Math.round(Number(raw) * 100));

export function LiveAccounting({ data, role, reload }: { data: AccountingData; role: string; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<"Overview" | "Setup">("Overview");
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
  const receivables = data.enrollments.filter((e) => Number(e.selling_price_centavos) - Number(e.paid_centavos) > 0 && e.enrollment_status !== "Cancelled");
  const receivableTotal = receivables.reduce((sum, e) => sum + (Number(e.selling_price_centavos) - Number(e.paid_centavos)), 0);
  const payableTotal = data.payables.reduce((sum, p) => sum + Number(p.amount_centavos), 0);

  return (
    <div className="portal-page">
      <div className="portal-heading">
        <div><span className="portal-eyebrow">Financial control</span><h1>Accounting</h1><p>Collections, disbursements, receivables, and setup — from the live Supabase ledger.</p></div>
      </div>
      <div className="portal-tabs">
        {(["Overview", "Setup"] as const).map((item) => (
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
              {receivables.slice(0, 50).map((e) => <tr key={e.id}><td><strong>{e.enrollment_number}</strong></td><td>{pesos(e.selling_price_centavos)}</td><td>{pesos(e.paid_centavos)}</td><td><strong>{pesos(Number(e.selling_price_centavos) - Number(e.paid_centavos))}</strong></td></tr>)}
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
