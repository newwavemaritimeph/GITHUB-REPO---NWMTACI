import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) return NextResponse.json({ error: "Webhook verification is not configured." }, { status: 503 });
  const payload = await request.text();
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const event = resend.webhooks.verify({
      payload,
      webhookSecret,
      headers: {
        id: request.headers.get("svix-id") ?? request.headers.get("webhook-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? request.headers.get("webhook-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? request.headers.get("webhook-signature") ?? "",
      },
    });
    const data = event.data as { email_id?: string; created_at?: string };
    const providerMessageId = data.email_id ?? null;
    const db = createSupabaseAdminClient();
    const { data: job } = providerMessageId ? await db.from("email_jobs").select("id").eq("provider_message_id", providerMessageId).maybeSingle() : { data: null };
    await db.from("email_logs").insert({
      email_job_id: job?.id ?? null,
      provider_message_id: providerMessageId,
      event_type: event.type,
      provider_payload: event,
      occurred_at: data.created_at ?? new Date().toISOString(),
      webhook_event_id: request.headers.get("svix-id") ?? request.headers.get("webhook-id"),
    });
    if (job?.id && ["email.delivered", "email.bounced", "email.failed", "email.complained", "email.suppressed"].includes(event.type)) {
      const state = event.type === "email.delivered" ? "Delivered" : "Delivery Failed";
      await db.from("email_jobs").update({ state }).eq("id", job.id);
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }
}
