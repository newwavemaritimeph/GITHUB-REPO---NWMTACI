import { Resend } from "resend";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/classroom";
import { instructionEmailVariables } from "@/lib/instruction-templates";
import { buildTrainingInstructionsPdf, loadInstructionDetails } from "@/lib/training-instructions";
import { buildCertificatePdf, certificateContext } from "@/lib/certificates";
import { activeConnection, googleConfigured, hasGmailScope } from "@/lib/google-classroom";
import { sendViaGmail, type MailMessage } from "@/lib/google-mail";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type EmailJob = { id: string; template_code: string; recipient: string; variables: Record<string, unknown> | null; attempts: number | null };

/**
 * Fill {{name}} placeholders. In HTML, values are escaped unless the variable
 * name ends in "_html" (those are built by the server, e.g. the Classroom block).
 */
export function renderTemplate(template: string, variables: Record<string, unknown>, html = false) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = key.split(".").reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, variables);
    if (value == null) return "";
    return html && !key.endsWith("_html") ? escapeHtml(String(value)) : String(value);
  });
}

const resendReady = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
/** Email goes through the connected Google account, or Resend when its keys are set. */
export const emailConfigured = () => resendReady() || googleConfigured();

type SendMail = (message: Omit<MailMessage, "from">, jobId: string) => Promise<{ id: string; payload: unknown }>;
/** How to send right now; null while the Google account has not allowed sending, so the jobs wait in the queue. */
async function mailSender(db: Admin): Promise<SendMail | null> {
  if (resendReady()) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    return async (message, jobId) => {
      const response = await resend.emails.send({ ...message, from: process.env.EMAIL_FROM!, tags: [{ name: "email_job_id", value: jobId }] });
      if (response.error || !response.data?.id) throw new Error(response.error?.message ?? "Email provider returned no message ID.");
      return { id: response.data.id, payload: response.data };
    };
  }
  const connection = googleConfigured() ? await activeConnection(db) : null;
  if (!connection || !hasGmailScope(connection.scopes)) return null;
  const from = `New Wave Maritime <${connection.account_email}>`;
  return async (message) => { const id = await sendViaGmail(db, { ...message, from }); return { id, payload: { id, via: "gmail" } }; };
}

/**
 * Send queued emails. With `ids`, only those jobs are claimed
 * (used to send right after Registration clicks Generate); otherwise the next
 * due batch. Failures retry with backoff, up to five attempts.
 * A job whose variables carry `attach_instructions_for` gets that enrollment's
 * training instructions PDF attached.
 */
export async function processEmailJobs(db: Admin, options: { limit?: number; ids?: string[]; origin?: string } = {}) {
  const send = await mailSender(db);
  if (!send) return { configured: false, results: [] as { id: string; state: string; error?: string }[] };
  let jobs: EmailJob[] = [];
  if (options.ids?.length) {
    for (const id of options.ids) {
      const { data: job } = await db.from("email_jobs").select("id,template_code,recipient,variables,attempts").eq("id", id).eq("state", "Queued").maybeSingle();
      if (!job) continue;
      const { data: claimed } = await db.from("email_jobs").update({ state: "Processing", attempts: Number(job.attempts ?? 0) + 1 }).eq("id", id).eq("state", "Queued").select("id,template_code,recipient,variables,attempts").maybeSingle();
      if (claimed) jobs.push(claimed as EmailJob);
    }
  } else {
    const { data, error } = await db.rpc("claim_email_jobs", { batch_size: options.limit ?? 20 });
    if (error) throw error;
    jobs = (data ?? []) as EmailJob[];
  }
  const results: { id: string; state: string; error?: string }[] = [];
  for (const job of jobs) {
    const { data: template } = await db.from("email_templates").select("subject,body_html,body_text").eq("template_code", job.template_code).eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    try {
      if (!template) throw new Error(`No active email template for ${job.template_code}`);
      const variables = (job.variables ?? {}) as Record<string, unknown>;
      const attachments: { filename: string; content: Buffer }[] = [];
      if (typeof variables.attach_instructions_for === "string") {
        const details = await loadInstructionDetails(db, variables.attach_instructions_for);
        if (details) {
          Object.assign(variables, instructionEmailVariables(details));
          attachments.push({ filename: `training-instructions-${details.enrollmentNumber}.pdf`, content: Buffer.from(await buildTrainingInstructionsPdf(details, options.origin)) });
        }
      }
      // Certificate soft copy (owner, 8 Oct 2026): the electronic copy of the trainee's certificate.
      if (typeof variables.attach_certificate_for === "string") {
        const ctx = await certificateContext(db, variables.attach_certificate_for);
        if (!ctx) throw new Error("Certificate not found for the soft copy.");
        attachments.push({ filename: `certificate-${ctx.cert?.certificate_number ?? ctx.enrollment.enrollment_number}.pdf`, content: Buffer.from(await buildCertificatePdf(db, ctx, "soft")) });
      }
      const sent = await send({
        to: job.recipient,
        subject: renderTemplate(template.subject, variables),
        html: renderTemplate(template.body_html, variables, true),
        text: renderTemplate(template.body_text, variables),
        ...(attachments.length ? { attachments } : {}),
      }, job.id);
      await db.from("email_jobs").update({ state: "Sent", sent_at: new Date().toISOString(), provider_message_id: sent.id, last_error: null }).eq("id", job.id).eq("state", "Processing");
      await db.from("email_logs").insert({ email_job_id: job.id, provider_message_id: sent.id, event_type: "email.sent", provider_payload: sent.payload, occurred_at: new Date().toISOString() });
      results.push({ id: job.id, state: "Sent" });
    } catch (error) {
      const attempts = Number(job.attempts ?? 1);
      const terminal = attempts >= 5;
      const message = error instanceof Error ? error.message : "Unknown delivery error";
      const retryAt = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString();
      await db.from("email_jobs").update({ state: terminal ? "Failed" : "Queued", scheduled_for: retryAt, last_error: message }).eq("id", job.id).eq("state", "Processing");
      results.push({ id: job.id, state: terminal ? "Failed" : "Queued", error: message });
    }
  }
  return { configured: true, results };
}
