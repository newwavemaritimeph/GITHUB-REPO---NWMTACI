import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** In-house courses that currently have at least one bookable (published, open,
 * future, not-full) batch — the only courses a public visitor can register into. */
export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ courses: [] });
  const db = await createSupabaseServerClient();
  const now = new Date();
  // Manila calendar day — align with the submit RPC's current_date check.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
  const { data, error } = await db.from("batches")
    .select("capacity,confirmed_count,courses!inner(code,name,delivery_type)")
    .eq("status", "Open")
    .not("published_at", "is", null)
    .gt("starts_on", today)
    .gt("enrollment_deadline", now.toISOString());
  if (error) return NextResponse.json({ courses: [] }, { status: 500 });
  const seen = new Map<string, { code: string; name: string }>();
  for (const row of data ?? []) {
    if (row.confirmed_count >= row.capacity) continue;
    const c = Array.isArray(row.courses) ? row.courses[0] : row.courses;
    if (!c || c.delivery_type !== "In-House") continue;
    if (!seen.has(c.code)) seen.set(c.code, { code: c.code, name: c.name });
  }
  const courses = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ courses }, { headers: { "Cache-Control": "no-store" } });
}
