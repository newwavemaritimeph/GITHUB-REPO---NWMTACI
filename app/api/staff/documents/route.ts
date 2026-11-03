import { NextResponse } from "next/server";
import { paymentState } from "@/lib/batch-roster";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Accounting › Receipts and TARs (owner, 3 Nov 2026): every Acknowledgement Receipt or Training Admission
 * Record issued in a Manila date range, read from the database (the portal list holds only the newest rows).
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
type Person = { legal_first_name: string; legal_middle_name: string | null; legal_last_name: string; application_number: string | null; trainee_number: string };
const nameOf = (t: Person | null) => (t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}${t.legal_middle_name ? ` ${t.legal_middle_name.charAt(0)}.` : ""}` : "—");

export async function GET(request: Request) {
  const staff = await requireStaff(["admin", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "tars" ? "tars" : "receipts";
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) return NextResponse.json({ error: "Choose the dates." }, { status: 400 });
  const start = `${from}T00:00:00+08:00`, end = `${to}T23:59:59.999+08:00`;
  const db = createSupabaseAdminClient();
  const people = "trainees(legal_first_name,legal_middle_name,legal_last_name,application_number,trainee_number)";
  // Pages of 1000 until the range is read (capped at 10,000 rows).
  async function all<T>(query: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
    const rows: T[] = [];
    for (let a = 0; a < 10000; a += 1000) { const { data, error } = await query(a, a + 999); if (error) throw new Error(error.message); rows.push(...((data ?? []) as T[])); if ((data ?? []).length < 1000) break; }
    return rows;
  }
  const codesFor = async (enrollmentIds: string[]) => {
    const map = new Map<string, { code: string; price: number }>();
    for (let i = 0; i < enrollmentIds.length; i += 200) {
      const { data } = await db.from("enrollments").select("id,selling_price_centavos,courses(code)").in("id", enrollmentIds.slice(i, i + 200));
      for (const e of data ?? []) map.set(e.id as string, { code: one(e.courses as { code: string } | { code: string }[] | null)?.code ?? "", price: Number(e.selling_price_centavos ?? 0) });
    }
    return map;
  };

  if (kind === "receipts") {
    type R = { receipt_number: string; issued_at: string; print_count: number | null; payment_id: string; payments: unknown };
    type P = { id: string; amount_centavos: number; method: string; reference_number: string | null; valid: boolean; remarks: string | null; trainees: unknown };
    const rows = await all<R>((a, b) => db.from("receipts").select(`receipt_number,issued_at,print_count,payment_id,payments!inner(id,amount_centavos,method,reference_number,valid,remarks,${people})`).gte("issued_at", start).lte("issued_at", end).order("issued_at", { ascending: false }).range(a, b));
    const ids = rows.map((r) => r.payment_id);
    const allocs: { payment_id: string; enrollment_id: string }[] = [];
    for (let i = 0; i < ids.length; i += 200) { const { data } = await db.from("payment_allocations").select("payment_id,enrollment_id").in("payment_id", ids.slice(i, i + 200)); allocs.push(...((data ?? []) as typeof allocs)); }
    const codes = await codesFor([...new Set(allocs.map((a) => a.enrollment_id))]);
    return NextResponse.json({ rows: rows.map((r) => {
      const p = one(r.payments as P | P[] | null);
      const courses = [...new Set(allocs.filter((a) => a.payment_id === r.payment_id).map((a) => codes.get(a.enrollment_id)?.code).filter(Boolean))].join(", ");
      const fee = p?.remarks && /^(Miscellaneous|Service Fee) · /.test(p.remarks) ? p.remarks : null;
      const t = one(p?.trainees as Person | Person[] | null);
      return { id: r.payment_id, number: r.receipt_number, issuedAt: r.issued_at, trainee: nameOf(t), nwmtaciNo: t?.application_number ?? t?.trainee_number ?? "", label: fee ?? `Training Fee${courses ? ` · ${courses}` : ""}`, method: p?.method ?? "", reference: p?.reference_number ?? "", amount: Number(p?.amount_centavos ?? 0), valid: p?.valid !== false, printCount: Number(r.print_count ?? 0) };
    }) }, { headers: { "Cache-Control": "no-store" } });
  }

  type A = { id: string; ar_number: string; issued_at: string; print_count: number | null; enrollment_ids: string[]; trainees: unknown };
  const rows = await all<A>((a, b) => db.from("admission_records").select(`id,ar_number,issued_at,print_count,enrollment_ids,${people}`).gte("issued_at", start).lte("issued_at", end).order("issued_at", { ascending: false }).range(a, b));
  const enrollmentIds = [...new Set(rows.flatMap((r) => r.enrollment_ids ?? []))];
  const codes = await codesFor(enrollmentIds);
  const due = new Map<string, number>(), paid = new Map<string, number>(), billed = new Set<string>();
  for (let i = 0; i < enrollmentIds.length; i += 200) {
    const part = enrollmentIds.slice(i, i + 200);
    const [{ data: charges }, { data: allocs }, cc] = await Promise.all([
      db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", part).eq("valid", true),
      db.from("payment_allocations").select("enrollment_id,amount_centavos,payments!inner(valid)").in("enrollment_id", part).eq("payments.valid", true),
      db.from("enrollments").select("id").in("id", part).not("company_charge_agency_id", "is", null),
    ]);
    for (const c of (charges ?? []) as { enrollment_id: string; amount_centavos: number; event_type: string }[]) due.set(c.enrollment_id, (due.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos));
    for (const a of (allocs ?? []) as { enrollment_id: string; amount_centavos: number }[]) paid.set(a.enrollment_id, (paid.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
    if (!cc.error) for (const x of (cc.data ?? []) as { id: string }[]) billed.add(x.id);
  }
  return NextResponse.json({ rows: rows.map((r) => {
    const ids = r.enrollment_ids ?? [];
    const totalDue = ids.reduce((s, id) => s + (codes.get(id)?.price ?? 0) + (due.get(id) ?? 0), 0), totalPaid = ids.reduce((s, id) => s + (paid.get(id) ?? 0), 0);
    const state = paymentState(totalDue, totalPaid, ids.some((id) => billed.has(id)));
    const t = one(r.trainees as Person | Person[] | null);
    return { id: r.id, number: r.ar_number, issuedAt: r.issued_at, trainee: nameOf(t), nwmtaciNo: t?.application_number ?? t?.trainee_number ?? "", courses: ids.map((id) => codes.get(id)?.code).filter(Boolean).join(", "), payment: state.payment, balanceCentavos: state.balanceCentavos, printCount: Number(r.print_count ?? 0) };
  }) }, { headers: { "Cache-Control": "no-store" } });
}
