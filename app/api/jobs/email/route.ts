import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function renderTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = key.split(".").reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, variables);
    return value == null ? "" : String(value);
  });
}

export async function POST(request: Request) {
  const expected = process.env.SCHEDULED_JOB_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return NextResponse.json({ error: "Email delivery is not configured." }, { status: 503 });

  const db = createSupabaseAdminClient();
  const { data: jobs, error: claimError } = await db.rpc("claim_email_jobs", { batch_size: 20 });
  if (claimError) return NextResponse.json({ error: "Could not claim queued emails." }, { status: 500 });
  const resend = new Resend(process.env.RESEND_API_KEY);
  const results: { id: string; state: string }[] = [];

  for (const job of jobs ?? []) {
    const { data: template } = await db.from("email_templates").select("subject,body_html,body_text").eq("template_code", job.template_code).eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    try {
      if (!template) throw new Error(`No active template for ${job.template_code}`);
      const variables = (job.variables ?? {}) as Record<string, unknown>;
      const response = await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: job.recipient,
        subject: renderTemplate(template.subject, variables),
        html: renderTemplate(template.body_html, variables),
        text: renderTemplate(template.body_text, variables),
        tags: [{ name: "email_job_id", value: job.id }],
      });
      if (response.error || !response.data?.id) throw new Error(response.error?.message ?? "Email provider returned no message ID.");
      await db.from("email_jobs").update({ state: "Sent", sent_at: new Date().toISOString(), provider_message_id: response.data.id, last_error: null }).eq("id", job.id).eq("state", "Processing");
      await db.from("email_logs").insert({ email_job_id: job.id, provider_message_id: response.data.id, event_type: "email.sent", provider_payload: response.data, occurred_at: new Date().toISOString() });
      results.push({ id: job.id, state: "Sent" });
    } catch (error) {
      const attempts = Number(job.attempts ?? 1);
      const terminal = attempts >= 5;
      const retryAt = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString();
      await db.from("email_jobs").update({ state: terminal ? "Failed" : "Queued", scheduled_for: retryAt, last_error: error instanceof Error ? error.message : "Unknown delivery error" }).eq("id", job.id).eq("state", "Processing");
      results.push({ id: job.id, state: terminal ? "Failed" : "Queued" });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
