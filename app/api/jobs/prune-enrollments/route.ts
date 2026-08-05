import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pruneUnpaidEnrollments, deletePastEmptyBatches } from "@/lib/enrollments";

export const runtime = "nodejs";
export const maxDuration = 60;

// Scheduled cleanup of UNPAID ("pending") enrollments — triggered like the other
// jobs with the SCHEDULED_JOB_SECRET bearer. Rules live in pruneUnpaidEnrollments.
async function run(request: Request) {
  const expected = process.env.SCHEDULED_JOB_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = createSupabaseAdminClient();
    const removed = await pruneUnpaidEnrollments(admin);
    const batchesRemoved = await deletePastEmptyBatches(admin);
    return NextResponse.json({ removed, batchesRemoved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Prune failed." }, { status: 500 });
  }
}

export async function POST(request: Request) { return run(request); }
export async function GET(request: Request) { return run(request); }
