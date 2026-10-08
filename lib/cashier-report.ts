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
export const SOURCES = ["Direct walk-ins", "Agencies", "Consultancies"] as const;
export type SourceKind = "Direct walk-in" | "Agency" | "Consultancy";
export type CollectionRow = { receipt: string; time: string; trainee: string; course: string; channel: string; reference: string; amountCentavos: number; kind: SourceKind; agency: string };

const sourceOf = (kind: SourceKind) => (kind === "Direct walk-in" ? "Direct walk-ins" : kind === "Agency" ? "Agencies" : "Consultancies");

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
  const order: SourceKind[] = ["Direct walk-in", "Agency", "Consultancy"];
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
export function cashPosition(input: { previousCentavos: number; cashCollectedCentavos: number; cashExpensesCentavos: number; countedCentavos: number | null }) {
  const onHandCentavos = input.previousCentavos + input.cashCollectedCentavos - input.cashExpensesCentavos;
  return { ...input, onHandCentavos, overShortCentavos: input.countedCentavos == null ? null : input.countedCentavos - onHandCentavos };
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
  const { data: pay } = await db.from("payments").select("id,payment_number,amount_centavos,method,reference_number,received_at,trainees(legal_first_name,legal_middle_name,legal_last_name,marketing_agency_id)")
    .eq("valid", true).gte("received_at", start).lte("received_at", end).order("received_at", { ascending: true }).limit(2000);
  const payments = (pay ?? []) as unknown as { id: string; payment_number: string; amount_centavos: number; method: string; reference_number: string | null; received_at: string; trainees: unknown }[];
  const ids = payments.map((p) => p.id);
  const [{ data: receipts }, { data: allocs }] = ids.length
    ? await Promise.all([
        db.from("receipts").select("payment_id,receipt_number").in("payment_id", ids),
        db.from("payment_allocations").select("payment_id,enrollment_id,enrollments(courses(code,name))").in("payment_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const receiptOf = new Map((receipts ?? []).map((r) => [r.payment_id as string, r.receipt_number as string]));
  const allocList = (allocs ?? []) as unknown as { payment_id: string; enrollment_id: string; enrollments: unknown }[];
  const enrollmentIds = [...new Set(allocList.map((a) => a.enrollment_id))];
  const { data: tagged } = enrollmentIds.length ? await db.from("agency_rebates").select("enrollment_id,agency_id").in("enrollment_id", enrollmentIds) : { data: [] };
  const agencyOfEnrollment = new Map((tagged ?? []).map((t) => [t.enrollment_id as string, t.agency_id as string]));
  // Agency or consultancy (202610080021); every agency counts as "Agency" before it.
  let agencies = (await db.from("marketing_agencies").select("id,name,kind")).data as { id: string; name: string; kind?: string | null }[] | null;
  if (!agencies) agencies = (await db.from("marketing_agencies").select("id,name")).data as { id: string; name: string }[] | null;
  const agencyById = new Map((agencies ?? []).map((a) => [a.id, a]));

  const rows: CollectionRow[] = payments.map((p) => {
    const mine = allocList.filter((a) => a.payment_id === p.id);
    const t = one(p.trainees as { legal_first_name?: string; legal_middle_name?: string; legal_last_name?: string; marketing_agency_id?: string | null } | null);
    const agencyId = mine.map((a) => agencyOfEnrollment.get(a.enrollment_id)).find(Boolean) ?? t?.marketing_agency_id ?? null;
    const agency = agencyId ? agencyById.get(agencyId) : undefined;
    const kind: SourceKind = !agency ? "Direct walk-in" : agency.kind === "Consultancy" ? "Consultancy" : "Agency";
    const courses = [...new Set(mine.map((a) => { const c = one(one(a.enrollments as { courses?: unknown } | null)?.courses as { code?: string; name?: string } | null); return c?.name ? `${c.name}${c.code ? ` (${c.code})` : ""}` : ""; }).filter(Boolean))];
    return { receipt: receiptOf.get(p.id) ?? p.payment_number, time: manilaTime(p.received_at), trainee: nameOf(t), course: courses.join(", ") || "—", channel: p.method, reference: p.reference_number ?? "", amountCentavos: Number(p.amount_centavos), kind, agency: agency?.name ?? "" };
  });
  const { data: methods } = await db.from("payment_methods").select("name,active,sort_order").eq("active", true).order("sort_order");
  const receivable = (methods ?? []).map((m) => m.name as string).filter((n) => ["Cash", "GCash", "PSBank", "UnionBank"].includes(n));
  const { channels, matrix, groups } = collectionsBySource(rows, receivable.length ? receivable : ["Cash", "GCash", "PSBank", "UnionBank"]);

  // Expenses released (paid) that day, with voucher numbers.
  const { data: exBase } = await db.from("expenses").select("id,expense_number,payee,category,amount_centavos,status,paid_at")
    .eq("status", "Paid").gte("paid_at", start).lte("paid_at", end).order("paid_at", { ascending: true }).limit(2000);
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
    cashCollectedCentavos: rows.filter((r) => r.channel === "Cash").reduce((s, r) => s + r.amountCentavos, 0),
    cashExpensesCentavos: expenses.filter((e) => e.channel === "Cash").reduce((s, e) => s + e.amountCentavos, 0),
    countedCentavos: counted.length ? counted.reduce((s, c) => s + Number(c.actual_cash_centavos), 0) : null,
  });

  let logoBytes: Uint8Array | undefined;
  try { logoBytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png"))); } catch { logoBytes = undefined; }
  return {
    dateLabel: longDate(date), preparedBy, logoBytes,
    position: { previousLabel: "Previous cash", previousNote, ...position },
    channels, matrix,
    groups: groups.map((g) => ({ kind: g.kind, name: g.name, subtotalCentavos: g.subtotalCentavos, rows: g.rows.map((r) => ({ receipt: r.receipt, time: r.time, trainee: r.trainee, course: r.course, channel: r.channel, reference: r.reference, amountCentavos: r.amountCentavos })) })),
    expenses,
    expenseTotals: [...expenseByChannel].map(([channel, totalCentavos]) => ({ channel, totalCentavos })),
  };
}
