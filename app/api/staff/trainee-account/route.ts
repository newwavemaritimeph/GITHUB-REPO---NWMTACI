import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeSrn } from "@/lib/validation";
import { sameTrainee, tarPrintable } from "@/lib/trainee-match";
import { loadTarGroups } from "@/lib/trainee-match-server";

export const runtime = "nodejs";

/**
 * Trainee Account check (29 Oct 2026). The portal list holds only the newest rows, so
 * the account asks the database whether this trainee has a course for the TAR, and
 * whether another record exists for the same person (same SRN, or name and birth date).
 */
export async function GET(request: Request) {
  const staff = await requireStaff(["admin", "registration", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const traineeId = new URL(request.url).searchParams.get("traineeId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(traineeId)) return NextResponse.json({ error: "Choose a trainee." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: me } = await db.from("trainees").select("id,srn,legal_first_name,legal_last_name,birthdate").eq("id", traineeId).maybeSingle();
  if (!me) return NextResponse.json({ error: "Trainee not found." }, { status: 404 });
  // Every receipt and TAR of this trainee (owner, 3 Nov 2026: Accounting reprints from the Trainee Account).
  type PayRow = { id: string; payment_number: string; trainee_id: string; amount_centavos: number; method: string; reference_number: string | null; received_at: string; valid: boolean; remarks: string | null; verification_state: string | null; void_reason: string | null; receipts: { receipt_number?: string; print_count?: number } | { receipt_number?: string; print_count?: number }[] | null };
  const paySelect = (receipts: string) => db.from("payments").select(`id,payment_number,trainee_id,amount_centavos,method,reference_number,received_at,valid,remarks,verification_state,void_reason,receipts(${receipts})`).eq("trainee_id", traineeId).order("received_at", { ascending: true }).limit(500);
  const [firstPay, tarRes] = await Promise.all([
    paySelect("receipt_number,print_count"),
    db.from("admission_records").select("id,ar_number,enrollment_ids,print_count,reprints_approved,issued_at").eq("trainee_id", traineeId).order("issued_at", { ascending: true }).limit(200),
  ]);
  // A failed read must never look like "No payments yet" (owner, 4 Nov 2026: receipts showed under Transactions but not here).
  // Retry without the print count; if that fails too, send nothing and the page falls back on its own list.
  let payRes = firstPay;
  if (payRes.error) { console.error("Trainee Account payments:", payRes.error.message); payRes = await paySelect("receipt_number"); }
  if (payRes.error) console.error("Trainee Account payments, retry:", payRes.error.message);
  const payments = payRes.error ? undefined : ((payRes.data ?? []) as unknown as PayRow[]).map((p) => { const r = Array.isArray(p.receipts) ? p.receipts[0] : p.receipts; return { id: p.id, payment_number: p.payment_number, trainee_id: p.trainee_id, amount_centavos: p.amount_centavos, method: p.method, reference_number: p.reference_number, received_at: p.received_at, valid: p.valid, remarks: p.remarks, verification_state: p.verification_state, void_reason: p.void_reason, receipt_number: r?.receipt_number ?? null, print_count: Number(r?.print_count ?? 0) }; });
  // Candidates: same SRN, or same last name (then name + birth date is checked in code).
  const srn = normalizeSrn(me.srn ?? "");
  const [bySrn, byName] = await Promise.all([
    srn ? db.from("trainees").select("id,srn,legal_first_name,legal_last_name,birthdate,application_number,trainee_number").ilike("srn", `%${srn.slice(-6)}%`).limit(20) : Promise.resolve({ data: [] }),
    me.legal_last_name ? db.from("trainees").select("id,srn,legal_first_name,legal_last_name,birthdate,application_number,trainee_number").ilike("legal_last_name", me.legal_last_name).limit(20) : Promise.resolve({ data: [] }),
  ]);
  const seen = new Map<string, { id: string; application_number?: string | null; trainee_number?: string | null }>();
  for (const t of [...(bySrn.data ?? []), ...(byName.data ?? [])] as (Parameters<typeof sameTrainee>[0] & { application_number?: string | null; trainee_number?: string | null })[]) if (sameTrainee(me, t)) seen.set(t.id, t);
  const others = [];
  if (seen.size) {
    const { data: theirs } = await db.from("enrollments").select("trainee_id,enrollment_status").in("trainee_id", [...seen.keys()]);
    for (const [id, t] of seen) others.push({ id, number: t.application_number ?? t.trainee_number ?? "", tarCourses: (theirs ?? []).filter((e) => e.trainee_id === id && tarPrintable(e)).length });
  }
  return NextResponse.json({ tarGroups: await loadTarGroups(db, traineeId), payments, tars: tarRes.data ?? [], others }, { headers: { "Cache-Control": "no-store" } });
}
