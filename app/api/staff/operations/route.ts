import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const enrollmentInput = z.object({
  action: z.literal("create-enrollment"), existingTraineeId: z.string().uuid().nullable().optional(),
  firstName: z.string().trim().max(80).optional().default(""), middleName: z.string().trim().max(80).optional().default(""), lastName: z.string().trim().max(80).optional().default(""),
  birthDate: z.string().date().optional(), email: z.string().email().optional(), mobile: z.string().trim().min(7).max(30).optional(),
  courseId: z.string().uuid(), partnerOfferId: z.string().uuid().nullable().optional(), batchId: z.string().uuid().nullable().optional(),
}).superRefine((value, context) => {
  if (!value.existingTraineeId && (!value.birthDate || !value.email || !value.mobile || value.firstName.length < 2 || value.lastName.length < 2)) {
    context.addIssue({ code: "custom", message: "Complete the trainee's name, birth date, email, and mobile number." });
  }
});

const batchInput = z.object({
  action: z.literal("create-batch"), courseId: z.string().uuid(), partnerOfferId: z.string().uuid().nullable().optional(),
  instructorName: z.string().trim().min(2).max(160), instructorEmail: z.string().email(), roomName: z.string().trim().min(1).max(120),
  startsOn: z.string().date(), endsOn: z.string().date(), dailyStart: z.string().regex(/^\d{2}:\d{2}$/), dailyEnd: z.string().regex(/^\d{2}:\d{2}$/),
  mode: z.string().trim().min(2).max(80), venue: z.string().trim().min(1).max(160), capacity: z.literal(24),
  enrollmentDeadline: z.string().datetime({ offset: true }), publish: z.boolean().default(true),
});

const paymentInput = z.object({
  action: z.literal("post-payment"), enrollmentId: z.string().uuid(), amountCentavos: z.number().int().positive(),
  method: z.enum(["Cash", "GCash", "Bank transfer", "Other"]), receivingAccount: z.string().trim().min(2).max(120),
  referenceNumber: z.string().trim().max(80).optional().default(""), proofId: z.string().uuid().nullable().optional(),
  receivedAt: z.string().datetime({ offset: true }), remarks: z.string().trim().max(500).optional().default(""),
}).superRefine((value, context) => {
  if (["GCash", "Bank transfer"].includes(value.method) && !value.referenceNumber) context.addIssue({ code: "custom", message: "A transaction reference is required for GCash and bank transfers." });
});

const notificationInput = z.object({ action: z.literal("mark-notifications-read") });

// Accounting Setup CRUD (Slice 1). Admin / Accounting only; applied with the
// service-role admin client after an explicit role check.
const channelInput = z.object({ action: z.literal("channel-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(80), code: z.string().trim().max(40).optional(), requiresReference: z.boolean().default(false), allowsProof: z.boolean().default(true), active: z.boolean().optional() });
const chargeInput = z.object({ action: z.literal("charge-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(80), defaultAmountCentavos: z.number().int().nonnegative().default(0), active: z.boolean().optional() });
const agencyInput = z.object({ action: z.literal("agency-save"), id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(120), contactName: z.string().trim().max(120).optional(), email: z.string().email().optional().or(z.literal("")), mobile: z.string().trim().max(40).optional(), active: z.boolean().optional() });
const payableInput = z.object({ action: z.literal("payable-save"), id: z.string().uuid().nullable().optional(), description: z.string().trim().min(1).max(200), amountCentavos: z.number().int().positive().optional(), dueOn: z.string().date().nullable().optional(), remove: z.boolean().optional() });

const actionInput = z.union([batchInput, paymentInput, enrollmentInput, notificationInput, channelInput, chargeInput, agencyInput, payableInput]);

const canManageAccounting = (roles: string[]) => roles.some((role) => ["admin", "accounting"].includes(role));

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const db = createSupabaseAdminClient();
  const results = await Promise.all([
    db.from("profiles").select("complete_name,email").eq("id", staff.user.id).maybeSingle(),
    db.from("courses").select("id,code,name,delivery_type,duration_label,standard_price_centavos,active,course_categories(name)").eq("active", true).order("name"),
    db.from("partner_course_offers").select("id,course_id,duration_label,training_fee_centavos,rebate_centavos,partner_payable_centavos,partner_centers(name)").eq("active", true).order("training_fee_centavos"),
    db.from("trainees").select("id,trainee_number,legal_first_name,legal_middle_name,legal_last_name,birthdate,email,mobile,account_state,registered_at").neq("account_state", "Deactivated").order("created_at", { ascending: false }).limit(250),
    db.from("batches").select("id,batch_number,course_id,partner_offer_id,starts_on,ends_on,daily_start,daily_end,mode,venue,capacity,confirmed_count,enrollment_deadline,status,published_at,courses(name,code),partner_course_offers(partner_centers(name))").eq("active", true).order("starts_on", { ascending: true }).limit(250),
    db.from("enrollments").select("id,enrollment_number,trainee_id,course_id,partner_offer_id,batch_id,enrollment_status,selling_price_centavos,rebate_centavos,partner_payable_centavos,created_at,trainees(trainee_number,legal_first_name,legal_middle_name,legal_last_name,email,mobile),courses(name,code),batches(batch_number,starts_on,ends_on,mode,venue),partner_course_offers(partner_centers(name))").order("created_at", { ascending: false }).limit(250),
    db.from("payments").select("id,payment_number,trainee_id,amount_centavos,method,receiving_account,reference_number,proof_id,received_at,verification_state,remarks,valid,trainees(legal_first_name,legal_last_name)").eq("valid", true).order("received_at", { ascending: false }).limit(250),
    db.from("payment_allocations").select("payment_id,enrollment_id,amount_centavos"),
    db.from("notifications").select("id,title,body,deep_link,read_at,created_at").eq("recipient_id", staff.user.id).order("created_at", { ascending: false }).limit(20),
    // Accounting datasets (Slice 1): channels, charges, agencies, expenses, payables.
    db.from("payment_methods").select("id,code,name,requires_reference,allows_proof,active,sort_order").order("sort_order"),
    db.from("charge_catalog").select("id,name,default_amount_centavos,active,used_count").order("name"),
    db.from("marketing_agencies").select("id,name,contact_name,email,mobile,active").order("name"),
    db.from("expenses").select("id,expense_number,payee,category,amount_centavos,purpose,status,created_at").order("created_at", { ascending: false }).limit(250),
    db.from("payables").select("id,description,amount_centavos,due_on,status,partner_center_id,enrollment_id,created_at").order("created_at", { ascending: false }).limit(250),
  ]);
  const error = results.find((item) => item.error)?.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const [profile, courses, offers, trainees, batches, enrollmentsResult, payments, allocations, notifications,
    paymentMethods, charges, agencies, expenses, payables] = results;
  const paidByEnrollment = new Map<string, number>();
  for (const allocation of allocations.data ?? []) paidByEnrollment.set(allocation.enrollment_id, (paidByEnrollment.get(allocation.enrollment_id) ?? 0) + Number(allocation.amount_centavos));
  const enrollments = (enrollmentsResult.data ?? []).map((row) => ({ ...row, paid_centavos: paidByEnrollment.get(row.id) ?? 0 }));
  return NextResponse.json({ profile: profile.data ?? { complete_name: staff.user.email?.split("@")[0] ?? "Staff", email: staff.user.email }, roles: staff.roleCodes,
    courses: courses.data ?? [], offers: offers.data ?? [], trainees: trainees.data ?? [], batches: batches.data ?? [], enrollments,
    payments: payments.data ?? [], notifications: notifications.data ?? [],
    paymentMethods: paymentMethods.data ?? [], charges: charges.data ?? [], agencies: agencies.data ?? [],
    expenses: expenses.data ?? [], payables: payables.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const input = actionInput.parse(await request.json());
    const db = await createSupabaseServerClient();
    if (input.action === "mark-notifications-read") {
      const { error } = await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", staff.user.id).is("read_at", null);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "channel-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage payment channels." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, code: (input.code || input.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40), requires_reference: input.requiresReference, allows_proof: input.allowsProof, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("payment_methods").update(row).eq("id", input.id) : await admin.from("payment_methods").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "charge-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, default_amount_centavos: input.defaultAmountCentavos, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("charge_catalog").update(row).eq("id", input.id) : await admin.from("charge_catalog").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "agency-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage agencies." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const row = { name: input.name, contact_name: input.contactName || null, email: input.email || null, mobile: input.mobile || null, ...(input.active !== undefined ? { active: input.active } : {}) };
      const { error } = input.id ? await admin.from("marketing_agencies").update(row).eq("id", input.id) : await admin.from("marketing_agencies").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "payable-save") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot manage payables." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      if (input.remove && input.id) {
        const { error } = await admin.from("payables").delete().eq("id", input.id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      if (!input.amountCentavos) return NextResponse.json({ error: "Amount is required." }, { status: 400 });
      const row = { description: input.description, amount_centavos: input.amountCentavos, due_on: input.dueOn || null };
      const { error } = input.id ? await admin.from("payables").update(row).eq("id", input.id) : await admin.from("payables").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "create-batch") {
      if (!staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot create schedules." }, { status: 403 });
      const { data, error } = await db.rpc("create_training_batch", { target_course: input.courseId, target_partner_offer: input.partnerOfferId ?? null,
        target_instructor_name: input.instructorName, target_instructor_email: input.instructorEmail, target_room_name: input.roomName,
        target_starts_on: input.startsOn, target_ends_on: input.endsOn, target_daily_start: input.dailyStart, target_daily_end: input.dailyEnd,
        target_mode: input.mode, target_venue: input.venue, target_capacity: input.capacity, target_enrollment_deadline: input.enrollmentDeadline, target_publish: input.publish });
      if (error) throw error;
      return NextResponse.json({ ok: true, batch: data });
    }
    if (input.action === "create-enrollment") {
      if (!staff.roleCodes.some((role) => ["admin", "registration", "training_operations"].includes(role))) return NextResponse.json({ error: "Your account cannot create enrollments." }, { status: 403 });
      const { data, error } = await db.rpc("create_staff_enrollment", { target_existing_trainee: input.existingTraineeId ?? null,
        target_first_name: input.firstName, target_middle_name: input.middleName, target_last_name: input.lastName, target_birthdate: input.birthDate ?? "1900-01-01",
        target_email: input.email ?? "", target_mobile: input.mobile ?? "", target_course: input.courseId, target_partner_offer: input.partnerOfferId ?? null,
        target_batch: input.batchId ?? null, target_source: "Staff-assisted registration" });
      if (error) throw error;
      return NextResponse.json({ ok: true, enrollment: data });
    }
    if (!staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Your account cannot post payments." }, { status: 403 });
    const admin = createSupabaseAdminClient();
    const { data: enrollment, error: enrollmentError } = await admin.from("enrollments").select("id,trainee_id,selling_price_centavos").eq("id", input.enrollmentId).maybeSingle();
    if (enrollmentError || !enrollment) throw enrollmentError ?? new Error("Enrollment not found.");
    const { data: existingAllocations } = await admin.from("payment_allocations").select("amount_centavos,payments!inner(valid)").eq("enrollment_id", input.enrollmentId).eq("payments.valid", true);
    const paid = (existingAllocations ?? []).reduce((sum, item) => sum + Number(item.amount_centavos), 0);
    if (input.amountCentavos > Number(enrollment.selling_price_centavos) - paid) throw new Error("Payment exceeds the remaining enrollment balance.");
    if (input.proofId) {
      const { data: proof } = await admin.from("payment_proofs").select("id").eq("id", input.proofId).eq("verified_by", staff.user.id).maybeSingle();
      if (!proof) throw new Error("The uploaded proof is invalid or belongs to another cashier session.");
    }
    const { data, error } = await db.rpc("post_payment", { target_trainee: enrollment.trainee_id, target_amount_centavos: input.amountCentavos,
      target_method: input.method, target_receiving_account: input.receivingAccount, target_reference: input.referenceNumber || null,
      target_received_at: input.receivedAt, target_proof: input.proofId ?? null, target_allocations: [{ enrollment_id: input.enrollmentId, amount_centavos: input.amountCentavos }], target_remarks: input.remarks || null });
    if (error) throw error;
    return NextResponse.json({ ok: true, payment: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The operation could not be completed." }, { status: 400 });
  }
}
