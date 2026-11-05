import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { periodStart, periodTitle, type Period } from "@/lib/accounting-periods";
import { instructionCategoryOf, type InstructionCategory } from "@/lib/instruction-templates";

/**
 * Cash and Sales Summary (owner, 21 Oct 2026): cash received, disbursements and
 * sales, split Endorsed Courses (Other STCW courses at partnered centers) vs New
 * Wave Courses (owner, 5 Nov 2026: Total Sales first, then New Wave by category,
 * then Endorsed by center). Cash by date received / released; sales by training date.
 */

export type Side = "E" | "D";
export type Line = { label: string; side: Side; byChannel: Record<string, number>; total: number };
export const CHANNEL_ORDER = ["Cash", "GCash", "PSBank", "UnionBank", "Check"];
export const CENTER_PAYMENT = "Partnered Center Payment";
export const ENDORSEMENT_REBATE = "Endorsement Rebate";

export type PaymentIn = { amount: number; channel: string; allocations: { amount: number; endorsement: boolean }[] };
export type IncomeIn = { amount: number; channel: string; source: string };
export type ExpenseIn = { amount: number; channel: string | null; category: string };
export type SaleIn = { endorsement: boolean; code: string; name: string; center: string; price: number; payable: number; rebate: number; share: number; charges: number; discounts: number; collected: number; rebateReceived: number; category?: InstructionCategory };
export type SalesLine = { trainees: number; fees: number; charges: number; discounts: number; sales: number; collected: number; balance: number };

/** Course fees plus charges less discounts, with what was collected (never more than the sale) and what is still owed. */
export function salesLine(rows: SaleIn[]): SalesLine {
  const t: SalesLine = { trainees: rows.length, fees: 0, charges: 0, discounts: 0, sales: 0, collected: 0, balance: 0 };
  for (const s of rows) { const sale = s.price + s.charges - s.discounts, got = Math.min(s.collected, sale); t.fees += s.price; t.charges += s.charges; t.discounts += s.discounts; t.sales += sale; t.collected += got; t.balance += sale - got; }
  return t;
}

const channelOf = (c: string | null | undefined) => { const v = (c ?? "").trim(); return /^cheque$/i.test(v) ? "Check" : v || "Not Set"; };

function lines(entries: { label: string; side: Side; channel: string; amount: number }[], firstLabels: string[]) {
  const map = new Map<string, Line>();
  for (const e of entries) {
    if (!e.amount) continue;
    const key = `${e.side}|${e.label}`;
    const line = map.get(key) ?? { label: e.label, side: e.side, byChannel: {}, total: 0 };
    const ch = channelOf(e.channel);
    line.byChannel[ch] = (line.byChannel[ch] ?? 0) + e.amount;
    line.total += e.amount;
    map.set(key, line);
  }
  const rank = (l: Line) => (firstLabels.includes(l.label) ? firstLabels.indexOf(l.label) : 99);
  return [...map.values()].sort((a, z) => a.side.localeCompare(z.side) * -1 || rank(a) - rank(z) || z.total - a.total);
}
export const sideTotal = (ls: Line[], side?: Side) => ls.filter((l) => !side || l.side === side).reduce((s, l) => s + l.total, 0);
export const channelTotal = (ls: Line[], side: Side, ch: string) => ls.filter((l) => l.side === side).reduce((s, l) => s + (l.byChannel[ch] ?? 0), 0);
export const channelsUsed = (...groups: Line[][]) => { const seen = new Set(groups.flat().flatMap((l) => Object.keys(l.byChannel))); return [...CHANNEL_ORDER.filter((c) => seen.has(c)), ...[...seen].filter((c) => !CHANNEL_ORDER.includes(c)).sort()]; };

/** Pure totals for the report; the server feeds it rows for one period. */
export function summarize(input: { payments: PaymentIn[]; income: IncomeIn[]; expenses: ExpenseIn[]; sales: SaleIn[] }) {
  const recv: { label: string; side: Side; channel: string; amount: number }[] = [];
  for (const p of input.payments) {
    const endorsement = p.allocations.filter((a) => a.endorsement).reduce((s, a) => s + a.amount, 0);
    recv.push({ label: "Training Fees", side: "E", channel: p.channel, amount: Math.min(endorsement, p.amount) });
    recv.push({ label: "Training Fees and Charges", side: "D", channel: p.channel, amount: Math.max(0, p.amount - endorsement) });
  }
  for (const i of input.income) recv.push(i.source === ENDORSEMENT_REBATE ? { label: "Endorsement Rebates", side: "E", channel: i.channel, amount: i.amount } : { label: i.source, side: "D", channel: i.channel, amount: i.amount });
  const received = lines(recv, ["Training Fees", "Endorsement Rebates", "Training Fees and Charges"]);
  const disbursed = lines(input.expenses.map((e) => e.category === CENTER_PAYMENT ? { label: "Payments to Partnered Centers", side: "E" as Side, channel: e.channel ?? "", amount: e.amount } : { label: e.category || "Uncategorized", side: "D" as Side, channel: e.channel ?? "", amount: e.amount }), ["Payments to Partnered Centers"]);

  const direct = input.sales.filter((s) => !s.endorsement);
  const categories = (["STCW", "In-House"] as const).map((key) => {
    const mine = direct.filter((s) => (s.category ?? "In-House") === key);
    const courses = [...new Set(mine.map((s) => s.code))].map((code) => { const rows = mine.filter((s) => s.code === code); return { code, name: rows[0].name, ...salesLine(rows) }; }).sort((a, z) => z.sales - a.sales || a.code.localeCompare(z.code));
    return { name: `${key} Courses`, courses, ...salesLine(mine) };
  });
  const directTotals = salesLine(direct), directExpenses = sideTotal(disbursed, "D");

  const endorsed = input.sales.filter((s) => s.endorsement);
  const add = (rows: SaleIn[], pick: (s: SaleIn) => number) => rows.reduce((t, s) => t + pick(s), 0);
  const centers = [...new Set(endorsed.map((s) => s.center))].map((name) => {
    const rows = endorsed.filter((s) => s.center === name), rebate = add(rows, (s) => s.rebate), share = add(rows, (s) => s.share), received = add(rows, (s) => s.rebateReceived);
    return { name, ...salesLine(rows), payable: add(rows, (s) => s.payable), rebate, received, due: rebate - received, share, keeps: rebate - share };
  }).sort((a, z) => z.fees - a.fees || a.name.localeCompare(z.name));
  const rebate = add(endorsed, (s) => s.rebate), share = add(endorsed, (s) => s.share), rebateIn = add(endorsed, (s) => s.rebateReceived);

  return {
    received, disbursed,
    totalSales: salesLine(input.sales),
    direct: { categories, ...directTotals, expenses: directExpenses, margin: directTotals.sales - directExpenses },
    endorsement: { centers, ...salesLine(endorsed), payable: add(endorsed, (s) => s.payable), rebate, received: rebateIn, share, keeps: rebate - share, rebateDue: rebate - rebateIn },
  };
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const startOf = (d: string) => `${d}T00:00:00+08:00`, endOf = (d: string) => `${d}T23:59:59.999+08:00`;
export async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, cap = 20000) {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error || !data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return rows;
}
export const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export type FinanceSummary = Awaited<ReturnType<typeof buildFinanceSummary>>;

/** Reads one period with the service role (pages of 1,000 rows) and summarizes it. */
export async function buildFinanceSummary(db: Admin, period: Period, end: string) {
  const from = periodStart(period, end), to = end;

  type Pay = { amount_centavos: number; method: string; payment_allocations: { amount_centavos: number; enrollments: { partner_offer_id: string | null } | { partner_offer_id: string | null }[] | null }[] | null };
  const pays = await all<Pay>((a, b) => db.from("payments").select("amount_centavos,method,payment_allocations(amount_centavos,enrollments(partner_offer_id))").eq("valid", true).gte("received_at", startOf(from)).lte("received_at", endOf(to)).order("received_at").range(a, b));
  type Inc = { amount_centavos: number; channel: string; source: string };
  const income = await all<Inc>((a, b) => db.from("other_income").select("amount_centavos,channel,source").is("voided_at", null).gte("received_on", from).lte("received_on", to).order("received_on").range(a, b));
  type Exp = { amount_centavos: number; category: string; payment_channel: string | null };
  const expenses = await all<Exp>((a, b) => db.from("expenses").select("amount_centavos,category,payment_channel").eq("status", "Paid").gte("paid_at", startOf(from)).lte("paid_at", endOf(to)).order("paid_at").range(a, b));

  // Sales by training date: batch start, else the scheduled date (partnered centers).
  const batches = await all<{ id: string }>((a, b) => db.from("batches").select("id").gte("starts_on", from).lte("starts_on", to).range(a, b));
  type Enr = { id: string; partner_offer_id: string | null; selling_price_centavos: number; partner_payable_centavos: number | null; rebate_centavos: number | null; agency_share_centavos?: number | null; enrollment_status: string; courses: { code: string; name: string; course_categories?: { name: string } | { name: string }[] | null } | { code: string; name: string; course_categories?: { name: string } | { name: string }[] | null }[] | null; partner_course_offers: { partner_centers: { name: string } | { name: string }[] | null } | { partner_centers: { name: string } | { name: string }[] | null }[] | null };
  const cols = "id,partner_offer_id,selling_price_centavos,partner_payable_centavos,rebate_centavos,agency_share_centavos,enrollment_status,courses(code,name,course_categories(name)),partner_course_offers(partner_centers(name))";
  const enrolled: Enr[] = [];
  const pick = async (q: (c: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) => {
    let r = await q(cols);
    if (r.error && /agency_share/.test(r.error.message)) r = await q(cols.replace("agency_share_centavos,", ""));
    // A failed read must show as an error: a short report that looks complete would mislead Accounting.
    if (r.error) throw new Error(r.error.message);
    enrolled.push(...((r.data ?? []) as Enr[]));
  };
  for (const ids of chunks(batches.map((b) => b.id))) await pick((c) => db.from("enrollments").select(c).in("batch_id", ids).neq("enrollment_status", "Cancelled"));
  await pick((c) => db.from("enrollments").select(c).is("batch_id", null).gte("scheduled_on", from).lte("scheduled_on", to).neq("enrollment_status", "Cancelled").limit(5000));

  const ids = enrolled.map((e) => e.id);
  const charges = new Map<string, { charge: number; discount: number }>(), collected = new Map<string, number>(), rebateIn = new Map<string, number>();
  for (const part of chunks(ids)) {
    const [ch, al, rb] = await Promise.all([
      db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", part).eq("valid", true),
      db.from("payment_allocations").select("enrollment_id,amount_centavos,payments!inner(valid)").in("enrollment_id", part).eq("payments.valid", true),
      db.from("other_income_rebates").select("enrollment_id,amount_centavos,other_income!inner(voided_at)").in("enrollment_id", part).is("other_income.voided_at", null),
    ]);
    for (const c of (ch.data ?? []) as { enrollment_id: string; amount_centavos: number; event_type: string }[]) { const t = charges.get(c.enrollment_id) ?? { charge: 0, discount: 0 }; if (c.event_type === "discount") t.discount += Number(c.amount_centavos); else t.charge += Number(c.amount_centavos); charges.set(c.enrollment_id, t); }
    for (const a of (al.data ?? []) as { enrollment_id: string; amount_centavos: number }[]) collected.set(a.enrollment_id, (collected.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
    for (const r of (rb.data ?? []) as { enrollment_id: string; amount_centavos: number }[]) rebateIn.set(r.enrollment_id, (rebateIn.get(r.enrollment_id) ?? 0) + Number(r.amount_centavos));
  }

  const result = summarize({
    payments: pays.map((p) => ({ amount: Number(p.amount_centavos), channel: p.method, allocations: (p.payment_allocations ?? []).map((a) => ({ amount: Number(a.amount_centavos), endorsement: !!one(a.enrollments)?.partner_offer_id })) })),
    income: income.map((i) => ({ amount: Number(i.amount_centavos), channel: i.channel, source: i.source })),
    expenses: expenses.map((e) => ({ amount: Number(e.amount_centavos), channel: e.payment_channel, category: e.category })),
    sales: enrolled.map((e) => { const c = one(e.courses), t = charges.get(e.id); return { endorsement: !!e.partner_offer_id, category: instructionCategoryOf(c?.code, one(c?.course_categories)?.name), code: c?.code ?? "—", name: c?.name ?? "", center: one(one(e.partner_course_offers)?.partner_centers)?.name ?? "Partnered center", price: Number(e.selling_price_centavos ?? 0), payable: Number(e.partner_payable_centavos ?? 0), rebate: Number(e.rebate_centavos ?? 0), share: Number(e.agency_share_centavos ?? 0), charges: t?.charge ?? 0, discounts: t?.discount ?? 0, collected: collected.get(e.id) ?? 0, rebateReceived: rebateIn.get(e.id) ?? 0 }; }),
  });
  return { period, end, from, to, title: periodTitle(period, end), ...result };
}
