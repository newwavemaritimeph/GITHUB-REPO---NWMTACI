import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PERIODS, periodStart, periodTitle, type Period } from "@/lib/accounting-periods";
import { all, chunks, one } from "@/lib/finance-summary";

/**
 * The Endorsed Courses report (owner, 5 Nov 2026, Design 2 · Center Statements): one ledger per partnered
 * center, by training date. Uses the same rule as the Cash and Sales Summary (endorsed = has a partner
 * offer; training date = batch start, else the scheduled date; only Cancelled left out), so the totals agree.
 */

export type CenterState = "Paid" | "Approved" | "For Approval" | "Owed";
export type RebateState = "Received" | "Due" | "None";
export type EndorsedRow = {
  id: string; trainee: string; traineeNo: string; enrollmentNo: string; status: string; center: string; code: string; course: string; trainingDate: string;
  fee: number; collected: number; balance: number; payable: number; centerPaid: number; centerState: CenterState; rebate: number; rebateReceived: number; rebateState: RebateState; share: number; keeps: number;
};
export type EndorsedTotals = { trainees: number; fees: number; collected: number; balance: number; payable: number; centerPaid: number; centerOwed: number; rebate: number; rebateReceived: number; rebateDue: number; share: number; keeps: number };

/** A rejected or missing center payment leaves the trainee owed, as in Pay the Centers. */
export const centerStateOf = (expenseStatus: string | null | undefined): CenterState => (expenseStatus === "Paid" ? "Paid" : expenseStatus === "Approved" ? "Approved" : expenseStatus === "Pending" ? "For Approval" : "Owed");
export const rebateStateOf = (rebate: number, received: number): RebateState => (rebate <= 0 ? "None" : received >= rebate ? "Received" : "Due");

export function endorsedTotals(rows: EndorsedRow[]): EndorsedTotals {
  const t: EndorsedTotals = { trainees: rows.length, fees: 0, collected: 0, balance: 0, payable: 0, centerPaid: 0, centerOwed: 0, rebate: 0, rebateReceived: 0, rebateDue: 0, share: 0, keeps: 0 };
  for (const r of rows) {
    t.fees += r.fee; t.collected += r.collected; t.balance += r.balance; t.payable += r.payable; t.centerPaid += r.centerPaid; t.centerOwed += Math.max(0, r.payable - r.centerPaid);
    t.rebate += r.rebate; t.rebateReceived += r.rebateReceived; t.rebateDue += Math.max(0, r.rebate - r.rebateReceived); t.share += r.share; t.keeps += r.keeps;
  }
  return t;
}

/** Rows newest training first, grouped per center (largest sales first), with totals. */
export function endorsedSales(rows: EndorsedRow[]) {
  const sorted = [...rows].sort((a, z) => z.trainingDate.localeCompare(a.trainingDate) || a.trainee.localeCompare(z.trainee));
  const names = [...new Set(sorted.map((r) => r.center))];
  const centers = names.map((name) => { const mine = sorted.filter((r) => r.center === name); return { name, rows: mine, totals: endorsedTotals(mine) }; }).sort((a, z) => z.totals.fees - a.totals.fees || a.name.localeCompare(z.name));
  return { rows: sorted, centers, totals: endorsedTotals(sorted) };
}

/** ?from&to for a custom range, or ?period&end. Null when neither is valid. */
export function endorsedRange(params: URLSearchParams) {
  const iso = /^\d{4}-\d{2}-\d{2}$/, from = params.get("from"), to = params.get("to");
  if (from || to) return from && to && iso.test(from) && iso.test(to) && from <= to ? { from, to, title: "Custom Range" } : null;
  const period = params.get("period") as Period | null, end = params.get("end") ?? "";
  if (!period || !(PERIODS as readonly string[]).includes(period) || !iso.test(end)) return null;
  return { from: periodStart(period, end), to: end, title: periodTitle(period, end) };
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Maybe<T> = T | T[] | null;
type Enr = {
  id: string; enrollment_number: string; enrollment_status: string; selling_price_centavos: number | null; partner_payable_centavos: number | null; rebate_centavos: number | null; agency_share_centavos: number | null; scheduled_on: string | null;
  batches: Maybe<{ starts_on: string | null }>; courses: Maybe<{ code: string; name: string }>; trainees: Maybe<{ legal_first_name: string; legal_middle_name: string | null; legal_last_name: string; trainee_number: string | null; application_number: string | null }>;
  partner_course_offers: Maybe<{ partner_centers: Maybe<{ name: string }> }>;
};
const COLUMNS = "id,enrollment_number,enrollment_status,selling_price_centavos,partner_payable_centavos,rebate_centavos,agency_share_centavos,scheduled_on,batches(starts_on),courses(code,name),trainees(legal_first_name,legal_middle_name,legal_last_name,trainee_number,application_number),partner_course_offers(partner_centers(name))";
// A failed read must show as an error: a short report that looks complete would mislead Accounting.
const checked = <R extends { error: { message: string } | null }>(r: R) => { if (r.error) throw new Error(r.error.message); return r; };

export type EndorsedSales = Awaited<ReturnType<typeof buildEndorsedSales>>;

/** Reads every endorsed enrollment with its training date in the range, with what was collected, paid to the center and received back. */
export async function buildEndorsedSales(db: Admin, range: { from: string; to: string; title: string }) {
  const { from, to, title } = range;
  const batches = await all<{ id: string }>(async (a, b) => checked(await db.from("batches").select("id").gte("starts_on", from).lte("starts_on", to).order("id").range(a, b)));
  const enrollments: Enr[] = [];
  for (const ids of chunks(batches.map((b) => b.id))) enrollments.push(...await all<Enr>(async (a, b) => checked(await db.from("enrollments").select(COLUMNS).in("batch_id", ids).not("partner_offer_id", "is", null).neq("enrollment_status", "Cancelled").order("id").range(a, b))));
  enrollments.push(...await all<Enr>(async (a, b) => checked(await db.from("enrollments").select(COLUMNS).is("batch_id", null).not("partner_offer_id", "is", null).gte("scheduled_on", from).lte("scheduled_on", to).neq("enrollment_status", "Cancelled").order("id").range(a, b))));

  const charges = new Map<string, number>(), collected = new Map<string, number>(), received = new Map<string, number>(), centerPay = new Map<string, { amount: number; status: string | null }>();
  for (const part of chunks(enrollments.map((e) => e.id))) {
    const [ch, al, rb, cp] = await Promise.all([
      db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", part).eq("valid", true),
      db.from("payment_allocations").select("enrollment_id,amount_centavos,payments!inner(valid)").in("enrollment_id", part).eq("payments.valid", true),
      db.from("other_income_rebates").select("enrollment_id,amount_centavos,other_income!inner(voided_at)").in("enrollment_id", part).is("other_income.voided_at", null),
      db.from("center_payment_items").select("enrollment_id,amount_centavos,expenses(status)").in("enrollment_id", part),
    ]);
    for (const c of (checked(ch).data ?? []) as { enrollment_id: string; amount_centavos: number; event_type: string }[]) charges.set(c.enrollment_id, (charges.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos));
    for (const a of (checked(al).data ?? []) as { enrollment_id: string; amount_centavos: number }[]) collected.set(a.enrollment_id, (collected.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
    for (const r of (checked(rb).data ?? []) as { enrollment_id: string; amount_centavos: number }[]) received.set(r.enrollment_id, (received.get(r.enrollment_id) ?? 0) + Number(r.amount_centavos));
    for (const p of (checked(cp).data ?? []) as unknown as { enrollment_id: string; amount_centavos: number; expenses: Maybe<{ status: string }> }[]) centerPay.set(p.enrollment_id, { amount: Number(p.amount_centavos), status: one(p.expenses)?.status ?? null });
  }

  const rows = enrollments.map((e): EndorsedRow => {
    const t = one(e.trainees), c = one(e.courses), fee = Number(e.selling_price_centavos ?? 0), got = collected.get(e.id) ?? 0, rebate = Number(e.rebate_centavos ?? 0), share = Number(e.agency_share_centavos ?? 0), back = received.get(e.id) ?? 0;
    const pay = centerPay.get(e.id), centerState = centerStateOf(pay?.status);
    return {
      id: e.id, trainee: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}${t.legal_middle_name ? ` ${t.legal_middle_name.charAt(0).toUpperCase()}.` : ""}` : e.enrollment_number, traineeNo: t?.application_number ?? t?.trainee_number ?? "", enrollmentNo: e.enrollment_number, status: e.enrollment_status,
      center: one(one(e.partner_course_offers)?.partner_centers ?? null)?.name ?? "Partnered center", code: c?.code ?? "—", course: c?.name ?? "", trainingDate: one(e.batches)?.starts_on ?? e.scheduled_on ?? "",
      fee, collected: got, balance: Math.max(0, fee + (charges.get(e.id) ?? 0) - got), payable: Number(e.partner_payable_centavos ?? 0), centerPaid: centerState === "Paid" ? pay?.amount ?? 0 : 0, centerState,
      rebate, rebateReceived: back, rebateState: rebateStateOf(rebate, back), share, keeps: rebate - share,
    };
  });
  return { from, to, title, ...endorsedSales(rows) };
}
