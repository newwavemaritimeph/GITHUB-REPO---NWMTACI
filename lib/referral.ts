import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

/** The rebate configured for an agency and course (Configuration › Rebates per course), or 0. */
export function rebateFor(agencyId: string, courseId: string, matrix: { agency_id: string; course_id: string; rebate_centavos: number }[]) {
  return Number(matrix.find((m) => m.agency_id === agencyId && m.course_id === courseId)?.rebate_centavos ?? 0);
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
 * Deduct the referral rebate from each enrollment's fee, once (idempotent):
 * an approved discount on the enrollment, and the agency's rebate recorded as
 * settled by deduction. Enrollments without a referral or without a rebate set
 * for their course are left alone. Best-effort: never blocks a payment.
 */
export async function applyReferralRebates(db: Admin, enrollmentIds: string[], actor: string | null) {
  const applied: string[] = [];
  if (!enrollmentIds.length) return applied;
  try {
    const { data: rows, error } = await db.from("enrollments").select("id,course_id,trainee_id,referral_agency_id,enrollment_status,trainees(marketing_agency_id)").in("id", enrollmentIds);
    if (error || !rows?.length) return applied;
    const { data: done } = await db.from("agency_rebates").select("enrollment_id").in("enrollment_id", enrollmentIds);
    const already = new Set((done ?? []).map((r) => r.enrollment_id as string));
    for (const raw of rows as unknown as { id: string; course_id: string; trainee_id: string; referral_agency_id: string | null; enrollment_status: string; trainees: { marketing_agency_id?: string | null } | { marketing_agency_id?: string | null }[] | null }[]) {
      if (already.has(raw.id) || raw.enrollment_status === "Cancelled") continue;
      const trainee = Array.isArray(raw.trainees) ? raw.trainees[0] : raw.trainees;
      const agencyId = raw.referral_agency_id ?? trainee?.marketing_agency_id ?? null;
      if (!agencyId) continue;
      const { data: matrix } = await db.from("agency_course_rebates").select("agency_id,course_id,rebate_centavos").eq("agency_id", agencyId).eq("course_id", raw.course_id);
      const rebate = rebateFor(agencyId, raw.course_id, (matrix ?? []) as { agency_id: string; course_id: string; rebate_centavos: number }[]);
      if (rebate <= 0) continue;
      // The payable row doubles as the "already deducted" marker (one per enrollment).
      const { error: recordError } = await db.from("agency_rebates").insert({ agency_id: agencyId, enrollment_id: raw.id, trainee_id: raw.trainee_id, course_id: raw.course_id, rebate_centavos: rebate, status: "Paid", created_by: actor });
      if (recordError) continue; // another request got there first
      await db.from("agency_rebates").update({ settlement: "Deducted from the trainee's payment" }).eq("enrollment_id", raw.id); // 202610080023; ignored before it
      const { data: agency } = await db.from("marketing_agencies").select("name").eq("id", agencyId).maybeSingle();
      await db.from("enrollment_charges").insert({ enrollment_id: raw.id, description: `Referral rebate (${agency?.name ?? "agency"})`, amount_centavos: rebate, event_type: "discount", valid: true, approval_status: "Approved", agency_id: agencyId, created_by: actor, decided_by: actor, decided_at: new Date().toISOString() });
      applied.push(raw.id);
    }
  } catch (e) {
    console.error("Referral rebate failed:", e instanceof Error ? e.message : e);
  }
  return applied;
}
