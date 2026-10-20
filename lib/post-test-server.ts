import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import drafts from "@/lib/post-test-drafts.json";
import { DEFAULT_PASSING_PERCENT, type PostTestQuestion } from "@/lib/post-test";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const DRAFTS = drafts as unknown as Record<string, PostTestQuestion[]>;
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * Drafted questions (20 Oct 2026), keyed "CODE - Course" like the Word templates.
 * The code picks the course, except the ILO catering courses, which share the code
 * ILO and match by name.
 */
export function draftFor(course: { code: string; name: string }): PostTestQuestion[] | null {
  const keys = Object.keys(DRAFTS);
  const code = norm(course.code), name = norm(course.name);
  const byName = keys.find((k) => norm(k.split(" - ").slice(1).join(" - ")) === name);
  const sameCode = keys.filter((k) => norm(k.split(" - ")[0]) === code);
  const key = sameCode.length === 1 ? sameCode[0] : byName;
  return key ? DRAFTS[key] : null;
}

export type CoursePostTest = { approved: boolean; approvedAt: string | null; passingPercent: number; questions: PostTestQuestion[]; source: "saved" | "draft" | "none" };

/** A course's post-test: the saved (Admin-edited) questions, else the draft. Tolerant before migration 202610200048. */
export async function loadPostTest(db: Admin, course: { id: string; code: string; name: string }): Promise<CoursePostTest> {
  const [{ data: setting, error }, { data: rows }] = await Promise.all([
    db.from("post_tests").select("passing_percent,approved_at").eq("course_id", course.id).maybeSingle(),
    db.from("post_test_questions").select("position,question,options,answer,why").eq("course_id", course.id).order("position"),
  ]);
  const saved = (rows ?? []).map((r) => ({ q: r.question as string, options: r.options as string[], answer: Number(r.answer), why: (r.why as string | null) ?? undefined }));
  const draft = draftFor(course);
  return {
    approved: !error && !!setting?.approved_at && saved.length > 0,
    approvedAt: (setting?.approved_at as string | null) ?? null,
    passingPercent: Number(setting?.passing_percent ?? DEFAULT_PASSING_PERCENT),
    questions: saved.length ? saved : draft ?? [],
    source: saved.length ? "saved" : draft ? "draft" : "none",
  };
}

/** Per enrollment: whether its course has a live post-test, the best attempt and how many tries. */
export async function postTestStatus(db: Admin, enrollments: { id: string; course_id: string }[]) {
  const out: Record<string, { required: boolean; passed: boolean; best: { score: number; total: number; percent: number } | null; attempts: number }> = {};
  if (!enrollments.length) return out;
  const courseIds = [...new Set(enrollments.map((e) => e.course_id))];
  const { data: live, error } = await db.from("post_tests").select("course_id").in("course_id", courseIds).not("approved_at", "is", null);
  if (error) return out;
  const liveSet = new Set((live ?? []).map((r) => r.course_id as string));
  const ids = enrollments.map((e) => e.id);
  const attempts: { enrollment_id: string; score: number; total: number; percent: number; passed: boolean }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("post_test_attempts").select("enrollment_id,score,total,percent,passed").in("enrollment_id", ids.slice(i, i + 200));
    attempts.push(...((data ?? []) as typeof attempts));
  }
  for (const e of enrollments) {
    const mine = attempts.filter((a) => a.enrollment_id === e.id);
    const best = mine.sort((a, b) => b.percent - a.percent)[0] ?? null;
    out[e.id] = { required: liveSet.has(e.course_id), passed: mine.some((a) => a.passed), best: best ? { score: best.score, total: best.total, percent: best.percent } : null, attempts: mine.length };
  }
  return out;
}
