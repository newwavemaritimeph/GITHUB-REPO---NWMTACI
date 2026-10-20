/**
 * Training evaluation in the portal, replacing Google Forms (owner, 20 Oct 2026).
 * The answers are filed as a PDF in Google Drive only; the database keeps just
 * that the evaluation was submitted. These questions are placeholders until the
 * owner's Google Form questions are supplied; swap them here when the link arrives.
 */
export const EVALUATION_RATINGS = [
  "The course objectives were clearly explained",
  "The course content was relevant to my work on board",
  "The instructor knew the subject well",
  "The instructor explained the lessons clearly",
  "Handouts and training materials were useful",
  "Facilities and equipment were in good condition",
  "The time allotted was enough",
  "Overall, I am satisfied with the training",
] as const;

export const EVALUATION_QUESTIONS = { liked: "What did you like most?", suggestions: "Suggestions to improve the training", recommend: "Would you recommend New Wave?" } as const;
export const RATING_SCALE = ["Poor", "Fair", "Good", "Very Good", "Excellent"] as const;
export const EVALUATION_TEXT_MAX = 1000;

export type EvaluationAnswers = { ratings: number[]; liked: string; suggestions: string; recommend: "Yes" | "No" };

/** First problem with the answers, or null when they are complete. Runs on the server for every submission. */
export function evaluationProblem(answers: unknown): string | null {
  const a = answers as Partial<EvaluationAnswers> | null;
  if (!a || typeof a !== "object") return "Please complete the evaluation.";
  if (!Array.isArray(a.ratings) || a.ratings.length !== EVALUATION_RATINGS.length || !a.ratings.every((r) => Number.isInteger(r) && r >= 1 && r <= 5)) return "Please rate every statement from 1 to 5.";
  if (a.recommend !== "Yes" && a.recommend !== "No") return "Please say whether you would recommend New Wave.";
  for (const t of [a.liked, a.suggestions]) if (typeof t !== "string" || t.length > EVALUATION_TEXT_MAX) return `Answers must be ${EVALUATION_TEXT_MAX} characters or fewer.`;
  return null;
}
