import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";
import { automaticEndDate } from "@/lib/scheduling";
import { googleConfigured } from "@/lib/google-classroom";
import { evaluationProblem, type EvaluationAnswers } from "@/lib/evaluation-form";
import { fileEvaluationInDrive } from "@/lib/evaluation-drive";
import { trySendSoftCopy } from "@/lib/certificates";

export const runtime = "nodejs";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const UNAVAILABLE = "Evaluations cannot be received right now. Please try again later.";
const INVALID = "This evaluation link is invalid or has expired.";

/** The enrollment behind a feedback link, with who, which course and the training dates. */
async function byToken(admin: Admin, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data: e } = await admin.from("enrollments")
    .select("id,scheduled_on,trainees(legal_first_name,legal_last_name,application_number,trainee_number),courses(name,code,delivery_type,duration_label),batches(starts_on,ends_on)")
    .eq("feedback_token", token).maybeSingle();
  if (!e) return null;
  const t = first(e.trainees) as { legal_first_name?: string; legal_last_name?: string; application_number?: string | null; trainee_number?: string | null } | null;
  const c = first(e.courses) as { name?: string; code?: string; delivery_type?: string; duration_label?: string | null } | null;
  const b = first(e.batches) as { starts_on?: string; ends_on?: string } | null;
  const startsOn = b?.starts_on ?? e.scheduled_on ?? null;
  const endsOn = b?.ends_on ?? (e.scheduled_on && c?.duration_label ? automaticEndDate(e.scheduled_on, c.duration_label) : e.scheduled_on ?? null);
  return {
    id: e.id as string, firstName: t?.legal_first_name ?? "", lastName: t?.legal_last_name ?? "", nwmtaciNo: t?.application_number ?? t?.trainee_number ?? "",
    courseName: c?.name ?? "your training", courseCode: c?.code ?? "", inHouse: c?.delivery_type === "In-House", startsOn, endsOn,
  };
}

// GET ?token=… → context for the public evaluation page (who + which course + dates + whether already submitted).
export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  try { await enforceRateLimit(request, "feedback-view", 30); } catch { return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 }); }
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return NextResponse.json({ error: "Missing link token." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const e = await byToken(admin, token);
  if (!e) return NextResponse.json({ error: INVALID }, { status: 404 });
  const { data: fb } = await admin.from("training_feedback").select("id").eq("enrollment_id", e.id).maybeSingle();
  return NextResponse.json({
    traineeName: `${e.firstName} ${e.lastName}`.trim() || "Trainee", courseName: e.courseName, courseCode: e.courseCode,
    startsOn: e.startsOn, endsOn: e.endsOn, inHouse: e.inHouse, alreadySubmitted: Boolean(fb),
  }, { headers: { "Cache-Control": "no-store" } });
}

const submitInput = z.object({ token: z.string().min(1).max(64), answers: z.unknown() });

/**
 * POST → the portal evaluation (owner, 20 Oct 2026; replaces Google Forms). The
 * answers go to Google Drive as a PDF only; the database records that it was
 * submitted and the Drive link. Nothing is recorded when Drive cannot take it.
 * For In-House courses the certificate becomes "Ready to Print".
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  try { await enforceRateLimit(request, "feedback", 10); } catch { return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 }); }
  const parsed = submitInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please complete the evaluation." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const e = await byToken(admin, parsed.data.token);
  if (!e) return NextResponse.json({ error: INVALID }, { status: 404 });
  const { data: existing } = await admin.from("training_feedback").select("id").eq("enrollment_id", e.id).maybeSingle();
  if (existing) return NextResponse.json({ error: "This evaluation was already submitted." }, { status: 409 });
  const problem = evaluationProblem(parsed.data.answers);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const raw = parsed.data.answers as EvaluationAnswers;
  const answers: EvaluationAnswers = { ratings: raw.ratings, liked: raw.liked.trim(), suggestions: raw.suggestions.trim(), recommend: raw.recommend };
  if (!googleConfigured()) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });

  const submittedAt = new Date().toISOString();
  let filed: { fileId: string; link: string };
  try {
    filed = await fileEvaluationInDrive(admin, { traineeName: `${e.firstName} ${e.lastName}`.trim(), firstName: e.firstName, lastName: e.lastName, nwmtaciNo: e.nwmtaciNo, courseName: e.courseName, courseCode: e.courseCode, startsOn: e.startsOn, endsOn: e.endsOn, submittedAt, answers });
  } catch (err) {
    console.error("Evaluation Drive filing failed:", e.id, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  const row = { enrollment_id: e.id, submitted_at: submittedAt, source: "Portal", overall_rating: null, instructor_rating: null };
  let { error: fbErr } = await admin.from("training_feedback").insert({ ...row, drive_file_id: filed.fileId, drive_link: filed.link, comments: null });
  // Before migration 202610200047 there are no Drive columns: keep the link in comments.
  if (fbErr && /drive_(file_id|link)/.test(fbErr.message)) ({ error: fbErr } = await admin.from("training_feedback").insert({ ...row, comments: `Evaluation PDF: ${filed.link}` }));
  if (fbErr) {
    if (fbErr.code === "23505") return NextResponse.json({ error: "This evaluation was already submitted." }, { status: 409 });
    console.error("Evaluation record failed:", e.id, fbErr.message);
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
  }
  if (e.inHouse) {
    // Ready to Print, unless the certificate is already Printed/Released/Cancelled.
    const { data: cert } = await admin.from("certificates").select("id,status").eq("enrollment_id", e.id).maybeSingle();
    if (!cert) await admin.from("certificates").insert({ enrollment_id: e.id, status: "Ready to Print", snapshot: { feedback_attendance: true } });
    else if (!["Printed", "Released", "Cancelled"].includes(cert.status)) await admin.from("certificates").update({ status: "Ready to Print", updated_at: new Date().toISOString() }).eq("id", cert.id);
  }
  await trySendSoftCopy(admin, e.id); // never throws
  return NextResponse.json({ ok: true });
}
