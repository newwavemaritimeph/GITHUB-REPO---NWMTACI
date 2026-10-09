import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isStcwRebateCourse } from "@/lib/rebates";

/**
 * Referral codes (owner, 8 Oct 2026). Each agency or consultancy has a secret
 * code, e.g. "QMCS050698". A trainee who registers with it is tagged as that
 * agency's referral, and the agency's rebate for the course is deducted from
 * what the trainee pays, whether the payment is partial or full.
 */

/** Uppercase letters and digits only; 4–20 characters, else null. */
export function normaliseReferralCode(input: string | null | undefined) {
  const code = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length >= 4 && code.length <= 20 ? code : null;
}

/** A suggested code: up to five letters of the name plus six digits, e.g. "QAPLA482913". */
export function suggestReferralCode(name: string, random: () => number = Math.random) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) || "NW";
  const digits = String(Math.floor(random() * 1_000_000)).padStart(6, "0");
  return `${letters}${digits}`;
}

/**
 * The rebate for one enrollment: a percentage of the actual training fee when the
 * agency has one and the course is a New Wave in-house course (owner, 8 Oct 2026:
 * 50% for some agencies), otherwise the peso amount in Rebates per course.
 * The five STCW courses always take the fixed peso amount set per partner (9 Oct 2026).
 */
export function referralRebate(input: { percent?: number | null; inHouse: boolean; feeCentavos: number; matrixCentavos: number; courseCode?: string | null }) {
  if (isStcwRebateCourse(input.courseCode)) return input.matrixCentavos;
  if (input.percent && input.percent > 0 && input.inHouse) return Math.round((input.feeCentavos * input.percent) / 100);
  return input.matrixCentavos;
}

/** The rebate configured for an agency and course (Configuration › Rebates per course), or 0. */
export function rebateFor(agencyId: string, courseId: string, matrix: { agency_id: string; course_id: string; rebate_centavos: number }[]) {
  return Number(matrix.find((m) => m.agency_id === agencyId && m.course_id === courseId)?.rebate_centavos ?? 0);
}

/**
 * What to do with a referral rebate (owner, 8 Oct 2026), per the agency's setting:
 * "Deducted" → take it off the fee (any time, before payments too);
 * "No deduction" → owe it to the agency, recorded once the trainee has paid.
 */
export function referralAction(mode: string | null | undefined, paid: boolean): "discount" | "payable" | "skip" {
  if (mode === "No deduction") return paid ? "payable" : "skip";
  return "discount";
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The active agency for a code, or null. */
export async function agencyForCode(db: Admin, code: string | null) {
  if (!code) return null;
  const { data } = await db.from("marketing_agencies").select("id,name,kind,active,referral_code").ilike("referral_code", code).eq("active", true).limit(1);
  const row = (data ?? [])[0] as { id: string; name: string; kind?: string | null; referral_code?: string | null } | undefined;
  return row && normaliseReferralCode(row.referral_code) === code ? row : null;
}

/**
 * Apply each enrollment's referral rebate once (idempotent; one agency_rebates row per enrollment).
 * Deducted: an approved discount on the enrollment, recorded as settled by deduction.
 * No deduction: a Pending rebate owed to the agency, only once the trainee has paid ({ paid: true }).
 * Enrollments without a referral or a rebate for their course are left alone. Never blocks a payment.
 */
export async function applyReferralRebates(db: Admin, enrollmentIds: string[], actor: string | null, options: { paid?: boolean } = {}) {
  const applied: string[] = [];
  if (!enrollmentIds.length) return applied;
  try {
    const { data: rows, error } = await db.from("enrollments").select("id,course_id,trainee_id,referral_agency_id,enrollment_status,selling_price_centavos,courses(delivery_type,code),trainees(marketing_agency_id)").in("id", enrollmentIds);
    if (error || !rows?.length) return applied;
    const { data: done } = await db.from("agency_rebates").select("enrollment_id").in("enrollment_id", enrollmentIds);
    const already = new Set((done ?? []).map((r) => r.enrollment_id as string));
    for (const raw of rows as unknown as { id: string; course_id: string; trainee_id: string; referral_agency_id: string | null; enrollment_status: string; selling_price_centavos: number; courses: { delivery_type?: string; code?: string } | { delivery_type?: string; code?: string }[] | null; trainees: { marketing_agency_id?: string | null } | { marketing_agency_id?: string | null }[] | null }[]) {
      if (already.has(raw.id) || raw.enrollment_status === "Cancelled") continue;
      const trainee = Array.isArray(raw.trainees) ? raw.trainees[0] : raw.trainees;
      const agencyId = raw.referral_agency_id ?? trainee?.marketing_agency_id ?? null;
      if (!agencyId) continue;
      const { data: matrix } = await db.from("agency_course_rebates").select("agency_id,course_id,rebate_centavos").eq("agency_id", agencyId).eq("course_id", raw.course_id);
      // Percentage of the fee (202610080025); the peso table before it or when not set.
      const { data: pctRow } = await db.from("marketing_agencies").select("rebate_percent").eq("id", agencyId).maybeSingle();
      const course = Array.isArray(raw.courses) ? raw.courses[0] : raw.courses;
      const rebate = referralRebate({ percent: Number((pctRow as { rebate_percent?: number | null } | null)?.rebate_percent ?? 0) || null, inHouse: course?.delivery_type === "In-House", courseCode: course?.code ?? null, feeCentavos: Number(raw.selling_price_centavos), matrixCentavos: rebateFor(agencyId, raw.course_id, (matrix ?? []) as { agency_id: string; course_id: string; rebate_centavos: number }[]) });
      if (rebate <= 0) continue;
      // Deducted or No deduction (202610080024); Deducted before it.
      const { data: modeRow } = await db.from("marketing_agencies").select("rebate_mode").eq("id", agencyId).maybeSingle();
      const action = referralAction((modeRow as { rebate_mode?: string } | null)?.rebate_mode, !!options.paid);
      if (action === "skip") continue;
      // The agency_rebates row doubles as the "already applied" marker (one per enrollment).
      const { error: recordError } = await db.from("agency_rebates").insert({ agency_id: agencyId, enrollment_id: raw.id, trainee_id: raw.trainee_id, course_id: raw.course_id, rebate_centavos: rebate, status: action === "discount" ? "Paid" : "Pending", created_by: actor });
      if (recordError) continue; // another request got there first
      await db.from("agency_rebates").update({ settlement: action === "discount" ? "Deducted from the trainee's payment" : "Payable to the agency" }).eq("enrollment_id", raw.id); // 202610080023; ignored before it
      if (action === "payable") { applied.push(raw.id); continue; }
      const { data: agency } = await db.from("marketing_agencies").select("name").eq("id", agencyId).maybeSingle();
      await db.from("enrollment_charges").insert({ enrollment_id: raw.id, description: `Referral rebate (${agency?.name ?? "agency"})`, amount_centavos: rebate, event_type: "discount", valid: true, approval_status: "Approved", agency_id: agencyId, created_by: actor, decided_by: actor, decided_at: new Date().toISOString() });
      applied.push(raw.id);
    }
  } catch (e) {
    console.error("Referral rebate failed:", e instanceof Error ? e.message : e);
  }
  return applied;
}
