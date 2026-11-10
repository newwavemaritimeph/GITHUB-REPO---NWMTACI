import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canHr, manilaToday, notifyHr } from "@/lib/hr-server";

export const runtime = "nodejs";

/**
 * Medical Fit to Work (owner, 10 Nov 2026). The employee uploads a new certificate in MyHR (PDF, JPEG or PNG,
 * up to 10 MB) into the private hr-files bucket; it waits for HR to accept it. HR, the Admin, or the employee
 * opens it through a 2-minute signed link, and every opening is in the audit log (Data Privacy Act).
 */
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: [string, string, (b: Uint8Array) => boolean][] = [
  ["application/pdf", "pdf", (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46],
  ["image/jpeg", "jpg", (b) => b[0] === 0xff && b[1] === 0xd8],
  ["image/png", "png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
];

async function selfEmployee(db: ReturnType<typeof createSupabaseAdminClient>, email: string | undefined) {
  const { data } = await db.from("employees").select("id,complete_name,fit_to_work_pending_path").ilike("work_email", email ?? "___none___").maybeSingle();
  return data;
}

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const db = createSupabaseAdminClient();
  const emp = await selfEmployee(db, staff.user.email);
  if (!emp) return NextResponse.json({ error: "No employee record is linked to your account. Ask HR to add you." }, { status: 400 });
  const form = await request.formData();
  const file = form.get("file");
  const issued = z.string().date().safeParse(form.get("certificateDate"));
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the certificate file." }, { status: 400 });
  if (!issued.success) return NextResponse.json({ error: "Enter the date on the certificate." }, { status: 400 });
  if (issued.data > manilaToday()) return NextResponse.json({ error: "The certificate date cannot be in the future." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "The file is larger than 10 MB." }, { status: 400 });
  const type = TYPES.find(([, , ok]) => ok(bytes));
  if (!type) return NextResponse.json({ error: "Upload a PDF, JPEG or PNG." }, { status: 400 });

  const path = `employees/${emp.id}/fit-to-work/${issued.data}-${Date.now()}.${type[1]}`;
  const up = await db.storage.from("hr-files").upload(path, bytes, { contentType: type[0], upsert: false });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 400 });
  const now = new Date().toISOString();
  const { error } = await db.from("employees").update({ fit_to_work_pending_on: issued.data, fit_to_work_pending_path: path, fit_to_work_uploaded_at: now }).eq("id", emp.id);
  if (error) { await db.storage.from("hr-files").remove([path]); return NextResponse.json({ error: /column/i.test(error.message) ? "Apply database update 202611100095 first." : error.message }, { status: 400 }); }
  // A replaced upload that HR never checked is removed; accepted certificates stay on file.
  if (emp.fit_to_work_pending_path) await db.storage.from("hr-files").remove([emp.fit_to_work_pending_path]);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes[0], action: "hr.fit_to_work_uploaded", record_type: "employee", record_id: emp.id, new_values: { certificate_date: issued.data, path } });
  await notifyHr(db, `Medical Fit to Work: ${emp.complete_name}`, `New certificate dated ${issued.data} is waiting for checking.`, "employee", emp.id);
  return NextResponse.json({ ok: true });
}

/** ?employeeId=…&which=pending|current → a 2-minute signed link. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const url = new URL(request.url);
  const id = z.string().uuid().safeParse(url.searchParams.get("employeeId"));
  const which = url.searchParams.get("which") === "current" ? "current" : "pending";
  if (!id.success) return NextResponse.json({ error: "Choose an employee." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: emp } = await db.from("employees").select("id,work_email,fit_to_work_path,fit_to_work_pending_path").eq("id", id.data).maybeSingle();
  if (!emp) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  const self = Boolean(staff.user.email && String(emp.work_email ?? "").toLowerCase() === staff.user.email.toLowerCase());
  if (!self && !canHr(staff.roleCodes)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const path = which === "current" ? emp.fit_to_work_path : emp.fit_to_work_pending_path;
  if (!path) return NextResponse.json({ error: "No file on record." }, { status: 404 });
  const signed = await db.storage.from("hr-files").createSignedUrl(path, 120);
  if (!signed.data?.signedUrl) return NextResponse.json({ error: "The file could not be opened." }, { status: 400 });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes[0], action: "hr.file_viewed", record_type: "employee", record_id: emp.id, new_values: { document: "Medical Fit to Work", which } });
  return NextResponse.redirect(signed.data.signedUrl);
}
