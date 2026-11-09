import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Accounting › Approvals history (owner, 3 Nov 2026): every decision in a Manila date range, by category.
 * Each category is read on its own; one that fails (or a column not yet added) comes back empty with a note.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
type Row = { id: string; category: string; decidedAt: string; title: string; detail: string; amountCentavos: number; decision: string; by: string; remarks: string };
type Trainee = { id: string; legal_first_name: string; legal_last_name: string };
const chunks = <T,>(list: T[], n = 200) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export async function GET(request: Request) {
  const staff = await requireStaff(["admin", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) return NextResponse.json({ error: "Choose the dates." }, { status: 400 });
  const start = `${from}T00:00:00+08:00`, end = `${to}T23:59:59.999+08:00`;
  const db = createSupabaseAdminClient();
  const notes: string[] = [];
  const byIds = async <T,>(table: string, cols: string, ids: string[], column = "id") => {
    const out: T[] = [];
    for (const part of chunks([...new Set(ids.filter(Boolean))])) { const { data, error } = await db.from(table).select(cols).in(column, part); if (error) throw new Error(`${table}: ${error.message}`); out.push(...((data ?? []) as T[])); }
    return out;
  };
  const inRange = async <T,>(table: string, cols: string, column: string, eq?: [string, string]) => {
    const base = db.from(table).select(cols).gte(column, start).lte(column, end);
    const { data, error } = await (eq ? base.eq(eq[0], eq[1]) : base).order(column, { ascending: false }).limit(2000);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as T[];
  };
  const rows: Row[] = [];
  const people = new Set<string>();
  const safely = async (label: string, run: () => Promise<void>) => { try { await run(); } catch (e) { notes.push(`${label}: ${e instanceof Error ? e.message : "not available"}`); } };

  await Promise.all([
    safely("Expense Requests", async () => {
      const list = await inRange<{ id: string; request_number: string | null; voucher_number: string | null; expense_number: string; payee: string; category: string; amount_centavos: number; status: string; approved_by: string | null; approved_at: string; decision_remarks: string | null }>("expenses", "id,request_number,voucher_number,expense_number,payee,category,amount_centavos,status,approved_by,approved_at,decision_remarks", "approved_at");
      for (const e of list) { if (e.approved_by) people.add(e.approved_by); rows.push({ id: `e:${e.id}`, category: "Expense Requests", decidedAt: e.approved_at, title: `${e.request_number ?? e.expense_number}${e.voucher_number && e.voucher_number !== e.request_number ? ` → ${e.voucher_number}` : ""} · ${e.payee}`, detail: e.category, amountCentavos: Number(e.amount_centavos), decision: e.status === "Rejected" ? "Rejected" : "Approved", by: e.approved_by ?? "", remarks: e.decision_remarks ?? "" }); }
    }),
    safely("Voucher Reprints", async () => {
      const list = await inRange<{ id: string; expense_id: string; reason: string; status: string; decided_by: string | null; decided_at: string; decision_remarks: string | null }>("expense_reprint_requests", "id,expense_id,reason,status,decided_by,decided_at,decision_remarks", "decided_at");
      const ex = new Map((await byIds<{ id: string; voucher_number: string | null; expense_number: string; payee: string }>("expenses", "id,voucher_number,expense_number,payee", list.map((r) => r.expense_id))).map((e) => [e.id, e]));
      for (const r of list) { const e = ex.get(r.expense_id); if (r.decided_by) people.add(r.decided_by); rows.push({ id: `v:${r.id}`, category: "Voucher Reprints", decidedAt: r.decided_at, title: `${e?.voucher_number ?? e?.expense_number ?? "Voucher"} · ${e?.payee ?? ""}`, detail: r.reason, amountCentavos: 0, decision: r.status, by: r.decided_by ?? "", remarks: r.decision_remarks ?? "" }); }
    }),
    safely("Refunds and Change Requests", async () => {
      const list = await inRange<{ id: string; request_number: string; request_type: string; status: string; decided_at: string; decision_remarks: string | null; assigned_approver_id: string | null; trainee_id: string; enrollment_id: string | null; requested_values: { amountCentavos?: number } | null; reason: string }>("enrollment_requests", "id,request_number,request_type,status,decided_at,decision_remarks,assigned_approver_id,trainee_id,enrollment_id,requested_values,reason", "decided_at");
      const tr = new Map((await byIds<Trainee>("trainees", "id,legal_first_name,legal_last_name", list.map((r) => r.trainee_id))).map((t) => [t.id, t]));
      for (const r of list.filter((x) => x.status !== "Pending")) { const t = tr.get(r.trainee_id); if (r.assigned_approver_id) people.add(r.assigned_approver_id); rows.push({ id: `r:${r.id}`, category: r.request_type === "Refund" ? "Refunds" : r.request_type === "TAR reprint" ? "TAR Reprints" : "Change Requests", decidedAt: r.decided_at, title: `${t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee"} · ${r.request_type === "Rescheduling" ? "Reschedule" : r.request_type}`, detail: `${r.request_number} · ${r.reason}`, amountCentavos: Number(r.requested_values?.amountCentavos ?? 0), decision: r.status, by: r.assigned_approver_id ?? "", remarks: r.decision_remarks ?? "" }); }
    }),
    safely("Discounts", async () => {
      const list = await inRange<{ id: string; enrollment_id: string; description: string; amount_centavos: number; approval_status: string; decided_by: string | null; decided_at: string }>("enrollment_charges", "id,enrollment_id,description,amount_centavos,approval_status,decided_by,decided_at", "decided_at", ["event_type", "discount"]);
      const en = new Map((await byIds<{ id: string; enrollment_number: string; trainee_id: string }>("enrollments", "id,enrollment_number,trainee_id", list.map((c) => c.enrollment_id))).map((e) => [e.id, e]));
      const tr = new Map((await byIds<Trainee>("trainees", "id,legal_first_name,legal_last_name", [...en.values()].map((e) => e.trainee_id))).map((t) => [t.id, t]));
      const why = new Map((await byIds<{ record_id: string; action: string; new_values: { remarks?: string } | null }>("audit_logs", "record_id,action,new_values", list.map((c) => c.id), "record_id")).filter((a) => a.action === "discount.rejected").map((a) => [a.record_id, a.new_values?.remarks ?? ""]));
      for (const c of list.filter((x) => x.approval_status !== "Pending")) { const e = en.get(c.enrollment_id), t = e ? tr.get(e.trainee_id) : undefined; if (c.decided_by) people.add(c.decided_by); rows.push({ id: `d:${c.id}`, category: "Discounts", decidedAt: c.decided_at, title: `${t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee"}${e ? ` · ${e.enrollment_number}` : ""}`, detail: c.description, amountCentavos: Number(c.amount_centavos), decision: c.approval_status, by: c.decided_by ?? "", remarks: why.get(c.id) ?? "" }); }
    }),
    safely("Payment Voids", async () => {
      const list = await inRange<{ id: string; payment_id: string; reason: string; status: string; decided_by: string | null; decided_at: string; decision_remarks: string | null }>("payment_void_requests", "id,payment_id,reason,status,decided_by,decided_at,decision_remarks", "decided_at");
      const pays = new Map((await byIds<{ id: string; payment_number: string; amount_centavos: number; trainee_id: string }>("payments", "id,payment_number,amount_centavos,trainee_id", list.map((v) => v.payment_id))).map((p) => [p.id, p]));
      const rec = new Map((await byIds<{ payment_id: string; receipt_number: string }>("receipts", "payment_id,receipt_number", list.map((v) => v.payment_id), "payment_id")).map((r) => [r.payment_id, r.receipt_number]));
      const tr = new Map((await byIds<Trainee>("trainees", "id,legal_first_name,legal_last_name", [...pays.values()].map((p) => p.trainee_id))).map((t) => [t.id, t]));
      for (const v of list.filter((x) => x.status !== "Pending")) { const p = pays.get(v.payment_id), t = p ? tr.get(p.trainee_id) : undefined; if (v.decided_by) people.add(v.decided_by); rows.push({ id: `p:${v.id}`, category: "Payment Voids", decidedAt: v.decided_at, title: `${rec.get(v.payment_id) ?? p?.payment_number ?? "Payment"} · ${t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : ""}`, detail: v.reason, amountCentavos: Number(p?.amount_centavos ?? 0), decision: v.status === "Approved" ? "Voided" : v.status, by: v.decided_by ?? "", remarks: v.decision_remarks ?? "" }); }
    }),
    safely("Rebates Paid to Partners", async () => {
      // Recorded when Accounting marks a rebate paid (audit "agency_rebate.settled", from 3 Nov 2026).
      const list = await inRange<{ record_id: string; actor_id: string | null; created_at: string; new_values: { status?: string } | null }>("audit_logs", "record_id,actor_id,created_at,new_values", "created_at", ["action", "agency_rebate.settled"]);
      const reb = new Map((await byIds<{ id: string; agency_id: string; rebate_centavos: number; trainee_id: string | null; course_id: string | null }>("agency_rebates", "id,agency_id,rebate_centavos,trainee_id,course_id", list.map((l) => l.record_id))).map((r) => [r.id, r]));
      const ag = new Map((await byIds<{ id: string; name: string }>("marketing_agencies", "id,name", [...reb.values()].map((r) => r.agency_id))).map((a) => [a.id, a.name]));
      const co = new Map((await byIds<{ id: string; code: string }>("courses", "id,code", [...reb.values()].map((r) => r.course_id ?? ""))).map((c) => [c.id, c.code]));
      const tr = new Map((await byIds<Trainee>("trainees", "id,legal_first_name,legal_last_name", [...reb.values()].map((r) => r.trainee_id ?? ""))).map((t) => [t.id, t]));
      for (const l of list) { const r = reb.get(l.record_id); const t = r?.trainee_id ? tr.get(r.trainee_id) : undefined; if (l.actor_id) people.add(l.actor_id); rows.push({ id: `b:${l.record_id}:${l.created_at}`, category: "Rebates Paid to Partners", decidedAt: l.created_at, title: `${r ? ag.get(r.agency_id) ?? "Partner" : "Partner"}`, detail: [t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "", r?.course_id ? co.get(r.course_id) : ""].filter(Boolean).join(" · "), amountCentavos: Number(r?.rebate_centavos ?? 0), decision: l.new_values?.status === "Cancelled" ? "Cancelled" : "Paid", by: l.actor_id ?? "", remarks: "" }); }
    }),
    safely("Cashier Closings Reviewed", async () => {
      const list = await inRange<{ id: string; closing_date: string; actual_cash_centavos: number | null; variance_centavos: number | null; reviewed_by: string | null; reviewed_at: string }>("cashier_closings", "id,closing_date,actual_cash_centavos,variance_centavos,reviewed_by,reviewed_at", "reviewed_at");
      for (const c of list) { const v = Number(c.variance_centavos ?? 0); if (c.reviewed_by) people.add(c.reviewed_by); rows.push({ id: `c:${c.id}`, category: "Cashier Closings Reviewed", decidedAt: c.reviewed_at, title: `Closing · ${c.closing_date}`, detail: `Counted ₱${(Number(c.actual_cash_centavos ?? 0) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}${v ? ` · ${v < 0 ? "short" : "over"} ₱${(Math.abs(v) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : " · balanced"}`, amountCentavos: Math.abs(v), decision: "Reviewed", by: c.reviewed_by ?? "", remarks: "" }); }
    }),
  ]);
  const names = new Map<string, string>();
  try { for (const p of await byIds<{ id: string; complete_name: string | null }>("profiles", "id,complete_name", [...people])) names.set(p.id, p.complete_name ?? ""); } catch { /* names are optional */ }
  rows.sort((a, z) => z.decidedAt.localeCompare(a.decidedAt));
  return NextResponse.json({ rows: rows.map((r) => ({ ...r, by: names.get(r.by) || (r.by ? "Staff" : "Automatic") })), notes }, { headers: { "Cache-Control": "no-store" } });
}
