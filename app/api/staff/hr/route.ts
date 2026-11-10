import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canHr, employeeAccounts, manilaToday, notifyEmployees, notifyHr } from "@/lib/hr-server";

export const runtime = "nodejs";

/**
 * HR Module, Phase 1 (owner, 10 Nov 2026). HR Officer and Admin: 201 details, accept a Medical Fit to Work,
 * remind employees, issue memos, decide 201 change requests, reminder settings.
 * Every employee (any staff role): confirm the biodata, file a 201 change, acknowledge a memo.
 * Each change is written to the audit log.
 */
const day = z.string().date();
const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hr-201-save"), employeeId: z.string().uuid(), birthDate: day.optional().nullable(), sex: opt(20), civilStatus: opt(30), address: opt(300), mobile: opt(30), personalEmail: opt(160), employmentType: z.enum(["Probationary", "Regular", "Project", "Contractual"]), biometricId: opt(40), regularizationDate: day.optional().nullable(), fitToWorkOn: day.optional().nullable() }),
  z.object({ action: z.literal("hr-fit-decide"), employeeId: z.string().uuid(), decision: z.enum(["Accept", "Return"]), reason: z.string().trim().max(300).optional().default("") }),
  z.object({ action: z.literal("hr-remind"), employeeIds: z.array(z.string().uuid()).min(1).max(60), kind: z.enum(["fit_to_work", "biodata"]) }),
  z.object({ action: z.literal("hr-settings-save"), fitToWorkMonths: z.number().int().min(1).max(24), biodataMonths: z.number().int().min(1).max(24), firstReminderDays: z.number().int().min(1).max(90), repeatDays: z.number().int().min(1).max(30), includeInDailyEmail: z.boolean() }),
  z.object({ action: z.literal("hr-request-decide"), id: z.string().uuid(), decision: z.enum(["Approved", "Rejected"]), remarks: z.string().trim().max(300).optional().default("") }),
  z.object({ action: z.literal("memo-issue"), memoType: z.enum(["General Announcement", "Policy", "Office Order", "Schedule / Holiday Advisory", "Reminder"]), subject: z.string().trim().min(3).max(160), body: z.string().trim().min(5).max(8000), employeeIds: z.array(z.string().uuid()).max(200).default([]) }),
  z.object({ action: z.literal("myhr-biodata-confirm") }),
  z.object({ action: z.literal("myhr-request-file"), requestType: z.enum(["201 Change"]), details: z.string().trim().min(5).max(1000) }),
  z.object({ action: z.literal("memo-ack"), memoId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details." }, { status: 400 });
  const body = parsed.data;
  const db = createSupabaseAdminClient();
  const origin = new URL(request.url).origin;
  const actorRole = staff.roleCodes.includes("admin") ? "admin" : staff.roleCodes.includes("hr") ? "hr" : staff.roleCodes[0];
  const audit = (action: string, recordType: string, recordId: string, prior: unknown, next: unknown, reason?: string) =>
    db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: actorRole, action, record_type: recordType, record_id: recordId, prior_values: prior ?? null, new_values: next ?? null, reason: reason || null });
  const fail = (e: { message: string } | null) => NextResponse.json({ error: e && /column|relation|does not exist/i.test(e.message) ? "Apply database update 202611100095 first." : e?.message ?? "Could not save." }, { status: 400 });

  // ---- Employee self-service (any staff member with a linked employee record) ----
  if (body.action === "myhr-biodata-confirm" || body.action === "myhr-request-file" || body.action === "memo-ack") {
    const { data: emp } = await db.from("employees").select("id,complete_name,biodata_confirmed_at").ilike("work_email", staff.user.email ?? "___none___").maybeSingle();
    if (!emp) return NextResponse.json({ error: "No employee record is linked to your account. Ask HR to add you." }, { status: 400 });
    if (body.action === "myhr-biodata-confirm") {
      const now = new Date().toISOString();
      const { error } = await db.from("employees").update({ biodata_confirmed_at: now }).eq("id", emp.id);
      if (error) return fail(error);
      await audit("hr.biodata_confirmed", "employee", emp.id, { biodata_confirmed_at: emp.biodata_confirmed_at }, { biodata_confirmed_at: now });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "myhr-request-file") {
      const { data: ref, error: refErr } = await db.rpc("next_reference", { prefix: "RQ" });
      if (refErr) return fail(refErr);
      const requestNo = `NWM-${String(ref).replace(/-0*(\d+)$/, (_, n: string) => `-${n.padStart(4, "0")}`)}`;
      const { data: row, error } = await db.from("hr_requests").insert({ request_no: requestNo, employee_id: emp.id, request_type: body.requestType, details: body.details }).select("id").single();
      if (error) return fail(error);
      await audit("hr.request_filed", "hr_request", row.id, null, { request_no: requestNo, request_type: body.requestType, details: body.details });
      await notifyHr(db, `${body.requestType}: ${emp.complete_name}`, body.details.slice(0, 180), "hr_request", row.id);
      return NextResponse.json({ ok: true, requestNo });
    }
    const { data: rec } = await db.from("memo_recipients").select("acknowledged_at").eq("memo_id", body.memoId).eq("employee_id", emp.id).maybeSingle();
    if (!rec) return NextResponse.json({ error: "This memo was not sent to you." }, { status: 404 });
    if (rec.acknowledged_at) return NextResponse.json({ ok: true });
    const now = new Date().toISOString();
    const { error } = await db.from("memo_recipients").update({ acknowledged_at: now }).eq("memo_id", body.memoId).eq("employee_id", emp.id).is("acknowledged_at", null);
    if (error) return fail(error);
    await audit("hr.memo_acknowledged", "memo", body.memoId, null, { employee_id: emp.id, acknowledged_at: now });
    return NextResponse.json({ ok: true });
  }

  // ---- HR Officer and Admin ----
  if (!canHr(staff.roleCodes)) return NextResponse.json({ error: "Only the HR Officer or the Admin can do this." }, { status: 403 });

  if (body.action === "hr-201-save") {
    const cols = "id,birth_date,sex,civil_status,address,mobile,personal_email,employment_type,biometric_id,regularization_date,fit_to_work_on";
    const { data: prior, error: pe } = await db.from("employees").select(cols).eq("id", body.employeeId).maybeSingle();
    if (pe) return fail(pe);
    if (!prior) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    const next = { birth_date: body.birthDate ?? null, sex: body.sex, civil_status: body.civilStatus, address: body.address, mobile: body.mobile, personal_email: body.personalEmail, employment_type: body.employmentType, biometric_id: body.biometricId, regularization_date: body.regularizationDate ?? null, fit_to_work_on: body.fitToWorkOn ?? null };
    if (next.fit_to_work_on && next.fit_to_work_on > manilaToday()) return NextResponse.json({ error: "The Fit to Work date cannot be in the future." }, { status: 400 });
    const { error } = await db.from("employees").update(next).eq("id", body.employeeId);
    if (error) return /biometric/i.test(error.message) ? NextResponse.json({ error: "Another employee already has this biometric ID." }, { status: 400 }) : fail(error);
    await audit("hr.201_saved", "employee", body.employeeId, prior, next);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "hr-fit-decide") {
    const { data: emp, error: ee } = await db.from("employees").select("id,complete_name,fit_to_work_on,fit_to_work_path,fit_to_work_pending_on,fit_to_work_pending_path").eq("id", body.employeeId).maybeSingle();
    if (ee) return fail(ee);
    if (!emp?.fit_to_work_pending_on) return NextResponse.json({ error: "There is no new certificate waiting for checking." }, { status: 400 });
    if (body.decision === "Return" && !body.reason) return NextResponse.json({ error: "Give the reason, so the employee knows what to fix." }, { status: 400 });
    const next = body.decision === "Accept"
      ? { fit_to_work_on: emp.fit_to_work_pending_on, fit_to_work_path: emp.fit_to_work_pending_path, fit_to_work_pending_on: null, fit_to_work_pending_path: null }
      : { fit_to_work_pending_on: null, fit_to_work_pending_path: null };
    const { error } = await db.from("employees").update(next).eq("id", emp.id);
    if (error) return fail(error);
    await audit(body.decision === "Accept" ? "hr.fit_to_work_accepted" : "hr.fit_to_work_returned", "employee", emp.id, { fit_to_work_on: emp.fit_to_work_on, pending: emp.fit_to_work_pending_on }, next, body.reason);
    const people = await employeeAccounts(db, [emp.id]);
    await notifyEmployees(db, people, body.decision === "Accept"
      ? { type: "hr", title: "Medical Fit to Work Accepted", body: `HR accepted your Medical Fit to Work dated ${emp.fit_to_work_pending_on}.`, key: `fit-accepted:${emp.id}:${emp.fit_to_work_pending_on}`, origin }
      : { type: "hr", title: "Medical Fit to Work Returned", body: `HR returned your Medical Fit to Work: ${body.reason}. Please upload it again in MyHR.`, key: `fit-returned:${emp.id}:${Date.now()}`, origin });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "hr-remind") {
    const people = await employeeAccounts(db, body.employeeIds);
    if (!people.length) return NextResponse.json({ error: "Employees not found." }, { status: 404 });
    const { error } = await db.from("hr_reminders").insert(people.map((p) => ({ employee_id: p.id, reminder_type: body.kind, sent_by: staff.user.id })));
    if (error) return fail(error);
    const fit = body.kind === "fit_to_work";
    await notifyEmployees(db, people, {
      type: "hr", origin, key: `remind:${body.kind}:${Date.now()}`,
      title: fit ? "Medical Fit to Work Due" : "Please Review Your Biodata",
      body: fit ? "Your semi-annual Medical Fit to Work is due. Upload your new certificate in MyHR › My 201." : "Your semi-annual biodata review is due. Open MyHR › My 201, check your details, then tap Confirm No Changes or Request a Change.",
    });
    await audit("hr.reminder_sent", "employee", people.map((p) => p.id).join(","), null, { kind: body.kind, employees: people.map((p) => p.name), without_account: people.filter((p) => !p.profileId && !p.email).map((p) => p.name) });
    return NextResponse.json({ ok: true, sent: people.length, noAccount: people.filter((p) => !p.profileId && !p.email).map((p) => p.name) });
  }

  if (body.action === "hr-settings-save") {
    const { data: prior } = await db.from("hr_settings").select("*").eq("id", true).maybeSingle();
    const next = { id: true, fit_to_work_months: body.fitToWorkMonths, biodata_months: body.biodataMonths, first_reminder_days: body.firstReminderDays, repeat_days: body.repeatDays, include_in_daily_email: body.includeInDailyEmail, updated_by: staff.user.id, updated_at: new Date().toISOString() };
    const { error } = await db.from("hr_settings").upsert(next);
    if (error) return fail(error);
    await audit("hr.settings_saved", "hr_settings", "1", prior, next);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "hr-request-decide") {
    const { data: req, error: re } = await db.from("hr_requests").select("id,request_no,employee_id,request_type,status").eq("id", body.id).maybeSingle();
    if (re) return fail(re);
    if (!req || req.status !== "Pending") return NextResponse.json({ error: "This request was already decided." }, { status: 400 });
    if (body.decision === "Rejected" && !body.remarks) return NextResponse.json({ error: "Give the reason for rejecting." }, { status: 400 });
    const now = new Date().toISOString();
    const { error } = await db.from("hr_requests").update({ status: body.decision, decided_by: staff.user.id, decided_at: now, decision_remarks: body.remarks || null }).eq("id", req.id).eq("status", "Pending");
    if (error) return fail(error);
    // An approved 201 change counts as the biodata review (HR updates the 201 details from it).
    if (body.decision === "Approved" && req.request_type === "201 Change") await db.from("employees").update({ biodata_confirmed_at: now }).eq("id", req.employee_id);
    await audit(`hr.request_${body.decision.toLowerCase()}`, "hr_request", req.id, { status: "Pending" }, { status: body.decision }, body.remarks);
    await notifyEmployees(db, await employeeAccounts(db, [req.employee_id]), { type: "hr", origin, key: `request:${req.id}:${body.decision}`, title: `${req.request_type} ${body.decision}`, body: `${req.request_no} was ${body.decision.toLowerCase()}${body.remarks ? `: ${body.remarks}` : "."}` });
    return NextResponse.json({ ok: true });
  }

  // memo-issue
  const { data: all } = await db.from("employees").select("id").eq("active", true);
  const recipients = body.employeeIds.length ? body.employeeIds : (all ?? []).map((e) => e.id as string);
  if (!recipients.length) return NextResponse.json({ error: "There are no active employees to send it to." }, { status: 400 });
  const { data: ref, error: refErr } = await db.rpc("next_reference", { prefix: "MEMO" });
  if (refErr) return fail(refErr);
  const memoNo = `NWM-${String(ref).replace(/-0*(\d+)$/, (_, n: string) => `-${n.padStart(3, "0")}`)}`;
  const { data: memo, error } = await db.from("memos").insert({ memo_no: memoNo, memo_type: body.memoType, subject: body.subject, body: body.body, audience: body.employeeIds.length ? `${recipients.length} Selected` : "All Employees", issued_by: staff.user.id }).select("id").single();
  if (error) return fail(error);
  const { error: re } = await db.from("memo_recipients").insert(recipients.map((id) => ({ memo_id: memo.id, employee_id: id })));
  if (re) return fail(re);
  await audit("hr.memo_issued", "memo", memo.id, null, { memo_no: memoNo, subject: body.subject, recipients: recipients.length });
  await notifyEmployees(db, await employeeAccounts(db, recipients), { type: "hr", origin, key: `memo:${memo.id}`, recordType: "memo", recordId: memo.id, title: `Memo ${memoNo}: ${body.subject}`, body: "A new memo is waiting in MyHR. Please read it and tap I Have Read and Understood." });
  return NextResponse.json({ ok: true, memoNo });
}
