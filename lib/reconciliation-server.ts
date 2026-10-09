import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { manilaDayBounds, recentDays, summarizeDays, type ReconStatus } from "@/lib/reconciliation";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export type ReconRow = { id: string; payment_number: string; receipt_number: string | null; received_at: string; amount_centavos: number; reference_number: string | null; trainee: string; recorded_by: string | null; proof_link: string | null; status: ReconStatus | null; remarks: string | null; checked_by: string | null; checked_at: string | null };

/**
 * One Manila day of GCash payments with their reconciliation status, the last
 * 14 days' summary, and every payment marked Not in History (for Accounting).
 * `tracked` is false before migration 202610090035.
 */
export async function loadGcashDay(db: Admin, day: string, today: string) {
  const { start, end } = manilaDayBounds(day);
  const sel = "id,payment_number,received_at,amount_centavos,reference_number,trainees(legal_first_name,legal_last_name),profiles:cashier_id(complete_name),receipts(receipt_number)";
  let dayRes = await db.from("payments").select(`${sel},payment_proofs:proof_id(drive_link)`).eq("valid", true).ilike("method", "gcash").gte("received_at", start).lte("received_at", end).order("received_at");
  if (dayRes.error) dayRes = await db.from("payments").select(sel).eq("valid", true).ilike("method", "gcash").gte("received_at", start).lte("received_at", end).order("received_at") as typeof dayRes;
  if (dayRes.error) throw dayRes.error;
  const days = recentDays(today, 14);
  const range = { start: manilaDayBounds(days[days.length - 1]).start, end: manilaDayBounds(today).end };
  const { data: recent, error: recentError } = await db.from("payments").select("id,amount_centavos,received_at").eq("valid", true).ilike("method", "gcash").gte("received_at", range.start).lte("received_at", range.end).limit(5000);
  if (recentError) throw recentError;
  const dayRows = (dayRes.data ?? []) as unknown as Record<string, unknown>[];
  const ids = [...new Set([...dayRows.map((r) => r.id as string), ...(recent ?? []).map((r) => r.id as string)])];
  const recon = new Map<string, { status: ReconStatus; remarks: string | null; checked_at: string; checker: string | null }>();
  let tracked = true;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("payment_reconciliations").select("payment_id,status,remarks,checked_at,profiles:checked_by(complete_name)").in("payment_id", ids.slice(i, i + 200));
    if (error) { tracked = false; break; }
    for (const r of data ?? []) recon.set(r.payment_id as string, { status: r.status as ReconStatus, remarks: (r.remarks as string | null) ?? null, checked_at: r.checked_at as string, checker: one(r.profiles as unknown as { complete_name: string } | null)?.complete_name ?? null });
  }
  const rows: ReconRow[] = dayRows.map((r) => {
    const t = one(r.trainees as { legal_first_name: string; legal_last_name: string } | null);
    const rc = recon.get(r.id as string);
    return { id: r.id as string, payment_number: r.payment_number as string, receipt_number: one(r.receipts as { receipt_number: string } | null)?.receipt_number ?? null, received_at: r.received_at as string, amount_centavos: Number(r.amount_centavos), reference_number: (r.reference_number as string | null) ?? null,
      trainee: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee", recorded_by: one(r.profiles as { complete_name: string } | null)?.complete_name ?? null, proof_link: one(r.payment_proofs as { drive_link: string | null } | null)?.drive_link ?? null,
      status: rc?.status ?? null, remarks: rc?.remarks ?? null, checked_by: rc?.checker ?? null, checked_at: rc?.checked_at ?? null };
  });
  const summary = summarizeDays((recent ?? []).map((r) => ({ amount_centavos: Number(r.amount_centavos), received_at: r.received_at as string, status: recon.get(r.id as string)?.status ?? null })), days);
  let missing: { payment_id: string; remarks: string | null; checked_at: string; payment_number: string; received_at: string; amount_centavos: number; reference_number: string | null; trainee: string }[] = [];
  if (tracked) {
    const { data } = await db.from("payment_reconciliations").select("payment_id,remarks,checked_at,payments(payment_number,received_at,amount_centavos,reference_number,trainees(legal_first_name,legal_last_name))").eq("status", "Not in History").order("checked_at", { ascending: false }).limit(100);
    missing = (data ?? []).map((m) => { const p = one(m.payments as unknown as { payment_number: string; received_at: string; amount_centavos: number; reference_number: string | null; trainees: unknown } | null); const t = one(p?.trainees as { legal_first_name: string; legal_last_name: string } | null);
      return { payment_id: m.payment_id as string, remarks: (m.remarks as string | null) ?? null, checked_at: m.checked_at as string, payment_number: p?.payment_number ?? "", received_at: p?.received_at ?? "", amount_centavos: Number(p?.amount_centavos ?? 0), reference_number: p?.reference_number ?? null, trainee: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee" }; });
  }
  return { day, today, tracked, rows, summary, missing };
}
