import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const querySchema = z.string().trim().min(2).max(40);

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("courseCode"));
  if (!parsed.success) return NextResponse.json({ schedules: [] });
  if (!isSupabaseConfigured()) return NextResponse.json({ schedules: [] });
  const db = await createSupabaseServerClient();
  const now = new Date();
  // Manila calendar day — must match how the submit RPC evaluates starts_on/current_date,
  // otherwise a batch starting "today" in Manila shows here but is rejected on submit.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
  // Public visitors only see the coming week's published schedules.
  const weekEnd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(now.getTime() + 7 * 86400000));
  const { data, error } = await db.from("batches")
    .select("id,batch_number,starts_on,ends_on,mode,venue,capacity,confirmed_count,courses!inner(code)")
    .eq("courses.code", parsed.data)
    .eq("status", "Open")
    .not("published_at", "is", null)
    .gt("starts_on", today)
    .lte("starts_on", weekEnd)
    .gt("enrollment_deadline", now.toISOString())
    .order("starts_on", { ascending: true });
  if (error) return NextResponse.json({ schedules: [] }, { status: 500 });
  const schedules = (data ?? []).filter((batch) => batch.confirmed_count < batch.capacity).map((batch) => ({
    id: batch.id,
    label: `${new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${batch.starts_on}T00:00:00+08:00`))}${batch.ends_on !== batch.starts_on ? ` – ${new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${batch.ends_on}T00:00:00+08:00`))}` : ""} · ${batch.mode}${batch.venue ? ` · ${batch.venue}` : ""}`,
    availableSlots: batch.capacity - batch.confirmed_count,
  }));
  return NextResponse.json({ schedules }, { headers: { "Cache-Control": "no-store" } });
}
