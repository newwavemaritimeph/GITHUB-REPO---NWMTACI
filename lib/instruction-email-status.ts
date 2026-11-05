import { normalizeEmail } from "@/lib/validation";

/** One line describing the latest training-instructions email for an enrollment. */
export type InstructionEmail = { state: string; to: string; sent_at: string | null; last_error: string | null; created_at: string; with_class?: boolean };

const when = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));

export function emailStatusText(email?: InstructionEmail | null): string | null {
  if (!email) return null;
  if (email.state === "Sent" || email.state === "Delivered") return `Emailed to ${email.to}${email.sent_at ? ` · ${when(email.sent_at)}` : ""}`;
  if (email.state === "Delivery Failed" || email.state === "Failed") return `Email to ${email.to} failed — check the address, then send again`;
  return `Email to ${email.to} queued — will retry`;
}

/** The result shown on the Last Sent line. */
export const emailResult = (state: string) => (state === "Sent" || state === "Delivered" ? "Sent" : state === "Failed" || state === "Delivery Failed" ? "Failed" : "Queued");

/** One send and one resend, then the button goes away (owner, 5 Nov 2026). A failed email does not use up a send. */
export const INSTRUCTION_SENDS = 2;
export const canSendInstructions = (count: number, lastState?: string | null) => count < INSTRUCTION_SENDS || emailResult(lastState ?? "") === "Failed";

/**
 * Instructions window (owner, 5 Nov 2026): who the email goes to, and whether the
 * trainee's record changes. Only a ticked box with a different address changes it.
 */
export function instructionRecipient(onRecord: string | null | undefined, typed: string | null | undefined, save: boolean | undefined) {
  const record = normalizeEmail(onRecord ?? ""), chosen = typed ? normalizeEmail(typed) : record;
  return { to: chosen || null, saveToRecord: !!save && !!chosen && chosen !== record };
}

export type InstructionSendResult = {
  email?: { state: string; to?: string | null; error?: string } | null;
  classroom?: { state: string; email: string; error: string | null } | null;
};

/** The message after a send. ok is false when the email did not go out. */
export function instructionSendText({ email, classroom }: InstructionSendResult, saved: boolean, recordKeeps?: string | null) {
  const sent = email?.state === "Sent" || email?.state === "Delivered";
  const first = sent ? `Sent to ${email?.to}.`
    : email?.state === "Not configured" ? "Email is not set up yet, so nothing was sent."
    : email?.state === "No email" ? "There is no email address to send to."
    : `The email to ${email?.to ?? "the trainee"} did not go out yet (${email?.error ?? email?.state ?? "unknown"}). It will retry automatically.`;
  const invite = !classroom ? "" : classroom.state === "Failed" ? ` Google Classroom invitation failed: ${classroom.error}.` : classroom.state === "Already invited" ? " Already invited to Google Classroom." : " Google Classroom invitation sent.";
  const record = saved ? " Saved as the trainee's email." : recordKeeps ? ` This one time only. The record keeps ${recordKeeps}.` : "";
  return { ok: sent, text: first + invite + record };
}
