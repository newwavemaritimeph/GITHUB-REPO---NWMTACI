import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/security";
import {
  VALIDATION_MESSAGES,
  isEmail,
  isPhContactNumber,
  isSrn,
  normalizeEmail,
  normalizePhContactNumber,
  normalizeSrn,
} from "@/lib/validation";
import { PUBLIC_STCW_CODES, automaticEndDate, fitsInWeek } from "@/lib/scheduling";
import { MAX_COURSES, firstOrderConflict, type PickRange } from "@/lib/course-selection";

const registrationSchema = z.object({
  firstName: z.string().trim().min(2).max(80), middleName: z.string().trim().max(80).optional().default(""), lastName: z.string().trim().min(2).max(80), suffix: z.string().trim().max(20).optional().default(""),
  // An SRN is required and must be exactly 10 digits.
  srn: z.string().trim().refine(isSrn, VALIDATION_MESSAGES.srn),
  email: z.string().trim().refine(isEmail, VALIDATION_MESSAGES.email),
  presentAddress: z.string().trim().min(8).max(500),
  mobile: z.string().trim().refine(isPhContactNumber, VALIDATION_MESSAGES.contact),
  placeOfBirth: z.string().trim().min(2).max(160), birthDate: z.string().date(), rank: z.string().trim().min(2).max(100), company: z.string().trim().max(160).optional().default(""),
  emergencyContactName: z.string().trim().min(2).max(160),
  emergencyContactMobile: z.string().trim().refine(isPhContactNumber, VALIDATION_MESSAGES.contact),
  termsAccepted: z.literal("on"),
});
// 1–5 chosen schedules (batch ids) per submission.
// Schedules are optional: without one, Registration assigns the course and
// schedule while screening (owner instruction, 7 Oct 2026).
const batchesSchema = z.array(z.string().uuid()).max(5, "You can select up to 5 courses per submission.");

// An In-House course and start date picked on the public Courses page.
const datedCourseSchema = z.object({ courseCode: z.string().trim().min(1).max(40), startDate: z.string().date() });

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name", middleName: "Middle name", lastName: "Last name", suffix: "Suffix", srn: "SRN", email: "Email address",
  presentAddress: "Complete address", mobile: "Mobile number", placeOfBirth: "Place of birth", birthDate: "Date of birth", rank: "Rank",
  company: "Company / manning agency", emergencyContactName: "Emergency contact person", emergencyContactMobile: "Emergency contact number",
  termsAccepted: "Terms and conditions",
};

/**
 * A message the applicant can act on. Field problems name the field; database
 * errors (plain objects from Supabase, not Error instances) pass their message
 * through instead of collapsing into a generic "review your details".
 */
function applicantMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const field = FIELD_LABELS[String(issue?.path?.[0] ?? "")];
    return field ? `${field}: ${issue.message}` : issue?.message ?? "Please review your details.";
  }
  const message = typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  // The database still requires a schedule: migration 202610070002 (course-less
  // applications) has not been applied yet.
  if (/select at least one schedule/i.test(message)) return "Online applications are being updated. Please try again shortly, or contact New Wave to register.";
  return message || "We could not submit your application. Please review your details and try again.";
}

export const runtime = "nodejs";
export const maxDuration = 25;

// Fail loudly instead of hanging: if a DB call blocks (e.g. a locked id_sequences
// row from a stuck transaction), return a clear message rather than an endless spinner.
function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Registration will open after the secure production environment is connected." }, { status: 503 });
  try {
    const ipHash = await enforceRateLimit(request, "public-registration", 5, 30);
    const form = await request.formData();
    const body = registrationSchema.parse(Object.fromEntries(form));
    const batches = batchesSchema.parse(form.getAll("scheduleIds").map((v) => String(v)).filter(Boolean));
    // In-House courses picked with a start date (courseCodes[i] + startDates[i]).
    const codes = form.getAll("courseCodes").map(String), starts = form.getAll("startDates").map(String);
    if (form.get("courseCode") && form.get("startDate")) { codes.push(String(form.get("courseCode"))); starts.push(String(form.get("startDate"))); }
    const dated = codes.map((code, i) => datedCourseSchema.parse({ courseCode: code, startDate: starts[i] }));
    if (batches.length + dated.length > MAX_COURSES) throw new Error(`You can choose up to ${MAX_COURSES} courses per application.`);
    const db = createSupabaseAdminClient();
    await checkCourseOrder(db, batches, dated);
    const { data: terms } = await db.from("terms_documents").select("version").eq("active", true).lte("effective_from", new Date().toISOString().slice(0,10)).order("effective_from", { ascending: false }).limit(1).maybeSingle();
    if (!terms) throw new Error("No approved terms are active.");
    const { data, error } = await withTimeout(db.rpc("submit_public_registration", {
      target_first_name: body.firstName,target_middle_name: body.middleName,target_last_name: body.lastName,target_suffix: body.suffix,target_srn: normalizeSrn(body.srn) ?? "",
      target_email: normalizeEmail(body.email),target_address: body.presentAddress,target_mobile: normalizePhContactNumber(body.mobile)!,target_place_of_birth: body.placeOfBirth,target_birthdate: body.birthDate,
      target_rank: body.rank,target_company: body.company,target_emergency_name: body.emergencyContactName,target_emergency_mobile: normalizePhContactNumber(body.emergencyContactMobile)!,
      target_batches: batches,target_terms_version: terms.version,target_ip_hash: ipHash,target_marketing_agency: null,
    }), 15000, "The registration service is busy (a previous submission may still be finalizing). Please try again in a minute.");
    if (error) throw error;
    const result = data as { application_number?:string;registration_reference:string;trainee_id:string;email:string;complete_name:string };
    for (const pick of dated) await attachDatedCourse(db, result.trainee_id, pick);
    // Trainees have no portal account. They follow their enrollment through the
    // public status lookup using this reference plus their registered email.
    // application_number (NWMTACI-0000001) exists once migration 202610070003 is
    // applied; until then the summary falls back to the registration reference.
    return NextResponse.json({ reference: result.registration_reference, applicationNumber: result.application_number ?? null });
  } catch (error) {
    const status = error instanceof Error && error.message === "RATE_LIMITED" ? 429 : 400;
    if (status !== 429) console.error("Public registration failed:", error);
    return NextResponse.json({ error: status === 429 ? "Too many registration attempts. Please try again later." : applicantMessage(error) }, { status });
  }
}

/**
 * Put the In-House course and start date the applicant picked onto their
 * application (a Pending enrollment with scheduled_on, no batch). Best-effort:
 * if anything does not check out, the application stays without a course and
 * Registration assigns one while screening.
 */
async function attachDatedCourse(db: ReturnType<typeof createSupabaseAdminClient>, traineeId: string, pick: { courseCode: string; startDate: string }) {
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    if ((PUBLIC_STCW_CODES as readonly string[]).includes(pick.courseCode) || pick.startDate <= today) return;
    const { data: course } = await db.from("courses").select("id,duration_label").eq("code", pick.courseCode).eq("delivery_type", "In-House").eq("active", true).maybeSingle();
    if (!course || !fitsInWeek(pick.startDate, course.duration_label)) return;
    const { data: enrollment, error } = await db.rpc("assign_application_course", { target_trainee: traineeId, target_course: course.id, target_batch: null, actor: null });
    if (error || !enrollment) { console.error("Could not attach the picked course:", error?.message); return; }
    const { error: dateError } = await db.from("enrollments").update({ scheduled_on: pick.startDate }).eq("id", (enrollment as { id: string }).id);
    if (dateError) console.error("Could not set the picked start date:", dateError.message);
  } catch (err) { console.error("Could not attach the picked course:", err instanceof Error ? err.message : err); }
}

/**
 * Safety → Crowd → Crisis: Crowd must start after Safety, and Crisis after
 * Safety and Crowd, within one application (lib/course-selection). The form
 * greys out such dates; this refuses an application that slips past it.
 */
async function checkCourseOrder(db: ReturnType<typeof createSupabaseAdminClient>, batchIds: string[], dated: { courseCode: string; startDate: string }[]) {
  const picks: PickRange[] = [];
  if (batchIds.length) {
    const { data } = await db.from("batches").select("id,starts_on,ends_on,courses(code)").in("id", batchIds);
    for (const b of data ?? []) {
      const course = Array.isArray(b.courses) ? b.courses[0] : b.courses;
      if (course?.code) picks.push({ code: course.code, start: b.starts_on, end: b.ends_on });
    }
  }
  for (const d of dated) picks.push({ code: d.courseCode, start: d.startDate, end: automaticEndDate(d.startDate, "1") });
  const seen = new Set<string>();
  for (const pick of picks) { if (seen.has(pick.code)) throw new Error("Each course can be chosen only once per application."); seen.add(pick.code); }
  const conflict = firstOrderConflict(picks);
  if (conflict) throw new Error(`Schedule order: ${conflict}. Crowd must start after Safety, and Crisis after Safety and Crowd.`);
}
