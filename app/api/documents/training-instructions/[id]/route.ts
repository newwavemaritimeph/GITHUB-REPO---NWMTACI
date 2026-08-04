import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTrainingInstructionsPdf } from "@/lib/documents";

export const runtime = "nodejs";
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const fmtDate = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${value}T00:00:00+08:00`)) : "");

/** Per-enrollment Training Instructions welcome letter (Option 1 design) with the
 * per-course template body + Google Classroom link, and batch date/time/classroom. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data } = await db.from("enrollments")
    .select("id,enrollment_number,course_id,created_at,scheduled_on,trainees(legal_first_name,legal_middle_name,legal_last_name),courses(name,code,google_classroom_link,delivery_type),batches(starts_on,ends_on,daily_start,daily_end,venue,classrooms(name))")
    .eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  const trainee = one(data.trainees);
  const course = one(data.courses);
  const batch = one(data.batches);
  const traineeName = trainee ? `${trainee.legal_first_name} ${trainee.legal_middle_name ?? ""} ${trainee.legal_last_name}`.replace(/\s+/g, " ").trim() : "Trainee";

  // Date of training: batch range, else the endorsed free date.
  const dateOfTraining = batch?.starts_on
    ? `${fmtDate(batch.starts_on)}${batch.ends_on && batch.ends_on !== batch.starts_on ? ` - ${fmtDate(batch.ends_on)}` : ""}`
    : data.scheduled_on ? fmtDate(data.scheduled_on) : "To be scheduled";
  const time = batch?.daily_start ? `${batch.daily_start.slice(0, 5)} - ${batch.daily_end?.slice(0, 5) ?? "17:00"}` : "8:00 AM - 5:00 PM";
  const classroom = one(batch?.classrooms)?.name ?? batch?.venue ?? "To be assigned";

  // Active per-course template (body stored as jsonb { text }).
  const { data: tpl } = await db.from("training_instruction_templates").select("subject,body").eq("course_id", data.course_id).eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  const body = tpl?.body && typeof tpl.body === "object" && "text" in (tpl.body as Record<string, unknown>) ? String((tpl.body as { text?: unknown }).text ?? "") : "";

  let logoBytes: Uint8Array | undefined;
  try { logoBytes = new Uint8Array(await (await fetch(new URL("/new-wave-emblem.png", request.url))).arrayBuffer()); } catch { logoBytes = undefined; }

  const bytes = await createTrainingInstructionsPdf({
    traineeName,
    courseName: course ? `${course.code ? course.code + " - " : ""}${course.name}` : "Training course",
    dateOfTraining,
    time,
    classroom,
    googleClassroomLink: course?.google_classroom_link ?? null,
    subject: tpl?.subject ?? "Training Instructions",
    body,
    reference: data.enrollment_number,
    issuedAt: new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date()),
    logoBytes,
  });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="training-instructions-${data.enrollment_number}.pdf"`, "cache-control": "private, no-store" } });
}
