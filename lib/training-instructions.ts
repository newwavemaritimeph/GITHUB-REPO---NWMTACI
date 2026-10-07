import { readFile } from "node:fs/promises";
import path from "node:path";
import { createTrainingInstructionsPdf } from "@/lib/documents";
import { classroomJoin, type ClassroomJoin } from "@/lib/classroom";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const fmtDate = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${value}T00:00:00+08:00`)) : "");

export type InstructionDetails = {
  enrollmentId: string; enrollmentNumber: string; enrollmentStatus: string;
  traineeName: string; traineeEmail: string | null;
  courseName: string; dates: string; time: string; classroom: string;
  join: ClassroomJoin; subject: string; body: string;
};

/** Everything the instructions PDF and email need for one enrollment, or null when it does not exist. */
export async function loadInstructionDetails(db: Admin, enrollmentId: string): Promise<InstructionDetails | null> {
  const { data } = await db.from("enrollments")
    .select("id,enrollment_number,enrollment_status,course_id,scheduled_on,trainees(legal_first_name,legal_middle_name,legal_last_name,email),courses(name,code,google_classroom_link,duration_label),batches(starts_on,ends_on,daily_start,daily_end,venue,classrooms(name))")
    .eq("id", enrollmentId).maybeSingle();
  if (!data) return null;
  const trainee = one(data.trainees), course = one(data.courses), batch = one(data.batches);
  // The class code column comes from migration 202610070012; tolerate its absence.
  const { data: codeRow } = await db.from("courses").select("google_classroom_code").eq("id", data.course_id).maybeSingle();
  const { data: tpl } = await db.from("training_instruction_templates").select("subject,body").eq("course_id", data.course_id).eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  const body = tpl?.body && typeof tpl.body === "object" && "text" in (tpl.body as Record<string, unknown>) ? String((tpl.body as { text?: unknown }).text ?? "") : "";
  return {
    enrollmentId: data.id, enrollmentNumber: data.enrollment_number, enrollmentStatus: data.enrollment_status,
    traineeName: trainee ? `${trainee.legal_first_name} ${trainee.legal_middle_name ?? ""} ${trainee.legal_last_name}`.replace(/\s+/g, " ").trim() : "Trainee",
    traineeEmail: trainee?.email ?? null,
    courseName: course ? `${course.code ? course.code + " - " : ""}${course.name}` : "Training course",
    // Batch range, else the picked / endorsed start date.
    dates: batch?.starts_on ? `${fmtDate(batch.starts_on)}${batch.ends_on && batch.ends_on !== batch.starts_on ? ` - ${fmtDate(batch.ends_on)}` : ""}` : data.scheduled_on ? fmtDate(data.scheduled_on) : "To be scheduled",
    time: batch?.daily_start ? `${batch.daily_start.slice(0, 5)} - ${batch.daily_end?.slice(0, 5) ?? "17:00"}` : "8:00 AM - 5:00 PM",
    classroom: one(batch?.classrooms)?.name ?? batch?.venue ?? "To be assigned",
    join: classroomJoin(course?.google_classroom_link, (codeRow as { google_classroom_code?: string | null } | null)?.google_classroom_code),
    subject: tpl?.subject ?? "Training Instructions",
    body,
  };
}

async function logoBytes(origin?: string) {
  try { return new Uint8Array(await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png"))); } catch { /* not bundled: fetch it */ }
  const base = origin ?? process.env.APP_BASE_URL;
  if (!base) return undefined;
  try { return new Uint8Array(await (await fetch(new URL("/new-wave-emblem.png", base))).arrayBuffer()); } catch { return undefined; }
}

/** The half-A4 training instructions PDF; the same bytes are shown in the portal and attached to the email. */
export async function buildTrainingInstructionsPdf(details: InstructionDetails, origin?: string) {
  return createTrainingInstructionsPdf({
    traineeName: details.traineeName,
    courseName: details.courseName,
    dateOfTraining: details.dates,
    time: details.time,
    classroom: details.classroom,
    googleClassroomLink: details.join.url,
    subject: details.subject,
    body: details.body,
    reference: details.enrollmentNumber,
    issuedAt: new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date()),
    logoBytes: await logoBytes(origin),
  });
}
