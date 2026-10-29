import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";
import { normalizeSrn } from "@/lib/validation";
import { certificateContext } from "@/lib/certificates";
import { proofState } from "@/lib/trainee-proof";

export const runtime = "nodejs";

const input = z.object({ srn: z.string().trim().min(10).max(20), nwmtaciNo: z.string().trim().min(4).max(40) });
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const longDate = (d?: string | null) => (d ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`)) : "");
const NO_MATCH = "We could not match this SRN and NWMTACI number.";

/**
 * Trainee status on the website (owner, 8 Oct 2026; SRN instead of birth date, owner, 20 Oct 2026).
 * With the SRN and NWMTACI number the trainee sees each course: schedule, status,
 * fee, paid and balance, evaluation, certificate, plus their payments. Never
 * returns address, mobile, email, birth date or SRN.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Trainee status opens after production setup." }, { status: 503 });
  try { await enforceRateLimit(request, "trainee-status", 15); } catch { return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 }); }
  const parsed = input.safeParse(await request.json().catch(() => null));
  const srn = parsed.success ? normalizeSrn(parsed.data.srn) : null;
  if (!parsed.success || !srn) return NextResponse.json({ error: "Enter your SRN (10 digits) and NWMTACI number." }, { status: 400 });
  const no = parsed.data.nwmtaciNo.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!no) return NextResponse.json({ error: NO_MATCH }, { status: 404 });
  const db = createSupabaseAdminClient();
  const { data: trainees } = await db.from("trainees").select("id,legal_first_name,srn,application_number,trainee_number,awaiting_course,marketing_agency_id").or(`application_number.eq.${no},trainee_number.eq.${no}`).limit(2);
  const t = (trainees ?? []).find((r) => normalizeSrn(r.srn ?? "") === srn);
  if (!t) return NextResponse.json({ error: NO_MATCH }, { status: 404 });
  const { data: enrollments } = await db.from("enrollments").select("id,enrollment_number,enrollment_status,partner_offer_id,feedback_token,courses(name,code,delivery_type),batches(starts_on,ends_on)").eq("trainee_id", t.id).order("created_at", { ascending: false }).limit(20);
  const ids = (enrollments ?? []).map((e) => e.id as string);
  const [{ data: handed }, { data: deliveries }, { data: allocations }, { data: feedback }, { data: payments }] = await Promise.all([
    db.from("enrollments").select("id,handed_to_cashier_at").eq("trainee_id", t.id),
    db.from("delivery_requests").select("enrollment_id,status,tracking_number").eq("trainee_id", t.id),
    db.from("payment_allocations").select("enrollment_id,amount_centavos,payments(valid)").in("enrollment_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    db.from("training_feedback").select("enrollment_id").in("enrollment_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    db.from("payments").select("payment_number,received_at,method,reference_number,amount_centavos,valid").eq("trainee_id", t.id).order("received_at", { ascending: false }).limit(100),
  ]);
  const handedSet = new Set(((handed ?? []) as { id: string; handed_to_cashier_at?: string | null }[]).filter((h) => h.handed_to_cashier_at).map((h) => h.id));
  // Company Charge (29 Oct 2026): the partner pays on its Billing Statement, never the trainee at the Cashier.
  const billedTo = new Map<string, string>();
  {
    const { data: links } = ids.length ? await db.from("enrollments").select("id,selling_price_centavos,referral_agency_id,company_charge_agency_id").in("id", ids) : { data: [] };
    const rows = (links ?? []) as { id: string; selling_price_centavos: number; referral_agency_id: string | null; company_charge_agency_id?: string | null }[];
    const agencyOf = (r: (typeof rows)[number]) => r.company_charge_agency_id ?? r.referral_agency_id ?? (t as { marketing_agency_id?: string | null }).marketing_agency_id ?? null;
    const agencyIds = [...new Set(rows.map(agencyOf).filter(Boolean) as string[])];
    const { data: ags } = agencyIds.length ? await db.from("marketing_agencies").select("id,name").in("id", agencyIds).eq("rebate_mode", "Company Charge") : { data: [] };
    const ccName = new Map((ags ?? []).map((a) => [a.id as string, a.name as string]));
    for (const r of rows) { const a = agencyOf(r); if (a && ccName.has(a)) billedTo.set(r.id, ccName.get(a)!); }
  }
  const deliveryBy = new Map(((deliveries ?? []) as { enrollment_id: string; status: string; tracking_number: string | null }[]).map((d) => [d.enrollment_id, d]));
  const paidBy = new Map<string, number>();
  for (const a of allocations ?? []) {
    if (first(a.payments as unknown as { valid: boolean } | null)?.valid === false) continue;
    paidBy.set(a.enrollment_id, (paidBy.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
  }
  const evaluated = new Set((feedback ?? []).map((f) => f.enrollment_id as string));
  const courses = [];
  for (const e of enrollments ?? []) {
    const c = first(e.courses as unknown as { name: string; code: string; delivery_type: string } | null), b = first(e.batches as unknown as { starts_on: string; ends_on: string } | null);
    const ctx = await certificateContext(db, e.id);
    const status = e.enrollment_status === "Pending" ? (handedSet.has(e.id) ? "For payment" : "Under screening") : e.enrollment_status === "Open Schedule" ? "Enrolled · schedule to follow" : e.enrollment_status;
    const d = deliveryBy.get(e.id);
    const state = ctx?.view.state;
    const cancelled = e.enrollment_status === "Cancelled";
    const certificate = cancelled || e.partner_offer_id ? null
      : state === "Released" ? (d?.status === "Shipped" || d?.status === "Delivered" ? `Sent by LBC${d.tracking_number ? ` · tracking no. ${d.tracking_number}` : ""}` : "Released")
      : state === "Printed" ? "Printed — ready for pick-up at our office (bring a valid ID)"
      : state === "Void requested" ? "Being reprinted"
      : state === "Due" ? (ctx?.postTest.required && !ctx.postTest.passed ? "Pass the post-test" : "Being prepared")
      : state === "Waiting for payment" ? "Settle your balance first"
      : state === "Waiting for evaluation" ? "Submit your training evaluation"
      : "After your training";
    // Released on: the latest release event of the certificate.
    let releasedAt: string | null = null;
    if (state === "Released" && ctx?.cert) {
      const { data: ev } = await db.from("certificate_release_events").select("created_at").eq("certificate_id", ctx.cert.id).eq("event_type", "release").order("created_at", { ascending: false }).limit(1).maybeSingle();
      releasedAt = (ev?.created_at as string | undefined) ?? null;
    }
    const paid = paidBy.get(e.id) ?? 0, balance = ctx?.balanceCentavos ?? 0;
    const trainingFinished = !!state && state !== "Training not finished" && state !== "Cancelled";
    const needed = c?.delivery_type === "In-House" && !e.partner_offer_id && !cancelled;
    const submitted = evaluated.has(e.id);
    courses.push({
      course: c?.name ?? "Course", code: c?.code ?? "", enrollmentNumber: e.enrollment_number ?? "",
      schedule: b ? `${longDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${longDate(b.ends_on)}` : ""}` : "Schedule to follow",
      status, trainingFinished, feeCentavos: paid + balance, paidCentavos: paid, balanceCentavos: billedTo.has(e.id) ? 0 : balance, billedTo: billedTo.get(e.id) ?? null,
      certificate, certificateNumber: (state === "Printed" || state === "Released") ? ctx?.cert?.certificate_number ?? null : null, releasedAt,
      ready: state === "Printed", delivery: d ? d.status : null,
      evaluation: { needed, submitted, url: needed && !submitted && trainingFinished && e.feedback_token ? `/feedback/${e.feedback_token}` : null },
      // Course post-test (20 Oct 2026): only for courses whose questions the Admin approved.
      postTest: { needed: !!ctx?.postTest.required && !cancelled, passed: !!ctx?.postTest.passed, best: ctx?.postTest.best ?? null, attempts: ctx?.postTest.attempts ?? 0, url: ctx?.postTest.required && !ctx.postTest.passed && trainingFinished && !cancelled && e.feedback_token ? `/post-test/${e.feedback_token}` : null },
    });
  }
  // Proofs of payment the trainee sent (29 Oct 2026); empty before migration 060.
  const { data: proofRows } = await db.from("payment_proofs").select("id,source,submitted_at,claimed_method,claimed_amount_centavos,extracted_reference,dismissed_at,dismiss_reason").eq("trainee_id", t.id).eq("source", "Trainee").order("submitted_at", { ascending: false }).limit(20);
  const proofIds = (proofRows ?? []).map((p) => p.id as string);
  const { data: usedRows } = proofIds.length ? await db.from("payments").select("proof_id").in("proof_id", proofIds).eq("valid", true) : { data: [] };
  const used = new Set((usedRows ?? []).map((r) => r.proof_id as string));
  const proofs = (proofRows ?? []).map((p) => ({ submittedAt: p.submitted_at as string, method: (p.claimed_method as string) ?? "", amountCentavos: Number(p.claimed_amount_centavos ?? 0), reference: (p.extracted_reference as string) ?? "", state: proofState(p as { id: string; dismissed_at: string | null }, used), reason: p.dismissed_at && !used.has(p.id as string) ? (p.dismiss_reason as string | null) : null }));
  return NextResponse.json({
    firstName: t.legal_first_name, proofs, nwmtaciNo: t.application_number ?? t.trainee_number, awaitingCourse: !!t.awaiting_course, courses,
    payments: (payments ?? []).map((p) => ({ paymentNumber: p.payment_number, receivedAt: p.received_at, method: p.method, referenceNumber: p.reference_number, amountCentavos: Number(p.amount_centavos), valid: p.valid !== false })),
  }, { headers: { "Cache-Control": "no-store" } });
}
