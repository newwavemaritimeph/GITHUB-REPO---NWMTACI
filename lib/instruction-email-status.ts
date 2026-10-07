/** One line describing the latest training-instructions email for an enrollment. */
export type InstructionEmail = { state: string; to: string; sent_at: string | null; last_error: string | null; created_at: string };

const when = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));

export function emailStatusText(email?: InstructionEmail | null): string | null {
  if (!email) return null;
  if (email.state === "Sent" || email.state === "Delivered") return `Emailed to ${email.to}${email.sent_at ? ` · ${when(email.sent_at)}` : ""}`;
  if (email.state === "Delivery Failed" || email.state === "Failed") return `Email to ${email.to} failed — check the address, then generate again`;
  return `Email to ${email.to} queued — will retry`;
}
