"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { PortalData } from "../portal-live-app";
import { addDays, first, manilaToday, pesos2 } from "@/lib/portal-format";
import { Badge, Message, fmtDate, usePost, usePaged } from "./shared-ui";
import { BarChart, Donut, HBars } from "./charts";
import { EXPENSE_REASONS, REQUEST_REASONS, RejectInline } from "./reject-inline";
import { PERIODS, percentChange, periodStart, type Period } from "@/lib/accounting-periods";
import { channelTotal, channelsUsed, sideTotal, type FinanceSummary, type Line } from "@/lib/finance-summary";
import type { AccountingReport } from "@/lib/accounting-report";
import type { CashierReportSnapshot } from "@/lib/documents";
import { unpaidAfterTraining, type BalanceEnrollment } from "@/lib/unpaid-balances";
import { downloadCsv } from "@/lib/csv";
import { tcl } from "@/lib/title-case";

/**
 * Accounting Manager (owner, 8 Oct 2026): a view-first dashboard like the
 * Cashier's with her approvals on top, an Approvals page, and one Reports page
 * for daily, weekly, monthly, quarterly and annual figures — half text, half charts.
 * Payments and expenses are recorded by the Cashier; she approves and reviews.
 */

const COLORS: Record<string, string> = { Cash: "#0a7a3e", GCash: "#0571D0", PSBank: "#F25615", UnionBank: "#7a3fb8", Cheque: "#5d6f7e" };
const CHANNELS = ["Cash", "GCash", "PSBank", "UnionBank", "Cheque"];
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

type Category = "Expense requests" | "Requisitions" | "Voucher reprints" | "Refunds" | "Discounts" | "Rebates owed to partners" | "Cashier closings";
const CATEGORY_GROUPS: [string, Category[]][] = [["Money out", ["Expense requests", "Requisitions", "Voucher reprints", "Refunds"]], ["Fees", ["Discounts", "Rebates owed to partners"]], ["Cash control", ["Cashier closings"]]];
/** Receipt photos the Cashier attached (owner, 19 Oct 2026), opened in Google Drive. */
function ApprovalReceipts({ files }: { files: { fileId: string; link: string }[] }) {
  return files.length
    ? <small className="ap-receipts">{files.map((f, i) => <a key={f.fileId} href={f.link} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>Receipt {i + 1}</a>)}</small>
    : <small className="ap-receipts none">No receipt photo</small>;
}
type Row = { id: string; title: string; detail: string; receipts?: { fileId: string; link: string }[]; ref: string; who: string; when: string; amount: number; act: (approve: boolean, remarks?: string) => Promise<unknown>; okLabel: string; canReject: boolean };

/**
 * Approvals by category (owner, 8 Oct 2026): money out (expense requests,
 * voucher reprints, refunds), fees (discounts, rebates owed to partners) and
 * cash control (cashier closings). Full page with a category list; on the
 * dashboard the same lists sit under category tabs.
 */
export function AccountingApprovals({ data, reload, compact }: { data: PortalData; reload: () => Promise<void>; compact?: boolean }) {
  const { busy, msg, post } = usePost(reload);
  const [cat, setCat] = useState<Category | "All">(compact ? "Expense requests" : "All");
  // Rejecting opens a reason row in place (design 2); the reason is required.
  const [rejecting, setRejecting] = useState<string | null>(null);
  // Full page: tick several and approve them together (owner's choice, design 5, 8 Oct 2026).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState("");
  const [doneNote, setDoneNote] = useState("");
  const name = (t: { legal_first_name: string; legal_last_name: string } | null) => (t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee");
  const expenses = (data.expenses as (PortalData["expenses"][number] & { purpose?: string; payment_channel?: string | null; request_number?: string | null; requested_by_name?: string | null; line_items?: unknown[] | null; receipt_files?: { fileId: string; link: string }[] | null })[])
    .filter((e) => e.status === "Pending").map((e): Row => ({ id: e.id, receipts: e.receipt_files ?? [], title: `${e.payee} · ${e.category}`, detail: [e.purpose, Array.isArray(e.line_items) && e.line_items.length ? `${e.line_items.length} line${e.line_items.length === 1 ? "" : "s"}` : "", e.payment_channel].filter(Boolean).join(" · "), ref: e.request_number ?? e.expense_number, who: e.requested_by_name ?? "Cashier", when: fmtDate(day(e.created_at)), amount: Number(e.amount_centavos), okLabel: "Approve", canReject: true,
      act: (approve, remarks) => post({ action: "expense-decide", id: e.id, decision: approve ? "Approved" : "Rejected", remarks }, approve ? "Approved. The voucher number is issued." : "Rejected.") }));
  const byExpense = new Map((data.expenses as { id: string; payee: string; amount_centavos: number; voucher_number?: string | null; expense_number: string }[]).map((e) => [e.id, e]));
  const reprints = (data.expenseReprints ?? []).filter((r) => r.status === "Pending").map((r): Row => { const e = byExpense.get(r.expense_id); return { id: r.id, title: `${e?.voucher_number ?? e?.expense_number ?? "Voucher"} · ${e?.payee ?? ""}`, detail: `Reason: ${r.reason}`, ref: "Reprint", who: r.requested_by_name ?? "Cashier", when: fmtDate(day(r.requested_at)), amount: Number(e?.amount_centavos ?? 0), okLabel: "Approve", canReject: true,
    act: (approve, remarks) => post({ action: "expense-reprint-decide", requestId: r.id, decision: approve ? "Approved" : "Rejected", remarks }, approve ? "Reprint approved." : "Reprint request rejected.") }; });
  const refunds = data.requests.filter((r) => r.request_type === "Refund" && r.status === "Pending" && r.stage !== "With cashier").map((r): Row => ({ id: r.id, title: `${name(first(r.trainees))} · Refund`, detail: r.reason, ref: first(r.enrollments)?.enrollment_number ?? r.request_number, who: "Cashier", when: fmtDate(day(r.created_at)), amount: Number(r.requested_values?.amountCentavos ?? 0), okLabel: "Approve", canReject: true,
    act: (approve, remarks) => post({ action: "request-decide", id: r.id, approve, remarks }, approve ? "Refund approved." : "Refund rejected.") }));
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
  // Admin Assistant requisitions (owner, 9 Oct 2026): approval issues a voucher for the Cashier.
  type Req = { id: string; requisition_number: string; purpose: string; lines?: { description: string; quantity: number }[]; total_centavos: number; status: string; created_at: string; requester?: { complete_name: string } | { complete_name: string }[] | null };
  const requisitions = ((data as unknown as { requisitions?: Req[] }).requisitions ?? []).filter((r) => r.status === "For Approval").map((r): Row => ({ id: r.id, title: `Requisition · ${r.purpose}`, detail: (r.lines ?? []).map((l) => `${l.description} × ${l.quantity}`).join(", "), ref: r.requisition_number, who: first(r.requester)?.complete_name ?? "Admin Assistant", when: fmtDate(day(r.created_at)), amount: Number(r.total_centavos), okLabel: "Approve", canReject: true,
    act: (approve, remarks) => post({ action: "requisition-decide", id: r.id, approve, remarks }, approve ? "Approved. The voucher is with the Cashier." : "Rejected.") }));
  const lists: Record<Category, Row[]> = { "Expense requests": expenses, Requisitions: requisitions, "Voucher reprints": reprints, Refunds: refunds, Discounts: discounts, "Rebates owed to partners": rebates, "Cashier closings": closings };
  const waiting = Object.values(lists).reduce((s, l) => s + l.length, 0);
  const rowsOf = (list: Row[]) => list.map((r) => <div key={r.id} className={rejecting && rejecting !== r.id ? "ac-dim" : undefined}>
    <div className={`ac-req${rejecting === r.id ? " ac-rejecting" : ""}`}>
      <div><strong>{r.title}</strong>{r.detail && <small>{r.detail}</small>}{r.receipts && <ApprovalReceipts files={r.receipts} />}<small className="cx-mono">{[r.ref, r.who, r.when].filter(Boolean).join(" · ")}</small></div>
      <strong className="cx-amt" style={r.amount < 0 ? { color: "#b42318" } : undefined}>{pesos2(r.amount)}</strong>
      {rejecting === r.id ? <span className="ac-rejlabel">Rejecting</span> : <div className="cx-acts"><button type="button" className="portal-primary" disabled={busy || !!rejecting} onClick={() => void r.act(true).catch(() => undefined)}>{r.okLabel}</button>{r.canReject && <button type="button" className="portal-secondary" disabled={busy || !!rejecting} onClick={() => setRejecting(r.id)}>Reject</button>}</div>}
    </div>
    {rejecting === r.id && <RejectInline reasons={expenses.some((x) => x.id === r.id) || requisitions.some((x) => x.id === r.id) ? EXPENSE_REASONS : REQUEST_REASONS} busy={busy} onCancel={() => setRejecting(null)} onReject={(why) => void r.act(false, why).then(() => setRejecting(null)).catch(() => undefined)} />}
  </div>);
  const groupOf = (c: Category) => CATEGORY_GROUPS.find(([, cs]) => cs.includes(c))?.[0] ?? "";
  if (compact) {
    const current = cat === "All" ? "Expense requests" : cat;
    return <section className="portal-panel cx-panel ac-approvals">
      <div className="panel-heading"><h2>For Your Approval</h2><Badge tone={waiting ? "orange" : undefined}>{waiting} waiting</Badge></div>
      {msg && <Message kind={msg.kind} text={msg.text} />}
      <div className="ac-tabs" role="tablist">{(Object.keys(lists) as Category[]).map((k) => <button key={k} type="button" role="tab" aria-selected={current === k} className={current === k ? "on" : ""} onClick={() => setCat(k)}>{tcl(k)}<span className={lists[k].length ? "" : "zero"}>{lists[k].length}</span></button>)}</div>
      {lists[current].length ? rowsOf(lists[current].slice(0, 6)) : <p className="portal-empty-copy">Nothing waiting.</p>}
    </section>;
  }
  // Checklist with bulk approve: only categories with requests get a group; empty ones are listed in one line.
  const cats = Object.keys(lists) as Category[];
  const filled = cats.filter((k) => lists[k].length && (cat === "All" || cat === k));
  const empty = cats.filter((k) => !lists[k].length);
  const all = cats.flatMap((k) => lists[k]);
  const chosen = all.filter((r) => picked.has(r.id));
  const chosenTotal = chosen.filter((r) => !closings.includes(r)).reduce((s, r) => s + r.amount, 0);
  const visible = filled.flatMap((k) => lists[k]);
  const toggle = (id: string) => { setDoneNote(""); setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  async function approveChosen() {
    let done = 0;
    for (const r of chosen) {
      setBulk(`Approving ${done + 1} of ${chosen.length}…`);
      try { await r.act(true); done += 1; } catch { break; }
    }
    setBulk(""); setPicked(new Set());
    setDoneNote(done === chosen.length ? `${done} approved.` : `${done} of ${chosen.length} approved; the next one could not be completed.`);
  }
  return <div className="ac-check">
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="chips ac-chipbar">
      <button type="button" className={`ac-chip${cat === "All" ? " on" : ""}`} onClick={() => setCat("All")}>All<span className={waiting ? "has" : ""}>{waiting}</span></button>
      {cats.map((k) => <button key={k} type="button" className={`ac-chip${cat === k ? " on" : ""}${lists[k].length ? "" : " zero"}`} onClick={() => setCat(k)}>{tcl(k)}<span className={lists[k].length ? "has" : ""}>{lists[k].length}</span></button>)}
    </div>
    {waiting > 0 && <div className="ac-bulk">
      <span><b className="cx-mono">{chosen.length}</b> selected · <b className="cx-mono">{pesos2(chosenTotal)}</b></span>
      <span className="ac-bulk-sp">{bulk || doneNote}</span>
      <button type="button" disabled={busy || !!bulk || !visible.length} onClick={() => setPicked(chosen.length === visible.length && visible.every((r) => picked.has(r.id)) ? new Set() : new Set(visible.map((r) => r.id)))}>{visible.length && visible.every((r) => picked.has(r.id)) ? "Clear selection" : "Select all"}</button>
      <button type="button" className="go" disabled={busy || !!bulk || !chosen.length} onClick={() => void approveChosen()}>Approve Selected</button>
    </div>}
    <section className="portal-panel cx-panel">
      {filled.length ? filled.map((k) => <div key={k} className="ac-group">
        <div className="ac-ghead"><h2>{tcl(k)}</h2><span className="muted-text">{groupOf(k)} · {lists[k].length} waiting</span></div>
        {lists[k].map((r) => <div key={r.id} className={rejecting && rejecting !== r.id ? "ac-dim" : undefined}>
          <div className={`ac-crow${rejecting === r.id ? " ac-rejecting" : ""}`}>
            <input type="checkbox" id={`ap-${r.id}`} checked={picked.has(r.id)} disabled={!!bulk} onChange={() => toggle(r.id)} aria-label={`Select ${r.title}`} />
            <label htmlFor={`ap-${r.id}`}><strong>{r.title}</strong>{r.detail && <small>{r.detail}</small>}{r.receipts && <ApprovalReceipts files={r.receipts} />}<small className="cx-mono">{[r.ref, r.who, r.when].filter(Boolean).join(" · ")}</small></label>
            <strong className="cx-amt" style={r.amount < 0 ? { color: "#b42318" } : undefined}>{pesos2(r.amount)}</strong>
            {rejecting === r.id ? <span className="ac-rejlabel">Rejecting</span> : <div className="cx-acts">{r.canReject && <button type="button" className="portal-secondary" disabled={busy || !!rejecting || !!bulk} onClick={() => setRejecting(r.id)}>Reject</button>}<button type="button" className="portal-primary" disabled={busy || !!rejecting || !!bulk} onClick={() => void r.act(true).then(() => setPicked((p) => { const n = new Set(p); n.delete(r.id); return n; })).catch(() => undefined)}>{r.okLabel}</button></div>}
          </div>
          {rejecting === r.id && <RejectInline reasons={expenses.some((x) => x.id === r.id) || requisitions.some((x) => x.id === r.id) ? EXPENSE_REASONS : REQUEST_REASONS} busy={busy} onCancel={() => setRejecting(null)} onReject={(why) => void r.act(false, why).then(() => setRejecting(null)).catch(() => undefined)} />}
        </div>)}
      </div>) : <p className="portal-empty-copy">{cat === "All" ? "Nothing waiting for your approval." : `No ${cat.toLowerCase()} waiting.`}</p>}
      {empty.length > 0 && <p className="ac-clear"><b>✓ Nothing Waiting:</b> {empty.join(", ")}.</p>}
    </section>
  </div>;
}

/* ------------------------------------------------------------ transactions (summary rail, owner-approved prototype, 8 Oct 2026) */

type PayDay = Omit<CashierReportSnapshot, "logoBytes">;
type ColRow = { name: string; color: string; count: number; amount: number };

/** One compact column of figures: a row per channel or bucket, then the total. Rows can filter the table when clickable. */
function FigureColumn({ rows, unit, totalLabel, pick, onPick }: { rows: ColRow[]; unit: string; totalLabel: string; pick?: string; onPick?: (name: string) => void }) {
  const n = (c: number) => `${c} ${unit}${c === 1 ? "" : "s"}`;
  const total = rows.reduce((s, r) => s + r.amount, 0), count = rows.reduce((s, r) => s + r.count, 0);
  return <div className="cx-tiles ac-tiles ac-tiles-in">
    {rows.map((r) => onPick
      ? <button type="button" key={r.name} className={`cx-tile ac-pick${pick === r.name ? " on" : ""}`} aria-pressed={pick === r.name} style={{ ["--c" as string]: r.color }} onClick={() => onPick(pick === r.name ? "" : r.name)}><span>{tcl(r.name)}</span><b>{pesos2(r.amount)}</b><small>{n(r.count)}</small></button>
      : <div key={r.name} className="cx-tile" style={{ ["--c" as string]: r.color }}><span>{tcl(r.name)}</span><b>{pesos2(r.amount)}</b><small>{n(r.count)}</small></div>)}
    <div className="cx-tile ac-total"><span>{totalLabel}</span><b>{pesos2(total)}</b><small>{n(count)}</small></div>
  </div>;
}

function TxHead({ title, right, note }: { title: string; right?: ReactNode; note?: ReactNode }) {
  return <><div className="cx-head"><div><span className="portal-eyebrow">Accounting · Transactions</span><h1>{title}</h1></div>{right}</div>{note && <p className="ac-note">{note}</p>}</>;
}

export function AccountingPayments() {
  const today = manilaToday();
  const [date, setDate] = useState(today), [channel, setChannel] = useState(""), [q, setQ] = useState("");
  const { data: r, error } = useJson<PayDay>(`/api/staff/cashier-report?date=${date}`);
  const rows = r ? r.groups.flatMap((g) => g.rows.map((x) => ({ ...x, source: g.kind === "Direct walk-in" ? "Walk-in" : g.name || g.kind }))) : [];
  const term = q.trim().toLowerCase();
  const shown = rows.filter((x) => (!channel || x.channel === channel) && (!term || `${x.receipt} ${x.trainee} ${x.course} ${x.source}`.toLowerCase().includes(term)));
  const pg = usePaged(shown);
  const byChannel = CHANNELS.map((c) => { const l = rows.filter((x) => x.channel === c); return { name: c, color: COLORS[c], count: l.length, amount: l.reduce((s, x) => s + x.amountCentavos, 0) }; });
  const proofOf = (x: (typeof rows)[number]) => (x.channel === "Cash" ? "Cash" : x.proof ? "Screenshot uploaded" : "Manual entry");
  return <div className="portal-page cx ac">
    <TxHead title="Payments" right={<DayPicker date={date} setDate={setDate} />} note={<>{longDay(date)} · <span className="ac-ro">View only — the Cashier records payments</span></>} />
    {error && <Message kind="error" text={error} />}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>By Channel</h2><span className="muted-text">tap to filter</span></div><FigureColumn rows={byChannel} unit="receipt" totalLabel="Total collected" pick={channel} onPick={setChannel} /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>By Source</h2></div>
          <dl className="ac-lines">{r ? r.matrix.map((m) => <div key={m.source}><dt>{m.source}</dt><dd>{pesos2(m.totalCentavos)}</dd></div>) : <div><dt>Loading…</dt><dd /></div>}</dl></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Proof of Payment</h2></div>
          <dl className="ac-lines">{["Screenshot uploaded", "Manual entry", "Cash"].map((k) => <div key={k}><dt>{k === "Cash" ? "Cash (no proof needed)" : k}</dt><dd>{rows.filter((x) => proofOf(x) === k).length}</dd></div>)}</dl></section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search payments" placeholder="Search receipt, trainee, course or partner" value={q} onChange={(e) => setQ(e.target.value)} /><select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All Channels</option>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        {!r ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : shown.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Receipt</th><th>Trainee</th><th>Source</th><th>Channel and Reference</th><th className="r">Amount</th></tr></thead><tbody>
          {pg.shown.map((x, i) => <tr key={`${x.receipt}-${i}`}><td data-l="" className="lead"><span className="cx-name cx-mono">{x.receipt}</span><small>{x.time}</small></td><td data-l="Trainee">{x.trainee}<small>{x.course}</small></td><td data-l="Source">{x.source}</td><td data-l="Channel">{x.channel}<small className="cx-mono">{x.reference || "—"}</small><small className={x.proof ? "ac-up" : ""}>{proofOf(x)}</small></td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(x.amountCentavos)}</strong></td></tr>)}
        </tbody><tfoot><tr><td colSpan={4} data-l="">{shown.length} receipt{shown.length === 1 ? "" : "s"}{channel ? ` · ${channel}` : ""}</td><td data-l="Total" className="r cx-amt">{pesos2(shown.reduce((s, x) => s + x.amountCentavos, 0))}</td></tr></tfoot></table>{pg.pager}</div> : <p className="portal-empty-copy">No payments match.</p>}
      </section>
    </div>
  </div>;
}

const EXPENSE_STATES = ["All", "For approval", "Awaiting release", "Released", "Rejected"] as const;
export function AccountingExpenses({ data }: { data: PortalData }) {
  const today = manilaToday();
  const [date, setDate] = useState(today), [st, setSt] = useState<(typeof EXPENSE_STATES)[number]>("All");
  type Ex = PortalData["expenses"][number] & { payment_channel?: string | null; reference_number?: string | null; voucher_number?: string | null; paid_at?: string | null; approved_at?: string | null };
  const label = (e: Ex) => (e.status === "Paid" ? "Released" : e.status === "Approved" ? "Awaiting release" : e.status === "Pending" ? "For approval" : e.status);
  const list = (data.expenses as Ex[]).filter((e) => day(e.created_at) === date || day(e.paid_at) === date || day(e.approved_at) === date).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const released = list.filter((e) => e.status === "Paid" && day(e.paid_at) === date);
  const byChannel = CHANNELS.map((c) => { const l = released.filter((e) => e.payment_channel === c); return { name: c, color: COLORS[c], count: l.length, amount: l.reduce((s, e) => s + Number(e.amount_centavos), 0) }; });
  const cats = [...new Set(list.filter((e) => e.status !== "Rejected").map((e) => e.category))];
  const shown = list.filter((e) => st === "All" || label(e) === st);
  const pg = usePaged(shown);
  const tone = (s: string) => (s === "Released" ? "green" : s === "Rejected" ? "red" : s === "For approval" ? "orange" : "blue");
  return <div className="portal-page cx ac">
    <TxHead title="Expenses" right={<DayPicker date={date} setDate={setDate} />} note={<>{longDay(date)} · <span className="ac-ro">View only — the Cashier records and releases expenses</span></>} />
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Released by Channel</h2></div><FigureColumn rows={byChannel} unit="voucher" totalLabel="Total released" /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>By Status</h2></div>
          <dl className="ac-lines">{EXPENSE_STATES.slice(1).map((s) => { const l = list.filter((e) => label(e) === s); return <div key={s}><dt>{tcl(s)}</dt><dd>{l.length} · {pesos2(l.reduce((a, e) => a + Number(e.amount_centavos), 0))}</dd></div>; })}</dl>
          <p className="ac-foot">Requests for your decision are in Approvals.</p></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>By Category</h2></div>
          {cats.length ? <dl className="ac-lines">{cats.map((c) => <div key={c}><dt>{c}</dt><dd>{pesos2(list.filter((e) => e.category === c && e.status !== "Rejected").reduce((a, e) => a + Number(e.amount_centavos), 0))}</dd></div>)}</dl> : <p className="portal-empty-copy">No expenses on this day.</p>}</section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="ac-chipbar">{EXPENSE_STATES.map((s) => <button key={s} type="button" className={`ac-chip${st === s ? " on" : ""}`} onClick={() => setSt(s)}>{tcl(s)}<span>{s === "All" ? list.length : list.filter((e) => label(e) === s).length}</span></button>)}</div>
        {shown.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Voucher</th><th>Payee</th><th>Channel</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead><tbody>
          {pg.shown.map((e) => <tr key={e.id}><td data-l="" className="lead"><span className="cx-name cx-mono">{e.voucher_number ?? e.expense_number}</span><small>{fmtDate(day(e.created_at))}</small></td><td data-l="Payee"><strong>{e.payee}</strong><small>{e.category}</small></td><td data-l="Channel">{e.payment_channel || "—"}{e.reference_number ? <small className="cx-mono">{e.reference_number}</small> : null}</td><td data-l="Status"><Badge tone={tone(label(e))}>{label(e)}</Badge></td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(e.amount_centavos)}</strong></td><td data-l="">{e.voucher_number && <a className="portal-secondary" href={`/api/documents/expense/${e.id}?copy=1`} target="_blank" rel="noreferrer">View</a>}</td></tr>)}
        </tbody></table>{pg.pager}</div> : <p className="portal-empty-copy">{list.length ? "Nothing with this status." : "No expenses on this day."}</p>}
      </section>
    </div>
  </div>;
}

const AGING: [string, string, number, number][] = [["0–15 days", "#0571D0", 0, 15], ["16–30 days", "#F25615", 16, 30], ["31–60 days", "#7a3fb8", 31, 60], ["Over 60 days", "#5d6f7e", 61, 99999]];
/** Receivables: balances still due after training ended, aged by days since the last training day. */
export function AccountingReceivables({ data }: { data: PortalData }) {
  const today = manilaToday();
  const [bucket, setBucket] = useState(""), [q, setQ] = useState("");
  const durations = new Map(data.courses.map((c) => [c.id, c.duration_label]));
  const all = unpaidAfterTraining(data.enrollments as unknown as BalanceEnrollment[], (id) => durations.get(id), today);
  const daysOf = (end: string) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`)) / 86400000));
  const inB = (end: string, b: (typeof AGING)[number]) => { const d = daysOf(end); return d >= b[2] && d <= b[3]; };
  const rows = AGING.map(([name, color, lo, hi]) => { const l = all.filter((u) => inB(u.trainingEnd, [name, color, lo, hi])); return { name, color, count: l.length, amount: l.reduce((s, u) => s + u.balanceCentavos, 0) }; });
  const term = q.trim().toLowerCase();
  const shown = all.filter((u) => (!bucket || inB(u.trainingEnd, AGING.find((b) => b[0] === bucket)!)) && (!term || `${u.traineeName} ${u.course} ${u.enrollmentNumber}`.toLowerCase().includes(term))).sort((a, b) => a.trainingEnd.localeCompare(b.trainingEnd));
  const pg = usePaged(shown);
  return <div className="portal-page cx ac">
    <TxHead title="Receivables" note={<>Balances still due after training ended · as of {fmtDate(today)}</>} />
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Aging</h2><span className="muted-text">tap to filter</span></div><FigureColumn rows={rows} unit="enrollment" totalLabel="Total unpaid" pick={bucket} onPick={setBucket} /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Status</h2></div>
          <dl className="ac-lines"><div><dt>Training ends today</dt><dd>{all.filter((u) => u.endsToday).length}</dd></div><div><dt>Past due</dt><dd className="minus">{all.filter((u) => !u.endsToday).length}</dd></div><div><dt>Trainees</dt><dd>{new Set(all.map((u) => u.traineeId)).size}</dd></div></dl></section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search receivables" placeholder="Search trainee, course or enrollment" value={q} onChange={(e) => setQ(e.target.value)} />{bucket && <button type="button" className="portal-secondary" onClick={() => setBucket("")}>Show All</button>}</div>
        {shown.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Trainee</th><th>Training Ended</th><th className="r">Fee</th><th className="r">Paid</th><th className="r">Balance</th><th>Overdue</th></tr></thead><tbody>
          {pg.shown.map((u) => { const d = daysOf(u.trainingEnd); return <tr key={u.id}><td data-l="" className="lead"><span className="cx-name">{u.traineeName}</span><small>{u.course} · <span className="cx-mono">{u.enrollmentNumber}</span></small></td><td data-l="Training ended">{fmtDate(u.trainingEnd)}</td><td data-l="Fee" className="r cx-amt">{pesos2(u.dueCentavos)}</td><td data-l="Paid" className="r cx-amt">{pesos2(u.paidCentavos)}</td><td data-l="Balance" className="r"><strong className="cx-amt" style={{ color: "#c2410c" }}>{pesos2(u.balanceCentavos)}</strong></td><td data-l="Overdue">{u.endsToday ? <Badge tone="orange">Ends Today</Badge> : <Badge tone={d > 60 ? "red" : d > 30 ? "orange" : undefined}>{d} day{d === 1 ? "" : "s"}</Badge>}</td></tr>; })}
        </tbody><tfoot><tr><td colSpan={4} data-l="">{shown.length} enrollment{shown.length === 1 ? "" : "s"}</td><td data-l="Total" className="r cx-amt">{pesos2(shown.reduce((s, u) => s + u.balanceCentavos, 0))}</td><td /></tr></tfoot></table>{pg.pager}</div> : <p className="portal-empty-copy">No unpaid balances after training.</p>}
      </section>
    </div>
  </div>;
}

const PAYABLE_TABS = ["Open", "Due this week", "Overdue", "Paid"] as const;
/** Payables: bills and fees New Wave owes, plus rebates owed to no-deduction partners. Mark paid records the settlement. */
export function AccountingPayables({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  const today = manilaToday(), weekEnd = addDays(today, 7), monthStart = `${today.slice(0, 8)}01`;
  const { busy, msg, post } = usePost(reload);
  const [tab, setTab] = useState<(typeof PAYABLE_TABS)[number]>("Open");
  type Item = { id: string; payee: string; kind: string; what: string; due: string | null; amount: number; paid: boolean; paidOn: string | null; settle: () => Promise<unknown> };
  const bills: Item[] = (data.payables as (PortalData["payables"][number] & { paid_at?: string | null })[]).map((p) => ({ id: p.id, payee: p.description, kind: "Bills and fees", what: "", due: p.due_on ?? null, amount: Number(p.amount_centavos), paid: p.status === "Paid", paidOn: day(p.paid_at), settle: () => post({ action: "payable-mark-paid", id: p.id }, "Marked paid.") }));
  const rebates: Item[] = (data.agencyRebates as (PortalData["agencyRebates"][number] & { settlement?: string | null })[]).filter((r) => r.status === "Pending" || (r.status === "Paid" && !(r.settlement ?? "").startsWith("Deducted"))).map((r) => {
    const t = first(r.trainees as { legal_first_name: string; legal_last_name: string } | null);
    return { id: r.id, payee: first(r.marketing_agencies as { name: string } | null)?.name ?? "Partner", kind: "Agency rebates", what: `${t ? `${t.legal_first_name} ${t.legal_last_name}` : "Trainee"} · ${first(r.courses as { name: string } | null)?.name ?? "Course"}`, due: null, amount: Number(r.rebate_centavos), paid: r.status === "Paid", paidOn: r.status === "Paid" ? day(r.created_at) : null, settle: () => post({ action: "agency-rebate-settle", id: r.id, status: "Paid" }, "Rebate marked paid to the partner.") };
  });
  const items = [...bills, ...rebates];
  const stateOf = (i: Item) => (i.paid ? "Paid" : i.due && i.due < today ? "Overdue" : i.due && i.due <= weekEnd ? "Due this week" : "Open");
  const open = items.filter((i) => !i.paid);
  const shown = items.filter((i) => (tab === "Open" ? !i.paid : stateOf(i) === tab)).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const pg = usePaged(shown);
  const kinds = ["Bills and fees", "Agency rebates"].map((k, n) => { const l = open.filter((i) => i.kind === k); return { name: k, color: n ? "#F25615" : "#0571D0", count: l.length, amount: l.reduce((s, i) => s + i.amount, 0) }; });
  const sum = (l: Item[]) => pesos2(l.reduce((s, i) => s + i.amount, 0));
  return <div className="portal-page cx ac">
    <TxHead title="Payables" note={<>Amounts New Wave owes · as of {fmtDate(today)}</>} />
    {msg && <Message kind={msg.kind} text={msg.text} />}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Owed Now</h2></div><FigureColumn rows={kinds} unit="item" totalLabel="Total owed" /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Timing</h2></div>
          <dl className="ac-lines"><div><dt>Overdue</dt><dd className="minus">{sum(open.filter((i) => stateOf(i) === "Overdue"))}</dd></div><div><dt>Due this week</dt><dd className="warn">{sum(open.filter((i) => stateOf(i) === "Due this week"))}</dd></div><div><dt>Paid this month</dt><dd className="plus">{sum(items.filter((i) => i.paid && (i.paidOn ?? "") >= monthStart))}</dd></div></dl></section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="ac-chipbar">{PAYABLE_TABS.map((t) => <button key={t} type="button" className={`ac-chip${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{tcl(t)}<span>{t === "Open" ? open.length : items.filter((i) => stateOf(i) === t).length}</span></button>)}</div>
        {shown.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Payee</th><th>Type</th><th>Due</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead><tbody>
          {pg.shown.map((i) => { const s = stateOf(i); return <tr key={`${i.kind}-${i.id}`}><td data-l="" className="lead"><span className="cx-name">{i.payee}</span>{i.what && <small>{i.what}</small>}</td><td data-l="Type">{i.kind === "Agency rebates" ? "Agency rebate" : "Bill or fee"}</td><td data-l="Due">{i.due ? fmtDate(i.due) : "—"}</td><td data-l="Status"><Badge tone={s === "Paid" ? "green" : s === "Overdue" ? "red" : s === "Due this week" ? "orange" : undefined}>{tcl(s)}</Badge></td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(i.amount)}</strong></td><td data-l="">{!i.paid && <button type="button" className="portal-primary" disabled={busy} onClick={() => void i.settle().catch(() => undefined)}>Mark Paid</button>}</td></tr>; })}
        </tbody></table>{pg.pager}</div> : <p className="portal-empty-copy">Nothing here.</p>}
      </section>
    </div>
  </div>;
}

/** Cash position: today's drawer (cash only), bank and e-wallet collections for reference, and the daily closings. */
export function AccountingCashPosition({ data }: { data: PortalData }) {
  const today = manilaToday();
  const [date, setDate] = useState(today);
  const { data: r, error } = useJson<PayDay>(`/api/staff/cashier-report?date=${date}`);
  const p = r?.position;
  const closings = [...data.cashierClosings].sort((a, b) => b.closing_date.localeCompare(a.closing_date)).slice(0, 10);
  const trend = [...closings].slice(0, 7).reverse();
  const closedOn = data.cashierClosings.find((c) => c.closing_date === date);
  const online = ["GCash", "PSBank", "UnionBank", "Cheque"].map((c) => { const total = r ? r.matrix.reduce((s, m) => s + (m.cells.find((x) => x.channel === c)?.totalCentavos ?? 0), 0) : 0; const count = r ? r.matrix.reduce((s, m) => s + (m.cells.find((x) => x.channel === c)?.count ?? 0), 0) : 0; return { name: c, color: COLORS[c], count, amount: total }; });
  return <div className="portal-page cx ac">
    <TxHead title="Cash Position" right={<DayPicker date={date} setDate={setDate} />} note={<>Cash only · {longDay(date)}</>} />
    {error && <Message kind="error" text={error} />}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>{date === today ? "Today" : fmtDate(date)}</h2><Badge tone={closedOn ? (closedOn.status === "Reviewed" ? "green" : "blue") : "orange"}>{closedOn ? closedOn.status : "Not Yet Closed"}</Badge></div>
          {p ? <dl className="ac-lines">
            <div><dt>Previous cash</dt><dd>{pesos2(p.previousCentavos)}</dd></div>
            <div><dt>+ Cash collected</dt><dd className="plus">{pesos2(p.cashCollectedCentavos)}</dd></div>
            <div><dt>− Cash expenses</dt><dd className="minus">{pesos2(p.cashExpensesCentavos)}</dd></div>
            <div className="total"><dt>= Cash on hand</dt><dd className="eq">{pesos2(p.onHandCentavos)}</dd></div>
            <div><dt>Counted at closing</dt><dd>{p.countedCentavos == null ? "Not yet" : pesos2(p.countedCentavos)}</dd></div>
            <div><dt>Over / short</dt><dd className={p.overShortCentavos ? (p.overShortCentavos < 0 ? "minus" : "plus") : ""}>{p.overShortCentavos == null ? "—" : pesos2(p.overShortCentavos)}</dd></div>
          </dl> : <p className="portal-empty-copy">{error ? "" : "Loading…"}</p>}
          {p?.previousNote && <p className="ac-foot">{p.previousNote}</p>}
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Bank and E-Wallet</h2><span className="muted-text">collected</span></div><FigureColumn rows={online} unit="receipt" totalLabel="Total non-cash" /><p className="ac-foot">Shown for reference; not part of cash on hand.</p></section>
      </div>
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Expected Cash at Closing</h2><span className="muted-text">last {trend.length} closing{trend.length === 1 ? "" : "s"}</span></div>
          {trend.length ? <BarChart label="Expected Cash at Each Closing" labels={trend.map((c) => fmtDate(c.closing_date).replace(/, \d{4}$/, ""))} series={[{ name: "Expected cash", color: "#0571D0", values: trend.map((c) => Number(c.expected_cash_centavos)) }, { name: "Counted", color: "#123F63", values: trend.map((c) => Number(c.actual_cash_centavos ?? 0)) }]} /> : <p className="portal-empty-copy">No closings yet.</p>}
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Daily Closings</h2></div>
          {closings.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Date</th><th className="r">Opening</th><th className="r">Cash in</th><th className="r">Cash Out</th><th className="r">Expected</th><th className="r">Counted</th><th className="r">Over / Short</th><th>Status</th></tr></thead><tbody>
            {closings.map((c) => { const v = c.variance_centavos == null ? null : Number(c.variance_centavos); return <tr key={c.id}><td data-l="" className="lead">{fmtDate(c.closing_date)}</td><td data-l="Opening" className="r cx-amt">{pesos2(c.opening_cash_centavos)}</td><td data-l="Cash in" className="r cx-amt">{pesos2(c.cash_collections_centavos)}</td><td data-l="Cash out" className="r cx-amt">{pesos2(c.expenses_centavos)}</td><td data-l="Expected" className="r cx-amt">{pesos2(c.expected_cash_centavos)}</td><td data-l="Counted" className="r cx-amt">{c.actual_cash_centavos == null ? "—" : pesos2(c.actual_cash_centavos)}</td><td data-l="Over / short" className="r cx-amt" style={v ? { color: v < 0 ? "#c2410c" : "#15803d" } : undefined}>{v == null ? "—" : v === 0 ? "Balanced" : pesos2(v)}</td><td data-l="Status"><Badge tone={c.status === "Reviewed" ? "green" : "blue"}>{c.status}</Badge></td></tr>; })}
          </tbody></table></div> : <p className="portal-empty-copy">No closings yet.</p>}
        </section>
      </div>
    </div>
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
  const p = r?.position;
  // Finance Rail (owner's choice, 20 Oct 2026): positions and collections on the left; approvals and channels on the right.
  const released = (ch: string) => r?.expenseTotals.find((t) => t.channel === ch)?.totalCentavos ?? 0;
  const releasedTotal = r ? r.expenses.reduce((x, e) => x + e.amountCentavos, 0) : 0;
  const bills = data.payables.filter((x) => x.status !== "Paid");
  const billsTotal = bills.reduce((x, b) => x + Number(b.amount_centavos), 0);
  const receivable = unpaid.reduce((x, u) => x + u.balanceCentavos, 0);
  const shortOver = data.cashierClosings.filter((c) => c.closing_date >= addDays(today, -6) && c.status !== "Reviewed" && Number(c.variance_centavos ?? 0) !== 0);
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Dashboard</h1></div>
      <div className="ac-day"><button type="button" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>‹</button><input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /><button type="button" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</button></div></div>
    <p className="ac-note">{longDay(date)} · view only — the Cashier records payments and expenses.</p>
    {dayReport.error && <Message kind="error" text={dayReport.error} />}
    {shortOver.map((c) => <div key={c.id} className="cl-admin-alarm"><p className="ac-note fr-warn">⚠ Cashier closing {fmtDate(c.closing_date)} · {Number(c.variance_centavos) < 0 ? "short" : "over"} {pesos2(Math.abs(Number(c.variance_centavos)))} <button type="button" className="portal-secondary" onClick={() => go("Cash position")}>Review</button></p></div>)}
    <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Positions</h2><span className="muted-text">as of now</span></div>
          <dl className="ac-lines">
            <div><dt>Cash on hand</dt><dd>{p ? pesos2(p.onHandCentavos) : "…"}</dd></div>
            {p && p.countedCentavos != null && <div><dt>Counted · over / short</dt><dd className={p.overShortCentavos ? (p.overShortCentavos < 0 ? "minus" : "plus") : ""}>{pesos2(p.countedCentavos)}{p.overShortCentavos ? ` · ${pesos2(p.overShortCentavos)}` : ""}</dd></div>}
            <div><dt>Bank and e-wallet collected</dt><dd>{pesos2(total - colOf("Cash"))}</dd></div>
            <div><dt>Receivables · {new Set(unpaid.map((u) => u.traineeId)).size} after training</dt><dd className="plus">{pesos2(receivable)}</dd></div>
            <div><dt>Payables · {bills.length} open</dt><dd className="minus">{pesos2(billsTotal)}</dd></div>
            <div><dt>Rebates owed to agencies</dt><dd className="minus">{pesos2(w?.current.rebatesOwed ?? 0)}</dd></div>
          </dl>
          <div className="ac-more"><button type="button" onClick={() => go("Receivables")}>Receivables</button> <button type="button" onClick={() => go("Payables")}>Payables</button> <button type="button" onClick={() => go("Cash position")}>Cash Position</button></div>
        </section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections</h2><strong className="cx-mono">{pesos2(total)}</strong></div>
          <dl className="ac-lines">
            {(r?.matrix ?? []).map((m) => <div key={m.source}><dt>{m.source}</dt><dd>{pesos2(m.totalCentavos)}</dd></div>)}
            <div className="total"><dt>Total · {receipts} receipt{receipts === 1 ? "" : "s"}</dt><dd className="eq">{pesos2(total)}</dd></div>
            <div><dt>Rebates deducted</dt><dd>{pesos2(w?.current.rebatesDeducted ?? 0)}</dd></div>
          </dl>
        </section>
      </div>
      <div className="ac-stack">
        <AccountingApprovals data={data} reload={reload} compact />
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Payments and Expenses per Channel</h2><span className="muted-text">{fmtDate(date)}</span></div>
          <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Channel</th><th className="r">Collected</th><th className="r">Released</th><th className="r">Net</th></tr></thead><tbody>
            {CHANNELS.map((c) => <tr key={c}><td data-l="" className="lead"><span className="cr-dot" style={{ background: COLORS[c] }} />{c}<small>{countOf(c)} receipt{countOf(c) === 1 ? "" : "s"}</small></td><td data-l="Collected" className="r cx-amt">{pesos2(colOf(c))}</td><td data-l="Released" className="r cx-amt">{released(c) ? `− ${pesos2(released(c))}` : "—"}</td><td data-l="Net" className="r"><strong className="cx-amt">{pesos2(colOf(c) - released(c))}</strong></td></tr>)}
            <tr className="nb-group"><td data-l="" className="lead"><b>Total</b></td><td data-l="Collected" className="r cx-amt"><b>{pesos2(total)}</b></td><td data-l="Released" className="r cx-amt"><b>− {pesos2(releasedTotal)}</b></td><td data-l="Net" className="r cx-amt"><b>{pesos2(total - releasedTotal)}</b></td></tr>
          </tbody></table></div>
          <div className="ac-more"><button type="button" onClick={() => go("Expenses")}>View Vouchers</button></div>
        </section>
      </div>
    </div>
  </div>;
}

/* ------------------------------------------------------------ reports */

export function AccountingReports({ switcher }: { switcher?: ReactNode } = {}) {
  const today = manilaToday();
  const [period, setPeriod] = useState<Period>("Daily");
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
    {switcher}
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
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections and Expenses</h2><span className="muted-text">{period.toLowerCase()} trend</span></div>
          <BarChart label={`${period} collections and expenses`} labels={rep.series.map((b) => b.label)} series={[{ name: "Collections", color: "#0571D0", values: rep.series.map((b) => b.collections) }, { name: "Expenses released", color: "#F25615", values: rep.series.map((b) => b.expenses) }]} /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections by Channel</h2></div><Donut label="Collections by Channel" parts={channels} /></section>
      </div>
      <div className="ac-grid2">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Collections by Source</h2></div><HBars rows={Object.entries(c.bySource).map(([name, value]) => ({ name, value, color: SOURCE_COLORS[name] }))} /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Expenses by Category</h2></div>{c.byCategory.length ? <HBars rows={c.byCategory.slice(0, 6).map((x, i) => ({ name: x.name, value: x.total, color: CATEGORY_COLORS[i] }))} /> : <p className="portal-empty-copy">No expenses released.</p>}</section>
      </div>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Top Courses by Collections</h2></div>
        {c.topCourses.length ? <div className="portal-table cx-cards"><table><tbody>{c.topCourses.map((x, i) => <tr key={x.name}><td data-l="" className="lead cx-mono">{i + 1}</td><td data-l="Course">{x.name}</td><td data-l="Collected" className="r cx-amt">{pesos2(x.total)}</td></tr>)}</tbody></table></div> : <p className="portal-empty-copy">No collections in this period.</p>}
      </section>
    </>}
  </div>;
}

/* ------------------------------------------------------------ cash and sales summary */

const REPORT_VIEWS = ["Overview", "Cash and Sales Summary"] as const;
/** Accounting › Reports (owner, 21 Oct 2026): Overview and the Cash and Sales Summary. */
export function AccountingReportsHub() {
  const [view, setView] = useState<(typeof REPORT_VIEWS)[number]>("Overview");
  const switcher = <div className="cx-seg fs-views" role="tablist">{REPORT_VIEWS.map((v) => <button key={v} type="button" className={view === v ? "on" : ""} onClick={() => setView(v)}>{v}</button>)}</div>;
  return view === "Overview" ? <AccountingReports switcher={switcher} /> : <FinanceSummaryReport switcher={switcher} />;
}

/** End of the previous period, or the last day of the next one (never past today). */
const shiftPeriod = (period: Period, end: string, n: number, today: string) => {
  if (n < 0) return addDays(periodStart(period, end), -1);
  const cur = periodStart(period, end);
  let d = addDays(end, 1);
  while (periodStart(period, d) === cur) d = addDays(d, 1);
  const next = periodStart(period, d);
  while (periodStart(period, addDays(d, 1)) === next) d = addDays(d, 1);
  return d > today ? today : d;
};

/**
 * Cash and Sales Summary (owner, 21 Oct 2026, prototype): cash received and
 * disbursed, and sales by training date, split Training Endorsement vs Direct
 * New Wave. Accounting and the Admin; PDF and Excel match the screen.
 */
export function FinanceSummaryReport({ switcher }: { switcher?: ReactNode }) {
  const today = manilaToday();
  const [period, setPeriod] = useState<Period>("Daily");
  const [end, setEnd] = useState(today);
  const q = `period=${period}&end=${end}`;
  const { data: s, error } = useJson<FinanceSummary>(`/api/staff/finance-summary?${q}`);
  const rE = s ? sideTotal(s.received, "E") : 0, rD = s ? sideTotal(s.received, "D") : 0, dE = s ? sideTotal(s.disbursed, "E") : 0, dD = s ? sideTotal(s.disbursed, "D") : 0;
  const neg = (v: number) => <td className="fs-n fs-neg">{pesos2(-v)}</td>;
  const cash = (title: string, ls: Line[]) => <section className="portal-panel cx-panel"><div className="panel-heading"><h2>{title}</h2></div>
    <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Line</th><th className="fs-n">Endorsement</th><th className="fs-n">Direct</th><th className="fs-n">Total</th></tr></thead><tbody>
      {(["E", "D"] as const).map((side) => { const mine = ls.filter((l) => l.side === side); return [<tr key={side} className="nb-group"><td colSpan={4}>{side === "E" ? "Training Endorsement" : "Direct New Wave"}</td></tr>,
        ...mine.map((l) => <tr key={`${side}${l.label}`} className="fs-sub"><td>{l.label}</td><td className="fs-n">{side === "E" ? pesos2(l.total) : "—"}</td><td className="fs-n">{side === "D" ? pesos2(l.total) : "—"}</td><td className="fs-n">{pesos2(l.total)}</td></tr>),
        !mine.length && <tr key={`${side}-none`} className="fs-sub"><td colSpan={4} className="muted-text">None in this period</td></tr>]; })}
      <tr className="fs-tot"><td>Total {title}</td><td className="fs-n">{pesos2(sideTotal(ls, "E"))}</td><td className="fs-n">{pesos2(sideTotal(ls, "D"))}</td><td className="fs-n">{pesos2(sideTotal(ls))}</td></tr>
      <tr className="nb-group"><td colSpan={4}>By Channel</td></tr>
      {channelsUsed(ls).map((ch) => { const ce = channelTotal(ls, "E", ch), cd = channelTotal(ls, "D", ch); return <tr key={ch} className="fs-sub"><td>{ch}</td><td className="fs-n">{pesos2(ce)}</td><td className="fs-n">{pesos2(cd)}</td><td className="fs-n">{pesos2(ce + cd)}</td></tr>; })}
    </tbody></table></div></section>;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting · Reports</span><h1>Cash and Sales Summary</h1></div>
      <div className="ac-controls"><a className="portal-secondary" href={`/api/documents/finance-summary?${q}&format=xlsx`}>Download Excel</a><a className="portal-primary" href={`/api/documents/finance-summary?${q}`} target="_blank" rel="noreferrer">Print PDF</a></div></div>
    {switcher}
    <div className="pd-bar cs-bar"><span className="cx-seg">{PERIODS.map((p) => <button key={p} type="button" className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>{p}</button>)}</span>
      <button type="button" className="portal-secondary" aria-label="Previous" onClick={() => setEnd(shiftPeriod(period, end, -1, today))}>‹</button>
      <input type="date" value={end} max={today} aria-label="As of" onChange={(e) => e.target.value && setEnd(e.target.value)} />
      <button type="button" className="portal-secondary" aria-label="Next" disabled={end >= today} onClick={() => setEnd(shiftPeriod(period, end, 1, today))}>›</button>
      {s && <span className="pd-label"><b>{s.title}</b> · {fmtDate(s.from)} – {fmtDate(s.to)}</span>}</div>
    {error && <Message kind="error" text={error} />}
    {!s ? !error && <p className="portal-empty-copy">Loading the summary…</p> : <>
      <div className="cx-tiles ac-tiles fs-tiles">
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#0a7a3e" }}><span>Cash Received</span><b>{pesos2(rE + rD)}</b><small>Endorsement {pesos2(rE)} · Direct {pesos2(rD)}</small></div>
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#b42318" }}><span>Disbursements</span><b>{pesos2(dE + dD)}</b><small>Endorsement {pesos2(dE)} · Direct {pesos2(dD)}</small></div>
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#0571D0" }}><span>Net Cash</span><b>{pesos2(rE + rD - dE - dD)}</b><small>received less disbursed</small></div>
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#F25615" }}><span>Direct Sales</span><b>{pesos2(s.direct.sales)}</b><small>{s.direct.trainees} trainee{s.direct.trainees === 1 ? "" : "s"} by training date</small></div>
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#a2470b" }}><span>Endorsement Keeps</span><b>{pesos2(s.endorsement.keeps)}</b><small>{s.endorsement.trainees} trainee{s.endorsement.trainees === 1 ? "" : "s"} · rebates less agency shares</small></div>
      </div>
      <div className="fs-grid">{cash("Cash Received", s.received)}{cash("Disbursements", s.disbursed)}</div>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Net Cash</h2></div><div className="cl-wrap"><table className="cl-log"><thead><tr><th></th><th className="fs-n">Endorsement</th><th className="fs-n">Direct</th><th className="fs-n">Total</th></tr></thead><tbody>
        <tr><td>Cash Received</td><td className="fs-n">{pesos2(rE)}</td><td className="fs-n">{pesos2(rD)}</td><td className="fs-n">{pesos2(rE + rD)}</td></tr>
        <tr><td>Less Disbursements</td>{neg(dE)}{neg(dD)}{neg(dE + dD)}</tr>
        <tr className="fs-net"><td>Net Cash</td><td className="fs-n">{pesos2(rE - dE)}</td><td className="fs-n">{pesos2(rD - dD)}</td><td className="fs-n">{pesos2(rE + rD - dE - dD)}</td></tr>
      </tbody></table></div></section>
      <div className="fs-grid">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Direct Sales</h2></div><div className="cl-wrap"><table className="cl-log"><thead><tr><th>Course</th><th className="fs-n">Trainees</th><th className="fs-n">Sales</th></tr></thead><tbody>
          {s.direct.courses.map((c) => <tr key={c.code}><td><b>{c.code}</b><small>{c.name}</small></td><td className="fs-n">{c.trainees}</td><td className="fs-n">{pesos2(c.sales)}</td></tr>)}
          {!s.direct.courses.length && <tr><td colSpan={3} className="muted-text">No New Wave training in this period.</td></tr>}
          <tr className="fs-tot"><td>Course Fees</td><td className="fs-n">{s.direct.trainees}</td><td className="fs-n">{pesos2(s.direct.fees)}</td></tr>
          <tr className="fs-sub"><td>Add Miscellaneous Charges</td><td /><td className="fs-n">{pesos2(s.direct.charges)}</td></tr>
          <tr className="fs-sub"><td>Less Discounts</td><td />{neg(s.direct.discounts)}</tr>
          <tr className="fs-net"><td>Direct Sales</td><td /><td className="fs-n">{pesos2(s.direct.sales)}</td></tr>
          <tr className="fs-sub"><td>Collected</td><td /><td className="fs-n fs-pos">{pesos2(s.direct.collected)}</td></tr>
          <tr className="fs-sub"><td>Balance Still Due</td><td /><td className="fs-n fs-neg">{pesos2(s.direct.balance)}</td></tr>
          <tr className="fs-sub"><td>Less Direct Expenses (period)</td><td />{neg(s.direct.expenses)}</tr>
          <tr className="fs-net"><td>Direct Gross Margin</td><td /><td className="fs-n">{pesos2(s.direct.margin)}</td></tr>
        </tbody></table></div></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Training Endorsement</h2></div><div className="cl-wrap"><table className="cl-log"><thead><tr><th>Center</th><th className="fs-n">Trainees</th><th className="fs-n">Fees Billed</th><th className="fs-n">Paid to Center</th><th className="fs-n">Rebate</th><th className="fs-n">Agency Share</th><th className="fs-n">New Wave Keeps</th></tr></thead><tbody>
          {s.endorsement.centers.map((c) => <tr key={c.name}><td><b>{c.name}</b><small>rebate received {pesos2(c.received)} of {pesos2(c.rebate)}</small></td><td className="fs-n">{c.trainees}</td><td className="fs-n">{pesos2(c.fees)}</td><td className="fs-n">{pesos2(c.payable)}</td><td className="fs-n">{pesos2(c.rebate)}</td>{neg(c.share)}<td className="fs-n">{pesos2(c.keeps)}</td></tr>)}
          {!s.endorsement.centers.length && <tr><td colSpan={7} className="muted-text">No endorsed training in this period.</td></tr>}
          <tr className="fs-tot"><td>Total</td><td className="fs-n">{s.endorsement.trainees}</td><td className="fs-n">{pesos2(s.endorsement.fees)}</td><td className="fs-n">{pesos2(s.endorsement.payable)}</td><td className="fs-n">{pesos2(s.endorsement.rebate)}</td>{neg(s.endorsement.share)}<td className="fs-n">{pesos2(s.endorsement.keeps)}</td></tr>
          <tr className="fs-sub"><td colSpan={6}>Rebates still due from centers</td><td className="fs-n fs-neg">{pesos2(s.endorsement.rebateDue)}</td></tr>
        </tbody></table></div></section>
      </div>
    </>}
  </div>;
}
