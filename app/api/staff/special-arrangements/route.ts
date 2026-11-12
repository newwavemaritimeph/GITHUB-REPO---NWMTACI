import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { specialDescription, specialNumber, specialProblem } from "@/lib/special-arrangements";

export const runtime = "nodejs";

/**
 * Special Arrangement fees (owner, 12 Nov 2026). Accounting or the Admin keep the rates and decide requests;
 * the Cashier (or Accounting / Admin) requests one for an enrollment. The request is a Pending, not-yet-valid
 * charge for the difference; approving makes it count in the balance. Decided requests are never edited.
 */
const id = z.string().uuid();
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rate-save"), id: id.optional().nullable(), courseId: id, arrangement: z.string().trim().min(2).max(60), priceCentavos: z.number().int().positive().max(10_000_000_00), active: z.boolean().default(true) }),
  z.object({ action: z.literal("request"), enrollmentId: id, rateId: id.optional().nullable(), priceCentavos: z.number().int().positive().max(10_000_000_00).optional().nullable(), agencyId: id.optional().nullable(), reason: z.string().trim().max(300).optional().default("") }),
  z.object({ action: z.literal("decide"), id, approve: z.boolean(), remarks: z.string().trim().max(500).optional().default("") }),
]);

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "accounting", "cashier"]);
  if (!staff) return NextResponse.json({ error: "Only the Cashier, Accounting or the Admin can work on special arrangements." }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details." }, { status: 400 });
  const body = parsed.data, db = createSupabaseAdminClient();
  const decider = staff.roleCodes.some((r) => ["admin", "accounting"].includes(r));
  const role = staff.roleCodes.includes("admin") ? "admin" : staff.roleCodes.includes("accounting") ? "accounting" : "cashier";
  const audit = (action: string, recordType: string, recordId: string, prior: unknown, next: unknown, reason?: string) =>
    db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: role, action, record_type: recordType, record_id: recordId, prior_values: prior ?? null, new_values: next ?? null, reason: reason || null });
  const fail = (e: { message: string; code?: string }) => NextResponse.json({ error: e.code === "23505" ? (/one_open_special/.test(e.message) ? "This enrollment already has a Special Arrangement waiting for approval." : "That course already has a rate with this arrangement name.") : /special_rates|arrangement|special_centavos|request_no/.test(e.message) ? "Apply database update 202611120101 first." : e.message }, { status: 400 });

  if (body.action === "rate-save") {
    if (!decider) return NextResponse.json({ error: "Only Accounting or the Admin can set special arrangement rates." }, { status: 403 });
    const row = { course_id: body.courseId, arrangement: body.arrangement, price_centavos: body.priceCentavos, active: body.active, updated_at: new Date().toISOString() };
    if (body.id) {
      const { data: prior } = await db.from("special_rates").select("course_id,arrangement,price_centavos,active").eq("id", body.id).maybeSingle();
      if (!prior) return NextResponse.json({ error: "Rate not found." }, { status: 404 });
      const { error } = await db.from("special_rates").update(row).eq("id", body.id);
      if (error) return fail(error);
      await audit("special_rate.update", "special_rate", body.id, prior, row);
      return NextResponse.json({ ok: true });
    }
    const { data, error } = await db.from("special_rates").insert({ ...row, created_by: staff.user.id }).select("id").single();
    if (error) return fail(error);
    await audit("special_rate.create", "special_rate", data.id, null, row);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "request") {
    const { data: e } = await db.from("enrollments").select("id,course_id,enrollment_status,selling_price_centavos,courses(code,name)").eq("id", body.enrollmentId).maybeSingle();
    if (!e) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
    if (e.enrollment_status === "Cancelled") return NextResponse.json({ error: "This enrollment is cancelled." }, { status: 400 });
    let rate: { id: string; arrangement: string; price_centavos: number } | null = null;
    if (body.rateId) {
      const { data: r, error } = await db.from("special_rates").select("id,course_id,arrangement,price_centavos,active").eq("id", body.rateId).maybeSingle();
      if (error) return fail(error);
      if (!r || !r.active || r.course_id !== e.course_id) return NextResponse.json({ error: "Choose a rate for this course from the list." }, { status: 400 });
      rate = { id: r.id, arrangement: r.arrangement, price_centavos: Number(r.price_centavos) };
    }
    const standard = Number(e.selling_price_centavos ?? 0), special = rate ? rate.price_centavos : Number(body.priceCentavos ?? 0);
    const open = await db.from("enrollment_charges").select("id").eq("enrollment_id", e.id).eq("approval_status", "Pending").not("arrangement", "is", null).limit(1);
    if (open.error) return fail(open.error);
    const problem = specialProblem({ standard, special, offList: !rate, reason: body.reason, openRequest: !!open.data?.length });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const course = (Array.isArray(e.courses) ? e.courses[0] : e.courses) as { code?: string | null; name?: string | null } | null;
    const agency = body.agencyId ? (await db.from("marketing_agencies").select("name").eq("id", body.agencyId).maybeSingle()).data?.name ?? null : null;
    const { data: ref, error: refErr } = await db.rpc("next_reference", { prefix: "SA" });
    if (refErr) return fail(refErr);
    const requestNo = specialNumber(String(ref)), arrangement = rate?.arrangement ?? "Other";
    const row = {
      enrollment_id: e.id, description: specialDescription(arrangement, course?.code ?? course?.name ?? "Course", agency), amount_centavos: special - standard,
      event_type: "charge", valid: false, approval_status: "Pending", agency_id: body.agencyId ?? null, created_by: staff.user.id,
      request_no: requestNo, special_rate_id: rate?.id ?? null, arrangement, standard_centavos: standard, special_centavos: special, reason: body.reason || null, off_list: !rate,
    };
    const { data, error } = await db.from("enrollment_charges").insert(row).select("id").single();
    if (error) return fail(error);
    await audit("special_arrangement.request", "enrollment_charge", data.id, null, row, body.reason);
    return NextResponse.json({ ok: true, requestNo, addsCentavos: special - standard });
  }

  if (!decider) return NextResponse.json({ error: "Only Accounting or the Admin can decide special arrangements." }, { status: 403 });
  if (!body.approve && body.remarks.length < 3) return NextResponse.json({ error: "Give the reason for rejecting." }, { status: 400 });
  const patch = { valid: body.approve, approval_status: body.approve ? "Approved" : "Rejected", decided_by: staff.user.id, decided_at: new Date().toISOString(), decision_remarks: body.remarks || null };
  // The Pending guard makes a double click or two people at once harmless.
  const { data: done, error } = await db.from("enrollment_charges").update(patch).eq("id", body.id).eq("approval_status", "Pending").not("arrangement", "is", null).select("id,request_no,amount_centavos").maybeSingle();
  if (error) return fail(error);
  if (!done) return NextResponse.json({ error: "This request was already decided. Refresh the page." }, { status: 409 });
  await audit(`special_arrangement.${body.approve ? "approve" : "reject"}`, "enrollment_charge", body.id, { approval_status: "Pending" }, patch, body.remarks);
  return NextResponse.json({ ok: true, requestNo: done.request_no });
}
