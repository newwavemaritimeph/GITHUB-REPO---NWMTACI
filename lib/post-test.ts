/**
 * Course post-tests (owner, 20 Oct 2026): at least 10 multiple-choice questions
 * per course, one correct answer each; pass at 70% unless the Admin sets another
 * mark; unlimited retakes. Pure rules shared by the server and the screens.
 */
export type PostTestQuestion = { q: string; options: string[]; answer: number; why?: string };

export const DEFAULT_PASSING_PERCENT = 70;
export const MIN_QUESTIONS = 10;

/** Correct answers needed to pass: 70% of 10 → 7. */
export const passMark = (total: number, percent: number) => Math.ceil((total * percent) / 100);

export function scorePostTest(questions: PostTestQuestion[], picks: unknown, passingPercent = DEFAULT_PASSING_PERCENT) {
  const answers = Array.isArray(picks) ? picks : [];
  const score = questions.reduce((s, q, i) => s + (answers[i] === q.answer ? 1 : 0), 0);
  const total = questions.length;
  const percent = total ? Math.round((score / total) * 100) : 0;
  return { score, total, percent, passed: total > 0 && score >= passMark(total, passingPercent) };
}

/** Every question answered with a valid choice, or the problem. */
export function picksProblem(questions: PostTestQuestion[], picks: unknown) {
  if (!Array.isArray(picks) || picks.length !== questions.length) return "Please answer every question.";
  if (!picks.every((p, i) => Number.isInteger(p) && p >= 0 && p < questions[i].options.length)) return "Please answer every question.";
  return null;
}

/** The Admin's edits: at least 10 questions, 4 different options, one valid answer. */
export function questionsProblem(questions: unknown): string | null {
  if (!Array.isArray(questions) || questions.length < MIN_QUESTIONS) return `A post-test needs at least ${MIN_QUESTIONS} questions.`;
  for (const [i, raw] of questions.entries()) {
    const q = raw as Partial<PostTestQuestion>;
    const n = i + 1;
    if (typeof q.q !== "string" || q.q.trim().length < 5) return `Question ${n} needs its wording.`;
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((o) => typeof o !== "string" || !o.trim())) return `Question ${n} needs 4 answer choices.`;
    if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== 4) return `Question ${n} has the same choice twice.`;
    if (!Number.isInteger(q.answer) || (q.answer as number) < 0 || (q.answer as number) > 3) return `Question ${n} needs its correct answer marked.`;
  }
  return null;
}

/** The questions as the trainee sees them: no correct answers or explanations. */
export const forTrainee = (questions: PostTestQuestion[]) => questions.map((q) => ({ q: q.q, options: q.options }));
