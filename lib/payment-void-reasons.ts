import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Why each voided payment was voided. The column comes with migration 202610090038; on a database
 * without it this gives no reasons rather than failing the whole list of payments.
 */
export async function voidReasons(db: ReturnType<typeof createSupabaseAdminClient>, paymentIds: string[]) {
  const reasons = new Map<string, string>();
  for (let i = 0; i < paymentIds.length; i += 100) {
    const { data, error } = await db.from("payments").select("id,void_reason").in("id", paymentIds.slice(i, i + 100));
    if (error) return reasons;
    for (const p of (data ?? []) as { id: string; void_reason: string | null }[]) if (p.void_reason) reasons.set(p.id, p.void_reason);
  }
  return reasons;
}
