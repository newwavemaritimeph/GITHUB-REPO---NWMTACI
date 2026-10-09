import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CHANNELS, channelOf, groupOverdue, manilaDayBounds, recentDays, summarizeDays, type Channel, type OverdueDay, type ReconStatus } from "@/lib/reconciliation";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
/** PostgREST filter for the three reconciled channels (case-insensitive). */
const CHANNEL_FILTER = CHANNELS.map((c) => `method.ilike.${c}`).join(",");

export type ReconRow = { id: string; payment_number: string; receipt_number: string | null; received_at: string; amount_centavos: number; reference_number: string | null; trainee: string; recorded_by: string | null; proof_link: string | null; status: ReconStatus | null; remarks: string | null; checked_by: string | null; checked_at: string | null };
export type ChannelOverdue = { channel: Channel; days: OverdueDay[]; count: number; total: number };

async function statusesFor(db: Admin, ids: string[]) {
  const map = new Map<string, { status: ReconStatus; remarks: string | null; checked_at: string; checker: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("payment_reconciliations").select("payment_id,status,remarks,checked_at,profiles:checked_by(complete_name)").in("payment_id", ids.slice(i, i + 200));
    if (error) return null;
    for (const r of data ?? []) map.set(r.payment_id as string, { status: r.status as ReconStatus, remarks: (r.remarks as string | null) ?? null, checked_at: r.checked_at as string, checker: one(r.profiles as unknown as { complete_name: string } | null)?.complete_name ?? null });
  }
  return map;
}

/**
 * Payments from before today (last 60 days) not yet reconciled, per channel.
 * Empty before migration 202610090035.
 */
export async function loadOverdue(db: Admin, today: string): Promise<ChannelOverdue[]> {
  const days = recentDays(today, 61);
  const { data: pays, error } = await db.from("payments").select("id,method,amount_centavos,received_at").eq("valid", true).or(CHANNEL_FILTER)
    .gte("received_at", manilaDayBounds(days[days.length - 1]).start).lt("received_at", manilaDayBounds(today).start).limit(10000);
  if (error || !pays?.length) return [];
  const status = await statusesFor(db, pays.map((p) => p.id as string));
  if (!status) return [];
  return CHANNELS.map((channel) => {
    const lines = pays.filter((p) => channelOf(p.method as string) === channel).map((p) => ({ amount_centavos: Number(p.amount_centavos), received_at: p.received_at as string, status: status.get(p.id as string)?.status ?? null }));
    const grouped = groupOverdue(lines, today);
    return { channel, days: grouped, count: grouped.reduce((s, d) => s + d.count, 0), total: grouped.reduce((s, d) => s + d.total, 0) };
  }).filter((c) => c.count > 0);
}

/**
 * One Manila day of a channel's payments with their reconciliation status, the
 * last 14 days' summary, how many are left to check per channel, overdue
 * payments and every payment marked Not in History (for Accounting).
 * `tracked` is false before migration 202610090035.
 */
export async function loadReconDay(db: Admin, day: string, today: string, channel: Channel) {
  const { start, end } = manilaDayBounds(day);
  const sel = "id,payment_number,received_at,amount_centavos,reference_number,trainees(legal_first_name,legal_last_name),profiles:cashier_id(complete_name),receipts(receipt_number)";
  let dayRes = await db.from("payments").select(`${sel},payment_proofs:proof_id(drive_link)`).eq("valid", true).ilike("method", channel).gte("received_at", start).lte("received_at", end).order("received_at");
  if (dayRes.error) dayRes = await db.from("payments").select(sel).eq("valid", true).ilike("method", channel).gte("received_at", start).lte("received_at", end).order("received_at") as typeof dayRes;
  if (dayRes.error) throw dayRes.error;
  const days = recentDays(today, 14);
  const { data: recent, error: recentError } = await db.from("payments").select("id,method,amount_centavos,received_at").eq("valid", true).or(CHANNEL_FILTER)
    .gte("received_at", manilaDayBounds(days[days.length - 1]).start).lte("received_at", manilaDayBounds(today).end).limit(10000);
  if (recentError) throw recentError;
  const dayRows = (dayRes.data ?? []) as unknown as Record<string, unknown>[];
  const ids = [...new Set([...dayRows.map((r) => r.id as string), ...(recent ?? []).map((r) => r.id as string)])];
  const recon = await statusesFor(db, ids);
  const tracked = recon !== null;
  const st = recon ?? new Map();
  const rows: ReconRow[] = dayRows.map((r) => {
    const t = one(r.trainees as { legal_first_name: string; legal_last_name: string } | null);
    const rc = st.get(r.id as string);
    return { id: r.id as string, payment_number: r.payment_number as string, receipt_number: one(r.receipts as { receipt_number: string } | null)?.receipt_number ?? null, received_at: r.received_at as string, amount_centavos: Number(r.amount_centavos), reference_number: (r.reference_number as string | null) ?? null,
      trainee: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee", recorded_by: one(r.profiles as { complete_name: string } | null)?.complete_name ?? null, proof_link: one(r.payment_proofs as { drive_link: string | null } | null)?.drive_link ?? null,
      status: rc?.status ?? null, remarks: rc?.remarks ?? null, checked_by: rc?.checker ?? null, checked_at: rc?.checked_at ?? null };
  });
  const lineOf = (r: { id: unknown; amount_centavos: unknown; received_at: unknown }) => ({ amount_centavos: Number(r.amount_centavos), received_at: r.received_at as string, status: st.get(r.id as string)?.status ?? null });
  const summary = summarizeDays((recent ?? []).filter((r) => channelOf(r.method as string) === channel).map(lineOf), days);
  const toCheck = Object.fromEntries(CHANNELS.map((c) => [c, summarizeDays((recent ?? []).filter((r) => channelOf(r.method as string) === c).map(lineOf), days).reduce((s, d) => s + d.toCheck, 0)])) as Record<Channel, number>;
  let missing: { payment_id: string; channel: Channel | null; remarks: string | null; checked_at: string; payment_number: string; received_at: string; amount_centavos: number; reference_number: string | null; trainee: string }[] = [];
  if (tracked) {
    const { data } = await db.from("payment_reconciliations").select("payment_id,remarks,checked_at,payments(payment_number,method,received_at,amount_centavos,reference_number,trainees(legal_first_name,legal_last_name))").eq("status", "Not in History").order("checked_at", { ascending: false }).limit(100);
    missing = (data ?? []).map((m) => { const p = one(m.payments as unknown as { payment_number: string; method: string; received_at: string; amount_centavos: number; reference_number: string | null; trainees: unknown } | null); const t = one(p?.trainees as { legal_first_name: string; legal_last_name: string } | null);
      return { payment_id: m.payment_id as string, channel: channelOf(p?.method), remarks: (m.remarks as string | null) ?? null, checked_at: m.checked_at as string, payment_number: p?.payment_number ?? "", received_at: p?.received_at ?? "", amount_centavos: Number(p?.amount_centavos ?? 0), reference_number: p?.reference_number ?? null, trainee: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}` : "Trainee" }; });
  }
  const overdue = tracked ? await loadOverdue(db, today) : [];
  return { day, today, channel, tracked, rows, summary, toCheck, overdue, missing };
}
