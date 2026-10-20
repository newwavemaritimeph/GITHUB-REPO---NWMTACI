/**
 * Training evaluation in the portal, replacing Google Forms (owner, 20 Oct 2026).
 * Questions copied from New Wave's "Training Evaluation Survey Form" (Google Form
 * 1_2a2LlO_pdM8JEVRuDVn0jtgxFsKFcSk9XU3jexLX5A). The trainee's name and training
 * dates come from the portal instead of being typed. The answers are filed as a
 * PDF in Google Drive only; the database keeps just that it was submitted.
 */
export const EVALUATION_INTRO = "Thank you for enrolling at New Wave Maritime Training and Assessment Center, Inc. We'd like to hear your feedback on the course you have taken so that we can continually improve the experience for all the trainees.";
export const ATTENDANCE_STATEMENT = "I hereby confirm that I have successfully completed and fully participated in the online training module, and have understood the topics covered throughout the course.";

export const EVALUATION_SECTIONS = [
  { title: "Content and Relevance", items: ["How relevant was the training content to your work needs?", "Did the course cover all the necessary topics in sufficient depth?", "Were the learning objectives clearly defined and achieved?"] },
  { title: "Delivery and Platform", items: ["How easy was it to navigate the online training platform?", "Did the platform function smoothly without technical issues?", "Were the visuals and multimedia elements helpful in understanding the content?"] },
  { title: "Overall Satisfaction", items: ["How satisfied are you with the overall online training experience?", "Would you recommend this training to a colleague?", "What did you like most about the online training?"] },
] as const;

/** Every rated item in order (9), one score each. */
export const EVALUATION_RATINGS: readonly string[] = EVALUATION_SECTIONS.flatMap((s) => s.items);
/** Score 1–4, as in the Google Form's columns. */
export const RATING_SCALE = ["Poor", "Fair", "Good", "Excellent"] as const;
export const COMMENTS_QUESTION = "Comments and Suggestions";
export const EVALUATION_TEXT_MAX = 1000;

export type EvaluationAnswers = { attendance: boolean; ratings: number[]; comments: string };

/** First problem with the answers, or null when they are complete. Runs on the server for every submission. */
export function evaluationProblem(answers: unknown): string | null {
  const a = answers as Partial<EvaluationAnswers> | null;
  if (!a || typeof a !== "object") return "Please complete the evaluation.";
  if (a.attendance !== true) return "Please confirm your attendance.";
  if (!Array.isArray(a.ratings) || a.ratings.length !== EVALUATION_RATINGS.length || !a.ratings.every((r) => Number.isInteger(r) && r >= 1 && r <= RATING_SCALE.length)) return "Please rate every item from Poor to Excellent.";
  if (typeof a.comments !== "string" || !a.comments.trim()) return "Please write your comments and suggestions.";
  if (a.comments.length > EVALUATION_TEXT_MAX) return `Comments must be ${EVALUATION_TEXT_MAX} characters or fewer.`;
  return null;
}
