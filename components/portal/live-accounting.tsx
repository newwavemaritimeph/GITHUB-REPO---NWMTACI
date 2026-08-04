"use client";

import { useMemo, useRef, useState } from "react";
import { parseCsv, downloadCsv } from "@/lib/csv";
import { LiveCashierClosing, type ClosingData } from "./live-cashier-closing";

/** Loose shapes for the accounting slices of the staff-operations payload. */
type Payment = { payment_number?: string; method: string; amount_centavos: number; reference_number?: string | null; received_at?: string; verification_state: string; trainee_id?: string };
type Enrollment = { id: string; enrollment_number: string; trainee_id?: string; created_at?: string; selling_price_centavos: number; paid_centavos: number; charges_centavos?: number; discounts_centavos?: number; enrollment_status: string; trainees?: unknown; courses?: unknown };
type TraineeRow = { id: string; trainee_number: string; legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; srn?: string | null; email?: string | null; mobile?: string | null };
/** Amount due = base price + other charges − rebates/discounts. */
const dueOf = (e: Enrollment) => Number(e.selling_price_centavos) + Number(e.charges_centavos ?? 0) - Number(e.discounts_centavos ?? 0);
type Channel = { id: string; code: string; name: string; requires_reference: boolean; allows_proof: boolean; active: boolean; kind?: string };
type Charge = { id: string; name: string; default_amount_centavos: number; active: boolean; used_count: number };
type Agency = { id: string; name: string; contact_name?: string | null; email?: string | null; mobile?: string | null; active: boolean };
type Expense = { id: string; expense_number: string; payee: string; category: string; amount_centavos: number; status: string; created_at: string };
type Payable = { id: string; description: string; amount_centavos: number; due_on?: string | null; status: string };
type Course = { id: string; code: string; name: string; delivery_type: string; duration_label?: string; duration_days?: number; training_mode?: string; category_id?: string; standard_price_centavos: number; updated_at?: string };
type CenterRef = { name: string };
type CourseRef = { name: string; code?: string };
type Offer = { id: string; course_id?: string; duration_label: string; training_fee_centavos: number; rebate_centavos: number; partner_payable_centavos: number; updated_at?: string; partner_centers?: CenterRef | CenterRef[] | null; courses?: CourseRef | CourseRef[] | null };
type Category = { id: string; name: string };
type Center = { id: string; name: string; active: boolean };
type AgencyRebate = { id: string; agency_id: string; course_id: string; rebate_centavos: number; updated_at?: string };
type AgencyRebateEntry = { id: string; agency_id: string; enrollment_id: string; course_id: string; rebate_centavos: number; status: string; created_at: string; marketing_agencies?: { name: string } | { name: string }[] | null; courses?: { name: string } | { name: string }[] | null; trainees?: { legal_first_name: string; legal_last_name: string } | { legal_first_name: string; legal_last_name: string }[] | null };
type InventoryItem = { id: string; name: string; category?: string | null; unit: string; quantity_on_hand: number; unit_value_centavos: number; active: boolean };
type InventoryMovement = { id: string; item_id: string; movement_type: string; quantity: number; remarks?: string | null; created_at: string; inventory_items?: { name: string } | { name: string }[] | null };
type NameRef = { legal_first_name: string; legal_last_name: string };
type PendingDiscount = { id: string; enrollment_id: string; description: string; amount_centavos: number; agency_id?: string | null; created_at: string; enrollments?: { enrollment_number: string; trainees?: NameRef | NameRef[] | null; courses?: CourseRef | CourseRef[] | null } | null; marketing_agencies?: { name: string } | { name: string }[] | null };
export type AccountingData = {
  payments: Payment[]; enrollments: Enrollment[]; paymentMethods: Channel[];
  charges: Charge[]; agencies: Agency[]; expenses: Expense[]; payables: Payable[];
  courses: Course[]; offers: Offer[]; courseCategories: Category[]; partnerCenters: Center[];
  agencyCourseRebates: AgencyRebate[]; agencyRebates: AgencyRebateEntry[];
  expenseCategories: { id: string; name: string; active: boolean }[];
  inventoryItems: InventoryItem[]; inventoryMovements: InventoryMovement[];
  cashierClosings: { id: string; closing_date: string; opening_cash_centavos: number; cash_collections_centavos: number; online_collections_centavos: number; expenses_centavos: number; expected_cash_centavos: number; actual_cash_centavos?: number | null; variance_centavos?: number | null; status: string }[];
  trainees: TraineeRow[];
  pendingDiscounts: PendingDiscount[];
  pendingCharges: { id: string; enrollment_id: string; description: string; amount_centavos: number; created_at: string; enrollments?: { enrollment_number: string; trainees?: { legal_first_name: string; legal_last_name: string } | { legal_first_name: string; legal_last_name: string }[] | null; courses?: CourseRef | CourseRef[] | null } | { enrollment_number: string; trainees?: { legal_first_name: string; legal_last_name: string } | { legal_first_name: string; legal_last_name: string }[] | null; courses?: CourseRef | CourseRef[] | null }[] | null }[];
  announcements: { id: string; title: string; body: string; audience_roles: string[]; expires_at?: string | null }[];
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

export function LiveAccounting({ data, role, reload }: { data: AccountingData; role: string; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<"Dashboard" | "Sales" | "Reconciliation" | "Cashier closing" | "Setup">(role === "admin" || role === "accounting" ? "Dashboard" : "Cashier closing");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canManage = role === "admin" || role === "accounting";
  const today = manilaDay(new Date().toISOString());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const inRange = (v?: string | null) => { const d = manilaDay(v); return !!d && d >= from && d <= to; };
  const enrollInRange = data.enrollments.filter((e) => inRange(e.created_at));
  const salesInRange = data.payments.filter((p) => inRange(p.received_at)).reduce((s, p) => s + Number(p.amount_centavos), 0);
  const expensesInRange = data.expenses.filter((e) => (e.status === "Paid" || e.status === "Approved") && inRange(e.created_at)).reduce((s, e) => s + Number(e.amount_centavos), 0);
  const netSales = salesInRange - expensesInRange;
  const courseCounts = new Map<string, number>();
  for (const e of enrollInRange) { const n = one(e.courses as CourseRef | CourseRef[] | null)?.name ?? "Unknown"; courseCounts.set(n, (courseCounts.get(n) ?? 0) + 1); }
  const topCourses = [...courseCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const agencyCounts = new Map<string, number>();
  for (const r of data.agencyRebates.filter((r) => inRange(r.created_at))) { const n = one(r.marketing_agencies)?.name ?? "Unknown"; agencyCounts.set(n, (agencyCounts.get(n) ?? 0) + 1); }
  const topAgencies = [...agencyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const pendingBalances = data.enrollments.filter((e) => e.enrollment_status !== "Cancelled" && dueOf(e) - Number(e.paid_centavos) > 0);

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
        {(canManage ? ["Dashboard", "Sales", "Reconciliation", "Cashier closing", "Setup"] : ["Cashier closing"]).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item as typeof tab)}>{item}</button>
        ))}
      </div>
      {message && <div className="portal-message error" role="alert">{message}</div>}

      {tab === "Dashboard" && (
        <>
          {data.announcements.length > 0 && <section className="portal-panel live-list" style={{ marginBottom: 16 }}><div className="panel-heading"><div><h2>📣 Announcements</h2></div></div>{data.announcements.slice(0, 5).map((a) => <div className="live-row-item" key={a.id}><div><strong>{a.title}</strong><small>{a.body}</small></div></div>)}</section>}
          <section className="portal-panel" style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 13, color: "var(--muted)" }}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 13, color: "var(--muted)" }}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <span className="portal-empty-copy" style={{ margin: 0 }}>{from} → {to}</span>
          </section>
          <div className="finance-hero">
            <div><span>Net sales</span><strong>{pesos(netSales)}</strong><small>Sales − expenses</small></div>
            <article><span>Sales</span><strong>{pesos(salesInRange)}</strong><small>Payments in range</small></article>
            <article><span>Expenses</span><strong>{pesos(expensesInRange)}</strong><small>Approved / paid</small></article>
            <article><span>Enrollments</span><strong>{enrollInRange.length}</strong><small>New in range</small></article>
          </div>
          <div className="dashboard-panels">
            <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Most enrolled courses</h2><p>Top courses in range</p></div></div>{topCourses.map(([name, n]) => <div className="live-row-item" key={name}><div><strong>{name}</strong></div><span className="slot-count">{n}</span></div>)}{!topCourses.length && <p className="portal-empty-copy">No enrollments in range.</p>}</section>
            <section className="portal-panel live-list"><div className="panel-heading"><div><h2>Top agencies</h2><p>Most rebated enrollments in range</p></div></div>{topAgencies.map(([name, n]) => <div className="live-row-item" key={name}><div><strong>{name}</strong></div><span className="slot-count">{n}</span></div>)}{!topAgencies.length && <p className="portal-empty-copy">No agency-tagged enrollments in range.</p>}</section>
          </div>
          <section className="portal-panel"><div className="panel-heading"><div><h2>Trainees with pending balances</h2><p>Outstanding enrollment balances</p></div><span>{pesos(pendingBalances.reduce((s, e) => s + (dueOf(e) - Number(e.paid_centavos)), 0))}</span></div><div className="portal-table"><table><thead><tr><th>Trainee</th><th>Course</th><th>Balance</th></tr></thead><tbody>{pendingBalances.slice(0, 50).map((e) => { const t = one(e.trainees as TraineeRow | TraineeRow[] | null); return <tr key={e.id}><td><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : "—"}</strong></td><td>{one(e.courses as CourseRef | CourseRef[] | null)?.name ?? "—"}</td><td><strong>{pesos(dueOf(e) - Number(e.paid_centavos))}</strong></td></tr>; })}{!pendingBalances.length && <tr><td colSpan={3}><span className="portal-empty-copy">No pending balances.</span></td></tr>}</tbody></table></div></section>
          {canManage && <section className="portal-panel"><div className="panel-heading"><div><h2>Discount approvals</h2><p>Cashier-requested discounts / agency rebates awaiting approval — approving deducts from the trainee&apos;s balance</p></div><span>{data.pendingDiscounts.length}</span></div><div className="portal-table"><table><thead><tr><th>Trainee · Course</th><th>Reason</th><th>Agency</th><th>Amount</th><th></th></tr></thead><tbody>{data.pendingDiscounts.map((d) => { const enr = d.enrollments ?? null; const t = one(enr?.trainees ?? null); return <tr key={d.id}><td><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : enr?.enrollment_number ?? "—"}</strong><small>{one(enr?.courses ?? null)?.name ?? ""}</small></td><td>{d.description}</td><td>{one(d.marketing_agencies)?.name ?? "—"}</td><td><strong>{pesos(d.amount_centavos)}</strong></td><td className="document-actions"><button disabled={busy} onClick={() => post({ action: "discount-decide", id: d.id, approve: true })}>Approve</button><button disabled={busy} onClick={() => post({ action: "discount-decide", id: d.id, approve: false })}>Reject</button></td></tr>; })}{!data.pendingDiscounts.length && <tr><td colSpan={5}><span className="portal-empty-copy">No pending discount requests.</span></td></tr>}</tbody></table></div></section>}
          {canManage && <section className="portal-panel"><div className="panel-heading"><div><h2>Charge approvals</h2><p>Cashier/Registration-raised charges (T-shirt, reprint, reschedule, make-up, etc.) awaiting approval — approving adds them to the trainee&apos;s balance</p></div><span>{data.pendingCharges.length}</span></div><div className="portal-table"><table><thead><tr><th>Trainee · Course</th><th>Charge</th><th>Amount</th><th></th></tr></thead><tbody>{data.pendingCharges.map((ch) => { const enr = one(ch.enrollments); const t = one(enr?.trainees ?? null); return <tr key={ch.id}><td><strong>{t ? `${t.legal_first_name} ${t.legal_last_name}` : enr?.enrollment_number ?? "—"}</strong><small>{one(enr?.courses ?? null)?.name ?? ""}</small></td><td>{ch.description}</td><td><strong>{pesos(ch.amount_centavos)}</strong></td><td className="document-actions"><button disabled={busy} onClick={() => post({ action: "charge-decide", id: ch.id, approve: true })}>Approve</button><button disabled={busy} onClick={() => post({ action: "charge-decide", id: ch.id, approve: false })}>Reject</button></td></tr>; })}{!data.pendingCharges.length && <tr><td colSpan={4}><span className="portal-empty-copy">No charges awaiting approval.</span></td></tr>}</tbody></table></div></section>}
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

          <AgencyRebatesOwed data={data} canManage={canManage} busy={busy} post={post} />
        </>
      )}

      {tab === "Sales" && <SalesReport payments={data.payments} payables={data.payables} />}

      {tab === "Reconciliation" && <Reconciliation payments={data.payments} channels={data.paymentMethods} />}

      {tab === "Cashier closing" && <LiveCashierClosing data={data as unknown as ClosingData} reload={reload} />}

      {tab === "Setup" && (
        <>
          {!canManage && <div className="portal-message error">Only Admin and Accounting can edit setup.</div>}
          <Pricelist data={data} canManage={canManage} busy={busy} post={post} />
          <SetupList title="Receivable channels" description="Collection modes offered at the cashier" entityLabel="receivable channel"
            canManage={canManage} busy={busy}
            fields={[{ key: "name", label: "Channel name" }, { key: "requiresReference", label: "Requires a reference number", type: "checkbox" }]}
            rows={data.paymentMethods.filter((c) => c.kind !== "payable").map((c) => ({ id: c.id, primary: c.name, secondary: `${c.requires_reference ? "Reference required" : "No reference"} · ${c.code}`, active: c.active, values: { name: c.name, requiresReference: c.requires_reference } }))}
            onSubmit={(v, id) => post({ action: "channel-save", id, name: String(v.name), requiresReference: Boolean(v.requiresReference), allowsProof: true, kind: "receivable" })}
            onArchive={(id, active, name) => post({ action: "channel-save", id, name, active: !active })} />

          <SetupList title="Payables channels" description="Disbursement channels for payables (bank, GCash, cash)" entityLabel="payables channel"
            canManage={canManage} busy={busy}
            fields={[{ key: "name", label: "Channel name" }]}
            rows={data.paymentMethods.filter((c) => c.kind === "payable").map((c) => ({ id: c.id, primary: c.name, secondary: c.code, active: c.active, values: { name: c.name } }))}
            onSubmit={(v, id) => post({ action: "channel-save", id, name: String(v.name), kind: "payable" })}
            onArchive={(id, active, name) => post({ action: "channel-save", id, name, kind: "payable", active: !active })} />

          <SetupList title="Other charges" description="Uniform, reprinting, make-up, etc." entityLabel="charge"
            canManage={canManage} busy={busy}
            fields={[{ key: "name", label: "Charge name" }, { key: "defaultAmount", label: "Default amount (PHP)", type: "number", optional: true }]}
            rows={data.charges.map((c) => ({ id: c.id, primary: c.name, secondary: `Default ${pesos(c.default_amount_centavos)}`, active: c.active, values: { name: c.name, defaultAmount: String(c.default_amount_centavos / 100) } }))}
            onSubmit={(v, id) => post({ action: "charge-save", id, name: String(v.name), defaultAmountCentavos: Math.round((Number(v.defaultAmount) || 0) * 100) })}
            onArchive={(id, active, name) => post({ action: "charge-save", id, name, active: !active })} />

          <SetupList title="Marketing agencies" description="Referring consultancies" entityLabel="agency"
            canManage={canManage} busy={busy}
            fields={[{ key: "name", label: "Agency name" }, { key: "contactName", label: "Contact person", optional: true }, { key: "email", label: "Email", optional: true }, { key: "mobile", label: "Mobile", optional: true }]}
            rows={data.agencies.map((a) => ({ id: a.id, primary: a.name, secondary: [a.contact_name, a.email, a.mobile].filter(Boolean).join(" · ") || "—", active: a.active, values: { name: a.name, contactName: a.contact_name || "", email: a.email || "", mobile: a.mobile || "" } }))}
            onSubmit={(v, id) => post({ action: "agency-save", id, name: String(v.name), contactName: String(v.contactName || ""), email: String(v.email || ""), mobile: String(v.mobile || "") })}
            onArchive={(id, active, name) => post({ action: "agency-save", id, name, active: !active })} />

          <AgencyRebatesEditor data={data} canManage={canManage} busy={busy} post={post} />

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

/* ---- Standalone Expense Vouchers module (own nav item) ---- */
export function LiveVouchers({ data, role, reload }: { data: AccountingData; role: string; reload: () => Promise<void> }) {
  const canManage = role === "admin" || role === "accounting";
  const canRaise = ["admin", "cashier"].includes(role);
  const [busy, setBusy] = useState(false);
  const [voucher, setVoucher] = useState<{ payee: string; category: string; amount: string; purpose: string } | null>(null);
  const [error, setError] = useState("");
  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The action could not be completed.");
      await reload();
    } finally { setBusy(false); }
  }
  return (
    <div className="portal-page">
      <div className="portal-heading"><div><span className="portal-eyebrow">Cashier / Accounting</span><h1>Expense vouchers</h1><p>Raise cash and expense vouchers; Accounting approves, rejects, or marks them paid.</p></div>{canRaise && <button className="portal-primary" disabled={busy} onClick={() => { setError(""); setVoucher({ payee: "", category: data.expenseCategories.find((c) => c.active)?.name ?? "Others", amount: "", purpose: "" }); }}>+ Raise voucher</button>}</div>
      <section className="portal-panel">
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
                {(e.status === "Approved" || e.status === "Paid") && <a href={`/api/documents/expense/${e.id}`} target="_blank" rel="noreferrer">Generate</a>}
              </td>
            </tr>
          ))}
          {!data.expenses.length && <tr><td colSpan={6}><span className="portal-empty-copy">No vouchers yet.</span></td></tr>}
        </tbody></table></div>
      </section>
      {voucher && (
        <EditModal title="Raise expense voucher" busy={busy} saveLabel="Raise voucher" onClose={() => setVoucher(null)} onSave={async () => {
          const amt = Math.round(Number(voucher.amount) * 100);
          if (!voucher.payee.trim()) { setError("Payee is required."); return; }
          if (!voucher.category.trim()) { setError("Category is required."); return; }
          if (!Number.isFinite(amt) || amt <= 0) { setError("Enter a valid amount."); return; }
          if (!voucher.purpose.trim()) { setError("Purpose is required."); return; }
          await post({ action: "expense-create", payee: voucher.payee, category: voucher.category, amountCentavos: amt, purpose: voucher.purpose });
          setVoucher(null);
        }}>
          {error && <div className="portal-message error full">{error}</div>}
          <label className="full">Payee<input autoFocus value={voucher.payee} onChange={(e) => setVoucher({ ...voucher, payee: e.target.value })} /></label>
          <label>Category<select value={voucher.category} onChange={(e) => setVoucher({ ...voucher, category: e.target.value })}>{data.expenseCategories.filter((c) => c.active).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}{voucher.category && !data.expenseCategories.some((c) => c.active && c.name === voucher.category) && <option value={voucher.category}>{voucher.category}</option>}</select></label>
          <label>Amount (PHP)<input type="number" min="0" step="0.01" value={voucher.amount} onChange={(e) => setVoucher({ ...voucher, amount: e.target.value })} /></label>
          <label className="full">Purpose / description<textarea rows={2} value={voucher.purpose} onChange={(e) => setVoucher({ ...voucher, purpose: e.target.value })} /></label>
        </EditModal>
      )}
    </div>
  );
}

/* ---- Standalone Inventory module (own left-nav item) ---- */
export function LiveInventory({ data, role, reload }: { data: AccountingData; role: string; reload: () => Promise<void> }) {
  const canManage = role === "admin" || role === "accounting";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function post(body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try { const r = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "The action could not be completed."); await reload(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "The action could not be completed."); }
    finally { setBusy(false); }
  }
  return <div className="portal-page"><div className="portal-heading"><div><span className="portal-eyebrow">Accounting</span><h1>Inventory</h1><p>Items with stock-in / stock-out movements</p></div></div>{message && <div className="portal-message error" role="alert">{message}</div>}<Inventory data={data} canManage={canManage} busy={busy} post={post} /></div>;
}

/* ---- Standalone Expenses module (own left-nav item) ---- */
export function LiveExpenses({ data, role, reload }: { data: AccountingData; role: string; reload: () => Promise<void> }) {
  const canManage = role === "admin" || role === "accounting";
  const [busy, setBusy] = useState(false);
  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try { const r = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "The action could not be completed."); await reload(); }
    finally { setBusy(false); }
  }
  return (
    <>
      <LiveVouchers data={data} role={role} reload={reload} />
      {canManage && (
        <div className="portal-page" style={{ paddingTop: 0 }}>
          <SetupList title="Expense categories" description="Categories for expense vouchers (Utilities, Salary, Government…)" entityLabel="category"
            canManage={canManage} busy={busy} removable
            fields={[{ key: "name", label: "Category name" }]}
            rows={data.expenseCategories.map((c) => ({ id: c.id, primary: c.name, secondary: c.active ? "Active" : "Archived", active: c.active, values: { name: c.name } }))}
            onSubmit={(v, id) => post({ action: "expense-category-save", id, name: String(v.name) })}
            onRemove={(id) => post({ action: "expense-category-save", id, name: "x", remove: true })} />
          <SetupList title="Monthly payables" description="Recurring bills (rent, utilities, remittances)" entityLabel="payable"
            canManage={canManage} busy={busy} removable
            fields={[{ key: "description", label: "Description" }, { key: "amount", label: "Amount (PHP)", type: "number" }, { key: "dueOn", label: "Due date (YYYY-MM-DD)", type: "date", optional: true }]}
            rows={data.payables.map((p) => ({ id: p.id, primary: p.description, secondary: `${pesos(p.amount_centavos)}${p.due_on ? ` · due ${p.due_on}` : ""}`, active: true, values: { description: p.description, amount: String(p.amount_centavos / 100), dueOn: p.due_on || "" } }))}
            onSubmit={(v, id) => post({ action: "payable-save", id, description: String(v.description), amountCentavos: Math.round((Number(v.amount) || 0) * 100), dueOn: String(v.dueOn || "") || null })}
            onRemove={(id) => post({ action: "payable-save", id, description: "x", remove: true })} />
        </div>
      )}
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

type PriceEdit =
  | { kind: "course"; id?: string; code: string; name: string; categoryId: string; deliveryType: "In-House" | "Partner or Endorsed"; durationLabel: string; durationDays: string; mode: string; price: string }
  | { kind: "offer"; id: string; label: string; fee: string; rebate: string }
  | { kind: "center"; id?: string; name: string; email: string; mobile: string };

/* ---- Courses & centers + endorsed-offer rates/rebates ---- */
function Pricelist({ data, canManage, busy, post }: { data: AccountingData; canManage: boolean; busy: boolean; post: (body: Record<string, unknown>) => Promise<void> }) {
  const [edit, setEdit] = useState<PriceEdit | null>(null);
  const [error, setError] = useState("");
  const offerCenters = [...new Set(data.offers.map((o) => one(o.partner_centers)?.name).filter(Boolean))] as string[];
  const [offerCenter, setOfferCenter] = useState(offerCenters[0] ?? "");
  const pesoFromInput = (raw: string) => { const n = Number(raw); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
  const defaultCategory = data.courseCategories[0]?.id ?? "";

  async function save() {
    if (!edit) return;
    setError("");
    if (edit.kind === "course") {
      const price = pesoFromInput(edit.price);
      const days = Number(edit.durationDays);
      if (edit.code.trim().length < 2 || edit.name.trim().length < 2) { setError("Code and name are required."); return; }
      if (!edit.categoryId) { setError("Pick a category."); return; }
      if (!Number.isFinite(days) || days <= 0) { setError("Enter valid duration days."); return; }
      if (price == null) { setError("Enter a valid price."); return; }
      await post({ action: "course-save", id: edit.id ?? null, code: edit.code, name: edit.name, categoryId: edit.categoryId, deliveryType: edit.deliveryType, durationLabel: edit.durationLabel, durationDays: days, mode: edit.mode, priceCentavos: price });
    } else if (edit.kind === "offer") {
      const fee = pesoFromInput(edit.fee); const rebate = pesoFromInput(edit.rebate);
      if (fee == null || rebate == null) { setError("Enter valid amounts."); return; }
      if (rebate > fee) { setError("Rebate cannot exceed the training fee."); return; }
      await post({ action: "offer-rate-save", offerId: edit.id, trainingFeeCentavos: fee, rebateCentavos: rebate });
    } else {
      if (edit.name.trim().length < 2) { setError("Center name is required."); return; }
      await post({ action: "center-save", id: edit.id ?? null, name: edit.name, email: edit.email, mobile: edit.mobile });
    }
    setEdit(null);
  }

  return (
    <>
      {!canManage && <div className="portal-message error">Only Admin and Accounting can edit courses, centers, and pricing.</div>}
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Courses</h2><p>Pick a course from the list to edit, or add a new one</p></div>{canManage && <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><select value="" onChange={(e) => { const c = data.courses.find((x) => x.id === e.target.value); if (c) { setError(""); setEdit({ kind: "course", id: c.id, code: c.code, name: c.name, categoryId: c.category_id ?? defaultCategory, deliveryType: c.delivery_type === "Partner or Endorsed" ? "Partner or Endorsed" : "In-House", durationLabel: c.duration_label ?? "", durationDays: String(c.duration_days ?? 1), mode: c.training_mode ?? "In-person", price: String(c.standard_price_centavos / 100) }); } }} style={{ maxWidth: 240 }}><option value="">Select a course…</option>{data.courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select><button className="portal-primary" disabled={busy} onClick={() => { setError(""); setEdit({ kind: "course", code: "", name: "", categoryId: defaultCategory, deliveryType: "In-House", durationLabel: "1 day", durationDays: "1", mode: "In-person", price: "0" }); }}>+ Add course</button></div>}</div>
        <div className="portal-table"><table><thead><tr><th>Course</th><th>Type</th><th>Duration</th><th>Price</th><th>Edited</th><th></th></tr></thead><tbody>
          {data.courses.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.name}</strong><small>{c.code}</small></td>
              <td>{c.delivery_type}</td>
              <td>{c.duration_label ?? "—"}</td>
              <td>{pesos(c.standard_price_centavos)}</td>
              <td>{c.updated_at ? manilaDay(c.updated_at) : "—"}</td>
              <td className="document-actions">{canManage && <button disabled={busy} onClick={() => { setError(""); setEdit({ kind: "course", id: c.id, code: c.code, name: c.name, categoryId: c.category_id ?? defaultCategory, deliveryType: c.delivery_type === "Partner or Endorsed" ? "Partner or Endorsed" : "In-House", durationLabel: c.duration_label ?? "", durationDays: String(c.duration_days ?? 1), mode: c.training_mode ?? "In-person", price: String(c.standard_price_centavos / 100) }); }}>Edit</button>}</td>
            </tr>
          ))}
          {!data.courses.length && <tr><td colSpan={6}><span className="portal-empty-copy">No courses.</span></td></tr>}
        </tbody></table></div>
      </section>

      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Training centers</h2><p>Partner / endorsing centers</p></div>{canManage && <button className="portal-primary" disabled={busy} onClick={() => { setError(""); setEdit({ kind: "center", name: "", email: "", mobile: "" }); }}>+ Add center</button>}</div>
        <div className="portal-table"><table><thead><tr><th>Center</th><th>Status</th><th></th></tr></thead><tbody>
          {data.partnerCenters.map((c) => (
            <tr key={c.id} className={c.active ? "" : "row-muted"}>
              <td><strong>{c.name}</strong></td>
              <td>{c.active ? "Active" : "Archived"}</td>
              <td className="document-actions">{canManage && <button disabled={busy} onClick={() => { setError(""); setEdit({ kind: "center", id: c.id, name: c.name, email: "", mobile: "" }); }}>Edit</button>}</td>
            </tr>
          ))}
          {!data.partnerCenters.length && <tr><td colSpan={3}><span className="portal-empty-copy">No training centers.</span></td></tr>}
        </tbody></table></div>
      </section>

      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Endorsed Programs (rates &amp; rebates)</h2><p>Pick a partner center to see the courses it offers</p></div>{offerCenters.length > 0 && <select value={offerCenter} onChange={(e) => setOfferCenter(e.target.value)} style={{ maxWidth: 240 }}>{offerCenters.map((c) => <option key={c} value={c}>{c}</option>)}</select>}</div>
        <div className="portal-table"><table><thead><tr><th>Course</th><th>Duration</th><th>Training fee</th><th>Rebate</th><th>Partner payable</th><th>Edited</th><th></th></tr></thead><tbody>
          {data.offers.filter((o) => one(o.partner_centers)?.name === offerCenter).map((o) => {
            const center = one(o.partner_centers)?.name ?? "—"; const course = data.courses.find((c) => c.id === o.course_id)?.name ?? one(o.courses)?.name ?? "—";
            return <tr key={o.id}>
              <td><strong>{course}</strong></td>
              <td>{o.duration_label}</td>
              <td>{pesos(o.training_fee_centavos)}</td>
              <td>{pesos(o.rebate_centavos)}</td>
              <td>{pesos(o.partner_payable_centavos)}</td>
              <td>{o.updated_at ? manilaDay(o.updated_at) : "—"}</td>
              <td className="document-actions">{canManage && <button disabled={busy} onClick={() => { setError(""); setEdit({ kind: "offer", id: o.id, label: `${course} · ${center}`, fee: String(o.training_fee_centavos / 100), rebate: String(o.rebate_centavos / 100) }); }}>Edit rate</button>}</td>
            </tr>;
          })}
          {!data.offers.filter((o) => one(o.partner_centers)?.name === offerCenter).length && <tr><td colSpan={7}><span className="portal-empty-copy">No courses for this center.</span></td></tr>}
        </tbody></table></div>
      </section>

      {edit && edit.kind === "course" && (
        <EditModal title={edit.id ? "Edit course" : "Add course"} busy={busy} onClose={() => setEdit(null)} onSave={save} saveLabel={edit.id ? "Save changes" : "Add course"}>
          {error && <div className="portal-message error full">{error}</div>}
          <label>Code<input autoFocus value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></label>
          <label>Category<select value={edit.categoryId} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value })}><option value="">Select…</option>{data.courseCategories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label>
          <label className="full">Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label>Delivery type<select value={edit.deliveryType} onChange={(e) => setEdit({ ...edit, deliveryType: e.target.value as "In-House" | "Partner or Endorsed" })}><option value="In-House">In-House</option><option value="Partner or Endorsed">Partner or Endorsed</option></select></label>
          <label>Mode<input value={edit.mode} onChange={(e) => setEdit({ ...edit, mode: e.target.value })} /></label>
          <label>Duration label<input value={edit.durationLabel} onChange={(e) => setEdit({ ...edit, durationLabel: e.target.value })} placeholder="e.g. 3 days" /></label>
          <label>Duration days<input type="number" min="0.5" step="0.5" value={edit.durationDays} onChange={(e) => setEdit({ ...edit, durationDays: e.target.value })} /></label>
          <label>Price (PHP)<input type="number" min="0" step="0.01" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></label>
        </EditModal>
      )}
      {edit && edit.kind === "center" && (
        <EditModal title={edit.id ? "Edit training center" : "Add training center"} busy={busy} onClose={() => setEdit(null)} onSave={save} saveLabel={edit.id ? "Save changes" : "Add center"}>
          {error && <div className="portal-message error full">{error}</div>}
          <label className="full">Center name<input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label>Email<input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
          <label>Mobile<input value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></label>
        </EditModal>
      )}
      {edit && edit.kind === "offer" && (
        <EditModal title="Edit Endorsed Program rate" subtitle={edit.label} busy={busy} onClose={() => setEdit(null)} onSave={save}>
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

/* ---- Trainee lookup — Accounting Manager searches by name/SRN ---- */
export function TraineeLookup({ data }: { data: AccountingData }) {
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const term = q.trim().toLowerCase();
  const nameOf = (t: TraineeRow) => `${t.legal_first_name} ${t.legal_middle_name ?? ""} ${t.legal_last_name}`.replace(/\s+/g, " ").trim();
  const matches = term.length < 2 ? [] : data.trainees.filter((t) => `${nameOf(t)} ${t.trainee_number} ${t.srn ?? ""}`.toLowerCase().includes(term)).slice(0, 25);
  const selected = data.trainees.find((t) => t.id === selectedId) ?? null;
  const enrollments = selected ? data.enrollments.filter((e) => e.trainee_id === selected.id) : [];
  const payments = selected ? data.payments.filter((p) => p.trainee_id === selected.id) : [];
  return (
    <>
      {!selected && (
        <section className="portal-panel">
          <div className="panel-heading"><div><h2>Trainee lookup</h2><p>Search a trainee by name or SRN to review their enrollments and payments</p></div></div>
          <div className="portal-form" style={{ padding: "4px 0" }}>
            <label className="full">Search name or SRN<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Dela Cruz or SRN-99887" /></label>
          </div>
          {term.length < 2 ? <p className="portal-empty-copy">Type at least 2 characters to search.</p> : (
            <div className="portal-table"><table><thead><tr><th>Trainee</th><th>SRN</th><th>Contact</th><th></th></tr></thead><tbody>
              {matches.map((t) => <tr key={t.id}><td><strong>{nameOf(t)}</strong><small>{t.trainee_number}</small></td><td>{t.srn || "—"}</td><td>{t.email || t.mobile || "—"}</td><td className="document-actions"><button onClick={() => setSelectedId(t.id)}>Open</button></td></tr>)}
              {!matches.length && <tr><td colSpan={4}><span className="portal-empty-copy">No trainee matches “{q}”.</span></td></tr>}
            </tbody></table></div>
          )}
        </section>
      )}
      {selected && (
        <>
          <section className="portal-panel">
            <div className="panel-heading"><div><h2>{nameOf(selected)}</h2><p>{selected.trainee_number}{selected.srn ? ` · SRN ${selected.srn}` : ""}{selected.mobile ? ` · ${selected.mobile}` : ""}</p></div><button className="portal-secondary" onClick={() => setSelectedId("")}>← Back to search</button></div>
            <div className="portal-table"><table><thead><tr><th>Enrollment</th><th>Course</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>
              {enrollments.map((e) => { const due = dueOf(e); const bal = Math.max(0, due - Number(e.paid_centavos)); return <tr key={e.id}><td><strong>{e.enrollment_number}</strong></td><td>{one(e.courses as CourseRef | CourseRef[] | null)?.name ?? "—"}</td><td>{pesos(due)}</td><td>{pesos(e.paid_centavos)}</td><td><strong>{pesos(bal)}</strong></td><td>{e.enrollment_status}</td></tr>; })}
              {!enrollments.length && <tr><td colSpan={6}><span className="portal-empty-copy">No enrollments.</span></td></tr>}
            </tbody></table></div>
          </section>
          <section className="portal-panel">
            <div className="panel-heading"><div><h2>Payments</h2><p>Posted payments for this trainee</p></div></div>
            <div className="portal-table"><table><thead><tr><th>Payment</th><th>Method</th><th>Reference</th><th>Amount</th><th>Verification</th></tr></thead><tbody>
              {payments.map((p, i) => <tr key={p.payment_number ?? i}><td><strong>{p.payment_number ?? "—"}</strong></td><td>{p.method}</td><td>{p.reference_number ?? "—"}</td><td>{pesos(p.amount_centavos)}</td><td>{p.verification_state}</td></tr>)}
              {!payments.length && <tr><td colSpan={5}><span className="portal-empty-copy">No payments.</span></td></tr>}
            </tbody></table></div>
          </section>
        </>
      )}
    </>
  );
}

/* ---- Inventory — items + stock in/out movements ---- */
function Inventory({ data, canManage, busy, post }: { data: AccountingData; canManage: boolean; busy: boolean; post: (body: Record<string, unknown>) => Promise<void> }) {
  const [edit, setEdit] = useState<{ id?: string; name: string; category: string; unit: string; unitValue: string } | null>(null);
  const [move, setMove] = useState<{ item: InventoryItem; type: "in" | "out"; quantity: string; remarks: string } | null>(null);
  const [error, setError] = useState("");
  const totalValue = data.inventoryItems.reduce((s, i) => s + Number(i.quantity_on_hand) * Number(i.unit_value_centavos), 0);
  async function saveItem() {
    if (!edit) return;
    if (edit.name.trim().length < 1) { setError("Item name is required."); return; }
    const cents = Math.round(Number(edit.unitValue || "0") * 100);
    if (!Number.isFinite(cents) || cents < 0) { setError("Enter a valid unit value."); return; }
    await post({ action: "inventory-item-save", id: edit.id ?? null, name: edit.name, category: edit.category, unit: edit.unit || "pc", unitValueCentavos: cents });
    setEdit(null);
  }
  async function saveMove() {
    if (!move) return;
    const qty = Math.round(Number(move.quantity));
    if (!Number.isInteger(qty) || qty <= 0) { setError("Enter a whole quantity greater than zero."); return; }
    await post({ action: "inventory-move", itemId: move.item.id, movementType: move.type, quantity: qty, remarks: move.remarks });
    setMove(null);
  }
  return (
    <>
      {!canManage && <div className="portal-message error">Only Admin and Accounting can manage inventory.</div>}
      <div className="finance-hero">
        <div><span>Inventory value</span><strong>{pesos(totalValue)}</strong><small>{data.inventoryItems.length} items</small></div>
        <article><span>Low stock</span><strong>{data.inventoryItems.filter((i) => i.active && i.quantity_on_hand <= 5).length}</strong><small>≤ 5 on hand</small></article>
        <article><span>Movements</span><strong>{data.inventoryMovements.length}</strong><small>recent in/out</small></article>
      </div>
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Items</h2><p>Stock on hand and value</p></div>{canManage && <button className="portal-primary" disabled={busy} onClick={() => { setError(""); setEdit({ name: "", category: "", unit: "pc", unitValue: "0" }); }}>+ Add item</button>}</div>
        <div className="portal-table"><table><thead><tr><th>Item</th><th>Unit</th><th>On hand</th><th>Unit value</th><th>Total</th>{canManage && <th></th>}</tr></thead><tbody>
          {data.inventoryItems.map((i) => <tr key={i.id} className={i.active ? "" : "row-muted"}><td><strong>{i.name}</strong><small>{i.category || "—"}</small></td><td>{i.unit}</td><td><strong>{i.quantity_on_hand}</strong></td><td>{pesos(i.unit_value_centavos)}</td><td>{pesos(Number(i.quantity_on_hand) * Number(i.unit_value_centavos))}</td>{canManage && <td className="document-actions"><button disabled={busy} onClick={() => { setError(""); setMove({ item: i, type: "in", quantity: "", remarks: "" }); }}>Stock in</button><button disabled={busy} onClick={() => { setError(""); setMove({ item: i, type: "out", quantity: "", remarks: "" }); }}>Stock out</button><button disabled={busy} onClick={() => { setError(""); setEdit({ id: i.id, name: i.name, category: i.category || "", unit: i.unit, unitValue: String(i.unit_value_centavos / 100) }); }}>Edit</button><button disabled={busy} onClick={() => { if (window.confirm("Remove this item and its movement history?")) post({ action: "inventory-item-save", id: i.id, name: i.name, remove: true }); }}>Remove</button></td>}</tr>)}
          {!data.inventoryItems.length && <tr><td colSpan={canManage ? 6 : 5}><span className="portal-empty-copy">No items yet.</span></td></tr>}
        </tbody></table></div>
      </section>
      <section className="portal-panel">
        <div className="panel-heading"><div><h2>Recent movements</h2><p>Stock in / out history</p></div></div>
        <div className="portal-table"><table><thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Remarks</th><th>When</th></tr></thead><tbody>
          {data.inventoryMovements.slice(0, 60).map((m) => <tr key={m.id}><td><strong>{one(m.inventory_items)?.name ?? "—"}</strong></td><td>{m.movement_type === "in" ? "Stock in" : "Stock out"}</td><td>{m.movement_type === "in" ? "+" : "−"}{m.quantity}</td><td>{m.remarks || "—"}</td><td>{manilaDay(m.created_at)}</td></tr>)}
          {!data.inventoryMovements.length && <tr><td colSpan={5}><span className="portal-empty-copy">No movements yet.</span></td></tr>}
        </tbody></table></div>
      </section>
      {edit && (
        <EditModal title={edit.id ? "Edit item" : "Add item"} busy={busy} onClose={() => setEdit(null)} onSave={saveItem} saveLabel={edit.id ? "Save changes" : "Add item"}>
          {error && <div className="portal-message error full">{error}</div>}
          <label className="full">Item name<input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label>Category<input value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="e.g. Supplies" /></label>
          <label>Unit<input value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="pc / ream / box" /></label>
          <label>Unit value (PHP)<input type="number" min="0" step="0.01" value={edit.unitValue} onChange={(e) => setEdit({ ...edit, unitValue: e.target.value })} /></label>
          <p className="portal-form-note full">Quantity on hand changes only through stock-in / stock-out movements.</p>
        </EditModal>
      )}
      {move && (
        <EditModal title={move.type === "in" ? "Stock in" : "Stock out"} subtitle={`${move.item.name} · ${move.item.quantity_on_hand} on hand`} busy={busy} onClose={() => setMove(null)} onSave={saveMove} saveLabel={move.type === "in" ? "Add stock" : "Issue stock"}>
          {error && <div className="portal-message error full">{error}</div>}
          <label>Quantity<input autoFocus type="number" min="1" step="1" value={move.quantity} onChange={(e) => setMove({ ...move, quantity: e.target.value })} /></label>
          <label className="full">Remarks<input value={move.remarks} onChange={(e) => setMove({ ...move, remarks: e.target.value })} placeholder="Optional" /></label>
        </EditModal>
      )}
    </>
  );
}

/* ---- Agency (consultancy) rebate matrix — agency × course → amount ---- */
function AgencyRebatesEditor({ data, canManage, busy, post }: { data: AccountingData; canManage: boolean; busy: boolean; post: (body: Record<string, unknown>) => Promise<void> }) {
  const agencies = data.agencies.filter((a) => a.active);
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? "");
  const courses = data.courses.filter((c) => c.delivery_type === "In-House");
  const rebateFor = (courseId: string) => data.agencyCourseRebates.find((r) => r.agency_id === agencyId && r.course_id === courseId)?.rebate_centavos ?? 0;
  const [edit, setEdit] = useState<{ courseId: string; name: string; amount: string } | null>(null);
  const [error, setError] = useState("");
  async function save() {
    if (!edit) return;
    const cents = Math.round(Number(edit.amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setError("Enter a valid amount."); return; }
    await post({ action: "agency-rebate-set", agencyId, courseId: edit.courseId, cents });
    setEdit(null);
  }
  return (
    <section className="portal-panel">
      <div className="panel-heading"><div><h2>Agency rebates</h2><p>Rebate paid to a consultancy per course. Auto-fills when a cashier tags the endorsing agency on a payment.</p></div></div>
      {!canManage && <div className="portal-message error">Only Admin and Accounting can set rebates.</div>}
      <div className="portal-form" style={{ padding: "4px 0 10px" }}>
        <label>Consultancy / agency<select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>{agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}{!agencies.length && <option value="">No agencies yet</option>}</select></label>
      </div>
      <div className="portal-table"><table><thead><tr><th>Course</th><th>Rebate</th><th></th></tr></thead><tbody>
        {agencyId && courses.map((c) => <tr key={c.id}><td><strong>{c.name}</strong><small>{c.code}</small></td><td>{pesos(rebateFor(c.id))}</td><td className="document-actions">{canManage && <button disabled={busy} onClick={() => { setError(""); setEdit({ courseId: c.id, name: c.name, amount: String(rebateFor(c.id) / 100) }); }}>Set</button>}</td></tr>)}
        {(!agencyId || !courses.length) && <tr><td colSpan={3}><span className="portal-empty-copy">{agencies.length ? "No New Wave courses to price." : "Add a marketing agency first (below)."}</span></td></tr>}
      </tbody></table></div>
      {edit && (
        <EditModal title="Set agency rebate" subtitle={`${data.agencies.find((a) => a.id === agencyId)?.name ?? ""} · ${edit.name}`} busy={busy} onClose={() => setEdit(null)} onSave={save}>
          {error && <div className="portal-message error full">{error}</div>}
          <label className="full">Rebate amount (PHP)<input autoFocus type="number" min="0" step="0.01" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></label>
        </EditModal>
      )}
    </section>
  );
}

/* ---- Agency rebates payable — what New Wave owes referring consultancies ---- */
function AgencyRebatesOwed({ data, canManage, busy, post }: { data: AccountingData; canManage: boolean; busy: boolean; post: (body: Record<string, unknown>) => Promise<void> }) {
  const total = data.agencyRebates.filter((r) => r.status === "Pending").reduce((s, r) => s + Number(r.rebate_centavos), 0);
  return (
    <section className="portal-panel">
      <div className="panel-heading"><div><h2>Agency rebates payable</h2><p>Owed to referring consultancies (recorded at payment)</p></div><span>{pesos(total)}</span></div>
      <div className="portal-table"><table><thead><tr><th>Agency</th><th>Course · Trainee</th><th>Rebate</th><th>Status</th>{canManage && <th></th>}</tr></thead><tbody>
        {data.agencyRebates.slice(0, 100).map((r) => { const t = one(r.trainees); return <tr key={r.id}><td><strong>{one(r.marketing_agencies)?.name ?? "—"}</strong></td><td>{one(r.courses)?.name ?? "—"}<small>{t ? `${t.legal_first_name} ${t.legal_last_name}` : ""}</small></td><td>{pesos(r.rebate_centavos)}</td><td>{r.status}</td>{canManage && <td className="document-actions">{r.status === "Pending" && <button disabled={busy} onClick={() => post({ action: "agency-rebate-settle", id: r.id, status: "Paid" })}>Mark paid</button>}</td>}</tr>; })}
        {!data.agencyRebates.length && <tr><td colSpan={canManage ? 5 : 4}><span className="portal-empty-copy">No agency rebates recorded yet.</span></td></tr>}
      </tbody></table></div>
    </section>
  );
}

type SetupField = { key: string; label: string; type?: "text" | "number" | "date" | "checkbox"; placeholder?: string; optional?: boolean };
type SetupRow = { id: string; primary: string; secondary: string; active: boolean; values: Record<string, string | boolean> };
type SetupDraft = { id?: string; values: Record<string, string | boolean> };
export function SetupList({ title, description, entityLabel, rows, canManage, busy, fields, onSubmit, onArchive, onRemove, removable }: {
  title: string; description: string; entityLabel: string; rows: SetupRow[]; canManage: boolean; busy: boolean;
  fields: SetupField[]; onSubmit: (values: Record<string, string | boolean>, id?: string) => Promise<void> | void;
  onArchive?: (id: string, active: boolean, name: string) => void; onRemove?: (id: string) => void; removable?: boolean;
}) {
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [error, setError] = useState("");
  function openAdd() { const v: Record<string, string | boolean> = {}; for (const f of fields) v[f.key] = f.type === "checkbox" ? false : ""; setError(""); setDraft({ values: v }); }
  function openEdit(row: SetupRow) { setError(""); setDraft({ id: row.id, values: { ...row.values } }); }
  async function save() {
    if (!draft) return;
    for (const f of fields) { if (!f.optional && f.type !== "checkbox" && String(draft.values[f.key] ?? "").trim() === "") { setError(`${f.label} is required.`); return; } }
    await onSubmit(draft.values, draft.id);
    setDraft(null);
  }
  return (
    <section className="portal-panel">
      <div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div>{canManage && <button className="portal-primary" disabled={busy} onClick={openAdd}>+ Add</button>}</div>
      <div className="portal-table"><table><thead><tr><th>Name</th><th>Details</th><th>Status</th><th></th></tr></thead><tbody>
        {rows.map((row) => (
          <tr key={row.id} className={row.active ? "" : "row-muted"}>
            <td><strong>{row.primary}</strong></td>
            <td>{row.secondary}</td>
            <td>{row.active ? "Active" : "Archived"}</td>
            <td className="document-actions">
              {canManage && <button onClick={() => openEdit(row)} disabled={busy}>Edit</button>}
              {canManage && removable && onRemove && <button onClick={() => { if (window.confirm(`Remove this ${entityLabel}?`)) onRemove(row.id); }} disabled={busy}>Remove</button>}
              {canManage && !removable && onArchive && <button onClick={() => onArchive(row.id, row.active, row.primary)} disabled={busy}>{row.active ? "Archive" : "Restore"}</button>}
            </td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={4}><span className="portal-empty-copy">Nothing yet.</span></td></tr>}
      </tbody></table></div>
      {draft && (
        <EditModal title={`${draft.id ? "Edit" : "Add"} ${entityLabel}`} busy={busy} onClose={() => setDraft(null)} onSave={save}>
          {error && <div className="portal-message error full">{error}</div>}
          {fields.map((f) => f.type === "checkbox" ? (
            <label key={f.key} className="portal-check full"><input type="checkbox" checked={Boolean(draft.values[f.key])} onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [f.key]: e.target.checked } })} /><span>{f.label}</span></label>
          ) : (
            <label key={f.key} className={f.type === "number" ? "" : "full"}>{f.label}
              <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} {...(f.type === "number" ? { min: "0", step: "0.01" } : {})} placeholder={f.placeholder} value={String(draft.values[f.key] ?? "")} onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [f.key]: e.target.value } })} />
            </label>
          ))}
        </EditModal>
      )}
    </section>
  );
}
