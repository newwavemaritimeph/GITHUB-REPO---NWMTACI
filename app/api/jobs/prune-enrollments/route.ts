import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hardDeleteEnrollment } from "@/lib/enrollments";

export const runtime = "nodejs";
export const maxDuration = 60;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Scheduled cleanup of UNPAID ("pending") enrollments. Triggered like the other
// jobs with the SCHEDULED_JOB_SECRET bearer. Rules:
//  - courses shorter than 2 days: delete when unpaid for more than 24 hours;
//  - any course: delete when the training starts within the next 12 hours (or already started).
// Paid enrollments (any payment_allocation) are never touched.
async function run(request: Request) {
  const expected = process.env.SCHEDULED_JOB_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createSupabaseAdminClient();
  const now = Date.now();

  const { data: rows, error } = await db.from("enrollments")
    .select("id,created_at,batch_id,enrollment_status,courses(duration_days),batches(starts_on,daily_start)")
    .neq("enrollment_status", "Cancelled").limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: allocs } = await db.from("payment_allocations").select("enrollment_id");
  const paid = new Set((allocs ?? []).map((a) => (a as { enrollment_id: string }).enrollment_id));

  const toDelete: string[] = [];
  for (const e of rows ?? []) {
    if (paid.has(e.id)) continue;
    const course = one(e.courses as { duration_days?: number } | { duration_days?: number }[] | null);
    const batch = one(e.batches as { starts_on?: string; daily_start?: string | null } | { starts_on?: string; daily_start?: string | null }[] | null);
    const durationDays = Number(course?.duration_days ?? 99);
    const ageHours = e.created_at ? (now - new Date(e.created_at).getTime()) / 3_600_000 : 0;
    let remove = false;
    if (durationDays < 2 && ageHours > 24) remove = true;
    if (batch?.starts_on) {
      const startMs = new Date(`${batch.starts_on}T${(batch.daily_start ?? "08:00").slice(0, 5)}:00+08:00`).getTime();
      if (startMs <= now + 12 * 3_600_000) remove = true;
    }
    if (remove) toDelete.push(e.id);
  }

  for (const id of toDelete) await hardDeleteEnrollment(db, id);
  return NextResponse.json({ removed: toDelete.length });
}

export async function POST(request: Request) { return run(request); }
export async function GET(request: Request) { return run(request); }
