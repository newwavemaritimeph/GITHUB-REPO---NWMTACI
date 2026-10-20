import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PASSING_PERCENT, questionsProblem, type PostTestQuestion } from "@/lib/post-test";
import { draftFor, loadPostTest } from "@/lib/post-test-server";

export const runtime = "nodejs";

/**
 * Admin › Configuration › Post-Tests (owner, 20 Oct 2026). GET lists every New Wave
 * course with its post-test state; GET ?courseId= returns that course's questions
 * (saved, else the draft). POST saves the Admin's edits and approves: a course's
 * post-test is live only once approved.
 */
export async function GET(request: Request) {
  const staff = await requireStaff(["admin"]);
  if (!staff) return NextResponse.json({ error: "Only the Admin manages post-tests." }, { status: 403 });
  const db = createSupabaseAdminClient();
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (courseId) {
    const { data: course } = await db.from("courses").select("id,code,name").eq("id", courseId).maybeSingle();
    if (!course) return NextResponse.json({ error: "Course not found." }, { status: 404 });
    return NextResponse.json({ course, ...(await loadPostTest(db, course)) });
  }
  const [{ data: courses }, tests, counts] = await Promise.all([
    db.from("courses").select("id,code,name").eq("delivery_type", "In-House").eq("active", true).order("name"),
    db.from("post_tests").select("course_id,approved_at,passing_percent"),
    db.from("post_test_questions").select("course_id"),
  ]);
  const ready = !tests.error;
  const byCourse = new Map(((tests.data ?? []) as { course_id: string; approved_at: string | null; passing_percent: number }[]).map((t) => [t.course_id, t]));
  const saved = new Map<string, number>();
  for (const r of (counts.data ?? []) as { course_id: string }[]) saved.set(r.course_id, (saved.get(r.course_id) ?? 0) + 1);
  return NextResponse.json({ ready, courses: (courses ?? []).map((c) => ({ ...c, approvedAt: byCourse.get(c.id)?.approved_at ?? null, passingPercent: byCourse.get(c.id)?.passing_percent ?? DEFAULT_PASSING_PERCENT, saved: saved.get(c.id) ?? 0, drafted: !!draftFor(c) })) });
}

const saveInput = z.object({ action: z.literal("save"), courseId: z.string().uuid(), questions: z.array(z.object({ q: z.string().trim().max(500), options: z.array(z.string().trim().max(300)), answer: z.number().int(), why: z.string().trim().max(500).optional() })).max(40), passingPercent: z.number().int().min(1).max(100), approve: z.boolean() });
const unapproveInput = z.object({ action: z.literal("unapprove"), courseId: z.string().uuid() });

export async function POST(request: Request) {
  const staff = await requireStaff(["admin"]);
  if (!staff) return NextResponse.json({ error: "Only the Admin manages post-tests." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = z.discriminatedUnion("action", [saveInput, unapproveInput]).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the questions." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const input = parsed.data;
  const now = new Date().toISOString();
  if (input.action === "unapprove") {
    const { error } = await db.from("post_tests").update({ approved_at: null, approved_by: null, updated_at: now, updated_by: staff.user.id }).eq("course_id", input.courseId);
    if (error) return NextResponse.json({ error: /post_tests/.test(error.message) ? "Apply database update 202610200048 first." : error.message }, { status: 400 });
    await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "admin", action: "post_test.unapproved", record_type: "course", record_id: input.courseId });
    return NextResponse.json({ ok: true });
  }
  const problem = questionsProblem(input.questions);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const questions = input.questions as PostTestQuestion[];
  const { error: delError } = await db.from("post_test_questions").delete().eq("course_id", input.courseId);
  if (delError) return NextResponse.json({ error: /post_test/.test(delError.message) ? "Apply database update 202610200048 first." : delError.message }, { status: 400 });
  const { error: insError } = await db.from("post_test_questions").insert(questions.map((q, i) => ({ course_id: input.courseId, position: i + 1, question: q.q.trim(), options: q.options.map((o) => o.trim()), answer: q.answer, why: q.why?.trim() || null })));
  if (insError) return NextResponse.json({ error: insError.message }, { status: 400 });
  const { data: prior } = await db.from("post_tests").select("approved_at").eq("course_id", input.courseId).maybeSingle();
  const { error } = await db.from("post_tests").upsert({ course_id: input.courseId, passing_percent: input.passingPercent, approved_at: input.approve ? now : prior?.approved_at ?? null, approved_by: input.approve ? staff.user.id : undefined, updated_at: now, updated_by: staff.user.id }, { onConflict: "course_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "admin", action: input.approve ? "post_test.approved" : "post_test.saved", record_type: "course", record_id: input.courseId, new_values: { questions: questions.length, passing_percent: input.passingPercent } });
  return NextResponse.json({ ok: true });
}
