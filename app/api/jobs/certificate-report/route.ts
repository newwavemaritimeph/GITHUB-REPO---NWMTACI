import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emailConfigured } from "@/lib/email-jobs";
import { sendCertificateReport } from "@/lib/certificate-report";
import { sendAutoReminders } from "@/lib/hr-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Daily at 8:00 PM Manila (Vercel cron, 12:00 UTC): the certificate report to the Admin (owner, 20 Oct 2026), with its HR section, and the HR reminders. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const allowed = [process.env.SCHEDULED_JOB_SECRET, process.env.CRON_SECRET].filter(Boolean).map((secret) => `Bearer ${secret}`);
  if (!auth || !allowed.includes(auth)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!emailConfigured()) return NextResponse.json({ error: "Email delivery is not configured." }, { status: 503 });
  const db = createSupabaseAdminClient(), origin = new URL(request.url).origin;
  const result = await sendCertificateReport(db, { origin });
  // HR (owner, 10 Nov 2026): automatic Fit to Work and Biodata reminders; never blocks the report.
  const hrReminders = await sendAutoReminders(db, origin).catch((e) => ({ sent: 0, error: e instanceof Error ? e.message : "failed" }));
  return NextResponse.json({ ...result, hrReminders });
}
