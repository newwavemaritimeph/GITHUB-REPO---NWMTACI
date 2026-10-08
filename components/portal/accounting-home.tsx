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

type ApprovalTab = "Expenses" | "Voucher reprints" | "Discounts" | "Refunds" | "Closings";
type Row = { id: string; title: string; detail: string; ref: string; who: string; when: string; amount: number; act: (approve: boolean) => Promise<unknown>; reviewOnly?: boolean };

export function AccountingApprovals({ data, reload, compact }: { data: PortalData; reload: () => Promise<void>; compact?: boolean }) {
  const { busy, msg, post } = usePost(reload);
  const [tab, setTab] = useState<ApprovalTab>("Expenses");
  const remarks = (approve: boolean) => (approve ? undefined : window.prompt("Reason for rejecting? (optional)") || undefined);
  const expenses = (data.expenses as (PortalData["expenses"][number] & { purpose?: string; payment_channel?: string | null; request_number?: string | null; requested_by_name?: string | null; line_items?: unknown[] | null })[])
    .filter((e) => e.status === "Pending").map((e): Row => ({ id: e.id, title: `${e.payee} · ${e.category}`, detail: [e.purpose, Array.isArray(e.line_items) && e.line_items.length ? `${e.line_items.length} line${e.line_items.length === 1 ? "" : "s"}` : "", e.payment_channel].filter(Boolean).join(" · "), ref: e.request_number ?? e.expense_number, who: e.requested_by_name ?? "Cashier", when: fmtDate(day(e.created_at)), amount: Number(e.amount_centavos),
      act: (approve) => post({ action: "expense-decide", id: e.id, decision: approve ? "Approved" : "Rejected", remarks: remarks(approve) }, approve ? "Approved. The voucher number is issued." : "Rejected.") }));
  const byExpense = new Map((data.expenses as { id: string; payee: string; amount_centavos: number; voucher_number?: string | null; expense_number: string }[]).map((e) => [e.id, e]));
  const reprints = (data.expenseReprints ?? []).filter((r) => r.status === "Pending").map((r): Row => { const e = byExpense.get(r.expense_id); return { id: r.id, title: `${e?.voucher_number ?? e?.expense_number ?? "Voucher"} · ${e?.payee ?? ""}`, detail: r.reason, ref: "Reprint", who: r.requested_by_name ?? "Cashier", when: fmtDate(day(r.requested_at)), amount: Number(e?.amount_centavos ?? 0),
    act: (approve) => post({ action: "expense-reprint-decide", requestId: r.id, decision: approve ? "Approved" : "Rejected", remarks: remarks(approve) }, approve ? "Reprint approved." : "Reprint request rejected.") }; });
  const discounts = (data.pendingDiscounts as (PortalData["pendingDiscounts"][number] & { enrollments?: unknown; marketing_agencies?: unknown })[]).map((d): Row => {
    const en = first(d.enrollments as { enrollment_number?: string; trainees?: unknown; courses?: unknown } | { enrollment_number?: string }[] | null) as { enrollment_number?: string; trainees?: unknown; courses?: unknown } | null;
    const t = first(en?.trainees as { legal_first_name: string; legal_last_name: string } | null), c = first(en?.courses as { name: string } | null);
    return { id: d.id, title: `${t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee"}${c ? ` · ${c.name}` : ""}`, detail: d.description, ref: en?.enrollment_number ?? "", who: "Cashier", when: fmtDate(day(d.created_at)), amount: Number(d.amount_centavos),
      act: (approve) => post({ action: "discount-decide", id: d.id, approve }, approve ? "Discount approved." : "Discount rejected.") };
  });
  const refunds = data.requests.filter((r) => r.request_type === "Refund" && r.status === "Pending" && r.stage !== "With cashier").map((r): Row => { const t = first(r.trainees), en = first(r.enrollments); return { id: r.id, title: `${t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee"} · Refund`, detail: r.reason, ref: en?.enrollment_number ?? r.request_number, who: "Cashier", when: fmtDate(day(r.created_at)), amount: Number(r.requested_values?.amountCentavos ?? 0),
    act: (approve) => post({ action: "request-decide", id: r.id, approve, remarks: remarks(approve) }, approve ? "Refund approved." : "Refund rejected.") }; });
  const closings = data.cashierClosings.filter((c) => c.status === "Submitted").map((c): Row => ({ id: c.id, title: `Cashier closing · ${fmtDate(c.closing_date)}`, detail: `Expected ${pesos2(c.expected_cash_centavos)} · counted ${pesos2(Number(c.actual_cash_centavos ?? 0))}`, ref: Number(c.variance_centavos ?? 0) === 0 ? "Balanced" : Number(c.variance_centavos) < 0 ? `Short ${pesos2(-Number(c.variance_centavos))}` : `Over ${pesos2(Number(c.variance_centavos))}`, who: "Cashier", when: fmtDate(c.closing_date), amount: Number(c.variance_centavos ?? 0), reviewOnly: true,
    act: () => post({ action: "cashier-closing-review", id: c.id }, "Closing marked reviewed.") }));
  const lists: Record<ApprovalTab, Row[]> = { Expenses: expenses, "Voucher reprints": reprints, Discounts: discounts, Refunds: refunds, Closings: closings };
  const waiting = Object.values(lists).reduce((s, l) => s + l.length, 0);
  const rows = lists[tab];
  return <section className="portal-panel cx-panel ac-approvals">
    <div className="panel-heading"><h2>For your approval</h2><Badge tone={waiting ? "orange" : undefined}>{waiting} waiting</Badge></div>
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="ac-tabs" role="tablist">{(Object.keys(lists) as ApprovalTab[]).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k}<span className={lists[k].length ? "" : "zero"}>{lists[k].length}</span></button>)}</div>
    {rows.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Request</th><th>Requested by</th><th className="r">Amount</th><th></th></tr></thead><tbody>
      {(compact ? rows.slice(0, 6) : rows).map((r) => <tr key={r.id}>
        <td data-l="" className="lead"><span className="cx-name">{r.title}</span>{r.detail && <small>{r.detail}</small>}{r.ref && <small className="cx-mono">{r.ref}</small>}</td>
        <td data-l="Requested by">{r.who}<small>{r.when}</small></td>
        <td data-l="Amount" className="r"><strong className="cx-amt" style={r.amount < 0 ? { color: "#b42318" } : undefined}>{pesos2(r.amount)}</strong></td>
        <td data-l=""><div className="cx-acts">{r.reviewOnly
          ? <button type="button" className="portal-primary" disabled={busy} onClick={() => void r.act(true).catch(() => undefined)}>Mark reviewed</button>
          : <><button type="button" className="portal-primary" disabled={busy} onClick={() => void r.act(true).catch(() => undefined)}>Approve</button><button type="button" className="portal-secondary" disabled={busy} onClick={() => void r.act(false).catch(() => undefined)}>Reject</button></>}</div></td>
      </tr>)}
    </tbody></table></div> : <p className="portal-empty-copy">Nothing waiting.</p>}
  </section>;
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
