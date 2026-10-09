import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, processEmailJobs } from "@/lib/email-jobs";
import { sendBalanceSummary } from "@/lib/balance-summary";
import { sendReconciliationReminder } from "@/lib/reconciliation-alert";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily at 4:00 PM Manila (Vercel cron, 08:00 UTC): email the Cashier and the
 * Accounting Manager the trainees whose training ended (or ends today) with a
 * balance still due, remind Accounting of payments not reconciled, then send
 * any other queued emails.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const allowed = [process.env.SCHEDULED_JOB_SECRET, process.env.CRON_SECRET].filter(Boolean).map((secret) => `Bearer ${secret}`);
  if (!auth || !allowed.includes(auth)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!emailConfigured()) return NextResponse.json({ error: "Email delivery is not configured." }, { status: 503 });
  const db = createSupabaseAdminClient();
  const origin = new URL(request.url).origin;
  const summary = await sendBalanceSummary(db, { origin });
  // Accounting reminder for GCash, PSBank and UnionBank payments not reconciled (owner, 9 Oct 2026).
  const reconciliation = await sendReconciliationReminder(db, { origin }).catch(() => ({ configured: true, recipients: 0, payments: 0 }));
  const queued = await processEmailJobs(db, { limit: 20, origin }).catch(() => ({ results: [] }));
  return NextResponse.json({ ...summary, reconciliation, otherEmails: queued.results.length });
}
