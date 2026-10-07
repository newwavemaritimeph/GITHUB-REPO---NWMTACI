import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, processEmailJobs } from "@/lib/email-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends queued emails (instructions, instructor schedules, feedback). Called by
 * the Vercel cron (GET with CRON_SECRET) to retry anything not sent right away,
 * or manually with the SCHEDULED_JOB_SECRET bearer.
 */
async function run(request: Request) {
  const auth = request.headers.get("authorization");
  const allowed = [process.env.SCHEDULED_JOB_SECRET, process.env.CRON_SECRET].filter(Boolean).map((secret) => `Bearer ${secret}`);
  if (!auth || !allowed.includes(auth)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!emailConfigured()) return NextResponse.json({ error: "Email delivery is not configured." }, { status: 503 });
  try {
    const { results } = await processEmailJobs(createSupabaseAdminClient(), { limit: 20, origin: new URL(request.url).origin });
    return NextResponse.json({ processed: results.length, results });
  } catch {
    return NextResponse.json({ error: "Could not claim queued emails." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
