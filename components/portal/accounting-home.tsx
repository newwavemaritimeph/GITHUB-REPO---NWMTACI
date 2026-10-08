"use client";

import { useEffect, useState } from "react";
import type { PortalData } from "../portal-live-app";
import { addDays, first, manilaToday, pesos2 } from "@/lib/portal-format";
import { Badge, Message, fmtDate, usePost } from "./shared-ui";
import { BarChart, Donut, HBars } from "./charts";
import { PERIODS, percentChange, type Period } from "@/lib/accounting-periods";
import type { AccountingReport } from "@/lib/accounting-report";
import type { CashierReportSnapshot } from "@/lib/documents";
import { unpaidAfterTraining, type BalanceEnrollment } from "@/lib/unpaid-balances";
import { downloadCsv } from "@/lib/csv";

/**
 * Accounting Manager (owner, 8 Oct 2026): a view-first dashboard like the
 * Cashier's with her approvals on top, an Approvals page, and one Reports page
 * for daily, weekly, monthly, quarterly and annual figures — half text, half charts.
 * Payments and expenses are recorded by the Cashier; she approves and reviews.
 */

const COLORS: Record<string, string> = { Cash: "#0a7a3e", GCash: "#0571D0", PSBank: "#F25615", UnionBank: "#7a3fb8" };
const CHANNELS = ["Cash", "GCash", "PSBank", "UnionBank"];
const SOURCE_COLORS: Record<string, string> = { "Walk-ins": "#0571D0", Agencies: "#123F63", Consultancies: "#35CCFA" };
const CATEGORY_COLORS = ["#F25615", "#c2410c", "#f59e0b", "#b45309", "#a16207", "#78716c"];
const day = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(v)) : "");
const longDay = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));

function useJson<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string }>({ url: null, data: null, error: "" });
  useEffect(() => {
    if (!url) return;
    let live = true;
    void fetch(url, { cache: "no-store" }).then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Could not load."); if (live) setState({ url, data: body as T, error: "" }); })
      .catch((e) => { if (live) setState({ url, data: null, error: e instanceof Error ? e.message : "Could not load." }); });
    return () => { live = false; };
  }, [url]);
  return { data: state.url === url ? state.data : null, error: state.url === url ? state.error : "", loading: state.url !== url };
}

/* ------------------------------------------------------------ approvals */

type Category = "Expense requests" | "Voucher reprints" | "Refunds" | "Discounts" | "Rebates owed to partners" | "Cashier closings";
const CATEGORY_GROUPS: [string, Category[]][] = [["Money out", ["Expense requests", "Voucher reprints", "Refunds"]], ["Fees", ["Discounts", "Rebates owed to partners"]], ["Cash control", ["Cashier closings"]]];
type Row = { id: string; title: string; detail: string; ref: string; who: string; when: string; amount: number; act: (approve: boolean) => Promise<unknown>; okLabel: string; canReject: boolean };

/**
 * Approvals by category (owner, 8 Oct 2026): money out (expense requests,
 * voucher reprints, refunds), fees (discounts, rebates owed to partners) and
 * cash control (cashier closings). Full page with a category list; on the
 * dashboard the same lists sit under category tabs.
 */
export function AccountingApprovals({ data, reload, compact }: { data: PortalData; reload: () => Promise<void>; compact?: boolean }) {
  const { busy, msg, post } = usePost(reload);
  const [cat, setCat] = useState<Category | "All">(compact ? "Expense requests" : "All");
  const remarks = (approve: boolean) => (approve ? undefined : window.prompt("Reason for rejecting? (optional)") || undefined);
  const name = (t: { legal_first_name: string; legal_last_name: string } | null) => (t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee");
  const expenses = (data.expenses as (PortalData["expenses"][number] & { purpose?: string; payment_channel?: string | null; request_number?: string | null; requested_by_name?: string | null; line_items?: unknown[] | null })[])
    .filter((e) => e.status === "Pending").map((e): Row => ({ id: e.id, title: `${e.payee} · ${e.category}`, detail: [e.purpose, Array.isArray(e.line_items) && e.line_items.length ? `${e.line_items.length} line${e.line_items.length === 1 ? "" : "s"}` : "", e.payment_channel].filter(Boolean).join(" · "), ref: e.request_number ?? e.expense_number, who: e.requested_by_name ?? "Cashier", when: fmtDate(day(e.created_at)), amount: Number(e.amount_centavos), okLabel: "Approve", canReject: true,
      act: (approve) => post({ action: "expense-decide", id: e.id, decision: approve ? "Approved" : "Rejected", remarks: remarks(approve) }, approve ? "Approved. The voucher number is issued." : "Rejected.") }));
  const byExpense = new Map((data.expenses as { id: string; payee: string; amount_centavos: number; voucher_number?: string | null; expense_number: string }[]).map((e) => [e.id, e]));
  const reprints = (data.expenseReprints ?? []).filter((r) => r.status === "Pending").map((r): Row => { const e = byExpense.get(r.expense_id); return { id: r.id, title: `${e?.voucher_number ?? e?.expense_number ?? "Voucher"} · ${e?.payee ?? ""}`, detail: `Reason: ${r.reason}`, ref: "Reprint", who: r.requested_by_name ?? "Cashier", when: fmtDate(day(r.requested_at)), amount: Number(e?.amount_centavos ?? 0), okLabel: "Approve", canReject: true,
    act: (approve) => post({ action: "expense-reprint-decide", requestId: r.id, decision: approve ? "Approved" : "Rejected", remarks: remarks(approve) }, approve ? "Reprint approved." : "Reprint request rejected.") }; });
  const refunds = data.requests.filter((r) => r.request_type === "Refund" && r.status === "Pending" && r.stage !== "With cashier").map((r): Row => ({ id: r.id, title: `${name(first(r.trainees))} · Refund`, detail: r.reason, ref: first(r.enrollments)?.enrollment_number ?? r.request_number, who: "Cashier", when: fmtDate(day(r.created_at)), amount: Number(r.requested_values?.amountCentavos ?? 0), okLabel: "Approve", canReject: true,
    act: (approve) => post({ action: "request-decide", id: r.id, approve, remarks: remarks(approve) }, approve ? "Refund approved." : "Refund rejected.") }));
  const discounts = (data.pendingDiscounts as (PortalData["pendingDiscounts"][number] & { enrollments?: unknown })[]).map((d): Row => {
    const en = first(d.enrollments as { enrollment_number?: string; trainees?: unknown; courses?: unknown } | { enrollment_number?: string }[] | null) as { enrollment_number?: string; trainees?: unknown; courses?: unknown } | null;
    const c = first(en?.courses as { name: string } | null);
    return { id: d.id, title: `${name(first(en?.trainees as { legal_first_name: string; legal_last_name: string } | null))}${c ? ` · ${c.name}` : ""}`, detail: d.description, ref: en?.enrollment_number ?? "", who: "Cashier", when: fmtDate(day(d.created_at)), amount: Number(d.amount_centavos), okLabel: "Approve", canReject: true,
      act: (approve) => post({ action: "discount-decide", id: d.id, approve }, approve ? "Discount approved." : "Discount rejected.") };
  });
  const rebates = (data.agencyRebates as (PortalData["agencyRebates"][number] & { marketing_agencies?: unknown; courses?: unknown; trainees?: unknown })[]).filter((r) => r.status === "Pending").map((r): Row => ({ id: r.id, title: `${first(r.marketing_agencies as { name: string } | null)?.name ?? "Partner"} · ${name(first(r.trainees as { legal_first_name: string; legal_last_name: string } | null))}`, detail: `${first(r.courses as { name: string } | null)?.name ?? "Course"} · rebate owed (no-deduction partner)`, ref: "Payable", who: "Recorded automatically", when: fmtDate(day(r.created_at)), amount: Number(r.rebate_centavos), okLabel: "Mark paid", canReject: false,
    act: () => post({ action: "agency-rebate-settle", id: r.id, status: "Paid" }, "Rebate marked paid to the partner.") }));
  const closings = data.cashierClosings.filter((c) => c.status === "Submitted").map((c): Row => ({ id: c.id, title: `Cashier closing · ${fmtDate(c.closing_date)}`, detail: `Expected ${pesos2(c.expected_cash_centavos)} · counted ${pesos2(Number(c.actual_cash_centavos ?? 0))}`, ref: Number(c.variance_centavos ?? 0) === 0 ? "Balanced" : Number(c.variance_centavos) < 0 ? `Short ${pesos2(-Number(c.variance_centavos))}` : `Over ${pesos2(Number(c.variance_centavos))}`, who: "Cashier", when: fmtDate(c.closing_date), amount: Number(c.variance_centavos ?? 0), okLabel: "Mark reviewed", canReject: false,
    act: () => post({ action: "cashier-closing-review", id: c.id }, "Closing marked reviewed.") }));
  const lists: Record<Category, Row[]> = { "Expense requests": expenses, "Voucher reprints": reprints, Refunds: refunds, Discounts: discounts, "Rebates owed to partners": rebates, "Cashier closings": closings };
  const waiting = Object.values(lists).reduce((s, l) => s + l.length, 0);
  const rowsOf = (list: Row[]) => list.map((r) => <div className="ac-req" key={r.id}>
    <div><strong>{r.title}</strong>{r.detail && <small>{r.detail}</small>}<small className="cx-mono">{[r.ref, r.who, r.when].filter(Boolean).join(" · ")}</small></div>
    <strong className="cx-amt" style={r.amount < 0 ? { color: "#b42318" } : undefined}>{pesos2(r.amount)}</strong>
    <div className="cx-acts"><button type="button" className="portal-primary" disabled={busy} onClick={() => void r.act(true).catch(() => undefined)}>{r.okLabel}</button>{r.canReject && <button type="button" className="portal-secondary" disabled={busy} onClick={() => void r.act(false).catch(() => undefined)}>Reject</button>}</div>
  </div>);
  const groupOf = (c: Category) => CATEGORY_GROUPS.find(([, cs]) => cs.includes(c))?.[0] ?? "";
  if (compact) {
    const current = cat === "All" ? "Expense requests" : cat;
    return <section className="portal-panel cx-panel ac-approvals">
      <div className="panel-heading"><h2>For your approval</h2><Badge tone={waiting ? "orange" : undefined}>{waiting} waiting</Badge></div>
      {msg && <Message kind={msg.kind} text={msg.text} />}
      <div className="ac-tabs" role="tablist">{(Object.keys(lists) as Category[]).map((k) => <button key={k} type="button" role="tab" aria-selected={current === k} className={current === k ? "on" : ""} onClick={() => setCat(k)}>{k}<span className={lists[k].length ? "" : "zero"}>{lists[k].length}</span></button>)}</div>
      {lists[current].length ? rowsOf(lists[current].slice(0, 6)) : <p className="portal-empty-copy">Nothing waiting.</p>}
    </section>;
  }
  const shown = (Object.keys(lists) as Category[]).filter((k) => cat === "All" || cat === k);
  return <div className="ac-layout">
    <nav className="ac-cats" aria-label="Approval categories">
      <button type="button" className={cat === "All" ? "on" : ""} onClick={() => setCat("All")}>All<span className={waiting ? "" : "zero"}>{waiting}</span></button>
      {CATEGORY_GROUPS.map(([group, cats]) => <div key={group}><div className="ac-grp">{group}</div>{cats.map((k) => <button key={k} type="button" className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{k}<span className={lists[k].length ? "" : "zero"}>{lists[k].length}</span></button>)}</div>)}
    </nav>
    <div className="ac-catlist">
      {msg && <Message kind={msg.kind} text={msg.text} />}
      {shown.map((k) => <section className="portal-panel cx-panel" key={k}><div className="panel-heading"><h2>{k}</h2><span className="muted-text">{groupOf(k)} · {lists[k].length} waiting</span></div>{lists[k].length ? rowsOf(lists[k]) : <p className="portal-empty-copy">Nothing waiting.</p>}</section>)}
    </div>
  </div>;
}

/* ------------------------------------------------------------ payments and expenses (view only) */

type PayDay = Omit<CashierReportSnapshot, "logoBytes">;

/** Payments for one day, view only (owner, 8 Oct 2026): totals per channel, then each receipt with source and proof. */
export function AccountingPayments() {
  const today = manilaToday();
  const [date, setDate] = useState(today), [channel, setChannel] = useState(""), [q, setQ] = useState("");
  const { data: r, error } = useJson<PayDay>(`/api/staff/cashier-report?date=${date}`);
  const rows = r ? r.groups.flatMap((g) => g.rows.map((x) => ({ ...x, source: g.kind === "Direct walk-in" ? "Walk-in" : g.name || g.kind }))) : [];
  const term = q.trim().toLowerCase();
  const shown = rows.filter((x) => (!channel || x.channel === channel) && (!term || `${x.receipt} ${x.trainee} ${x.course} ${x.source}`.toLowerCase().includes(term)));
  const sumOf = (c: string) => rows.filter((x) => x.channel === c).reduce((s, x) => s + x.amountCentavos, 0);
  const countOf = (c: string) => rows.filter((x) => x.channel === c).length;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Payments</h1></div><DayPicker date={date} setDate={setDate} /></div>
    <p className="ac-note">{longDay(date)} · <span className="ac-ro">View only — the Cashier records payments</span></p>
    {error && <Message kind="error" text={error} />}
    <div className="cx-tiles ac-tiles">{CHANNELS.map((c) => <div className="cx-tile" key={c} style={{ ["--c" as string]: COLORS[c] }}><span>{c}</span><b>{pesos2(sumOf(c))}</b><small>{countOf(c)} receipt{countOf(c) === 1 ? "" : "s"}</small></div>)}
      <div className="cx-tile ac-total"><span>Total collected</span><b>{pesos2(rows.reduce((s, x) => s + x.amountCentavos, 0))}</b><small>{rows.length} receipt{rows.length === 1 ? "" : "s"}</small></div></div>
    <div className="cx-bar"><label className="cx-dt">Channel<select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All channels</option>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label><input className="vx-search" aria-label="Search payments" placeholder="Search receipt, trainee, course or partner" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <section className="portal-panel cx-panel">{!r ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : shown.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Receipt</th><th>Trainee</th><th>Source</th><th>Channel</th><th>Reference and proof</th><th className="r">Amount</th></tr></thead><tbody>
      {shown.map((x, i) => <tr key={`${x.receipt}-${i}`}><td data-l="" className="lead"><span className="cx-name cx-mono">{x.receipt}</span><small>{x.time}</small></td><td data-l="Trainee">{x.trainee}<small>{x.course}</small></td><td data-l="Source">{x.source}</td><td data-l="Channel">{x.channel}</td><td data-l="Reference and proof">{x.reference || "—"}<small className={x.proof ? "ac-up" : ""}>{x.proof ? "Screenshot uploaded" : "Manual entry"}</small></td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(x.amountCentavos)}</strong></td></tr>)}
    </tbody></table></div> : <p className="portal-empty-copy">No payments on this day.</p>}</section>
  </div>;
}

/** Expenses for one day, view only (owner, 8 Oct 2026): released per channel, then every voucher recorded or released that day. */
export function AccountingExpenses({ data }: { data: PortalData }) {
  const today = manilaToday();
  const [date, setDate] = useState(today);
  type Ex = PortalData["expenses"][number] & { payment_channel?: string | null; reference_number?: string | null; voucher_number?: string | null; paid_at?: string | null; approved_at?: string | null };
  const list = (data.expenses as Ex[]).filter((e) => day(e.created_at) === date || day(e.paid_at) === date || day(e.approved_at) === date).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const released = list.filter((e) => e.status === "Paid" && day(e.paid_at) === date);
  const sumOf = (c: string) => released.filter((e) => e.payment_channel === c).reduce((s, e) => s + Number(e.amount_centavos), 0);
  const label = (e: Ex) => (e.status === "Paid" ? "Released" : e.status === "Approved" ? "Awaiting release" : e.status === "Pending" ? "For approval" : e.status);
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Expenses</h1></div><DayPicker date={date} setDate={setDate} /></div>
    <p className="ac-note">{longDay(date)} · <span className="ac-ro">View only — the Cashier records and releases expenses</span></p>
    <div className="cx-tiles ac-tiles">{CHANNELS.map((c) => <div className="cx-tile" key={c} style={{ ["--c" as string]: COLORS[c] }}><span>{c}</span><b>{pesos2(sumOf(c))}</b><small>{released.filter((e) => e.payment_channel === c).length} released</small></div>)}
      <div className="cx-tile ac-total"><span>Total released</span><b>{pesos2(released.reduce((s, e) => s + Number(e.amount_centavos), 0))}</b><small>{list.filter((e) => e.status === "Approved").length} awaiting release</small></div></div>
    <section className="portal-panel cx-panel">{list.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Voucher</th><th>Payee</th><th>Channel</th><th>Status</th><th className="r">Amount</th></tr></thead><tbody>
      {list.map((e) => <tr key={e.id}><td data-l="" className="lead"><span className="cx-name cx-mono">{e.voucher_number ?? e.expense_number}</span><small>{fmtDate(day(e.created_at))}</small></td><td data-l="Payee"><strong>{e.payee}</strong><small>{e.category}</small></td><td data-l="Channel">{e.payment_channel || "—"}{e.reference_number ? <small className="cx-mono">{e.reference_number}</small> : null}</td><td data-l="Status"><Badge tone={e.status === "Paid" ? "green" : e.status === "Rejected" ? "red" : e.status === "Pending" ? "orange" : "blue"}>{label(e)}</Badge></td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(e.amount_centavos)}</strong></td></tr>)}
    </tbody></table></div> : <p className="portal-empty-copy">No expenses on this day.</p>}</section>
    <p className="ac-note">Expense requests waiting for your decision are in Approvals › Expense requests.</p>
  </div>;
}

function DayPicker({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const today = manilaToday();
  return <div className="ac-day"><button type="button" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>‹</button><input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /><button type="button" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</button></div>;
}

/* ------------------------------------------------------------ dashboard */

type DayReport = Omit<CashierReportSnapshot, "logoBytes">;

export function AccountingHome({ data, reload, go }: { data: PortalData; reload: () => Promise<void>; go: (module: string) => void }) {
  const today = manilaToday();
  const [date, setDate] = useState(today);
  const dayReport = useJson<DayReport>(`/api/staff/cashier-report?date=${date}`);
  const week = useJson<AccountingReport>(`/api/staff/accounting-report?period=Daily&end=${date}`);
  const r = dayReport.data, w = week.data;
  const colOf = (c: string) => r ? r.matrix.reduce((s, m) => s + (m.cells.find((x) => x.channel === c)?.totalCentavos ?? 0), 0) : 0;
  const countOf = (c: string) => r ? r.matrix.reduce((s, m) => s + (m.cells.find((x) => x.channel === c)?.count ?? 0), 0) : 0;
  const total = CHANNELS.reduce((s, c) => s + colOf(c), 0), receipts = CHANNELS.reduce((s, c) => s + countOf(c), 0);
  const durations = new Map(data.courses.map((c) => [c.id, c.duration_label]));
  const unpaid = unpaidAfterTraining(data.enrollments as unknown as BalanceEnrollment[], (id) => durations.get(id), today);
  const last7 = w ? w.series.slice(-7) : [];
  const p = r?.position;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Dashboard</h1></div>
      <div className="ac-day"><button type="button" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>‹</button><input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /><button type="button" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</button></div></div>
    <p className="ac-note">{longDay(date)} · view only — the Cashier records payments and expenses.</p>
    <AccountingApprovals data={data} reload={reload} compact />

    <h3 className="ac-sec">Collections</h3>
    {dayReport.error && <Message kind="error" text={dayReport.error} />}
    <div className="cx-tiles ac-tiles">
      {CHANNELS.map((c) => <div className="cx-tile" key={c} style={{ ["--c" as string]: COLORS[c] }}><span>{c}</span><b>{pesos2(colOf(c))}</b><small>{countOf(c)} receipt{countOf(c) === 1 ? "" : "s"}</small></div>)}
      <div className="cx-tile ac-total"><span>Total collected</span><b>{pesos2(total)}</b><small>{receipts} receipt{receipts === 1 ? "" : "s"}</small></div>
    </div>
    {r && <p className="ac-split">{r.matrix.map((m) => <span key={m.source}>{m.source} <b className="cx-mono">{pesos2(m.totalCentavos)}</b></span>)}</p>}

    <div className="ac-grid2">
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Last 7 days</h2><span className="muted-text">collections and expenses</span></div>
        {last7.length ? <BarChart label="Collections and expenses, last 7 days" labels={last7.map((b) => b.label)} series={[{ name: "Collections", color: "#0571D0", values: last7.map((b) => b.collections) }, { name: "Expenses released", color: "#F25615", values: last7.map((b) => b.expenses) }]} /> : <p className="portal-empty-copy">{week.error || "Loading…"}</p>}
      </section>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>By channel</h2><span className="muted-text">{fmtDate(date)}</span></div>
        <Donut label="Collections by channel" parts={CHANNELS.map((c) => ({ name: c, color: COLORS[c], value: colOf(c) }))} />
      </section>
    </div>

    <div className="ac-grid2">
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Expenses released</h2><strong className="cx-mono">{pesos2(r ? r.expenses.reduce((s, e) => s + e.amountCentavos, 0) : 0)}</strong></div>
        {r && r.expenseTotals.length ? <HBars rows={r.expenseTotals.map((t) => ({ name: t.channel, value: t.totalCentavos, color: COLORS[t.channel] }))} /> : <p className="portal-empty-copy">No expenses released.</p>}
        <div className="ac-more"><button type="button" onClick={() => go("Expenses")}>View vouchers</button></div>
      </section>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Cash position</h2><span className="muted-text">cash only</span></div>
        {p ? <dl className="ac-sum">
          <div><dt>Previous cash</dt><dd>{pesos2(p.previousCentavos)}</dd><small>{p.previousNote}</small></div>
          <div className="plus"><dt>+ Cash collected</dt><dd>{pesos2(p.cashCollectedCentavos)}</dd></div>
          <div className="minus"><dt>− Cash expenses</dt><dd>{pesos2(p.cashExpensesCentavos)}</dd></div>
          <div className="eq"><dt>= Cash on hand</dt><dd>{pesos2(p.onHandCentavos)}</dd></div>
          <div><dt>Counted at closing</dt><dd>{p.countedCentavos == null ? "Not yet" : pesos2(p.countedCentavos)}</dd></div>
          <div className={p.overShortCentavos ? (p.overShortCentavos < 0 ? "minus" : "plus") : ""}><dt>Over / short</dt><dd>{p.overShortCentavos == null ? "—" : pesos2(p.overShortCentavos)}</dd></div>
        </dl> : <p className="portal-empty-copy">Loading…</p>}
      </section>
    </div>

    <div className="ac-grid2">
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Rebates</h2></div>
        <dl className="ac-sum"><div><dt>Deducted from payments</dt><dd>{pesos2(w?.current.rebatesDeducted ?? 0)}</dd><small>{fmtDate(date)}</small></div><div><dt>Owed to agencies</dt><dd className="warn">{pesos2(w?.current.rebatesOwed ?? 0)}</dd></div></dl>
        {w && w.current.owedByAgency.length > 0 && <div className="portal-table cx-cards"><table><tbody>{w.current.owedByAgency.slice(0, 5).map((o) => <tr key={o.name}><td data-l="" className="lead">{o.name}</td><td data-l="Trainees">{o.count} trainee{o.count === 1 ? "" : "s"}</td><td data-l="Owed" className="r cx-amt">{pesos2(o.total)}</td></tr>)}</tbody></table></div>}
        <div className="ac-more"><button type="button" onClick={() => go("Payables")}>View payables</button></div>
      </section>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Unpaid after training</h2></div>
        <dl className="ac-sum"><div><dt>Balance</dt><dd className="bad">{pesos2(unpaid.reduce((s, u) => s + u.balanceCentavos, 0))}</dd></div><div><dt>Trainees</dt><dd>{new Set(unpaid.map((u) => u.traineeId)).size}</dd></div></dl>
        <div className="ac-more"><button type="button" onClick={() => go("Receivables")}>View receivables</button></div>
      </section>
    </div>
  </div>;
}

/* ------------------------------------------------------------ reports */

export function AccountingReports() {
  const today = manilaToday();
  const [period, setPeriod] = useState<Period>("Monthly");
  const [end, setEnd] = useState(today);
  const { data: rep, error } = useJson<AccountingReport>(`/api/staff/accounting-report?period=${period}&end=${end}`);
  const c = rep?.current;
  const d1 = rep ? percentChange(rep.current.collections, rep.previous.collections) : null, d2 = rep ? percentChange(rep.current.expenses, rep.previous.expenses) : null;
  const channels = c ? CHANNELS.map((ch) => ({ name: ch, color: COLORS[ch], value: c.byChannel[ch] ?? 0 })) : [];
  const topChannel = channels.slice().sort((a, b) => b.value - a.value)[0];
  const net = c ? c.collections - c.expenses : 0;
  const partnerShare = c && c.collections ? Math.round((100 * ((c.bySource.Agencies ?? 0) + (c.bySource.Consultancies ?? 0))) / c.collections) : 0;
  const change = (v: number | null, goodWhenUp: boolean) => v == null ? <small>no earlier figures</small> : <small className={(v >= 0) === goodWhenUp ? "ac-up" : "ac-down"}>{v >= 0 ? "▲" : "▼"} {Math.abs(v)}% vs {rep?.previousLabel}</small>;
  const exportCsv = () => { if (!rep) return; downloadCsv(`accounting-${period.toLowerCase()}-${end}.csv`, [["Period", "From", "To", "Collections (PHP)", "Expenses released (PHP)", "Net (PHP)"], ...rep.series.map((b) => [b.label, b.from, b.to, (b.collections / 100).toFixed(2), (b.expenses / 100).toFixed(2), ((b.collections - b.expenses) / 100).toFixed(2)])]); };
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Reports</h1></div>
      <div className="ac-controls"><div className="cx-seg" role="tablist">{PERIODS.map((p) => <button key={p} type="button" className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>{p}</button>)}</div>
        <label className="cx-dt">As of<input type="date" value={end} max={today} onChange={(e) => e.target.value && setEnd(e.target.value)} /></label>
        <button type="button" className="portal-secondary" disabled={!rep} onClick={exportCsv}>Download Excel (CSV)</button></div></div>
    {error && <Message kind="error" text={error} />}
    {!rep && !error && <p className="portal-empty-copy">Loading the report…</p>}
    {rep && c && <>
      <p className="ac-note">{rep.title} · compared with {rep.previousLabel}</p>
      <div className="cx-tiles ac-tiles">
        <div className="cx-tile" style={{ ["--c" as string]: "#0571D0" }}><span>Collections</span><b>{pesos2(c.collections)}</b>{change(d1, true)}</div>
        <div className="cx-tile" style={{ ["--c" as string]: "#F25615" }}><span>Expenses released</span><b>{pesos2(c.expenses)}</b>{change(d2, false)}</div>
        <div className="cx-tile" style={{ ["--c" as string]: "#0a7a3e" }}><span>Net cash flow</span><b>{pesos2(net)}</b><small>collections − expenses</small></div>
        <div className="cx-tile" style={{ ["--c" as string]: "#35CCFA" }}><span>Rebates</span><b>{pesos2(c.rebatesDeducted)}</b><small>deducted · {pesos2(c.rebatesOwed)} owed</small></div>
        <div className="cx-tile ac-total"><span>Receipts issued</span><b>{c.receipts.toLocaleString("en-PH")}</b><small>{rep.title.replace(" (to date)", "")}</small></div>
      </div>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Summary</h2></div><ul className="ac-insights">
        <li>Collections were <b>{pesos2(c.collections)}</b>{d1 == null ? "" : `, ${d1 >= 0 ? "up" : "down"} ${Math.abs(d1)}% from ${rep.previousLabel}`}.{topChannel && topChannel.value > 0 ? <> <b>{topChannel.name}</b> brought in the most ({Math.round((100 * topChannel.value) / c.collections)}%).</> : null}</li>
        <li>Expenses released were <b>{pesos2(c.expenses)}</b>{c.byCategory[0] ? <>; the largest category was <b>{c.byCategory[0].name}</b> ({pesos2(c.byCategory[0].total)})</> : null}.</li>
        <li>Net cash flow was <b>{pesos2(net)}</b>. Agencies and consultancies made up {partnerShare}% of collections.</li>
        <li>Rebates deducted from payments came to <b>{pesos2(c.rebatesDeducted)}</b>; <b>{pesos2(c.rebatesOwed)}</b> is owed to {c.owedByAgency.length} agenc{c.owedByAgency.length === 1 ? "y" : "ies"}.</li>
        <li>{c.closings.count} cashier closing{c.closings.count === 1 ? "" : "s"}, {c.closings.reviewed} reviewed, total over / short <b>{pesos2(c.closings.overShort)}</b>.</li>
      </ul></section>
      <div className="ac-grid2">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections and expenses</h2><span className="muted-text">{period.toLowerCase()} trend</span></div>
          <BarChart label={`${period} collections and expenses`} labels={rep.series.map((b) => b.label)} series={[{ name: "Collections", color: "#0571D0", values: rep.series.map((b) => b.collections) }, { name: "Expenses released", color: "#F25615", values: rep.series.map((b) => b.expenses) }]} /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections by channel</h2></div><Donut label="Collections by channel" parts={channels} /></section>
      </div>
      <div className="ac-grid2">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections by source</h2></div><HBars rows={Object.entries(c.bySource).map(([name, value]) => ({ name, value, color: SOURCE_COLORS[name] }))} /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Expenses by category</h2></div>{c.byCategory.length ? <HBars rows={c.byCategory.slice(0, 6).map((x, i) => ({ name: x.name, value: x.total, color: CATEGORY_COLORS[i] }))} /> : <p className="portal-empty-copy">No expenses released.</p>}</section>
      </div>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Top courses by collections</h2></div>
        {c.topCourses.length ? <div className="portal-table cx-cards"><table><tbody>{c.topCourses.map((x, i) => <tr key={x.name}><td data-l="" className="lead cx-mono">{i + 1}</td><td data-l="Course">{x.name}</td><td data-l="Collected" className="r cx-amt">{pesos2(x.total)}</td></tr>)}</tbody></table></div> : <p className="portal-empty-copy">No collections in this period.</p>}
      </section>
    </>}
  </div>;
}
