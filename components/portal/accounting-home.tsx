"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { PortalData } from "../portal-live-app";
import { addDays, first, manilaToday, pesos2 } from "@/lib/portal-format";
import { Badge, Message, MonthBar, PeriodBar, ViewIcon, fmtClock, fmtDate, manilaDay, submit, useMonthRows, usePeriod, usePost, usePaged } from "./shared-ui";
import { BarChart, Donut, HBars } from "./charts";
import { REASONS, REJECT_REASONS, RejectInline } from "./reject-inline";
import { PERIODS, percentChange, periodStart, type Period } from "@/lib/accounting-periods";
import { channelTotal, channelsUsed, sideTotal, type FinanceSummary, type Line, type SalesLine } from "@/lib/finance-summary";
import type { AccountingReport } from "@/lib/accounting-report";
import type { CenterState, EndorsedSales } from "@/lib/endorsed-sales";
import type { BillingRow } from "@/lib/billing-statement";
import type { CashierReportSnapshot } from "@/lib/documents";
import { unpaidAfterTraining, type BalanceEnrollment } from "@/lib/unpaid-balances";
import { downloadCsv } from "@/lib/csv";
import { tcl } from "@/lib/title-case";
import { askReason } from "./dialogs";
import { PaymentDayRow, PrintGlyph, paymentStatus } from "./payment-void";

/**
 * Accounting (owner, 8 Oct 2026): a view-first dashboard like the
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
    void fetch(url, { cache: "no-store" }).then(async (r) => { const text = await r.text(); let body: { error?: string } = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = {}; } if (!r.ok || !text) throw new Error(body.error ?? `The server did not answer (status ${r.status}). Try again.`); if (live) setState({ url, data: body as T, error: "" }); })
      .catch((e) => { if (live) setState({ url, data: null, error: e instanceof Error ? e.message : "Could not load." }); });
    return () => { live = false; };
  }, [url]);
  return { data: state.url === url ? state.data : null, error: state.url === url ? state.error : "", loading: state.url !== url };
}

/* ------------------------------------------------------------ approvals */

// Accounting Dashboard Design 06 (owner, 3 Nov 2026): Requisitions are not Accounting's; voucher reprints sit with expense requests.
type Category = "Expense requests" | "Refunds" | "Discounts" | "Payment voids" | "Rebates owed to partners" | "Cashier opening and closing";
const CATEGORY_GROUPS: [string, Category[]][] = [["Needs your decision", ["Expense requests", "Refunds", "Discounts", "Payment voids"]], ["For billing", ["Rebates owed to partners"]], ["Cash control", ["Cashier opening and closing"]]];
/** Receipt photos the Cashier attached (owner, 19 Oct 2026), opened in Google Drive. */
function ApprovalReceipts({ files }: { files: { fileId: string; link: string }[] }) {
  return files.length
    ? <small className="ap-receipts">{files.map((f, i) => <a key={f.fileId} href={f.link} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>Receipt {i + 1}</a>)}</small>
    : <small className="ap-receipts none">No receipt photo</small>;
}
type Row = { id: string; reasons?: string[]; title: string; detail: string; receipts?: { fileId: string; link: string }[]; ref: string; who: string; when: string; amount: number; act: (approve: boolean, remarks?: string) => Promise<unknown>; okLabel: string; canReject: boolean };

/**
 * Approvals by category (owner, 8 Oct 2026): money out (expense requests,
 * voucher reprints, refunds), fees (discounts, rebates owed to partners) and
 * cash control (cashier closings). Full page with a category list; on the
 * dashboard the same lists sit under category tabs.
 */
export function AccountingApprovals({ data, reload, compact, rail }: { data: PortalData; reload: () => Promise<void>; compact?: boolean; rail?: { top?: ReactNode; bottom?: ReactNode } }) {
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
    .filter((e) => e.status === "Pending").map((e): Row => ({ id: e.id, reasons: REJECT_REASONS.expense, receipts: e.receipt_files ?? [], title: `${e.payee} · ${e.category}`, detail: [e.purpose, Array.isArray(e.line_items) && e.line_items.length ? `${e.line_items.length} line${e.line_items.length === 1 ? "" : "s"}` : "", e.payment_channel].filter(Boolean).join(" · "), ref: e.request_number ?? e.expense_number, who: e.requested_by_name ?? "Cashier", when: fmtDate(day(e.created_at)), amount: Number(e.amount_centavos), okLabel: "Approve", canReject: true,
      act: (approve, remarks) => post({ action: "expense-decide", id: e.id, decision: approve ? "Approved" : "Rejected", remarks }, approve ? "Approved. The voucher number is issued." : "Rejected.") }));
  const byExpense = new Map((data.expenses as { id: string; payee: string; amount_centavos: number; voucher_number?: string | null; expense_number: string }[]).map((e) => [e.id, e]));
  const reprints = (data.expenseReprints ?? []).filter((r) => r.status === "Pending").map((r): Row => { const e = byExpense.get(r.expense_id); return { id: r.id, reasons: REJECT_REASONS.voucherReprint, title: `${e?.voucher_number ?? e?.expense_number ?? "Voucher"} · ${e?.payee ?? ""}`, detail: `Reason: ${r.reason}`, ref: "Reprint", who: r.requested_by_name ?? "Cashier", when: fmtDate(day(r.requested_at)), amount: Number(e?.amount_centavos ?? 0), okLabel: "Approve", canReject: true,
    act: (approve, remarks) => post({ action: "expense-reprint-decide", requestId: r.id, decision: approve ? "Approved" : "Rejected", remarks }, approve ? "Reprint approved." : "Reprint request rejected.") }; });
  const refunds = data.requests.filter((r) => r.request_type === "Refund" && r.status === "Pending" && r.stage !== "With cashier").map((r): Row => ({ id: r.id, reasons: REJECT_REASONS.refund, title: `${name(first(r.trainees))} · Refund`, detail: r.reason, ref: first(r.enrollments)?.enrollment_number ?? r.request_number, who: "Cashier", when: fmtDate(day(r.created_at)), amount: Number(r.requested_values?.amountCentavos ?? 0), okLabel: "Approve", canReject: true,
    act: (approve, remarks) => post({ action: "request-decide", id: r.id, approve, remarks }, approve ? "Refund approved." : "Refund rejected.") }));
  const discounts = (data.pendingDiscounts as (PortalData["pendingDiscounts"][number] & { enrollments?: unknown })[]).map((d): Row => {
    const en = first(d.enrollments as { enrollment_number?: string; trainees?: unknown; courses?: unknown } | { enrollment_number?: string }[] | null) as { enrollment_number?: string; trainees?: unknown; courses?: unknown } | null;
    const c = first(en?.courses as { name: string } | null);
    return { id: d.id, reasons: REJECT_REASONS.discount, title: `${name(first(en?.trainees as { legal_first_name: string; legal_last_name: string } | null))}${c ? ` · ${c.name}` : ""}`, detail: d.description, ref: en?.enrollment_number ?? "", who: "Cashier", when: fmtDate(day(d.created_at)), amount: Number(d.amount_centavos), okLabel: "Approve", canReject: true,
      act: (approve, remarks) => post({ action: "discount-decide", id: d.id, approve, remarks }, approve ? "Discount approved." : "Discount rejected.") };
  });
  const rebates = (data.agencyRebates as (PortalData["agencyRebates"][number] & { marketing_agencies?: unknown; courses?: unknown; trainees?: unknown })[]).filter((r) => r.status === "Pending").map((r): Row => ({ id: r.id, title: `${first(r.marketing_agencies as { name: string } | null)?.name ?? "Partner"} · ${name(first(r.trainees as { legal_first_name: string; legal_last_name: string } | null))}`, detail: `${first(r.courses as { name: string } | null)?.name ?? "Course"} · rebate owed (no-deduction partner)`, ref: "Payable", who: "Recorded automatically", when: fmtDate(day(r.created_at)), amount: Number(r.rebate_centavos), okLabel: "Mark paid", canReject: false,
    act: () => post({ action: "agency-rebate-settle", id: r.id, status: "Paid" }, "Rebate marked paid to the partner.") }));
  const closings = data.cashierClosings.filter((c) => c.status === "Submitted").map((c): Row => ({ id: c.id, title: `Cashier closing · ${fmtDate(c.closing_date)}`, detail: `Expected ${pesos2(c.expected_cash_centavos)} · counted ${pesos2(Number(c.actual_cash_centavos ?? 0))}`, ref: Number(c.variance_centavos ?? 0) === 0 ? "Balanced" : Number(c.variance_centavos) < 0 ? `Short ${pesos2(-Number(c.variance_centavos))}` : `Over ${pesos2(Number(c.variance_centavos))}`, who: "Cashier", when: fmtDate(c.closing_date), amount: Number(c.variance_centavos ?? 0), okLabel: "Mark reviewed", canReject: false,
    act: () => post({ action: "cashier-closing-review", id: c.id }, "Closing marked reviewed.") }));
  // Payment voids the Cashier asked for (owner, 29 Oct 2026): approving voids the payment and marks its receipt VOID.
  const payById = new Map(data.payments.map((p) => [p.id, p]));
  const voids = (data.paymentVoids ?? []).filter((r) => r.status === "Pending").map((r): Row => { const p = payById.get(r.payment_id); const t = p ? first(p.trainees) : null; return { id: r.id, reasons: REJECT_REASONS.paymentVoid, title: `${p?.payment_number ?? "Payment"} · ${name(t ?? null)}`, detail: `${p ? `${p.method}${p.reference_number ? ` · Ref ${p.reference_number}` : ""} · ` : ""}Reason: ${r.reason}`, ref: "Void", who: r.requested_by_name ?? "Cashier", when: fmtDate(day(r.requested_at)), amount: Number(p?.amount_centavos ?? 0), okLabel: "Approve Void", canReject: true,
    act: (approve, remarks) => post({ action: "payment-void-decide", requestId: r.id, approve, remarks }, approve ? "Payment voided. The receipt shows VOID and the amount is back on the balance." : "Void request rejected.") }; });
  const lists: Record<Category, Row[]> = { "Expense requests": [...expenses, ...reprints], Refunds: refunds, Discounts: discounts, "Payment voids": voids, "Rebates owed to partners": rebates, "Cashier opening and closing": closings };
  const waiting = Object.values(lists).reduce((s, l) => s + l.length, 0);
  const rowsOf = (list: Row[]) => list.map((r) => <div key={r.id} className={rejecting && rejecting !== r.id ? "ac-dim" : undefined}>
    <div className={`ac-req${rejecting === r.id ? " ac-rejecting" : ""}`}>
      <div><strong>{r.title}</strong>{r.detail && <small>{r.detail}</small>}{r.receipts && <ApprovalReceipts files={r.receipts} />}<small className="cx-mono">{[r.ref, r.who, r.when].filter(Boolean).join(" · ")}</small></div>
      <strong className="cx-amt" style={r.amount < 0 ? { color: "#b42318" } : undefined}>{pesos2(r.amount)}</strong>
      {rejecting === r.id ? <span className="ac-rejlabel">Rejecting</span> : <div className="cx-acts"><button type="button" className="portal-primary" disabled={busy || !!rejecting} onClick={() => void r.act(true).catch(() => undefined)}>{r.okLabel}</button>{r.canReject && <button type="button" className="portal-secondary" disabled={busy || !!rejecting} onClick={() => setRejecting(r.id)}>Reject</button>}</div>}
    </div>
    {rejecting === r.id && <RejectInline reasons={r.reasons ?? REJECT_REASONS.request} busy={busy} onCancel={() => setRejecting(null)} onReject={(why) => void r.act(false, why).then(() => setRejecting(null)).catch(() => undefined)} />}
  </div>);
  const groupOf = (c: Category) => CATEGORY_GROUPS.find(([, cs]) => cs.includes(c))?.[0] ?? "";
  if (rail) {
    const order = CATEGORY_GROUPS.flatMap(([, cs]) => cs);
    const current: Category = cat === "All" ? order.find((k) => lists[k].length) ?? "Expense requests" : cat;
    return <div className="ad-split">
      <section className="portal-panel cx-panel ad-rail"><div className="panel-heading"><h2>To Do</h2><Badge tone={waiting ? "orange" : undefined}>{waiting} waiting</Badge></div>
        {CATEGORY_GROUPS.map(([g, cs], i) => <div key={g} className="ad-grp"><span className="ad-grp-h">{i + 1} · {tcl(g)}</span>
          {cs.map((k) => <button key={k} type="button" className={current === k ? "on" : ""} onClick={() => { setCat(k); setRejecting(null); }}><span>{tcl(k)}<small>{k === "Cashier opening and closing" ? `${lists[k].length} to review` : pesos2(lists[k].reduce((x, r) => x + r.amount, 0))}</small></span><b className={lists[k].length ? "" : "zero"}>{lists[k].length}</b></button>)}
        </div>)}
      </section>
      <div className="ac-stack">
        {rail.top}
        <section className="portal-panel cx-panel ac-approvals"><div className="panel-heading"><h2>{tcl(current)}</h2><span className="muted-text">{lists[current].length} waiting</span></div>
          {msg && <Message kind={msg.kind} text={msg.text} />}
          {lists[current].length ? rowsOf(lists[current]) : <p className="portal-empty-copy">Nothing waiting.</p>}
          {rail.bottom}
        </section>
      </div>
    </div>;
  }
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
          {rejecting === r.id && <RejectInline reasons={r.reasons ?? REJECT_REASONS.request} busy={busy} onCancel={() => setRejecting(null)} onReject={(why) => void r.act(false, why).then(() => setRejecting(null)).catch(() => undefined)} />}
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

const REPRINT_REASONS = ["Misprint", "Lost by the trainee", "Damaged", "Other"];

/** Accounting's reprint with a reason, no limit (owner, 3 Nov 2026): the inline reason row and the call that opens the copy. */
function useReprint(onDone?: () => void) {
  const [open, setOpen] = useState<string | null>(null), [why, setWhy] = useState(""), [other, setOther] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const toggle = (id: string) => { setOpen(open === id ? null : id); setWhy(""); setOther(""); };
  const run = async (kind: "receipt" | "tar", id: string, number: string) => {
    const reason = why === "Other" ? other.trim() : why;
    if (reason.length < 3) { setMsg({ kind: "error", text: "Choose the reason for the reprint." }); return; }
    const tab = window.open("", "_blank"); setBusy(true); setMsg(null);
    try {
      const res = await submit({ action: "document-reprint", kind, id, reason }) as { url: string; copy: number };
      if (tab) tab.location.href = res.url; else window.location.assign(res.url);
      setMsg({ kind: "success", text: `${number} reprinted · Copy ${res.copy}.` }); setOpen(null); setWhy(""); setOther(""); onDone?.();
    } catch (e) { tab?.close(); setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not reprint." }); } finally { setBusy(false); }
  };
  const formRow = (kind: "receipt" | "tar", id: string, number: string, cols: number) => open === id ? <tr><td colSpan={cols}><div className="tp-reprint"><b>Reprint {number}</b><select value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Reason for the reprint"><option value="">Reason…</option>{REPRINT_REASONS.map((x) => <option key={x}>{x}</option>)}</select>{why === "Other" && <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Reason" aria-label="Other reason" />}<button type="button" className="portal-primary" disabled={busy} onClick={() => void run(kind, id, number)}>Reprint</button><button type="button" className="portal-secondary" onClick={() => setOpen(null)}>Cancel</button></div></td></tr> : null;
  return { toggle, formRow, msg, close: () => setOpen(null) };
}

export function AccountingPayments({ data }: { data: PortalData }) {
  // Receipts and TARs are consolidated here (owner, 3 Nov 2026: "Consolidate Receipt and TARs in Payment").
  const [view, setView] = useState<"receipts" | "tars">("receipts");
  const pills = <div className="sub-pills">{([["receipts", "Acknowledgement Receipts"], ["tars", "Training Admission Records"]] as const).map(([k, label]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{label}</button>)}</div>;
  if (view === "tars") return <div className="portal-page cx ac"><TxHead title="Payments" />{pills}<AccountingDocuments only="tars" embedded /></div>;
  return <PaymentReceipts pills={pills} data={data} />;
}

function PaymentReceipts({ pills, data }: { pills: ReactNode; data: PortalData }) {
  const today = manilaToday();
  const [date, setDate] = useState(today), [channel, setChannel] = useState(""), [q, setQ] = useState("");
  const { data: r, error } = useJson<PayDay>(`/api/staff/cashier-report?date=${date}`);
  const sourceName = (kind: string, name: string) => (kind === "Direct walk-in" ? "Walk-in" : name || kind);
  const rows = r ? r.groups.flatMap((g) => g.rows.map((x) => ({ ...x, source: sourceName(g.kind, g.name) }))) : [];
  const term = q.trim().toLowerCase();
  // Newest first, as on Cashier › Payments; voided payments stay listed, marked VOID, and count in no total.
  const shown = [...rows, ...(r?.voided ?? []).map((x) => ({ ...x, source: sourceName(x.kind ?? "", x.agency ?? "") }))]
    .filter((x) => (!channel || x.channel === channel) && (!term || `${x.receipt} ${x.trainee} ${x.course} ${x.source}`.toLowerCase().includes(term)))
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
  const pg = usePaged(shown);
  const byChannel = CHANNELS.map((c) => { const l = rows.filter((x) => x.channel === c); return { name: c, color: COLORS[c], count: l.length, amount: l.reduce((s, x) => s + x.amountCentavos, 0) }; });
  const proofOf = (x: (typeof rows)[number]) => (x.channel === "Cash" ? "Cash" : x.proof ? "Screenshot uploaded" : "Manual entry");
  // Reprint here too (owner, 3 Nov 2026).
  const rp = useReprint();
  return <div className="portal-page cx ac">
    <TxHead title="Payments" right={<DayPicker date={date} setDate={setDate} />} />{pills}<p className="ac-note">{longDay(date)} · <span className="ac-ro">View only — the Cashier records payments</span></p>
    {error && <Message kind="error" text={error} />}
    {rp.msg && <Message kind={rp.msg.kind} text={rp.msg.text} />}
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
        {/* Day Ledger with Icon Actions, the same row as Cashier › Payments (owner, 5 Nov 2026), plus Accounting's source and rebate. */}
        {!r ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : shown.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Time</th><th>Trainee</th><th>Source</th><th>Mode</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead><tbody>
          {pg.shown.flatMap((x, i) => {
            const s = paymentStatus(data, { id: x.paymentId ?? "", valid: x.valid, void_reason: x.voidReason, verification_state: x.verificationState }), isVoid = x.valid === false;
            return [
              !i && <PaymentDayRow key="day" day={fmtDate(date)} count={shown.length} span={5} total={pesos2(shown.filter((v) => v.valid !== false).reduce((n, v) => n + v.amountCentavos, 0))} />,
              <tr key={`${x.receipt}-${i}`} className={isVoid ? "pv-void" : undefined}><td data-l="Time" className="cx-mono">{x.time}</td><td data-l="" className="lead"><span className="cx-name">{x.trainee}</span><small className="cx-mono">{x.receipt}{x.codes ? ` · ${x.codes}` : ""}</small></td><td data-l="Source"><span className={`cs-chip ${x.source === "Walk-in" ? "wk" : "ag"}`}>{x.source === "Walk-in" ? "Walk-In" : x.source}</span>{x.rebateCentavos ? <small>Rebate {pesos2(x.rebateCentavos)} · {x.rebateStatus}</small> : null}</td><td data-l="Mode">{x.channel}{x.reference ? <small className="cx-mono">{x.reference}</small> : null}</td><td data-l="Status"><Badge tone={s.tone}>{s.label}</Badge>{s.note ? <small>{s.note}</small> : x.channel !== "Cash" ? <small className={x.proof ? "ac-up" : ""}>{tcl(proofOf(x))}</small> : null}</td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(x.amountCentavos)}</strong></td><td data-l="">{x.paymentId && !isVoid && <button type="button" className="pv-icon" title="Reprint" aria-label={`Reprint ${x.receipt}`} onClick={() => rp.toggle(x.paymentId!)}><PrintGlyph /></button>}</td></tr>,
              x.paymentId ? <Fragment key={`${x.receipt}-${i}-reprint`}>{rp.formRow("receipt", x.paymentId, x.receipt, 7)}</Fragment> : null,
            ];
          })}
        </tbody></table>{pg.pager}</div> : <p className="portal-empty-copy">No payments match.</p>}
      </section>
    </div>
  </div>;
}

const EXPENSE_STATES = ["All", "For approval", "Awaiting release", "Released", "Rejected"] as const;
export function AccountingExpenses({ data }: { data: PortalData }) {
  const p = usePeriod();
  const [st, setSt] = useState<(typeof EXPENSE_STATES)[number]>("All");
  type Ex = PortalData["expenses"][number] & { payment_channel?: string | null; reference_number?: string | null; voucher_number?: string | null; paid_at?: string | null; approved_at?: string | null };
  const label = (e: Ex) => (e.status === "Paid" ? "Released" : e.status === "Approved" ? "Awaiting release" : e.status === "Pending" ? "For approval" : e.status);
  const list = (data.expenses as Ex[]).filter((e) => p.inRange(e.created_at) || p.inRange(e.paid_at) || p.inRange(e.approved_at)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const released = list.filter((e) => e.status === "Paid" && p.inRange(e.paid_at));
  const byChannel = CHANNELS.map((c) => { const l = released.filter((e) => e.payment_channel === c); return { name: c, color: COLORS[c], count: l.length, amount: l.reduce((s, e) => s + Number(e.amount_centavos), 0) }; });
  const cats = [...new Set(list.filter((e) => e.status !== "Rejected").map((e) => e.category))];
  const shown = list.filter((e) => st === "All" || label(e) === st);
  const pg = usePaged(shown);
  const tone = (s: string) => (s === "Released" ? "green" : s === "Rejected" ? "red" : s === "For approval" ? "orange" : "blue");
  return <div className="portal-page cx ac">
    <TxHead title="Expenses" note={<span className="ac-ro">View only — the Cashier records and releases expenses</span>} />
    <MonthBar p={p} what="Expenses" count={`${list.length} voucher${list.length === 1 ? "" : "s"}`} />
    {p.picked && <div className="ac-rail">
      <div className="ac-stack">
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Released by Channel</h2></div><FigureColumn rows={byChannel} unit="voucher" totalLabel="Total released" /></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>By Status</h2></div>
          <dl className="ac-lines">{EXPENSE_STATES.slice(1).map((s) => { const l = list.filter((e) => label(e) === s); return <div key={s}><dt>{tcl(s)}</dt><dd>{l.length} · {pesos2(l.reduce((a, e) => a + Number(e.amount_centavos), 0))}</dd></div>; })}</dl>
          <p className="ac-foot">Requests for your decision are in Approvals.</p></section>
        <section className="portal-panel cx-panel"><div className="panel-heading"><h2>By Category</h2></div>
          {cats.length ? <dl className="ac-lines">{cats.map((c) => <div key={c}><dt>{c}</dt><dd>{pesos2(list.filter((e) => e.category === c && e.status !== "Rejected").reduce((a, e) => a + Number(e.amount_centavos), 0))}</dd></div>)}</dl> : <p className="portal-empty-copy">No expenses in this period.</p>}</section>
      </div>
      <section className="portal-panel cx-panel">
        <div className="ac-chipbar">{EXPENSE_STATES.map((s) => <button key={s} type="button" className={`ac-chip${st === s ? " on" : ""}`} onClick={() => setSt(s)}>{tcl(s)}<span>{s === "All" ? list.length : list.filter((e) => label(e) === s).length}</span></button>)}</div>
        {shown.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Voucher</th><th>Payee</th><th>Channel</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead><tbody>
          {pg.shown.map((e) => <tr key={e.id}><td data-l="" className="lead"><span className="cx-name cx-mono">{e.voucher_number ?? e.expense_number}</span><small>{fmtDate(day(e.created_at))}</small></td><td data-l="Payee"><strong>{e.payee}</strong><small>{e.category}</small></td><td data-l="Channel">{e.payment_channel || "—"}{e.reference_number ? <small className="cx-mono">{e.reference_number}</small> : null}</td><td data-l="Status"><Badge tone={tone(label(e))}>{label(e)}</Badge></td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(e.amount_centavos)}</strong></td><td data-l="">{e.voucher_number && <ViewIcon label="View Voucher" href={`/api/documents/expense/${e.id}?copy=1`} />}</td></tr>)}
        </tbody></table>{pg.pager}</div> : <p className="portal-empty-copy">{list.length ? "Nothing with this status." : "No expenses in this period."}</p>}
      </section>
    </div>}
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
  // Paid by month; what is still owed always shows (owner, 3 Nov 2026).
  const { p: paidPeriod, rows: paidRows } = useMonthRows(items.filter((i) => i.paid), (i) => i.paidOn, false);
  const shown = (tab === "Paid" ? paidRows : items.filter((i) => (tab === "Open" ? !i.paid : stateOf(i) === tab))).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
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
        <div className="ac-chipbar">{PAYABLE_TABS.map((t) => <button key={t} type="button" className={`ac-chip${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{tcl(t)}<span>{t === "Open" ? open.length : t === "Paid" ? paidRows.length : items.filter((i) => stateOf(i) === t).length}</span></button>)}</div>
        {tab === "Paid" && <PeriodBar p={paidPeriod} what="Paid" count={`${paidRows.length} item${paidRows.length === 1 ? "" : "s"}`} />}
        {tab === "Paid" && !paidPeriod.picked ? null : shown.length ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Payee</th><th>Type</th><th>Due</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead><tbody>
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
  const releasedTotal = r ? r.expenses.reduce((x, e) => x + e.amountCentavos, 0) : 0;
  const bills = data.payables.filter((x) => x.status !== "Paid");
  const billsTotal = bills.reduce((x, b) => x + Number(b.amount_centavos), 0);
  const receivable = unpaid.reduce((x, u) => x + u.balanceCentavos, 0);
  const shortOver = data.cashierClosings.filter((c) => c.closing_date >= addDays(today, -6) && c.status !== "Reviewed" && Number(c.variance_centavos ?? 0) !== 0);
  // Cash control for the day (Design 06): the Cashier's opening and closing, and the last closing before it.
  const opening = (data.cashierOpenings ?? []).find((o) => o.opening_date === date);
  const closing = data.cashierClosings.find((c) => c.closing_date === date);
  const last = data.cashierClosings.filter((c) => c.closing_date < date).sort((x, y) => y.closing_date.localeCompare(x.closing_date))[0];
  const varianceText = (c: { variance_centavos?: number | null }) => { const v = Number(c.variance_centavos ?? 0); return v === 0 ? "Balanced" : `${v < 0 ? "Short" : "Over"} ${pesos2(Math.abs(v))}`; };
  const cashierToday = <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Cashier Today</h2><span className="muted-text">{fmtDate(date)}</span></div>
    <div className="ad-cash">
      <div><span>Opening</span><b>{opening ? pesos2(Number(opening.opening_cash_centavos)) : "Not yet"}</b><small>{opening ? fmtClock(opening.created_at) : "No opening recorded"}</small></div>
      <div><span>Closing</span><b>{closing ? varianceText(closing) : "Not yet"}</b><small>{closing ? `${closing.status} · counted ${pesos2(Number(closing.actual_cash_centavos ?? 0))}` : "Not submitted"}</small></div>
      <div><span>Last Closing</span><b className={last && Number(last.variance_centavos ?? 0) < 0 ? "minus" : ""}>{last ? varianceText(last) : "—"}</b><small>{last ? `${fmtDate(last.closing_date)} · ${last.status === "Reviewed" ? "reviewed" : "needs review"}` : "None yet"}</small></div>
    </div></section>;
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting</span><h1>Dashboard</h1></div>
      <div className="ac-day"><button type="button" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>‹</button><input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /><button type="button" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</button></div></div>
    <p className="ac-note">{longDay(date)} · view only — the Cashier records payments and expenses.</p>
    {dayReport.error && <Message kind="error" text={dayReport.error} />}
    {shortOver.map((c) => <div key={c.id} className="cl-admin-alarm"><p className="ac-note fr-warn">⚠ Cashier closing {fmtDate(c.closing_date)} · {Number(c.variance_centavos) < 0 ? "short" : "over"} {pesos2(Math.abs(Number(c.variance_centavos)))} <button type="button" className="portal-secondary" onClick={() => go("Cash position")}>Review</button></p></div>)}
    <AccountingApprovals data={data} reload={reload} rail={{ top: cashierToday, bottom: <div className="ad-strip">
      <div><span>Collections</span><b>{pesos2(total)}</b><small>{receipts} receipt{receipts === 1 ? "" : "s"}</small></div>
      <div><span>Cash on hand</span><b>{p ? pesos2(p.onHandCentavos) : "…"}</b></div>
      <div><span>Released</span><b>{pesos2(releasedTotal)}</b></div>
      <div><button type="button" onClick={() => go("Receivables")}>Receivables</button><b>{pesos2(receivable)}</b></div>
      <div><button type="button" onClick={() => go("Payables")}>Payables · {bills.length}</button><b>{pesos2(billsTotal)}</b></div>
      <div><span>Rebates owed</span><b>{pesos2(w?.current.rebatesOwed ?? 0)}</b></div>
    </div> }} />
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

const REPORT_VIEWS = ["Cash and Sales Summary", "Overview"] as const;
/** Accounting › Reports › Cash and Sales Summary, with the Overview inside it (owner, 5 Nov 2026). */
export function AccountingReportsHub() {
  const [view, setView] = useState<(typeof REPORT_VIEWS)[number]>("Cash and Sales Summary");
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

const CENTER_TONE: Record<CenterState, "green" | "blue" | "orange"> = { Paid: "green", Approved: "blue", "For Approval": "blue", Owed: "orange" };

/** One center's ledger: its trainees, ten per page, and the subtotal. */
function EndorsedCenter({ center }: { center: EndorsedSales["centers"][number] }) {
  const pg = usePaged(center.rows), t = center.totals;
  return <section className="portal-panel cx-panel">
    <div className="panel-heading"><h2>{center.name}</h2><span className="muted-text">{t.trainees} Trainee{t.trainees === 1 ? "" : "s"} · Course Fees {pesos2(t.fees)}</span></div>
    <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Trainee</th><th>Course</th><th>Training Date</th><th className="fs-n">Course Fee</th><th className="fs-n">Amount Collected</th><th className="fs-n">Outstanding Balance</th><th>Partnered Center</th><th>Rebate</th><th className="fs-n">Rebate Amount</th><th className="fs-n">Agency Commission</th><th className="fs-n">Net Rebate Income</th></tr></thead><tbody>
      {pg.shown.map((r) => <tr key={r.id}>
        <td><b>{r.trainee}</b><small className="cl-sub cl-block">{r.traineeNo}{r.status === "Enrolled" ? "" : ` · ${r.status}`}</small></td>
        <td title={r.course}>{r.code}</td>
        <td>{r.trainingDate ? fmtDate(r.trainingDate) : "—"}</td>
        <td className="fs-n">{pesos2(r.fee)}</td>
        <td className="fs-n">{pesos2(r.collected)}</td>
        <td className={`fs-n${r.balance > 0 ? " fs-neg" : ""}`}>{pesos2(r.balance)}</td>
        <td><Badge tone={CENTER_TONE[r.centerState]}>{r.centerState}</Badge></td>
        <td>{r.rebateState === "None" ? "—" : <Badge tone={r.rebateState === "Received" ? "green" : "orange"}>{r.rebateState}</Badge>}</td>
        <td className="fs-n">{pesos2(r.rebate)}</td>
        <td className="fs-n">{pesos2(r.share)}</td>
        <td className="fs-n">{pesos2(r.keeps)}</td>
      </tr>)}
      <tr className="fs-tot"><td colSpan={3}>Total · {t.trainees} Trainee{t.trainees === 1 ? "" : "s"}</td><td className="fs-n">{pesos2(t.fees)}</td><td className="fs-n">{pesos2(t.collected)}</td><td className="fs-n">{pesos2(t.balance)}</td><td /><td /><td className="fs-n">{pesos2(t.rebate)}</td><td className="fs-n">{pesos2(t.share)}</td><td className="fs-n">{pesos2(t.keeps)}</td></tr>
    </tbody></table></div>{pg.pager}
  </section>;
}

/** The statements themselves, one per center, then the grand totals. */
export function EndorsedStatements({ report }: { report: EndorsedSales }) {
  const t = report.totals;
  if (!report.rows.length) return <section className="portal-panel cx-panel"><p className="portal-empty-copy">No endorsed trainees in this period.</p></section>;
  const facts: [string, string | number][] = [["Trainees", t.trainees], ["Course Fees", pesos2(t.fees)], ["Amount Collected", pesos2(t.collected)], ["Outstanding Balance", pesos2(t.balance)], ["Remitted to Partnered Centers", pesos2(t.centerPaid)], ["Payable to Partnered Centers", pesos2(t.centerOwed)], ["Rebates Receivable", pesos2(t.rebateDue)], ["Rebates Received", pesos2(t.rebateReceived)], ["Agency Commissions", pesos2(t.share)], ["Net Rebate Income", pesos2(t.keeps)]];
  return <div className="es-stack">
    {report.centers.map((c) => <EndorsedCenter key={`${report.from}|${report.to}|${c.name}`} center={c} />)}
    <div className="es-grand">{facts.map(([label, value]) => <span key={label}>{label} <b>{value}</b></span>)}</div>
  </div>;
}

/**
 * Endorsed Courses report (owner, 5 Nov 2026, Design 2 · Center Statements): sales by training date, so the
 * totals agree with the Cash and Sales Summary. Accounting and the Admin; PDF and Excel match the screen.
 */
export function EndorsedSalesReport() {
  const today = manilaToday();
  const [period, setPeriod] = useState<Period | "Custom">("Monthly");
  const [end, setEnd] = useState(today);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`), [to, setTo] = useState(today);
  const custom = period === "Custom", ready = !custom || (!!from && !!to && from <= to);
  const q = custom ? `from=${from}&to=${to}` : `period=${period}&end=${end}`;
  const { data: s, error } = useJson<EndorsedSales>(ready ? `/api/staff/endorsed-sales?${q}` : null);
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting · Reports</span><h1>Endorsed Courses</h1></div>
      {ready && <div className="ac-controls"><a className="portal-secondary" href={`/api/documents/endorsed-sales?${q}&format=xlsx`}>Download Excel</a><a className="portal-primary" href={`/api/documents/endorsed-sales?${q}`} target="_blank" rel="noreferrer">Print PDF</a></div>}</div>
    <div className="pd-bar cs-bar"><span className="cx-seg">{[...PERIODS, "Custom" as const].map((p) => <button key={p} type="button" className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>{p}</button>)}</span>
      {period === "Custom" ? <>
        <label className="cx-dt">From<input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="cx-dt">To<input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} /></label>
      </> : <>
        <button type="button" className="portal-secondary" aria-label="Previous" onClick={() => setEnd(shiftPeriod(period, end, -1, today))}>‹</button>
        <input type="date" value={end} max={today} aria-label="As of" onChange={(e) => e.target.value && setEnd(e.target.value)} />
        <button type="button" className="portal-secondary" aria-label="Next" disabled={end >= today} onClick={() => setEnd(shiftPeriod(period, end, 1, today))}>›</button>
      </>}
      {s && <span className="pd-label"><b>{s.title}</b> · {fmtDate(s.from)} – {fmtDate(s.to)} · By Training Date</span>}</div>
    {!ready && <Message kind="error" text="Choose a From date on or before the To date." />}
    {error && <Message kind="error" text={error} />}
    {ready && !s ? !error && <p className="portal-empty-copy">Loading the report…</p> : s && <EndorsedStatements report={s} />}
  </div>;
}

/**
 * Cash and Sales Summary (owner, 21 Oct 2026, prototype): cash received and
 * disbursed, and sales by training date, split Endorsed Courses vs New Wave Courses
 * New Wave. Accounting and the Admin; PDF and Excel match the screen.
 */
export function FinanceSummaryReport({ switcher }: { switcher?: ReactNode }) {
  const today = manilaToday();
  const [period, setPeriod] = useState<Period>("Daily");
  const [end, setEnd] = useState(today);
  const q = `period=${period}&end=${end}`;
  const { data: s, error } = useJson<FinanceSummary>(`/api/staff/finance-summary?${q}`);
  const rE = s ? sideTotal(s.received, "E") : 0, rD = s ? sideTotal(s.received, "D") : 0, dE = s ? sideTotal(s.disbursed, "E") : 0, dD = s ? sideTotal(s.disbursed, "D") : 0;
  // A zero is not a loss: only real amounts take the red or green.
  const tone = (v: number, cls: string) => <td className={`fs-n${v ? ` ${cls}` : ""}`}>{pesos2(v)}</td>;
  const neg = (v: number) => <td className={`fs-n${v ? " fs-neg" : ""}`}>{pesos2(0 - v)}</td>;
  const saleCells = (r: SalesLine) => <><td className="fs-n">{r.trainees}</td><td className="fs-n">{pesos2(r.fees)}</td><td className="fs-n">{pesos2(r.charges)}</td>{neg(r.discounts)}<td className="fs-n"><b>{pesos2(r.sales)}</b></td>{tone(r.collected, "fs-pos")}{tone(r.balance, "fs-neg")}</>;
  const saleHeads = (first: string) => <thead><tr><th>{first}</th><th className="fs-n">Trainees</th><th className="fs-n">Course Fees</th><th className="fs-n">Miscellaneous Charges</th><th className="fs-n">Less Discounts</th><th className="fs-n">Total Sales</th><th className="fs-n">Amount Collected</th><th className="fs-n">Outstanding Balance</th></tr></thead>;
  const share = (v: number) => (s?.totalSales.sales ? `${Math.round((v / s.totalSales.sales) * 100)}% of Total Sales` : "No Sales in This Period");
  const trainees = (n: number) => `${n} Trainee${n === 1 ? "" : "s"}`;
  const none = (cols: number, text: string) => <tr><td colSpan={cols} className="muted-text">{text}</td></tr>;
  const cash = (title: string, ls: Line[]) => <section className="portal-panel cx-panel"><div className="panel-heading"><h2>{title}</h2></div>
    <div className="cl-wrap"><table className="cl-log"><thead><tr><th>Line</th><th className="fs-n">Endorsed Courses</th><th className="fs-n">New Wave Courses</th><th className="fs-n">Total</th></tr></thead><tbody>
      {(["E", "D"] as const).map((side) => { const mine = ls.filter((l) => l.side === side); return [<tr key={side} className="nb-group"><td colSpan={4}>{side === "E" ? "Endorsed Courses" : "New Wave Courses"}</td></tr>,
        ...mine.map((l) => <tr key={`${side}${l.label}`} className="fs-sub"><td>{l.label}</td><td className="fs-n">{side === "E" ? pesos2(l.total) : "—"}</td><td className="fs-n">{side === "D" ? pesos2(l.total) : "—"}</td><td className="fs-n">{pesos2(l.total)}</td></tr>),
        !mine.length && <tr key={`${side}-none`} className="fs-sub"><td colSpan={4} className="muted-text">None in This Period</td></tr>]; })}
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
      <div className="fs-section"><h2>Sales Summary</h2><small>By Training Date · Company Charge by Date Paid</small></div>
      <div className="cx-tiles ac-tiles fs-tiles">
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#123F63" }}><span>Total Sales</span><b>{pesos2(s.totalSales.sales)}</b><small>{trainees(s.totalSales.trainees)}</small></div>
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#0571D0" }}><span>Sales from New Wave Courses</span><b>{pesos2(s.direct.sales)}</b><small>{trainees(s.direct.trainees)} · {share(s.direct.sales)}</small></div>
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#F25615" }}><span>Sales from Endorsed Courses</span><b>{pesos2(s.endorsement.sales)}</b><small>{trainees(s.endorsement.trainees)} · {share(s.endorsement.sales)}</small></div>
      </div>
      <section className="portal-panel cx-panel"><div className="cl-wrap"><table className="cl-log">{saleHeads("Category")}<tbody>
        <tr className="fs-total"><td>Total Sales</td>{saleCells(s.totalSales)}</tr>
        <tr className="fs-lvl1" style={{ ["--c" as string]: "#0571D0" }}><td>Sales from New Wave Courses</td>{saleCells(s.direct)}</tr>
        {s.direct.categories.map((c) => <tr key={c.name} className="fs-sub"><td>{c.name}</td>{saleCells(c)}</tr>)}
        <tr className="fs-lvl1" style={{ ["--c" as string]: "#F25615" }}><td>Sales from Endorsed Courses</td>{saleCells(s.endorsement)}</tr>
        {s.endorsement.centers.map((c) => <tr key={c.name} className="fs-sub"><td>{c.name}</td>{saleCells(c)}</tr>)}
        {!s.endorsement.centers.length && none(8, "No Endorsed Training in This Period")}
        <tr className="fs-sub"><td>Of Which Company Charge, by Date Paid</td>{saleCells(s.companyCharge)}</tr>
      </tbody></table></div><p className="ac-note">Sales from Endorsed Courses are shown in full, though most of the amount is remitted to the partnered centers. New Wave&apos;s own income from them is the Net Rebate Income below.</p></section>

      <div className="fs-section"><h2>Sales from New Wave Courses</h2></div>
      <section className="portal-panel cx-panel"><div className="cl-wrap"><table className="cl-log">{saleHeads("Course")}<tbody>
        {s.direct.categories.map((c) => <Fragment key={c.name}>
          <tr className="nb-group"><td colSpan={8}>{c.name}</td></tr>
          {c.courses.map((r) => <tr key={r.code}><td><b>{r.code}</b><small className="cl-sub cl-block">{r.name}</small></td>{saleCells(r)}</tr>)}
          {!c.courses.length && none(8, "No Training in This Period")}
          <tr className="fs-tot"><td>Total {c.name}</td>{saleCells(c)}</tr>
        </Fragment>)}
        <tr className="fs-net"><td>Total Sales from New Wave Courses</td>{saleCells(s.direct)}</tr>
        <tr><td colSpan={7}>Less Operating Expenses for the Period</td>{neg(s.direct.expenses)}</tr>
        <tr className="fs-net"><td colSpan={7}>Gross Margin on New Wave Courses</td><td className="fs-n">{pesos2(s.direct.margin)}</td></tr>
      </tbody></table></div></section>

      <div className="fs-section"><h2>Sales from Endorsed Courses</h2></div>
      <section className="portal-panel cx-panel"><div className="cl-wrap"><table className="cl-log">{saleHeads("Partnered Center")}<tbody>
        {s.endorsement.centers.map((c) => <tr key={c.name}><td><b>{c.name}</b></td>{saleCells(c)}</tr>)}
        {!s.endorsement.centers.length && none(8, "No Endorsed Training in This Period")}
        <tr className="fs-net"><td>Total Sales from Endorsed Courses</td>{saleCells(s.endorsement)}</tr>
      </tbody></table></div></section>
      <section className="portal-panel cx-panel fs-gap"><div className="panel-heading"><h2>Rebates from Endorsed Courses</h2></div><div className="cl-wrap"><table className="cl-log"><thead><tr><th>Partnered Center</th><th className="fs-n">Payable to Partnered Center</th><th className="fs-n">Rebate</th><th className="fs-n">Rebate Received</th><th className="fs-n">Rebates Receivable</th><th className="fs-n">Agency Commission</th><th className="fs-n">Net Rebate Income</th></tr></thead><tbody>
        {s.endorsement.centers.map((c) => <tr key={c.name}><td><b>{c.name}</b></td><td className="fs-n">{pesos2(c.payable)}</td><td className="fs-n">{pesos2(c.rebate)}</td>{tone(c.received, "fs-pos")}{tone(c.due, "fs-neg")}{neg(c.share)}<td className="fs-n"><b>{pesos2(c.keeps)}</b></td></tr>)}
        {!s.endorsement.centers.length && none(7, "No Endorsed Training in This Period")}
        <tr className="fs-net"><td>Total</td><td className="fs-n">{pesos2(s.endorsement.payable)}</td><td className="fs-n">{pesos2(s.endorsement.rebate)}</td><td className="fs-n">{pesos2(s.endorsement.received)}</td><td className="fs-n">{pesos2(s.endorsement.rebateDue)}</td><td className="fs-n">{pesos2(0 - s.endorsement.share)}</td><td className="fs-n">{pesos2(s.endorsement.keeps)}</td></tr>
      </tbody></table></div></section>

      <div className="fs-section"><h2>Cash Summary</h2><small>By Date Received and Released</small></div>
      <div className="cx-tiles ac-tiles fs-tiles">
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#0a7a3e" }}><span>Cash Received</span><b>{pesos2(rE + rD)}</b><small>Endorsed {pesos2(rE)} · New Wave {pesos2(rD)}</small></div>
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#b42318" }}><span>Disbursements</span><b>{pesos2(dE + dD)}</b><small>Endorsed {pesos2(dE)} · New Wave {pesos2(dD)}</small></div>
        <div className="cx-tile fs-tile" style={{ ["--c" as string]: "#0571D0" }}><span>Net Cash</span><b>{pesos2(rE + rD - dE - dD)}</b><small>Received Less Disbursed</small></div>
      </div>
      <div className="fs-grid">{cash("Cash Received", s.received)}{cash("Disbursements", s.disbursed)}</div>
      <section className="portal-panel cx-panel"><div className="panel-heading"><h2>Net Cash</h2></div><div className="cl-wrap"><table className="cl-log"><thead><tr><th></th><th className="fs-n">Endorsed Courses</th><th className="fs-n">New Wave Courses</th><th className="fs-n">Total</th></tr></thead><tbody>
        <tr><td>Cash Received</td><td className="fs-n">{pesos2(rE)}</td><td className="fs-n">{pesos2(rD)}</td><td className="fs-n">{pesos2(rE + rD)}</td></tr>
        <tr><td>Less Disbursements</td>{neg(dE)}{neg(dD)}{neg(dE + dD)}</tr>
        <tr className="fs-net"><td>Net Cash</td><td className="fs-n">{pesos2(rE - dE)}</td><td className="fs-n">{pesos2(rD - dD)}</td><td className="fs-n">{pesos2(rE + rD - dE - dD)}</td></tr>
      </tbody></table></div></section>
    </>}
  </div>;
}

/* ------------------------------------------------------------ billing statement */

type BillingPreview = { from: string; to: string; statements: { agencyId: string; billTo: string; kind: string; rows: BillingRow[]; total: number; bsNumber: string | null; statementId?: string | null }[] };
const firstOfMonth = (d: string) => `${d.slice(0, 8)}01`;
/**
 * Billing Statement (owner, 22 Oct 2026): per agency or consultancy (dropdown), the trainees
 * enrolled in the coverage at the full fee with their training status; Print PDF issues the BS No.
 */
export function BillingStatementReport({ switcher, onBack }: { switcher?: ReactNode; onBack?: () => void }) {
  const today = manilaToday();
  const [from, setFrom] = useState(firstOfMonth(today)), [to, setTo] = useState(today), [agency, setAgency] = useState("");
  // Amounts Accounting types before issuing (owner, 29 Oct 2026: partners have their own pricelists); a void lets a corrected one be issued.
  const [typed, setTyped] = useState<Record<string, string>>({}), [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  const { data, error } = useJson<BillingPreview>(`/api/staff/billing-statement?from=${from}&to=${to}&v=${version}`);
  const list = data?.statements ?? [];
  const st = list.find((x) => x.agencyId === agency) ?? list[0] ?? null;
  const issued = !!st?.bsNumber;
  const amountOf = (r: BillingRow) => (!issued && r.enrollmentId && typed[r.enrollmentId] !== undefined ? Math.round((Number(typed[r.enrollmentId]) || 0) * 100) : r.amount);
  const total = st ? st.rows.reduce((s, r) => s + amountOf(r), 0) : 0;
  const pdfUrl = st ? `/api/documents/billing-statement?agency=${st.agencyId}&from=${from}&to=${to}` : "";
  async function act(body: Record<string, unknown>) {
    setBusy(true); setProblem("");
    try { const r = await fetch("/api/staff/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "Could not save."); return b; }
    finally { setBusy(false); }
  }
  async function issue() {
    if (!st) return;
    const amounts = Object.fromEntries(st.rows.filter((r) => r.enrollmentId).map((r) => [r.enrollmentId!, amountOf(r)]));
    const tab = window.open("", "_blank");
    try { await act({ action: "billing-statement-issue", agencyId: st.agencyId, from, to, amounts }); setTyped({}); setVersion((v) => v + 1); if (tab) tab.location.href = pdfUrl; }
    catch (e) { tab?.close(); setProblem(e instanceof Error ? e.message : "Could not issue the statement."); }
  }
  async function voidIt() {
    if (!st?.statementId) return;
    const reason = await askReason(`Void BS No. ${st.bsNumber}? A corrected statement can then be issued with a new BS No.`, REASONS.billingVoid, { title: "Void Billing Statement", okLabel: "Void", danger: true });
    if (!reason || reason.trim().length < 3) return;
    try { await act({ action: "billing-statement-void", billingStatementId: st.statementId, reason: reason.trim() }); setVersion((v) => v + 1); }
    catch (e) { setProblem(e instanceof Error ? e.message : "Could not void the statement."); }
  }
  const groups = (["Agency", "Consultancy"] as const).map((k) => [k, list.filter((x) => (x.kind === "Consultancy" ? "Consultancy" : "Agency") === k)] as const).filter(([, xs]) => xs.length);
  return <div className="portal-page cx ac">
    <div className="cx-head"><div><span className="portal-eyebrow">Accounting · Company Charge</span><h1>Issue Statement</h1></div>
      <div className="ac-controls">{onBack && <button type="button" className="portal-secondary" onClick={onBack}>Back to Company Charge</button>}{st && (issued ? <><a className="portal-primary" href={pdfUrl} target="_blank" rel="noreferrer">Reprint PDF</a><button type="button" className="portal-secondary" disabled={busy} onClick={() => void voidIt()}>Void Statement</button></> : <button type="button" className="portal-primary" disabled={busy || !st.rows.length} onClick={() => void issue()}>{busy ? "Issuing…" : "Issue and Print PDF"}</button>)}</div></div>
    {switcher}
    <div className="pd-bar cs-bar">
      <label className="rp-who">Bill To<select value={st?.agencyId ?? ""} onChange={(e) => setAgency(e.target.value)} disabled={!list.length}>
        {!list.length && <option value="">No Company Charge Trainees</option>}
        {groups.map(([k, xs]) => <optgroup key={k} label={k === "Consultancy" ? "Consultancies" : "Agencies"}>{xs.map((x) => <option key={x.agencyId} value={x.agencyId}>{x.billTo}</option>)}</optgroup>)}
      </select></label>
      <label className="rp-who">From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
      <label className="rp-who">To<input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
    </div>
    {error && <Message kind="error" text={error} />}
    {problem && <Message kind="error" text={problem} />}
    {!data ? !error && <p className="portal-empty-copy">Loading…</p> : !st ? <p className="portal-empty-copy">No trainees on Company Charge in this coverage.</p> :
      <section className="portal-panel cx-panel bs-sheet">
        <div className="bs-title"><h2>Billing Statement{issued ? ` · BS No. ${st.bsNumber}` : ""}</h2><span className="bs-form">Form No: NW-FMGR-04-24 · Issued Date: 12/03/2025</span></div>
        <table className="bs-info"><tbody><tr><td>Bill to:</td><td><b>{st.billTo}</b></td></tr><tr><td>Billing Coverage:</td><td>{fmtDate(from)} – {fmtDate(to)} (as per date enrolled)</td></tr></tbody></table>
        <div className="cl-wrap"><table className="cl-log bs-items"><thead><tr><th>Date Enrolled</th><th>Name</th><th>Training</th><th>Status</th><th className="fs-n">Amount</th></tr></thead><tbody>
          {st.rows.map((r, i) => <tr key={i}><td>{r.enrolled}</td><td>{r.name}</td><td>{r.training}</td><td className="bs-st">{r.status}</td><td className="fs-n">{!issued && r.enrollmentId ? <input className="rb3-amt" type="number" min="0" step="0.01" aria-label={`Amount for ${r.name}`} value={typed[r.enrollmentId] ?? (r.amount / 100).toFixed(2)} onChange={(e) => setTyped({ ...typed, [r.enrollmentId!]: e.target.value })} /> : pesos2(r.amount)}</td></tr>)}
          <tr className="fs-tot"><td colSpan={4}>Total · {st.rows.length} enrollment{st.rows.length === 1 ? "" : "s"}</td><td className="fs-n">{pesos2(issued ? st.total : total)}</td></tr>
        </tbody></table></div>
        <p className="ac-note">{issued ? "Issued statements stay as printed. Void it to issue a corrected one with a new BS No." : "Type each amount from the partner's pricelist, then Issue and Print PDF. These trainees are billed at these amounts, and their balances follow."}</p>
      </section>}
  </div>;
}

type DocRow = { id: string; number: string; issuedAt: string; trainee: string; nwmtaciNo: string; label?: string; courses?: string; method?: string; reference?: string; amount?: number; valid?: boolean; voidReason?: string | null; verificationState?: string | null; payment?: string; balanceCentavos?: number; printCount: number };
/** Accounting › Receipts and TARs (owner, 3 Nov 2026): date-sensitive lists of every receipt and TAR issued; Accounting reprints them, with a reason and no limit. */
export function AccountingDocuments({ only, embedded, data: portal }: { only?: "receipts" | "tars"; embedded?: boolean; data?: PortalData } = {}) {
  const p = usePeriod();
  const [kindPick, setKind] = useState<"receipts" | "tars">(only ?? "receipts"), [q, setQ] = useState(""), [tick, setTick] = useState(0);
  const kind = only ?? kindPick;
  const term = q.trim().toLowerCase();
  // Nothing loads until a date is picked; a search looks across the last 12 months (owner, 5 Nov 2026).
  const range = p.picked ? p.range : term ? { from: addDays(p.today, -365), to: p.today, label: "the last 12 months" } : null;
  const { data, error } = useJson<{ rows: DocRow[] }>(range ? `/api/staff/documents?kind=${kind}&from=${range.from}&to=${range.to}&n=${tick}` : null);
  const rows = (data?.rows ?? []).filter((r) => !term || `${r.number} ${r.trainee} ${r.nwmtaciNo} ${r.label ?? ""} ${r.courses ?? ""}`.toLowerCase().includes(term));
  const pg = usePaged(rows);
  const rp = useReprint(() => setTick((n) => n + 1));
  const total = rows.filter((r) => r.valid !== false).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const when =(iso: string) => `${fmtDate(iso)} · ${new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso))}`;
  const body = <>
    {!only && <div className="sub-pills">{([["receipts", "Acknowledgement Receipts"], ["tars", "Training Admission Records"]] as const).map(([k, label]) => <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => { setKind(k); rp.close(); }}>{label}</button>)}</div>}
    {rp.msg && <Message kind={rp.msg.kind} text={rp.msg.text} />}
    {error && <Message kind="error" text={error} />}
    <section className="portal-panel cx-panel">
      <PeriodBar p={p} what={kind === "receipts" ? "Receipts issued" : "TARs issued"} count={`${rows.length}`} />
      <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search receipts and TARs" placeholder="Search number, trainee or NWMTACI No." value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!range ? null : !data ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : !rows.length ? <p className="portal-empty-copy">No {kind === "receipts" ? "receipts" : "TARs"} issued in this period.</p>
        : kind === "receipts" ? <div className="portal-table cx-cards ac-table"><table><thead><tr><th>Time</th><th>Trainee</th><th>For</th><th>Mode</th><th>Status</th><th className="r">Amount</th><th></th></tr></thead><tbody>
          {/* Day Ledger with Icon Actions, the same row as Cashier › Payments (owner, 5 Nov 2026). */}
          {pg.shown.flatMap((r, i) => {
            const d = manilaDay(r.issuedAt), onDay = rows.filter((x) => manilaDay(x.issuedAt) === d), isVoid = r.valid === false;
            const s = paymentStatus(portal ?? {}, { id: r.id, valid: r.valid, void_reason: r.voidReason, verification_state: r.verificationState });
            return [
              (!i || manilaDay(pg.shown[i - 1].issuedAt) !== d) && <PaymentDayRow key={`day-${d}`} day={fmtDate(d)} count={onDay.length} span={5} total={pesos2(onDay.filter((x) => x.valid !== false).reduce((n, x) => n + Number(x.amount ?? 0), 0))} />,
              <tr key={r.id} className={isVoid ? "pv-void" : undefined}><td data-l="Time" className="cx-mono">{fmtClock(r.issuedAt)}</td><td data-l="" className="lead"><span className="cx-name">{r.trainee}</span><small className="cx-mono">{r.number}</small></td><td data-l="For">{r.label}</td><td data-l="Mode">{r.method}{r.reference ? <small className="cx-mono">{r.reference}</small> : null}</td><td data-l="Status"><Badge tone={s.tone}>{s.label}</Badge><small>{s.note || (r.printCount ? `Printed ${r.printCount} Time${r.printCount === 1 ? "" : "s"}` : "Not Yet Printed")}</small></td><td data-l="Amount" className="r"><strong className="cx-amt">{pesos2(Number(r.amount ?? 0))}</strong></td><td data-l="">{!isVoid && <button type="button" className="pv-icon" title="Reprint" aria-label={`Reprint ${r.number}`} onClick={() => rp.toggle(r.id)}><PrintGlyph /></button>}</td></tr>,
              <Fragment key={`${r.id}-reprint`}>{rp.formRow("receipt", r.id, r.number, 7)}</Fragment>,
            ];
          })}
        </tbody><tfoot><tr><td data-l="" colSpan={5}>{rows.length} receipt{rows.length === 1 ? "" : "s"} · {range.label}</td><td data-l="Total" className="r cx-amt">{pesos2(total)}</td><td data-l="" /></tr></tfoot></table>{pg.pager}</div>
        : <div className="portal-table ac-table"><table><thead><tr><th>TAR No.</th><th>Issued</th><th>Trainee</th><th>Courses</th><th>Payment</th><th>Printed</th><th></th></tr></thead><tbody>
          {pg.shown.map((r) => <Fragment key={r.id}><tr>
            <td className="cx-mono"><b>{r.number}</b></td><td>{when(r.issuedAt)}</td><td>{r.trainee}<small className="cx-mono">{r.nwmtaciNo}</small></td>
            <td>{r.courses || "—"}</td><td><Badge tone={r.payment === "Paid" ? "active" : r.payment === "Company Charge" ? "pending" : "cancelled"}>{r.payment === "Balance" ? `Balance ${pesos2(Number(r.balanceCentavos ?? 0))}` : r.payment ?? ""}</Badge></td>
            <td>{r.printCount ? `Printed ${r.printCount} time${r.printCount === 1 ? "" : "s"}` : "Not printed yet"}</td>
            <td><button type="button" className="portal-secondary" onClick={() => rp.toggle(r.id)}>Reprint</button></td></tr>
            {rp.formRow("tar", r.id, r.number, 7)}
          </Fragment>)}
        </tbody></table>{pg.pager}</div>}
    </section>
  </>;
  return embedded ? body : <div className="portal-page cx ac"><TxHead title="Receipts and TARs" />{body}</div>;
}

type HistoryRow = { id: string; category: string; decidedAt: string; title: string; detail: string; amountCentavos: number; decision: string; by: string; remarks: string };
// One line of short filters (owner, 3 Nov 2026); the table keeps each row's full category.
const HISTORY_FILTERS: [string, string[]][] = [["Expenses", ["Expense Requests", "Voucher Reprints"]], ["Refunds", ["Refunds"]], ["Changes", ["Change Requests"]], ["Discounts", ["Discounts"]], ["Voids", ["Payment Voids"]], ["Rebates", ["Rebates Paid to Partners"]], ["Closings", ["Cashier Closings Reviewed"]]];
const DECISION_TONE: Record<string, "active" | "cancelled" | "pending"> = { Approved: "active", Paid: "active", Reviewed: "active", Voided: "pending", Rejected: "cancelled", Cancelled: "cancelled" };

/** Accounting › Approvals (owner, 3 Nov 2026): a date-sensitive history of every decision, by category. Waiting items are on the Dashboard. */
export function ApprovalHistory({ data, go }: { data: PortalData; go: (module: string) => void }) {
  const p = usePeriod();
  const [cat, setCat] = useState("All"), [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  // Nothing loads until a date is picked; a search looks across the last 12 months (owner, 5 Nov 2026).
  const range = p.picked ? p.range : term ? { from: addDays(p.today, -365), to: p.today, label: "the last 12 months" } : null;
  const { data: res, error } = useJson<{ rows: HistoryRow[]; notes: string[] }>(range ? `/api/staff/approval-history?from=${range.from}&to=${range.to}` : null);
  const inView = (res?.rows ?? []).filter((r) => !term || `${r.title} ${r.detail} ${r.remarks} ${r.by}`.toLowerCase().includes(term));
  const inFilter = (r: HistoryRow, f: string) => f === "All" || (HISTORY_FILTERS.find(([n]) => n === f)?.[1] ?? []).includes(r.category);
  const rows = inView.filter((r) => inFilter(r, cat));
  const pg = usePaged(rows);
  const okRows = rows.filter((r) => r.decision !== "Rejected" && r.decision !== "Cancelled"), noRows = rows.filter((r) => r.decision === "Rejected");
  const sum = (l: HistoryRow[]) => l.reduce((s, r) => s + r.amountCentavos, 0);
  // Still waiting: the same counts the Dashboard rail shows.
  const waiting = data.expenses.filter((e) => e.status === "Pending").length + (data.expenseReprints ?? []).filter((r) => r.status === "Pending").length + data.requests.filter((r) => r.request_type === "Refund" && r.status === "Pending" && r.stage !== "With cashier").length + data.pendingDiscounts.length + (data.paymentVoids ?? []).filter((r) => r.status === "Pending").length + data.agencyRebates.filter((r) => r.status === "Pending").length + data.cashierClosings.filter((c) => c.status === "Submitted").length;
  const when = (iso: string) => `${fmtDate(iso)} · ${new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso))}`;
  return <>
    {waiting > 0 && <div className="ah-wait"><span>{waiting} still waiting for your decision</span><button type="button" className="portal-secondary" onClick={() => go("Dashboard")}>Open on the Dashboard</button></div>}
    {error && <Message kind="error" text={error} />}
    {(res?.notes ?? []).length > 0 && <p className="ac-note">Not shown: {res!.notes.join(" · ")}</p>}
    <section className="portal-panel cx-panel">
      <PeriodBar p={p} what="Decided" count={`${rows.length}`} />
      <div className="cx-bar ac-bar"><input className="vx-search" aria-label="Search approvals" placeholder="Search number, payee, trainee or remarks" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="chips ac-chipbar ah-chips">{["All", ...HISTORY_FILTERS.map(([n]) => n)].map((c) => { const n = inView.filter((r) => inFilter(r, c)).length; return <button key={c} type="button" className={`ac-chip${cat === c ? " on" : ""}${n ? "" : " zero"}`} onClick={() => setCat(c)}>{c}<span className={n ? "has" : ""}>{n}</span></button>; })}</div>
      {range && <div className="ad-cash">
        <div><span>Decided</span><b>{rows.length}</b><small>{range.label}</small></div>
        <div><span>Approved · Paid · Reviewed</span><b>{pesos2(sum(okRows))}</b><small>{okRows.length} item{okRows.length === 1 ? "" : "s"}</small></div>
        <div><span>Rejected</span><b>{pesos2(sum(noRows))}</b><small>{noRows.length} item{noRows.length === 1 ? "" : "s"}</small></div>
      </div>}
      {!range ? null : !res ? <p className="portal-empty-copy">{error ? "" : "Loading…"}</p> : rows.length ? <div className="portal-table ac-table"><table><thead><tr><th>Decided</th><th>Category</th><th>What</th><th className="r">Amount</th><th>Decision</th><th>By</th><th>Remarks</th></tr></thead><tbody>
        {pg.shown.map((r) => <tr key={r.id}><td>{when(r.decidedAt)}</td><td><span className="ah-cat">{r.category}</span></td><td><b>{r.title}</b>{r.detail && <small>{r.detail}</small>}</td><td className="r cx-amt">{r.amountCentavos ? pesos2(r.amountCentavos) : "—"}</td><td><Badge tone={DECISION_TONE[r.decision] ?? "pending"}>{r.decision}</Badge></td><td>{r.by}</td><td>{r.remarks || "—"}</td></tr>)}
      </tbody></table>{pg.pager}</div> : <p className="portal-empty-copy">Nothing decided in this period.</p>}
    </section>
  </>;
}
