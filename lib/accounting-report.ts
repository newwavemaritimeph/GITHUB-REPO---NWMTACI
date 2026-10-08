import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PREVIOUS_LABEL, periodBuckets, periodTitle, type Period } from "@/lib/accounting-periods";

/**
 * The Accounting Manager's period report (owner, 8 Oct 2026): collections and
 * expenses per bucket for the trend, and for the current period the split by
 * channel, by source (walk-in, agency, consultancy), expenses by category,
 * top courses, rebates and cashier closings. Read with the service role.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));
const startOf = (d: string) => `${d}T00:00:00+08:00`, endOf = (d: string) => `${d}T23:59:59.999+08:00`;

/** Supabase returns at most 1,000 rows per request; read in pages. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, cap = 20000) {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error || !data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return rows;
}

export type AccountingReport = Awaited<ReturnType<typeof buildAccountingReport>>;

export async function buildAccountingReport(db: Admin, period: Period, end: string) {
  const buckets = periodBuckets(period, end);
  const first = buckets[0].from, current = buckets[buckets.length - 1];

  type Pay = { id: string; amount_centavos: number; method: string; received_at: string; trainees: { marketing_agency_id?: string | null } | { marketing_agency_id?: string | null }[] | null };
  const payments = await all<Pay>((a, b) => db.from("payments").select("id,amount_centavos,method,received_at,trainees(marketing_agency_id)").eq("valid", true).gte("received_at", startOf(first)).lte("received_at", endOf(end)).order("received_at").range(a, b));
  type Exp = { id: string; amount_centavos: number; category: string; paid_at: string };
  const expenses = await all<Exp>((a, b) => db.from("expenses").select("id,amount_centavos,category,paid_at").eq("status", "Paid").gte("paid_at", startOf(first)).lte("paid_at", endOf(end)).order("paid_at").range(a, b));

  const series = buckets.map((bk) => ({
    ...bk,
    collections: payments.filter((p) => { const d = manilaDay(p.received_at); return d >= bk.from && d <= bk.to; }).reduce((s, p) => s + Number(p.amount_centavos), 0),
    expenses: expenses.filter((e) => { const d = manilaDay(e.paid_at); return d >= bk.from && d <= bk.to; }).reduce((s, e) => s + Number(e.amount_centavos), 0),
  }));

  const inCurrent = payments.filter((p) => { const d = manilaDay(p.received_at); return d >= current.from && d <= current.to; });
  const expCurrent = expenses.filter((e) => { const d = manilaDay(e.paid_at); return d >= current.from && d <= current.to; });

  // Channel split.
  const byChannel: Record<string, number> = {};
  for (const p of inCurrent) byChannel[p.method] = (byChannel[p.method] ?? 0) + Number(p.amount_centavos);

  // Source and course split: agency tagged on an allocated enrollment, else the trainee's agency, else walk-in.
  const ids = inCurrent.map((p) => p.id);
  type Alloc = { payment_id: string; enrollment_id: string; amount_centavos: number; enrollments: unknown };
  const allocs: Alloc[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("payment_allocations").select("payment_id,enrollment_id,amount_centavos,enrollments(referral_agency_id,courses(code,name))").in("payment_id", ids.slice(i, i + 200));
    if (data) allocs.push(...(data as unknown as Alloc[]));
    else { const { data: plain } = await db.from("payment_allocations").select("payment_id,enrollment_id,amount_centavos,enrollments(courses(code,name))").in("payment_id", ids.slice(i, i + 200)); allocs.push(...((plain ?? []) as unknown as Alloc[])); }
  }
  const enrollmentIds = [...new Set(allocs.map((a) => a.enrollment_id))];
  const tagged = new Map<string, string>();
  for (let i = 0; i < enrollmentIds.length; i += 200) {
    const { data } = await db.from("agency_rebates").select("enrollment_id,agency_id").in("enrollment_id", enrollmentIds.slice(i, i + 200));
    for (const t of data ?? []) tagged.set(t.enrollment_id as string, t.agency_id as string);
  }
  let agencies = (await db.from("marketing_agencies").select("id,name,kind")).data as { id: string; name: string; kind?: string | null }[] | null;
  if (!agencies) agencies = (await db.from("marketing_agencies").select("id,name")).data as { id: string; name: string }[] | null;
  const kindOf = new Map((agencies ?? []).map((a) => [a.id, a.kind === "Consultancy" ? "Consultancies" : "Agencies"]));
  const bySource: Record<string, number> = { "Walk-ins": 0, Agencies: 0, Consultancies: 0 };
  const byCourse: Record<string, number> = {};
  for (const p of inCurrent) {
    const mine = allocs.filter((a) => a.payment_id === p.id);
    const agencyId = mine.map((a) => (one(a.enrollments as { referral_agency_id?: string | null } | null)?.referral_agency_id) ?? tagged.get(a.enrollment_id)).find(Boolean) ?? one(p.trainees)?.marketing_agency_id ?? null;
    const source = agencyId ? kindOf.get(agencyId) ?? "Agencies" : "Walk-ins";
    bySource[source] += Number(p.amount_centavos);
    for (const a of mine) {
      const c = one(one(a.enrollments as { courses?: unknown } | null)?.courses as { code?: string; name?: string } | null);
      const key = c?.name ? `${c.name}${c.code ? ` (${c.code})` : ""}` : "Other";
      byCourse[key] = (byCourse[key] ?? 0) + Number(a.amount_centavos);
    }
  }

  const byCategory: Record<string, number> = {};
  for (const e of expCurrent) byCategory[e.category] = (byCategory[e.category] ?? 0) + Number(e.amount_centavos);

  // Rebates: deducted in the period; owed to agencies now (all pending).
  const { data: rebatesRows } = await db.from("agency_rebates").select("rebate_centavos,status,created_at,agency_id").gte("created_at", startOf(current.from)).lte("created_at", endOf(current.to));
  const { data: owedRows } = await db.from("agency_rebates").select("rebate_centavos,agency_id").eq("status", "Pending");
  const owedByAgency: Record<string, { count: number; total: number }> = {};
  for (const r of owedRows ?? []) { const name = (agencies ?? []).find((a) => a.id === r.agency_id)?.name ?? "Agency"; const o = owedByAgency[name] ?? { count: 0, total: 0 }; o.count += 1; o.total += Number(r.rebate_centavos); owedByAgency[name] = o; }

  // Cashier closings in the period.
  const { data: closings } = await db.from("cashier_closings").select("status,variance_centavos").gte("closing_date", current.from).lte("closing_date", current.to);

  const prev = series[series.length - 2];
  return {
    period, end, title: periodTitle(period, end), previousLabel: PREVIOUS_LABEL[period],
    series: series.map(({ label, from, to, collections, expenses: ex }) => ({ label, from, to, collections, expenses: ex })),
    current: {
      collections: series[series.length - 1].collections,
      expenses: series[series.length - 1].expenses,
      receipts: inCurrent.length,
      byChannel,
      bySource,
      byCategory: Object.entries(byCategory).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
      topCourses: Object.entries(byCourse).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5),
      rebatesDeducted: (rebatesRows ?? []).filter((r) => r.status === "Paid").reduce((s, r) => s + Number(r.rebate_centavos), 0),
      rebatesOwed: Object.values(owedByAgency).reduce((s, o) => s + o.total, 0),
      owedByAgency: Object.entries(owedByAgency).map(([name, o]) => ({ name, ...o })).sort((a, b) => b.total - a.total),
      closings: { count: (closings ?? []).length, reviewed: (closings ?? []).filter((c) => c.status === "Reviewed").length, overShort: (closings ?? []).reduce((s, c) => s + Number(c.variance_centavos ?? 0), 0) },
    },
    previous: { collections: prev?.collections ?? 0, expenses: prev?.expenses ?? 0 },
  };
}
