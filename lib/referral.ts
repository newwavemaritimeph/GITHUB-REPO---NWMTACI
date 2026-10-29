import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isStcwRebateCourse } from "@/lib/rebates";

/**
 * Referral codes (owner, 8 Oct 2026). Each agency or consultancy has a secret
 * code, e.g. "QMCS050698". A trainee who registers with it is tagged as that
 * agency's referral, and the agency's rebate for the course is deducted from
 * what the trainee pays. Since 21 Oct 2026 only Qapla Maritime, Costa Maritime and
 * Tara Barko deduct on any payment; every other partner's rebate comes off once
 * the trainee has paid the fee less the rebate ("Deducted on full payment").
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
export const FULL_PAYMENT = "Deducted on full payment";
export function referralAction(mode: string | null | undefined, paid: boolean, fullyPaid = false): "discount" | "payable" | "skip" {
  if (mode === "Company Charge") return "skip"; // billed to the company at the full fee (29 Oct 2026)
  if (mode === "No deduction") return paid ? "payable" : "skip";
  if (mode === FULL_PAYMENT) return fullyPaid ? "discount" : "skip";
  return "discount";
}

/** The rebate to take off once the total paid reaches the fee less the rebate (never more than what is still owed), else 0. */
export function fullPaymentRebate(input: { due: number; rebate: number; paidTotal: number }) {
  if (input.rebate <= 0 || input.paidTotal < input.due - input.rebate) return 0;
  return Math.max(0, Math.min(input.rebate, input.due - input.paidTotal));
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
    const cols = "id,course_id,trainee_id,referral_agency_id,enrollment_status,selling_price_centavos,package_code,package_id,courses(delivery_type,code),trainees(marketing_agency_id)";
    let res: { data: unknown[] | null; error: unknown } = await db.from("enrollments").select(cols).in("id", enrollmentIds);
    if (res.error) res = await db.from("enrollments").select(cols.replace("package_code,package_id,", "")).in("id", enrollmentIds);
    if (res.error || !res.data?.length) return applied;
    let rows = res.data as unknown[];
    // CCI Package (21 Oct 2026): one rebate per package, on its Crisis enrollment, using the CCI rate.
    const pkgIds = [...new Set((rows as { package_id?: string | null }[]).map((r) => r.package_id).filter(Boolean) as string[])];
    let cciCourse: string | null = null;
    if (pkgIds.length) {
      const { data: mates } = await db.from("enrollments").select(cols).in("package_id", pkgIds);
      const seen = new Set((rows as { id: string }[]).map((r) => r.id));
      rows = [...rows, ...((mates ?? []) as { id: string }[]).filter((m) => !seen.has(m.id))];
      const { data: cci } = await db.from("courses").select("id").eq("code", "CCI").eq("delivery_type", "In-House").limit(1);
      cciCourse = (cci?.[0]?.id as string | undefined) ?? null;
    }
    enrollmentIds = (rows as { id: string }[]).map((r) => r.id);
    const { data: done } = await db.from("agency_rebates").select("enrollment_id").in("enrollment_id", enrollmentIds);
    const already = new Set((done ?? []).map((r) => r.enrollment_id as string));
    for (const raw of rows as unknown as { package_code?: string | null; package_id?: string | null; id: string; course_id: string; trainee_id: string; referral_agency_id: string | null; enrollment_status: string; selling_price_centavos: number; courses: { delivery_type?: string; code?: string } | { delivery_type?: string; code?: string }[] | null; trainees: { marketing_agency_id?: string | null } | { marketing_agency_id?: string | null }[] | null }[]) {
      if (already.has(raw.id) || raw.enrollment_status === "Cancelled") continue;
      const part = Array.isArray(raw.courses) ? raw.courses[0] : raw.courses;
      const inPackage = raw.package_code === "CCI" && !!raw.package_id;
      if (inPackage && (part?.code !== "PSCMHBT" || !cciCourse)) continue;
      const rateCourse = inPackage ? (cciCourse as string) : raw.course_id;
      const packageRows = inPackage ? (rows as { id: string; package_id?: string | null; selling_price_centavos: number }[]).filter((r) => r.package_id === raw.package_id) : [raw];
      const trainee = Array.isArray(raw.trainees) ? raw.trainees[0] : raw.trainees;
      const agencyId = raw.referral_agency_id ?? trainee?.marketing_agency_id ?? null;
      if (!agencyId) continue;
      const { data: matrix } = await db.from("agency_course_rebates").select("agency_id,course_id,rebate_centavos").eq("agency_id", agencyId).eq("course_id", rateCourse);
      // Percentage of the fee (202610080025); the peso table before it or when not set.
      const { data: pctRow } = await db.from("marketing_agencies").select("rebate_percent").eq("id", agencyId).maybeSingle();
      const course = Array.isArray(raw.courses) ? raw.courses[0] : raw.courses;
      const rebate = referralRebate({ percent: Number((pctRow as { rebate_percent?: number | null } | null)?.rebate_percent ?? 0) || null, inHouse: course?.delivery_type === "In-House", courseCode: inPackage ? "CCI" : course?.code ?? null, feeCentavos: Number(raw.selling_price_centavos), matrixCentavos: rebateFor(agencyId, rateCourse, (matrix ?? []) as { agency_id: string; course_id: string; rebate_centavos: number }[]) });
      if (rebate <= 0) continue;
      // Deducted or No deduction (202610080024); Deducted before it.
      const { data: modeRow } = await db.from("marketing_agencies").select("rebate_mode").eq("id", agencyId).maybeSingle();
      const mode = (modeRow as { rebate_mode?: string } | null)?.rebate_mode;
      let amount = rebate;
      if (mode === FULL_PAYMENT) {
        if (!options.paid) continue;
        const [{ data: ch }, { data: al }] = await Promise.all([
          db.from("enrollment_charges").select("amount_centavos,event_type").in("enrollment_id", packageRows.map((r) => r.id)).eq("valid", true),
          db.from("payment_allocations").select("amount_centavos,payments!inner(valid)").in("enrollment_id", packageRows.map((r) => r.id)).eq("payments.valid", true),
        ]);
        const due = packageRows.reduce((t, r) => t + Number(r.selling_price_centavos), 0) + ((ch ?? []) as { amount_centavos: number; event_type: string }[]).reduce((t, c) => t + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos), 0);
        const paidTotal = ((al ?? []) as { amount_centavos: number }[]).reduce((t, a) => t + Number(a.amount_centavos), 0);
        amount = fullPaymentRebate({ due, rebate, paidTotal });
      }
      const action = referralAction(mode, !!options.paid, amount > 0);
      if (action === "skip") continue;
      // The agency_rebates row doubles as the "already applied" marker (one per enrollment).
      const { error: recordError } = await db.from("agency_rebates").insert({ agency_id: agencyId, enrollment_id: raw.id, trainee_id: raw.trainee_id, course_id: raw.course_id, rebate_centavos: amount, status: action === "discount" ? "Paid" : "Pending", created_by: actor });
      if (recordError) continue; // another request got there first
      await db.from("agency_rebates").update({ settlement: action === "discount" ? "Deducted from the trainee's payment" : "Payable to the agency" }).eq("enrollment_id", raw.id); // 202610080023; ignored before it
      if (action === "payable") { applied.push(raw.id); continue; }
      const { data: agency } = await db.from("marketing_agencies").select("name").eq("id", agencyId).maybeSingle();
      await db.from("enrollment_charges").insert({ enrollment_id: raw.id, description: `Referral rebate (${agency?.name ?? "agency"})`, amount_centavos: amount, event_type: "discount", valid: true, approval_status: "Approved", agency_id: agencyId, created_by: actor, decided_by: actor, decided_at: new Date().toISOString() });
      applied.push(raw.id);
    }
  } catch (e) {
    console.error("Referral rebate failed:", e instanceof Error ? e.message : e);
  }
  return applied;
}

/**
 * Rebates waiting for full payment, per enrollment (for the Cashier's Record Payment):
 * partner on "Deducted on full payment", not applied yet. Batched reads.
 */
export async function pendingFullPaymentRebates(db: Admin, enrollments: { id: string; course_id: string; agency_id: string | null; price: number; inHouse: boolean; code: string | null }[]) {
  const out: Record<string, number> = {};
  const withAgency = enrollments.filter((e) => e.agency_id);
  if (!withAgency.length) return out;
  try {
    const agencyIds = [...new Set(withAgency.map((e) => e.agency_id as string))];
    const { data: agencies, error } = await db.from("marketing_agencies").select("id,rebate_mode,rebate_percent").in("id", agencyIds);
    if (error) return out;
    const full = new Map(((agencies ?? []) as { id: string; rebate_mode?: string | null; rebate_percent?: number | null }[]).filter((a) => a.rebate_mode === FULL_PAYMENT).map((a) => [a.id, a]));
    const mine = withAgency.filter((e) => full.has(e.agency_id as string));
    if (!mine.length) return out;
    const [{ data: matrix }, { data: done }] = await Promise.all([
      db.from("agency_course_rebates").select("agency_id,course_id,rebate_centavos").in("agency_id", [...full.keys()]),
      db.from("agency_rebates").select("enrollment_id").in("enrollment_id", mine.map((e) => e.id)),
    ]);
    const applied = new Set((done ?? []).map((r) => r.enrollment_id as string));
    for (const e of mine) {
      if (applied.has(e.id)) continue;
      const a = full.get(e.agency_id as string)!;
      const rebate = referralRebate({ percent: Number(a.rebate_percent ?? 0) || null, inHouse: e.inHouse, courseCode: e.code, feeCentavos: e.price, matrixCentavos: rebateFor(e.agency_id as string, e.course_id, (matrix ?? []) as { agency_id: string; course_id: string; rebate_centavos: number }[]) });
      if (rebate > 0) out[e.id] = rebate;
    }
  } catch { /* the hint is optional */ }
  return out;
}
