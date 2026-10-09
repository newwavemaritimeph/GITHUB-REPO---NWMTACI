import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createResourcePlanPdf } from "@/lib/print/resource-plan";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { planRows, type PlanBatch } from "@/lib/admin-assistant";

export const runtime = "nodejs";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Resource plan as PDF (owner, 9 Oct 2026): batches from `from` to `to`
 * grouped by start day, with classroom, students, instructor and notes
 * (missing, over capacity, accreditation, double bookings). A4 landscape.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "admin_assistant"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const from = url.searchParams.get("from") ?? today, to = url.searchParams.get("to") ?? from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const [batchRes, roomRes, insRes, accRes, planRes] = await Promise.all([
    db.from("batches").select("id,batch_number,course_id,starts_on,ends_on,capacity,confirmed_count,status,classroom_id,courses(code,name)").neq("status", "Cancelled").lte("starts_on", to).gte("ends_on", from).order("starts_on").limit(1000),
    db.from("classrooms").select("id,name,capacity").eq("active", true),
    db.from("instructors").select("id,complete_name"),
    db.from("instructor_accreditations").select("instructor_id,course_id,valid_until"),
    db.from("batch_resources").select("batch_id,classroom_id,instructor_id"),
  ]);
  if (batchRes.error) return NextResponse.json({ error: batchRes.error.message }, { status: 400 });
  const plans = new Map(((planRes.error ? [] : planRes.data) ?? []).map((p) => [p.batch_id as string, p]));
  const batches: PlanBatch[] = (batchRes.data ?? []).map((b) => {
    const c = one(b.courses as unknown as { code: string; name: string } | null);
    const p = plans.get(b.id as string);
    return { id: b.id as string, batchNumber: b.batch_number as string, courseId: b.course_id as string, courseCode: c?.code ?? "", courseName: c?.name ?? "", startsOn: b.starts_on as string, endsOn: b.ends_on as string, students: Number(b.confirmed_count ?? 0), capacity: Number(b.capacity ?? 24), classroomId: (p?.classroom_id as string | null) ?? (b.classroom_id as string | null) ?? null, instructorId: (p?.instructor_id as string | null) ?? null };
  });
  const rows = planRows(batches, (roomRes.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, capacity: Number(r.capacity) })), (insRes.error ? [] : insRes.data ?? []) as { id: string; complete_name: string }[], (accRes.error ? [] : accRes.data ?? []) as { instructor_id: string; course_id: string; valid_until: string | null }[]);

  const bytes = await createResourcePlanPdf(from, to, today, rows);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "report.exported", record_type: "report", record_id: `resource-plan:${from}:${to}`, new_values: { from, to, batches: rows.length } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="resource-plan-${from}-to-${to}.pdf"`, "cache-control": "no-store" } });
}
