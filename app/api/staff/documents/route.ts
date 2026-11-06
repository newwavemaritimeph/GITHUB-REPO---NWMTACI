import { NextResponse } from "next/server";
import { paymentState } from "@/lib/batch-roster";
import { voidReasons } from "@/lib/payment-void-reasons";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Accounting › Payments › Receipts and TARs (owner, 3 Nov 2026): every Acknowledgement Receipt or Training
 * Admission Record issued in a Manila date range, read from the database (the portal list holds only the newest
 * rows). Plain lookups by id, no nested joins; any failure comes back as a message instead of an empty reply.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
type Person = { id: string; legal_first_name: string; legal_middle_name: string | null; legal_last_name: string; application_number: string | null; trainee_number: string };
const nameOf = (t: Person | undefined) => (t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}${t.legal_middle_name ? ` ${t.legal_middle_name.charAt(0)}.` : ""}` : "—");
const chunks = <T,>(list: T[], n = 200) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export async function GET(request: Request) {
  const staff = await requireStaff(["admin", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "tars" ? "tars" : "receipts";
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) return NextResponse.json({ error: "Choose the dates." }, { status: 400 });
  const start = `${from}T00:00:00+08:00`, end = `${to}T23:59:59.999+08:00`;
  const db = createSupabaseAdminClient();
  try {
    const byIds = async <T,>(table: string, cols: string, column: string, ids: string[]) => {
      const out: T[] = [];
      for (const part of chunks([...new Set(ids)])) { const { data, error } = await db.from(table).select(cols).in(column, part); if (error) throw new Error(`${table}: ${error.message}`); out.push(...((data ?? []) as T[])); }
      return out;
    };
    const ranged = async <T,>(table: string, cols: string) => {
      const out: T[] = [];
      for (let a = 0; a < 10000; a += 1000) {
        const { data, error } = await db.from(table).select(cols).gte("issued_at", start).lte("issued_at", end).order("issued_at", { ascending: false }).range(a, a + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...((data ?? []) as T[])); if ((data ?? []).length < 1000) break;
      }
      return out;
    };
    const people = async (ids: string[]) => new Map((await byIds<Person>("trainees", "id,legal_first_name,legal_middle_name,legal_last_name,application_number,trainee_number", "id", ids)).map((t) => [t.id, t]));
    const courses = async (enrollmentIds: string[]) => {
      const rows = await byIds<{ id: string; course_id: string; selling_price_centavos: number }>("enrollments", "id,course_id,selling_price_centavos", "id", enrollmentIds);
      const codes = new Map((await byIds<{ id: string; code: string }>("courses", "id,code", "id", rows.map((r) => r.course_id))).map((c) => [c.id, c.code]));
      return new Map(rows.map((r) => [r.id, { code: codes.get(r.course_id) ?? "", price: Number(r.selling_price_centavos ?? 0) }]));
    };

    if (kind === "receipts") {
      const rows = await ranged<{ receipt_number: string; issued_at: string; print_count: number | null; payment_id: string }>("receipts", "receipt_number,issued_at,print_count,payment_id");
      const pays = new Map((await byIds<{ id: string; trainee_id: string; amount_centavos: number; method: string; reference_number: string | null; valid: boolean; remarks: string | null; verification_state: string | null }>("payments", "id,trainee_id,amount_centavos,method,reference_number,valid,remarks,verification_state", "id", rows.map((r) => r.payment_id))).map((p) => [p.id, p]));
      const why = await voidReasons(db, [...pays.values()].filter((p) => !p.valid).map((p) => p.id));
      const allocs = await byIds<{ payment_id: string; enrollment_id: string }>("payment_allocations", "payment_id,enrollment_id", "payment_id", rows.map((r) => r.payment_id));
      const [who, codes] = await Promise.all([people([...pays.values()].map((p) => p.trainee_id)), courses(allocs.map((a) => a.enrollment_id))]);
      return NextResponse.json({ rows: rows.map((r) => {
        const p = pays.get(r.payment_id);
        const list = [...new Set(allocs.filter((a) => a.payment_id === r.payment_id).map((a) => codes.get(a.enrollment_id)?.code).filter(Boolean))].join(", ");
        const fee = p?.remarks && /^(Miscellaneous|Service Fee) · /.test(p.remarks) ? p.remarks : null;
        const t = p ? who.get(p.trainee_id) : undefined;
        return { id: r.payment_id, number: r.receipt_number, issuedAt: r.issued_at, trainee: nameOf(t), nwmtaciNo: t?.application_number ?? t?.trainee_number ?? "", label: fee ?? `Training Fee${list ? ` · ${list}` : ""}`, method: p?.method ?? "", reference: p?.reference_number ?? "", amount: Number(p?.amount_centavos ?? 0), valid: p?.valid !== false, voidReason: why.get(r.payment_id) ?? null, verificationState: p?.verification_state ?? null, printCount: Number(r.print_count ?? 0) };
      }) }, { headers: { "Cache-Control": "no-store" } });
    }

    const rows = await ranged<{ id: string; ar_number: string; issued_at: string; print_count: number | null; enrollment_ids: string[] | null; trainee_id: string }>("admission_records", "id,ar_number,issued_at,print_count,enrollment_ids,trainee_id");
    const enrollmentIds = rows.flatMap((r) => r.enrollment_ids ?? []);
    const [who, codes, charges, allocs] = await Promise.all([
      people(rows.map((r) => r.trainee_id)),
      courses(enrollmentIds),
      byIds<{ enrollment_id: string; amount_centavos: number; event_type: string; valid: boolean }>("enrollment_charges", "enrollment_id,amount_centavos,event_type,valid", "enrollment_id", enrollmentIds),
      byIds<{ enrollment_id: string; amount_centavos: number; payment_id: string }>("payment_allocations", "enrollment_id,amount_centavos,payment_id", "enrollment_id", enrollmentIds),
    ]);
    const validPay = new Set((await byIds<{ id: string; valid: boolean }>("payments", "id,valid", "id", allocs.map((a) => a.payment_id))).filter((p) => p.valid).map((p) => p.id));
    // Company Charge (migration 063): tolerated when the column is missing.
    const billed = new Set<string>();
    for (const part of chunks([...new Set(enrollmentIds)])) { const { data, error } = await db.from("enrollments").select("id").in("id", part).not("company_charge_agency_id", "is", null); if (!error) for (const x of (data ?? []) as { id: string }[]) billed.add(x.id); }
    const due = new Map<string, number>(), paid = new Map<string, number>();
    for (const c of charges.filter((x) => x.valid)) due.set(c.enrollment_id, (due.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos));
    for (const a of allocs.filter((x) => validPay.has(x.payment_id))) paid.set(a.enrollment_id, (paid.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
    return NextResponse.json({ rows: rows.map((r) => {
      const ids = r.enrollment_ids ?? [];
      const totalDue = ids.reduce((s, id) => s + (codes.get(id)?.price ?? 0) + (due.get(id) ?? 0), 0), totalPaid = ids.reduce((s, id) => s + (paid.get(id) ?? 0), 0);
      const state = paymentState(totalDue, totalPaid, ids.some((id) => billed.has(id)));
      const t = who.get(r.trainee_id);
      return { id: r.id, number: r.ar_number, issuedAt: r.issued_at, trainee: nameOf(t), nwmtaciNo: t?.application_number ?? t?.trainee_number ?? "", courses: ids.map((id) => codes.get(id)?.code).filter(Boolean).join(", "), payment: state.payment, balanceCentavos: state.balanceCentavos, printCount: Number(r.print_count ?? 0) };
    }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("Receipts and TARs:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: `Could not load the list: ${e instanceof Error ? e.message : "unknown error"}` }, { status: 500 });
  }
}
