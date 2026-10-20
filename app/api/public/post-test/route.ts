import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";
import { forTrainee, passMark, picksProblem, scorePostTest } from "@/lib/post-test";
import { loadPostTest } from "@/lib/post-test-server";

export const runtime = "nodejs";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const INVALID = "This post-test link is invalid or has expired.";

/** The enrollment behind a post-test link (the enrollment's feedback token), with the trainee and course. */
async function byToken(admin: Admin, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data: e } = await admin.from("enrollments").select("id,course_id,enrollment_status,partner_offer_id,trainees(legal_first_name,legal_last_name),courses(id,name,code)").eq("feedback_token", token).maybeSingle();
  if (!e || e.enrollment_status === "Cancelled" || e.partner_offer_id) return null;
  const t = first(e.trainees) as { legal_first_name?: string; legal_last_name?: string } | null;
  const c = first(e.courses) as { id: string; name: string; code: string } | null;
  if (!c) return null;
  return { id: e.id as string, name: `${t?.legal_first_name ?? ""} ${t?.legal_last_name ?? ""}`.trim() || "Trainee", course: c };
}

async function attemptsOf(admin: Admin, enrollmentId: string) {
  const { data } = await admin.from("post_test_attempts").select("score,total,percent,passed,submitted_at").eq("enrollment_id", enrollmentId).order("submitted_at", { ascending: false });
  return (data ?? []) as { score: number; total: number; percent: number; passed: boolean; submitted_at: string }[];
}

/** GET ?token=… → the course's live post-test (questions without answers) and the trainee's attempts. */
export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  try { await enforceRateLimit(request, "post-test-view", 40); } catch { return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 }); }
  const admin = createSupabaseAdminClient();
  const e = await byToken(admin, new URL(request.url).searchParams.get("token") ?? "");
  if (!e) return NextResponse.json({ error: INVALID }, { status: 404 });
  const test = await loadPostTest(admin, e.course);
  if (!test.approved) return NextResponse.json({ error: "This course has no post-test yet." }, { status: 404 });
  const attempts = await attemptsOf(admin, e.id);
  return NextResponse.json({ traineeName: e.name, courseName: e.course.name, courseCode: e.course.code, passingPercent: test.passingPercent, passMark: passMark(test.questions.length, test.passingPercent), questions: forTrainee(test.questions), attempts: attempts.length, passed: attempts.some((a) => a.passed), best: attempts.sort((a, b) => b.percent - a.percent)[0] ?? null }, { headers: { "Cache-Control": "no-store" } });
}

const submitInput = z.object({ token: z.string().min(1).max(64), picks: z.array(z.number().int()).max(100) });

/** POST → scores an attempt server-side and keeps it; unlimited retakes; answers are never sent back. */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  try { await enforceRateLimit(request, "post-test", 20); } catch { return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 }); }
  const parsed = submitInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please answer every question." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const e = await byToken(admin, parsed.data.token);
  if (!e) return NextResponse.json({ error: INVALID }, { status: 404 });
  const test = await loadPostTest(admin, e.course);
  if (!test.approved) return NextResponse.json({ error: "This course has no post-test yet." }, { status: 404 });
  const problem = picksProblem(test.questions, parsed.data.picks);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const result = scorePostTest(test.questions, parsed.data.picks, test.passingPercent);
  const { error } = await admin.from("post_test_attempts").insert({ enrollment_id: e.id, course_id: e.course.id, score: result.score, total: result.total, percent: result.percent, passed: result.passed, answers: { picks: parsed.data.picks, questions: test.questions.map((q) => q.q) } });
  if (error) return NextResponse.json({ error: "Your answers could not be saved. Please try again." }, { status: 500 });
  const attempts = await attemptsOf(admin, e.id);
  return NextResponse.json({ ...result, passingPercent: test.passingPercent, passMark: passMark(result.total, test.passingPercent), attempts: attempts.length });
}
