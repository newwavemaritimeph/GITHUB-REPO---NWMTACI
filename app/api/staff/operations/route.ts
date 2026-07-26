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
  method: z.string().trim().min(1).max(80), receivingAccount: z.string().trim().min(2).max(120),
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
const expenseCreateInput = z.object({ action: z.literal("expense-create"), payee: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(80), amountCentavos: z.number().int().positive(), purpose: z.string().trim().min(1).max(300) });
const expenseDecideInput = z.object({ action: z.literal("expense-decide"), id: z.string().uuid(), decision: z.enum(["Approved", "Rejected", "Paid"]) });
const closingInput = z.object({ action: z.literal("cashier-close"), closingDate: z.string().date(), openingCashCentavos: z.number().int().nonnegative(), actualCashCentavos: z.number().int().nonnegative(), remarks: z.string().trim().max(500).optional().default("") });
// Other charges + agency rebates posted to an enrollment ledger (enrollment_charges).
// A charge adds to the amount due; a discount (rebate) subtracts. Both are append-only;
// corrections mark the row invalid rather than deleting it.
const enrollmentChargeInput = z.object({ action: z.literal("enrollment-charge"), enrollmentId: z.string().uuid(), chargeCatalogId: z.string().uuid().nullable().optional(), description: z.string().trim().min(1).max(200), amountCentavos: z.number().int().positive(), kind: z.enum(["charge", "discount"]).default("charge") });
const enrollmentChargeVoidInput = z.object({ action: z.literal("enrollment-charge-void"), id: z.string().uuid() });

// HR / payroll (Slice 1): attendance logging and leave / cash-advance filing + decisions.
const hm = /^\d{2}:\d{2}$/;
const hrAttendanceInput = z.object({ action: z.literal("hr-attendance-log"), employeeId: z.string().uuid(), attendanceDate: z.string().date(), scheduledIn: z.string().regex(hm).default("08:00"), scheduledOut: z.string().regex(hm).default("17:00"), timeIn: z.string().regex(hm).optional(), timeOut: z.string().regex(hm).optional(), remarks: z.string().trim().max(300).optional().default("") });
const leaveFileInput = z.object({ action: z.literal("leave-file"), employeeId: z.string().uuid(), leaveType: z.string().trim().min(1).max(60), startsOn: z.string().date(), endsOn: z.string().date(), reason: z.string().trim().min(1).max(300) });
const leaveDecideInput = z.object({ action: z.literal("leave-decide"), id: z.string().uuid(), decision: z.enum(["Approved", "Rejected"]) });
const advanceFileInput = z.object({ action: z.literal("advance-file"), employeeId: z.string().uuid(), amountCentavos: z.number().int().positive(), requestedOn: z.string().date() });
const advanceDecideInput = z.object({ action: z.literal("advance-decide"), id: z.string().uuid(), decision: z.enum(["Approved", "Rejected"]) });

const actionInput = z.union([batchInput, paymentInput, enrollmentInput, notificationInput, channelInput, chargeInput, agencyInput, payableInput, expenseCreateInput, expenseDecideInput, closingInput, enrollmentChargeInput, enrollmentChargeVoidInput, hrAttendanceInput, leaveFileInput, leaveDecideInput, advanceFileInput, advanceDecideInput]);

const canManageAccounting = (roles: string[]) => roles.some((role) => ["admin", "accounting"].includes(role));
const canManageHr = (roles: string[]) => roles.some((role) => ["admin", "hr"].includes(role));
const minutesOfDay = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const stampManila = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

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
    db.from("cashier_closings").select("id,closing_date,opening_cash_centavos,cash_collections_centavos,online_collections_centavos,refunds_centavos,expenses_centavos,expected_cash_centavos,actual_cash_centavos,variance_centavos,status,submitted_at").order("closing_date", { ascending: false }).limit(60),
    db.from("enrollment_charges").select("id,enrollment_id,charge_catalog_id,description,amount_centavos,event_type,created_at").eq("valid", true).order("created_at", { ascending: false }).limit(500),
  ]);
  const error = results.find((item) => item.error)?.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const [profile, courses, offers, trainees, batches, enrollmentsResult, payments, allocations, notifications,
    paymentMethods, charges, agencies, expenses, payables, cashierClosings, enrollmentCharges] = results;
  const paidByEnrollment = new Map<string, number>();
  for (const allocation of allocations.data ?? []) paidByEnrollment.set(allocation.enrollment_id, (paidByEnrollment.get(allocation.enrollment_id) ?? 0) + Number(allocation.amount_centavos));
  const chargesByEnrollment = new Map<string, number>();
  const discountsByEnrollment = new Map<string, number>();
  for (const row of enrollmentCharges.data ?? []) {
    const target = row.event_type === "discount" ? discountsByEnrollment : chargesByEnrollment;
    target.set(row.enrollment_id, (target.get(row.enrollment_id) ?? 0) + Number(row.amount_centavos));
  }
  const enrollments = (enrollmentsResult.data ?? []).map((row) => ({ ...row, paid_centavos: paidByEnrollment.get(row.id) ?? 0, charges_centavos: chargesByEnrollment.get(row.id) ?? 0, discounts_centavos: discountsByEnrollment.get(row.id) ?? 0 }));
  // HR datasets are sensitive (salaries, government IDs) — only HR and Admin receive them.
  const isHr = canManageHr(staff.roleCodes);
  let hr: Record<string, unknown[]> = { employees: [], employeeAttendance: [], leaveRequests: [], cashAdvances: [], payrollPeriods: [] };
  if (isHr) {
    const hrResults = await Promise.all([
      db.from("employees").select("id,employee_number,complete_name,position,employment_status,date_hired,pay_type,base_rate_centavos,instructor_daily_rate_centavos,work_email,active").order("complete_name"),
      db.from("employee_attendance").select("id,employee_id,attendance_date,checked_in_at,checked_out_at,minutes_late,minutes_undertime,status,remarks").order("attendance_date", { ascending: false }).limit(300),
      db.from("leave_requests").select("id,employee_id,leave_type,starts_on,ends_on,reason,status,created_at").order("created_at", { ascending: false }).limit(200),
      db.from("cash_advances").select("id,employee_id,amount_centavos,requested_on,balance_centavos,status").order("requested_on", { ascending: false }).limit(200),
      db.from("payroll_periods").select("id,period_number,starts_on,ends_on,pay_date,status,finalized_at").order("starts_on", { ascending: false }).limit(60),
    ]);
    hr = { employees: hrResults[0].data ?? [], employeeAttendance: hrResults[1].data ?? [], leaveRequests: hrResults[2].data ?? [], cashAdvances: hrResults[3].data ?? [], payrollPeriods: hrResults[4].data ?? [] };
  }
  return NextResponse.json({ profile: profile.data ?? { complete_name: staff.user.email?.split("@")[0] ?? "Staff", email: staff.user.email }, roles: staff.roleCodes,
    courses: courses.data ?? [], offers: offers.data ?? [], trainees: trainees.data ?? [], batches: batches.data ?? [], enrollments,
    payments: payments.data ?? [], notifications: notifications.data ?? [],
    paymentMethods: paymentMethods.data ?? [], charges: charges.data ?? [], agencies: agencies.data ?? [],
    expenses: expenses.data ?? [], payables: payables.data ?? [], cashierClosings: cashierClosings.data ?? [], enrollmentCharges: enrollmentCharges.data ?? [],
    employees: hr.employees, employeeAttendance: hr.employeeAttendance, leaveRequests: hr.leaveRequests, cashAdvances: hr.cashAdvances, payrollPeriods: hr.payrollPeriods }, { headers: { "Cache-Control": "no-store" } });
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
    if (input.action === "expense-create") {
      if (!staff.roleCodes.some((role) => ["admin", "accounting", "cashier"].includes(role))) return NextResponse.json({ error: "Your account cannot raise expense vouchers." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { count } = await admin.from("expenses").select("id", { count: "exact", head: true });
      const expenseNumber = `CV-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(6, "0")}`;
      const { error } = await admin.from("expenses").insert({ expense_number: expenseNumber, payee: input.payee, category: input.category, amount_centavos: input.amountCentavos, purpose: input.purpose, status: "Pending", requested_by: staff.user.id });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "expense-decide") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot decide expenses." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const patch = input.decision === "Paid"
        ? { status: "Paid", paid_at: new Date().toISOString(), approved_by: staff.user.id }
        : { status: input.decision, approved_by: staff.user.id };
      const { error } = await admin.from("expenses").update(patch).eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "cashier-close") {
      if (!staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Your account cannot submit a cashier closing." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const start = `${input.closingDate}T00:00:00+08:00`;
      const end = `${input.closingDate}T23:59:59.999+08:00`;
      const { data: dayPayments } = await admin.from("payments").select("amount_centavos,method").eq("valid", true).gte("received_at", start).lte("received_at", end);
      const cash = (dayPayments ?? []).filter((p) => p.method === "Cash").reduce((s, p) => s + Number(p.amount_centavos), 0);
      const online = (dayPayments ?? []).filter((p) => p.method !== "Cash").reduce((s, p) => s + Number(p.amount_centavos), 0);
      const { data: dayExpenses } = await admin.from("expenses").select("amount_centavos").eq("status", "Paid").gte("paid_at", start).lte("paid_at", end);
      const expensesTotal = (dayExpenses ?? []).reduce((s, e) => s + Number(e.amount_centavos), 0);
      const refunds = 0;
      const expected = input.openingCashCentavos + cash - expensesTotal - refunds;
      const variance = input.actualCashCentavos - expected;
      const { error } = await admin.from("cashier_closings").insert({ cashier_id: staff.user.id, closing_date: input.closingDate, opening_cash_centavos: input.openingCashCentavos, cash_collections_centavos: cash, online_collections_centavos: online, refunds_centavos: refunds, expenses_centavos: expensesTotal, expected_cash_centavos: expected, actual_cash_centavos: input.actualCashCentavos, variance_centavos: variance, status: "Submitted", submitted_at: new Date().toISOString(), remarks: input.remarks || null });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "enrollment-charge") {
      const isDiscount = input.kind === "discount";
      // Charges may be added by any cashier/accounting/admin; discounts (rebates)
      // are sensitive and restricted to Accounting/Admin.
      const allowed = isDiscount ? canManageAccounting(staff.roleCodes) : staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role));
      if (!allowed) return NextResponse.json({ error: isDiscount ? "Only Accounting or Admin can post a rebate." : "Your account cannot post charges." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("enrollment_charges").insert({ enrollment_id: input.enrollmentId, charge_catalog_id: input.chargeCatalogId ?? null, description: input.description, amount_centavos: input.amountCentavos, event_type: isDiscount ? "discount" : "charge", created_by: staff.user.id });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "enrollment-charge-void") {
      if (!canManageAccounting(staff.roleCodes)) return NextResponse.json({ error: "Only Accounting or Admin can void a charge or rebate." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("enrollment_charges").update({ valid: false }).eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "hr-attendance-log") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot record HR attendance." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const minutesLate = input.timeIn ? Math.max(0, minutesOfDay(input.timeIn) - minutesOfDay(input.scheduledIn)) : 0;
      const minutesUndertime = input.timeOut ? Math.max(0, minutesOfDay(input.scheduledOut) - minutesOfDay(input.timeOut)) : 0;
      const status = !input.timeIn ? "Absent" : minutesLate > 0 ? "Late" : "Present";
      const row = {
        employee_id: input.employeeId, attendance_date: input.attendanceDate,
        checked_in_at: input.timeIn ? stampManila(input.attendanceDate, input.timeIn) : null,
        checked_out_at: input.timeOut ? stampManila(input.attendanceDate, input.timeOut) : null,
        minutes_late: minutesLate, minutes_undertime: minutesUndertime, status, remarks: input.remarks || null,
      };
      const { data: existing } = await admin.from("employee_attendance").select("id").eq("employee_id", input.employeeId).eq("attendance_date", input.attendanceDate).maybeSingle();
      const { error } = existing ? await admin.from("employee_attendance").update(row).eq("id", existing.id) : await admin.from("employee_attendance").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "leave-file") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot file leave." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("leave_requests").insert({ employee_id: input.employeeId, leave_type: input.leaveType, starts_on: input.startsOn, ends_on: input.endsOn, reason: input.reason, status: "Pending" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "leave-decide") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot decide leave." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("leave_requests").update({ status: input.decision, approved_by: staff.user.id }).eq("id", input.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "advance-file") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot file cash advances." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("cash_advances").insert({ employee_id: input.employeeId, amount_centavos: input.amountCentavos, balance_centavos: input.amountCentavos, requested_on: input.requestedOn, status: "Pending" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (input.action === "advance-decide") {
      if (!canManageHr(staff.roleCodes)) return NextResponse.json({ error: "Your account cannot decide cash advances." }, { status: 403 });
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("cash_advances").update({ status: input.decision, approved_by: staff.user.id }).eq("id", input.id);
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
    // Amount due = base selling price + other charges − rebates/discounts (valid rows only).
    const { data: chargeRows } = await admin.from("enrollment_charges").select("amount_centavos,event_type").eq("enrollment_id", input.enrollmentId).eq("valid", true);
    const chargeTotal = (chargeRows ?? []).filter((r) => r.event_type !== "discount").reduce((sum, r) => sum + Number(r.amount_centavos), 0);
    const discountTotal = (chargeRows ?? []).filter((r) => r.event_type === "discount").reduce((sum, r) => sum + Number(r.amount_centavos), 0);
    const due = Number(enrollment.selling_price_centavos) + chargeTotal - discountTotal;
    if (input.amountCentavos > due - paid) throw new Error("Payment exceeds the remaining enrollment balance.");
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
