import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";
import { processEmailJobs } from "@/lib/email-jobs";
import { trySendSoftCopy } from "@/lib/certificates";
import { matchEvaluationEnrollment } from "@/lib/certificate-rules";

export const runtime = "nodejs";

const input = z.object({
  formId: z.string().trim().min(10).max(120),
  formTitle: z.string().trim().max(300).optional(),
  responseId: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  nwmtaciNo: z.string().trim().max(40).optional(),
  submittedAt: z.string().datetime({ offset: true }).optional(),
});

const sameSecret = (given: string, expected: string) => {
  const a = createHash("sha256").update(given).digest(), b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
};

/**
 * Google Forms evaluation (owner, 8 Oct 2026). The script on each course's
 * evaluation form posts here on submit (docs/google-form-evaluation.gs). The
 * trainee is matched by NWMTACI number or registered email to their latest
 * enrollment in the course that owns the form; the evaluation is recorded,
 * the certificate becomes due once the fee is settled, and the soft copy is
 * emailed. Answers stay in Google Forms; only the fact of submission is kept.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  const secret = process.env.EVALUATION_WEBHOOK_SECRET ?? "";
  const given = request.headers.get("x-evaluation-secret") ?? "";
  if (!secret || !given || !sameSecret(given, secret)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  try { await enforceRateLimit(request, "evaluation-webhook", 300); } catch { return NextResponse.json({ error: "Too many requests." }, { status: 429 }); }
  let body: z.infer<typeof input>;
  try { body = input.parse(await request.json()); } catch { return NextResponse.json({ error: "Invalid payload." }, { status: 400 }); }
  const db = createSupabaseAdminClient();
  // Trainee by NWMTACI number first, then by registered email.
  const clean = (body.nwmtaciNo ?? "").replace(/[^A-Za-z0-9-]/g, "");
  let traineeIds: string[] = [];
  if (clean) {
    const { data } = await db.from("trainees").select("id").or(`application_number.eq.${clean},trainee_number.eq.${clean}`);
    traineeIds = (data ?? []).map((t) => t.id as string);
  }
  if (!traineeIds.length && body.email) {
    const { data } = await db.from("trainees").select("id").ilike("email", body.email);
    traineeIds = (data ?? []).map((t) => t.id as string);
  }
  if (!traineeIds.length) return NextResponse.json({ ok: false, reason: "No trainee matches this email or NWMTACI number." }, { status: 404 });

  // The course: a course linked to this form, else the course code in the form's title
  // (the shared STCW form goes to the trainee's STCW course).
  const { data: rows } = await db.from("enrollments").select("id,created_at,course_id,courses(code,course_categories(name))").in("trainee_id", traineeIds).neq("enrollment_status", "Cancelled").order("created_at", { ascending: false }).limit(50);
  const list = (rows ?? []) as unknown as { id: string; created_at: string; course_id: string; courses: { code: string; course_categories: { name: string } | { name: string }[] | null } | { code: string; course_categories: { name: string } | { name: string }[] | null }[] | null }[];
  if (!list.length) return NextResponse.json({ ok: false, reason: "The trainee has no enrollment." }, { status: 404 });
  const { data: linked } = await db.from("courses").select("id").eq("evaluation_form_id", body.formId);
  const linkedIds = new Set((linked ?? []).map((c) => c.id as string));
  const { data: done } = await db.from("training_feedback").select("enrollment_id").in("enrollment_id", list.map((e) => e.id));
  const doneIds = new Set((done ?? []).map((d) => d.enrollment_id as string));
  const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const pool = linkedIds.size && list.some((e) => linkedIds.has(e.course_id)) ? list.filter((e) => linkedIds.has(e.course_id)) : list;
  const matchedId = linkedIds.size && pool !== list ? (pool.find((e) => !doneIds.has(e.id)) ?? pool[0]).id : matchEvaluationEnrollment(body.formTitle ?? "", pool.map((e) => { const c = one(e.courses); return { id: e.id, code: c?.code ?? "", categoryName: one(c?.course_categories)?.name ?? null, createdAt: e.created_at, hasEvaluation: doneIds.has(e.id) }; }));
  if (!matchedId) return NextResponse.json({ ok: false, reason: "Could not tell which course this evaluation is for. Put the course code in the form title." }, { status: 404 });
  const enrollment = { id: matchedId };

  const submittedAt = body.submittedAt ?? new Date().toISOString();
  const row = { enrollment_id: enrollment.id, comments: "Submitted through Google Forms", submitted_at: submittedAt, source: "Google Form", respondent_email: body.email || null, response_id: body.responseId };
  const { error } = await db.from("training_feedback").upsert(row, { onConflict: "enrollment_id" });
  if (error) return NextResponse.json({ error: "Could not record the evaluation." }, { status: 500 });
  await db.from("audit_logs").insert({ actor_id: null, actor_role: "system", action: "evaluation.received", record_type: "enrollment", record_id: enrollment.id, new_values: { source: "Google Form" } });

  const soft = await trySendSoftCopy(db, enrollment.id);
  if (soft.state === "Queued" && soft.jobId) await processEmailJobs(db, { ids: [soft.jobId], origin: new URL(request.url).origin }).catch(() => undefined);
  return NextResponse.json({ ok: true, softCopy: soft.state });
}
