import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isReferralRebate, manilaDay, type LineFacts } from "@/lib/referral-voucher";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * Detailed voucher lines (owner, 13 Nov 2026): for each rebate, its enrollment number, the fee due, what was paid
 * (a referral rebate counts as paid toward the fee, as on the receipt), the latest receipt and its date.
 */
export async function voucherLineFacts(db: Admin, rebateIds: string[]): Promise<Map<string, LineFacts>> {
  const out = new Map<string, LineFacts>();
  if (!rebateIds.length) return out;
  const reb = (await Promise.all(chunks(rebateIds).map((ids) => db.from("agency_rebates").select("id,enrollment_id").in("id", ids)))).flatMap((r) => r.data ?? []) as { id: string; enrollment_id: string }[];
  const enrIds = [...new Set(reb.map((r) => r.enrollment_id))];
  const [enr, alloc, chg] = await Promise.all([
    Promise.all(chunks(enrIds).map((ids) => db.from("enrollments").select("id,enrollment_number,selling_price_centavos").in("id", ids))),
    Promise.all(chunks(enrIds).map((ids) => db.from("payment_allocations").select("enrollment_id,amount_centavos,payment_id,payments!inner(valid,received_at)").in("enrollment_id", ids).eq("payments.valid", true))),
    Promise.all(chunks(enrIds).map((ids) => db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type,description").in("enrollment_id", ids).eq("valid", true))),
  ]);
  const allocs = alloc.flatMap((r) => r.data ?? []) as unknown as { enrollment_id: string; amount_centavos: number; payment_id: string; payments: { received_at: string } | { received_at: string }[] }[];
  const payIds = [...new Set(allocs.map((a) => a.payment_id))];
  const receipts = new Map(((await Promise.all(chunks(payIds).map((ids) => db.from("receipts").select("payment_id,receipt_number").in("payment_id", ids)))).flatMap((r) => r.data ?? []) as { payment_id: string; receipt_number: string }[]).map((r) => [r.payment_id, r.receipt_number]));
  const charges = chg.flatMap((r) => r.data ?? []) as { enrollment_id: string; amount_centavos: number; event_type: string; description: string }[];
  const facts = new Map<string, LineFacts>();
  for (const e of enr.flatMap((r) => r.data ?? []) as { id: string; enrollment_number: string; selling_price_centavos: number }[]) {
    const mine = charges.filter((c) => c.enrollment_id === e.id);
    const fee = Number(e.selling_price_centavos) + mine.filter((c) => c.event_type !== "discount").reduce((s, c) => s + Number(c.amount_centavos), 0) - mine.filter((c) => c.event_type === "discount" && !isReferralRebate(c)).reduce((s, c) => s + Number(c.amount_centavos), 0);
    const paidRows = allocs.filter((a) => a.enrollment_id === e.id).map((a) => ({ ...a, at: (Array.isArray(a.payments) ? a.payments[0] : a.payments)?.received_at ?? "" })).sort((a, b) => b.at.localeCompare(a.at));
    const paid = paidRows.reduce((s, a) => s + Number(a.amount_centavos), 0) + mine.filter(isReferralRebate).reduce((s, c) => s + Number(c.amount_centavos), 0);
    facts.set(e.id, { enrollmentNo: e.enrollment_number, feeCentavos: fee, paidCentavos: paid, receipt: paidRows[0] ? receipts.get(paidRows[0].payment_id) ?? null : null, paidOn: paidRows[0]?.at ? manilaDay(paidRows[0].at) : null });
  }
  for (const r of reb) { const f = facts.get(r.enrollment_id); if (f) out.set(r.id, f); }
  return out;
}
