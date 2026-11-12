import { depositedOn } from "@/lib/bank-deposits";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CashierReportSnapshot } from "@/lib/documents";

/**
 * Cashier summary report (owner, 8 Oct 2026): one consolidated day.
 * Cash position (previous cash + today's cash collected − cash expenses),
 * collections by source (direct walk-ins, agencies, consultancies) and
 * payment channel, the receipts behind them, and expenses with voucher numbers.
 * Shared by the Report screen (JSON) and the PDF.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export const SOURCES = ["Direct walk-ins", "Agencies", "Consultancies", "Freelance"] as const;
export type SourceKind = "Direct walk-in" | "Agency" | "Consultancy" | "Freelance";
export type CollectionRow = { paymentId?: string; rebateCentavos?: number; rebateStatus?: string; receipt: string; time: string; trainee: string; course: string; channel: string; reference: string; amountCentavos: number; kind: SourceKind; agency: string; proof?: boolean; receivedAt?: string; codes?: string; valid?: boolean; voidReason?: string | null; verificationState?: string | null };

const sourceOf = (kind: SourceKind) => (kind === "Direct walk-in" ? "Direct walk-ins" : kind === "Agency" ? "Agencies" : kind === "Freelance" ? "Freelance" : "Consultancies");

/** The summary matrix (source × channel) and the receipts grouped by source and agency name. */
export function collectionsBySource(rows: CollectionRow[], channelOrder: string[]) {
  const channels = [...channelOrder, ...[...new Set(rows.map((r) => r.channel))].filter((c) => !channelOrder.includes(c))];
  const matrix = SOURCES.map((source) => {
    const list = rows.filter((r) => sourceOf(r.kind) === source);
    return {
      source,
      cells: channels.map((channel) => { const l = list.filter((r) => r.channel === channel); return { channel, count: l.length, totalCentavos: l.reduce((s, r) => s + r.amountCentavos, 0) }; }),
      count: list.length,
      totalCentavos: list.reduce((s, r) => s + r.amountCentavos, 0),
    };
  });
  const order: SourceKind[] = ["Direct walk-in", "Agency", "Consultancy", "Freelance"];
  const keyed = new Map<string, { kind: SourceKind; name: string; rows: CollectionRow[] }>();
  for (const r of rows) {
    const key = `${r.kind}|${r.kind === "Direct walk-in" ? "" : r.agency}`;
    const g = keyed.get(key) ?? { kind: r.kind, name: r.kind === "Direct walk-in" ? "" : r.agency, rows: [] };
    g.rows.push(r); keyed.set(key, g);
  }
  const groups = [...keyed.values()]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name))
    .map((g) => ({ kind: g.kind, name: g.name, rows: g.rows, subtotalCentavos: g.rows.reduce((s, r) => s + r.amountCentavos, 0) }));
  return { channels, matrix, groups };
}

/** Previous cash + cash collected − cash expenses = cash on hand; compared with the count at closing. */
export function cashPosition(input: { previousCentavos: number; cashCollectedCentavos: number; cashExpensesCentavos: number; bankDepositsCentavos?: number; countedCentavos: number | null }) {
  // Bank deposits (11 Nov 2026) leave the drawer but are not expenses.
  const onHandCentavos = input.previousCentavos + input.cashCollectedCentavos - input.cashExpensesCentavos - (input.bankDepositsCentavos ?? 0);
  return { ...input, onHandCentavos, overShortCentavos: input.countedCentavos == null ? null : input.countedCentavos - onHandCentavos };
}

/** Drawer cash deposited to the bank on a day; 0 before migration 202611110097. */
async function depositsOn(db: Admin, date: string) {
  const { data, error } = await db.from("bank_deposits").select("status,deposited_on,amount_centavos,source").eq("deposited_on", date);
  return error ? 0 : depositedOn((data ?? []) as Parameters<typeof depositedOn>[0], date);
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaTime = (iso: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const longDate = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const shortDate = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const nameOf = (t: { legal_first_name?: string | null; legal_middle_name?: string | null; legal_last_name?: string | null } | null) => {
  if (!t) return "Unknown trainee";
  const mid = t.legal_middle_name ? ` ${t.legal_middle_name.charAt(0)}.` : "";
  return `${(t.legal_last_name ?? "").toUpperCase()}, ${t.legal_first_name ?? ""}${mid}`.trim();
};

/** Everything the report needs for one Manila date, read with the service role. */
export async function buildCashierReport(db: Admin, date: string, preparedBy: string): Promise<CashierReportSnapshot> {
  const start = `${date}T00:00:00+08:00`, end = `${date}T23:59:59.999+08:00`;

  // Collections.
  const payCols = "id,payment_number,amount_centavos,method,reference_number,received_at,proof_id,verification_state,trainees(legal_first_name,legal_middle_name,legal_last_name,marketing_agency_id)";
  const { data: pay } = await db.from("payments").select(payCols)
    .eq("valid", true).gte("received_at", start).lte("received_at", end).order("received_at", { ascending: true }).limit(2000);
  // Voided payments stay listed for Accounting, marked VOID, and count in no total (owner, 5 Nov 2026). Read apart, so the report stands before 202610090038.
  const { data: voidPay } = await db.from("payments").select(`${payCols},void_reason`)
    .eq("valid", false).gte("received_at", start).lte("received_at", end).order("received_at", { ascending: true }).limit(500);
  type PayRow = { id: string; payment_number: string; amount_centavos: number; method: string; reference_number: string | null; received_at: string; proof_id: string | null; verification_state?: string | null; void_reason?: string | null; trainees: unknown };
  const payments = (pay ?? []) as unknown as PayRow[], voidedPayments = (voidPay ?? []) as unknown as PayRow[];
  const ids = [...payments, ...voidedPayments].map((p) => p.id);
  const [{ data: receipts }, { data: allocs }] = ids.length
    ? await Promise.all([
        db.from("receipts").select("payment_id,receipt_number").in("payment_id", ids),
        db.from("payment_allocations").select("payment_id,enrollment_id,enrollments(referral_agency_id,courses(code,name))").in("payment_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const receiptOf = new Map((receipts ?? []).map((r) => [r.payment_id as string, r.receipt_number as string]));
  const allocList = (allocs ?? []) as unknown as { payment_id: string; enrollment_id: string; enrollments: unknown }[];
  const enrollmentIds = [...new Set(allocList.map((a) => a.enrollment_id))];
  const { data: tagged } = enrollmentIds.length ? await db.from("agency_rebates").select("enrollment_id,agency_id,rebate_centavos,status").in("enrollment_id", enrollmentIds) : { data: [] };
  const agencyOfEnrollment = new Map((tagged ?? []).map((t) => [t.enrollment_id as string, t.agency_id as string]));
  const rebateOfEnrollment = new Map((tagged ?? []).map((t) => [t.enrollment_id as string, { amount: Number(t.rebate_centavos ?? 0), status: t.status === "Pending" ? "Payable" : "Deducted" }]));
  // Agency or consultancy (202610080021); every agency counts as "Agency" before it.
  let agencies = (await db.from("marketing_agencies").select("id,name,kind")).data as { id: string; name: string; kind?: string | null }[] | null;
  if (!agencies) agencies = (await db.from("marketing_agencies").select("id,name")).data as { id: string; name: string }[] | null;
  const agencyById = new Map((agencies ?? []).map((a) => [a.id, a]));

  const toRow = (p: PayRow, valid: boolean): CollectionRow => {
    const mine = allocList.filter((a) => a.payment_id === p.id);
    const t = one(p.trainees as { legal_first_name?: string; legal_middle_name?: string; legal_last_name?: string; marketing_agency_id?: string | null } | null);
    // The paid course's own partner (owner, 3 Nov 2026), not the trainee's earlier one.
    const agencyId = mine.map((a) => agencyOfEnrollment.get(a.enrollment_id) ?? one(a.enrollments as { referral_agency_id?: string | null } | null)?.referral_agency_id).find(Boolean) ?? null;
    const agency = agencyId ? agencyById.get(agencyId) : undefined;
    const kind: SourceKind = !agency ? "Direct walk-in" : agency.kind === "Consultancy" ? "Consultancy" : agency.kind === "Freelance" ? "Freelance" : "Agency";
    const courses = [...new Set(mine.map((a) => { const c = one(one(a.enrollments as { courses?: unknown } | null)?.courses as { code?: string; name?: string } | null); return c?.name ? `${c.name}${c.code ? ` (${c.code})` : ""}` : ""; }).filter(Boolean))];
    const rebate = mine.map((a) => rebateOfEnrollment.get(a.enrollment_id)).find(Boolean);
    const codes = [...new Set(mine.map((a) => one(one(a.enrollments as { courses?: unknown } | null)?.courses as { code?: string } | null)?.code).filter(Boolean))].join(", ");
    return { paymentId: p.id, rebateCentavos: rebate?.amount, rebateStatus: rebate?.status, receipt: receiptOf.get(p.id) ?? p.payment_number, time: manilaTime(p.received_at), trainee: nameOf(t), course: courses.join(", ") || "—", channel: p.method, reference: p.reference_number ?? "", amountCentavos: Number(p.amount_centavos), kind, agency: agency?.name ?? "", proof: !!p.proof_id, receivedAt: p.received_at, codes, valid, voidReason: p.void_reason ?? null, verificationState: p.verification_state ?? null };
  };
  const rows = payments.map((p) => toRow(p, true));
  const { data: methods } = await db.from("payment_methods").select("name,active,sort_order").eq("active", true).order("sort_order");
  const receivable = (methods ?? []).map((m) => m.name as string).filter((n) => ["Cash", "GCash", "PSBank", "UnionBank", "Cheque"].includes(n));
  const { channels, matrix, groups } = collectionsBySource(rows, receivable.length ? receivable : ["Cash", "GCash", "PSBank", "UnionBank", "Cheque"]);

  // Expenses released (paid) that day, with voucher numbers.
  const { data: exBase } = await db.from("expenses").select("id,expense_number,payee,category,amount_centavos,status,paid_at")
    .in("status", ["Paid", "Advanced"]).gte("paid_at", start).lte("paid_at", end).order("paid_at", { ascending: true }).limit(2000);
  const exRows = exBase ?? [];
  const exExtra = new Map<string, { voucher_number?: string | null; payment_channel?: string | null; reference_number?: string | null }>();
  if (exRows.length) {
    const { data } = await db.from("expenses").select("id,payment_channel,reference_number").in("id", exRows.map((e) => e.id));
    for (const r of data ?? []) exExtra.set((r as { id: string }).id, r);
    const { data: v } = await db.from("expenses").select("id,voucher_number").in("id", exRows.map((e) => e.id));
    for (const r of v ?? []) exExtra.set((r as { id: string }).id, { ...exExtra.get((r as { id: string }).id), voucher_number: (r as { voucher_number?: string | null }).voucher_number });
  }
  const expenses = exRows.map((e) => { const x = exExtra.get(e.id) ?? {}; return { voucher: x.voucher_number ?? e.expense_number, payee: e.payee, category: e.category, channel: x.payment_channel ?? "", reference: x.reference_number ?? "", status: "Released", amountCentavos: Number(e.amount_centavos) }; });
  const expenseByChannel = new Map<string, number>();
  for (const e of expenses) expenseByChannel.set(e.channel || "Not set", (expenseByChannel.get(e.channel || "Not set") ?? 0) + e.amountCentavos);

  // Other income received that day (202610190045; none before it).
  const { data: incRows } = await db.from("other_income").select("income_number,source,payer,channel,reference,amount_centavos").eq("received_on", date).is("voided_at", null).order("created_at", { ascending: true });
  const otherIncome = (incRows ?? []).map((i) => ({ number: i.income_number as string, source: i.source as string, payer: i.payer as string, channel: i.channel as string, reference: (i.reference as string | null) ?? "", amountCentavos: Number(i.amount_centavos) }));

  // Cash position: the last counted closing before today, else today's opening.
  const { data: prevClosing } = await db.from("cashier_closings").select("closing_date,actual_cash_centavos").lt("closing_date", date).not("actual_cash_centavos", "is", null).order("closing_date", { ascending: false }).limit(20);
  const lastDate = prevClosing?.[0]?.closing_date as string | undefined;
  let previousCentavos = 0, previousNote = "No closing or opening recorded";
  if (lastDate) {
    previousCentavos = (prevClosing ?? []).filter((c) => c.closing_date === lastDate).reduce((s, c) => s + Number(c.actual_cash_centavos), 0);
    previousNote = `${shortDate(lastDate)} closing, counted`;
  } else {
    const { data: openings } = await db.from("cashier_openings").select("opening_cash_centavos").eq("opening_date", date);
    if (openings?.length) { previousCentavos = openings.reduce((s, o) => s + Number(o.opening_cash_centavos), 0); previousNote = "Today's opening cash"; }
  }
  const { data: todayClosing } = await db.from("cashier_closings").select("actual_cash_centavos").eq("closing_date", date);
  const counted = (todayClosing ?? []).filter((c) => c.actual_cash_centavos != null);
  const position = cashPosition({
    previousCentavos,
    cashCollectedCentavos: rows.filter((r) => r.channel === "Cash").reduce((s, r) => s + r.amountCentavos, 0) + otherIncome.filter((i) => i.channel === "Cash").reduce((s, i) => s + i.amountCentavos, 0),
    cashExpensesCentavos: expenses.filter((e) => e.channel === "Cash").reduce((s, e) => s + e.amountCentavos, 0),
    bankDepositsCentavos: await depositsOn(db, date),
    countedCentavos: counted.length ? counted.reduce((s, c) => s + Number(c.actual_cash_centavos), 0) : null,
  });

  let logoBytes: Uint8Array | undefined;
  try { logoBytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png"))); } catch { logoBytes = undefined; }
  return {
    dateLabel: longDate(date), preparedBy, logoBytes,
    position: { previousLabel: "Previous cash", previousNote, ...position },
    channels, matrix,
    groups: groups.map((g) => ({ kind: g.kind, name: g.name, subtotalCentavos: g.subtotalCentavos, rows: g.rows })),
    voided: voidedPayments.map((p) => toRow(p, false)),
    expenses,
    expenseTotals: [...expenseByChannel].map(([channel, totalCentavos]) => ({ channel, totalCentavos })),
    otherIncome,
  };
}
