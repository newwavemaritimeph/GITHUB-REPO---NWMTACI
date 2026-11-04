import { randomUUID } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleAccessToken } from "@/lib/google-classroom";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type MailMessage = { from: string; to: string; subject: string; html: string; text: string; attachments?: { filename: string; content: Buffer }[] };

/**
 * Portal email through the connected Google account (owner, 4 Nov 2026: "I am using Vercel and Google Cloud").
 * The Gmail API takes one raw message, so the parts are built here: text and HTML, then any PDFs.
 */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const header = (value: string) => { const v = oneLine(value); return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`; };
const body = (content: string | Buffer) => (typeof content === "string" ? Buffer.from(content, "utf8") : content).toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
const quoted = (value: string) => oneLine(value).replace(/["\\]/g, "");

export function buildMime(message: MailMessage, id: string = randomUUID()) {
  const mixed = `nw-mixed-${id}`, alternative = `nw-alt-${id}`;
  const part = (type: string, content: string) => [`Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", body(content)];
  return [
    `From: ${oneLine(message.from)}`, `To: ${oneLine(message.to)}`, `Subject: ${header(message.subject)}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${mixed}"`, "",
    `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alternative}"`, "",
    `--${alternative}`, ...part("text/plain", message.text),
    `--${alternative}`, ...part("text/html", message.html),
    `--${alternative}--`,
    ...(message.attachments ?? []).flatMap((a) => [`--${mixed}`, `Content-Type: application/pdf; name="${quoted(a.filename)}"`, `Content-Disposition: attachment; filename="${quoted(a.filename)}"`, "Content-Transfer-Encoding: base64", "", body(a.content)]),
    `--${mixed}--`, "",
  ].join("\r\n");
}

/** Sends one message from the connected Google account and returns Gmail's message ID. */
export async function sendViaGmail(db: Admin, message: MailMessage) {
  const token = await googleAccessToken(db);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(buildMime(message), "utf8").toString("base64url") }),
  });
  const result = await response.json().catch(() => null) as { id?: string; error?: { message?: string } } | null;
  if (response.status === 401 || response.status === 403) throw new Error(`Gmail refused the email: ${result?.error?.message ?? response.status}. Turn on the Gmail API in Google Cloud, then reconnect Google in the portal.`);
  if (!response.ok || !result?.id) throw new Error(result?.error?.message ?? "Gmail returned no message ID.");
  return result.id;
}
