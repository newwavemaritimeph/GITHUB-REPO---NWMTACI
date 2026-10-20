import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emailConfigured } from "@/lib/email-jobs";
import { sendCertificateReport } from "@/lib/certificate-report";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Daily at 8:00 PM Manila (Vercel cron, 12:00 UTC): the certificate report to the Admin (owner, 20 Oct 2026). */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const allowed = [process.env.SCHEDULED_JOB_SECRET, process.env.CRON_SECRET].filter(Boolean).map((secret) => `Bearer ${secret}`);
  if (!auth || !allowed.includes(auth)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!emailConfigured()) return NextResponse.json({ error: "Email delivery is not configured." }, { status: 503 });
  const result = await sendCertificateReport(createSupabaseAdminClient(), { origin: new URL(request.url).origin });
  return NextResponse.json(result);
}
