import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { tarGroups, type TarGroup } from "@/lib/trainee-match";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Paid = { id: string; created_at: string; receipts?: { receipt_number: string } | { receipt_number: string }[] | null };

/**
 * The trainee's transactions (owner, 4 Nov 2026), each with its TAR and receipt numbers: the
 * courses, the TARs issued and when each receipt was generated decide them. A failed read
 * throws, so a TAR or receipt is never issued on a guess.
 */
export async function loadTarGroups(db: Admin, traineeId: string): Promise<(TarGroup & { tar: string | null; receipts: string[] })[]> {
  const [enrollments, records, allocations] = await Promise.all([
    db.from("enrollments").select("id,enrollment_status,created_at").eq("trainee_id", traineeId),
    db.from("admission_records").select("ar_number,enrollment_ids").eq("trainee_id", traineeId).order("issued_at", { ascending: false }),
    db.from("payment_allocations").select("enrollment_id,payments!inner(id,created_at,valid,trainee_id,receipts(receipt_number))").eq("payments.trainee_id", traineeId).eq("payments.valid", true),
  ]);
  const failed = enrollments.error ?? records.error ?? allocations.error;
  if (failed) throw failed;
  const firstReceipt = new Map<string, Paid>(), receiptNumbers = new Map<string, Set<string>>();
  for (const a of (allocations.data ?? []) as unknown as { enrollment_id: string; payments: Paid | Paid[] }[]) {
    const pay = Array.isArray(a.payments) ? a.payments[0] : a.payments;
    const seen = firstReceipt.get(a.enrollment_id);
    if (!seen || new Date(pay.created_at) < new Date(seen.created_at)) firstReceipt.set(a.enrollment_id, pay);
    const number = (Array.isArray(pay.receipts) ? pay.receipts[0] : pay.receipts)?.receipt_number;
    if (number) receiptNumbers.set(a.enrollment_id, (receiptNumbers.get(a.enrollment_id) ?? new Set<string>()).add(number));
  }
  const issued = (records.data ?? []) as { ar_number: string; enrollment_ids: string[] }[];
  const rows = ((enrollments.data ?? []) as { id: string; enrollment_status: string; created_at: string }[]).map((e) => ({ ...e, receipt_at: firstReceipt.get(e.id)?.created_at ?? null, paid_by: firstReceipt.get(e.id)?.id ?? null }));
  return tarGroups(rows, issued.map((r) => r.enrollment_ids)).map((g) => ({
    ...g,
    tar: issued.find((r) => [...r.enrollment_ids].sort().join("|") === g.ids.join("|"))?.ar_number ?? null,
    receipts: [...new Set(g.ids.flatMap((id) => [...(receiptNumbers.get(id) ?? [])]))].sort(),
  }));
}
