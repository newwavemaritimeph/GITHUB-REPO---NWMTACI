import { isStcwCategory } from "@/lib/certificate-rules";
import { classroomEmailBlocks, escapeHtml, type ClassroomJoin } from "@/lib/classroom";
import { MISMO_COURSE_CODES } from "@/lib/mismo";

/**
 * Training Instructions by category (owner, 3 Nov 2026; design/training-instructions-designs.html,
 * Design 11): the Admin edits one template for STCW courses and one for In-House courses, one line
 * per item; Registration generates the sheet and the email from them.
 */
export type InstructionCategory = "STCW" | "In-House";
export type CategoryTemplate = { category: InstructionCategory; subject: string; bring: string; reminders: string; policies: string };

// Short forms of the Terms and Conditions; the full wording is on the back of the TAR.
const POLICIES = [
  "Payment: Full payment for 1-day courses; 50% down payment otherwise.",
  "Partial Payments: Settle in full by the 2nd day of training, particularly for STCW/MARINA courses.",
  "No Refund: Fees paid are non-refundable for reasons attributable to the trainee.",
  "Reschedule: 5+ days before: Php 350.00. Under 5 days: 50% of the fee + Php 250.00.",
  "Cancellation: 6+ days before: Php 350.00. Under 6 days: transfer to another New Wave course only, within 12 months.",
  "Training in Progress: No rescheduling or cancellation; all fees paid are forfeited.",
  "Certificate: Released after all requirements and balances are complete.",
].join("\n");

/** The same text as migrations 202610290073 and 202610290077, used until they are run. */
export const DEFAULT_CATEGORY_TEMPLATES: Record<InstructionCategory, CategoryTemplate> = {
  STCW: {
    category: "STCW", subject: "Your training instructions · {{course}}", policies: POLICIES,
    bring: "Valid ID and Seaman's Book (SIRB)\nTraining uniform (white polo, black pants, black shoes)\nOwn tumbler and ballpen",
    reminders: "Report by 7:30 AM on the first day; late arrivals over 15 minutes are rescheduled.\nAttendance is required on all training days for MARINA reporting.\nCheck your name on the TAR; report corrections before the first day.",
  },
  "In-House": {
    category: "In-House", subject: "Your training instructions · {{course}}", policies: POLICIES,
    bring: "Valid ID\nOwn tumbler and ballpen\nLaptop or phone with camera for online classes",
    reminders: "Join the Google Classroom with the link and class code the day before.\nFull attendance is required; keep your camera on for online classes.\nComplete the post-test and the evaluation to release your certificate.",
  },
};

export const INSTRUCTION_PLACEHOLDERS = ["{{trainee}}", "{{course}}", "{{dates}}", "{{time}}", "{{room}}", "{{classroom_link}}", "{{class_code}}"];

export const linesOf = (text: string | null | undefined) => (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
/** A course with no class yet does not tell the trainee to join one (owner, 5 Nov 2026). */
export const remindersFor = (lines: string[], hasClass: boolean) => (hasClass ? lines : lines.filter((l) => !/google classroom|class code/i.test(l)));
export const fillPlaceholders = (text: string, values: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? "");

/** "Payment: Full payment…" as [label, text]; a line without a label keeps its whole text. */
export const policyPairs = (text: string | null | undefined): [string, string][] => linesOf(text).map((line) => {
  const at = line.indexOf(":");
  return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : ["", line];
});

export const instructionCategoryOf = (code: string | null | undefined, categoryName: string | null | undefined): InstructionCategory =>
  isStcwCategory(categoryName) || MISMO_COURSE_CODES.includes((code ?? "").trim().toUpperCase()) ? "STCW" : "In-House";

export const isOnlineMode = (mode: string | null | undefined) => /online|virtual|remote/i.test(mode ?? "");
/**
 * How the class is held: the batch's mode, else the course's. In-House courses are usually booked by date with no
 * batch, so reading the batch alone gave them the STCW face-to-face wording (owner, 5 Nov 2026).
 */
export const instructionMode = (batchMode: string | null | undefined, courseMode: string | null | undefined, category: InstructionCategory) =>
  batchMode || courseMode || (category === "In-House" ? "Online" : "Face-to-Face");
export const arriveNote = (online: boolean) => (online ? "log in by 7:45 AM" : "report by 7:30 AM");

/** The five boxes on the sheet. */
export const sheetSteps = (online: boolean, hasClass: boolean): [string, string][] => [
  ["Before", hasClass ? "Join the Google Classroom the day before." : "Check your name on the TAR."],
  ["Arrive", online ? "Log in by 7:45 AM with your valid ID." : "Report by 7:30 AM with your valid ID."],
  ["During", online ? "Camera on, full attendance." : "Wear the uniform, full attendance."],
  ["After", "Take the post-test and the evaluation."],
  ["Certificate", "Released once requirements and balance are complete."],
];

/** The five numbered lines in the email. */
export const emailSteps = (online: boolean, hasClass: boolean, room: string, firstDay: string): string[] => (online
  ? [hasClass ? "Join the Google Classroom today with the button above." : "Check your invitation for the class link.", "Check your camera, microphone and internet before class.", `Log in by 7:45 AM on ${firstDay} and show your valid ID on camera.`, "Attend the whole session with your camera on.", "Take the post-test and the evaluation; your certificate follows."]
  : [`Report to ${room} by 7:30 AM on ${firstDay}.`, "Bring the items listed under What to Bring.", "Sign the attendance sheet every training day.", "Pass the assessment on the last day.", "Your certificate is released once requirements and balances are complete."]);

type EmailDetails = {
  subject: string; firstName: string; formalName: string; nwmtaciNumber: string; srn: string; enrollmentNumber: string; courseName: string; batchNumber: string;
  dates: string; time: string; classroom: string; mode: string; online: boolean; join: ClassroomJoin; bring: string[]; reminders: string[]; policies: [string, string][];
};

const listHtml = (items: string[]) => items.map((x) => `<li style="margin:0 0 3px">${escapeHtml(x)}</li>`).join("");

/** Everything template training.instructions v2 fills. Variables ending in _html are built here, already escaped. */
export function instructionEmailVariables(d: EmailDetails) {
  const firstDay = d.dates.split(" - ")[0];
  const steps = emailSteps(d.online, !!(d.join.url || d.join.code), d.classroom, firstDay);
  const classroom = classroomEmailBlocks(d.join);
  return {
    email_subject: d.subject, first_name: d.firstName, formal_name: d.formalName, nwmtaci_number: d.nwmtaciNumber, srn_text: d.srn ? ` · SRN ${d.srn}` : "", enrollment_number: d.enrollmentNumber,
    course_name: d.courseName, dates: d.dates, time: d.time, arrive_note: arriveNote(d.online), classroom: d.classroom, where_detail: `${d.mode} · ${d.courseName}${d.batchNumber ? ` · Batch ${d.batchNumber}` : ""}`,
    bring_html: listHtml(d.bring), reminders_html: listHtml(d.reminders),
    steps_html: steps.map((s, i) => `<tr><td style="width:30px;padding:0 8px 8px 0;vertical-align:top"><div style="width:24px;height:24px;line-height:24px;border-radius:50%;background:#0571D0;color:#ffffff;text-align:center;font-weight:700;font-size:12px">${i + 1}</div></td><td style="padding:2px 0 8px;font-size:13.5px;line-height:1.45">${escapeHtml(s)}</td></tr>`).join(""),
    policies_html: d.policies.map(([k, v]) => `${k ? `<b style="color:#0f2638">${escapeHtml(k)}:</b> ` : ""}${escapeHtml(v)}`).join("<br>"),
    classroom_block_html: classroom.html, classroom_block_text: classroom.text,
    bring_text: d.bring.map((x) => `- ${x}`).join("\n"), reminders_text: d.reminders.map((x) => `- ${x}`).join("\n"),
    steps_text: steps.map((s, i) => `${i + 1}. ${s}`).join("\n"), policies_text: d.policies.map(([k, v]) => (k ? `${k}: ${v}` : v)).join("\n"),
  };
}
