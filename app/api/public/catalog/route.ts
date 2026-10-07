import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { LATE_ENROLLMENT_CODES, PUBLIC_STCW_CODES } from "@/lib/scheduling";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";

export const runtime = "nodejs";

// Category and modality come from the New Wave course catalog (lib/in-house-catalog),
// which files every course under its official heading; the database name is a fallback.
const CATALOG = new Map(IN_HOUSE_COURSES.map((c) => [c.code, c]));
const STCW_CATEGORIES = new Set(["Accredited MARINA STCW", "MARINA Domestic"]);

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The public Courses page (owner, 7 Oct 2026):
 * - stcw: the five STCW courses New Wave schedules, each with its bookable
 *   batches (published, open, not started, before the deadline, seats left).
 * - inHouse: every other active New Wave in-house course, for the date picker.
 * Read-only and anonymous; only names, codes, durations, modality, category,
 * batch dates and seats left leave the server (no prices, rebates or partner data).
 */
export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ stcw: [], inHouse: [] });
  const db = createSupabaseAdminClient();
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
  const [courses, batches] = await Promise.all([
    db.from("courses").select("id,code,name,duration_label,duration_days,training_mode,course_categories(name)").eq("active", true).eq("delivery_type", "In-House").order("name"),
    db.from("batches").select("id,batch_number,course_id,starts_on,ends_on,capacity,confirmed_count,status,courses!inner(code,delivery_type)")
      .in("status", ["Open", "Full"]).not("published_at", "is", null).gte("ends_on", today).gt("enrollment_deadline", now.toISOString())
      .in("courses.code", [...PUBLIC_STCW_CODES]).order("starts_on"),
  ]);
  if (courses.error || batches.error) {
    console.error("Public catalog failed:", courses.error?.message ?? batches.error?.message);
    return NextResponse.json({ stcw: [], inHouse: [] }, { status: 500 });
  }
  const stcwCodes = new Set<string>(PUBLIC_STCW_CODES);
  const shape = (c: (typeof courses.data)[number]) => ({ code: c.code, name: c.name, duration: c.duration_label, modality: CATALOG.get(c.code)?.modality ?? c.training_mode ?? "Face-to-face", category: CATALOG.get(c.code)?.category ?? first(c.course_categories as { name: string } | { name: string }[] | null)?.name ?? "Maritime In-House" });
  // The catalog holds some courses more than once (same code or name). List each
  // once; an STCW course gathers the batches opened on any of its copies.
  const idsByCode = new Map<string, Set<string>>();
  for (const c of courses.data) idsByCode.set(c.code, (idsByCode.get(c.code) ?? new Set()).add(c.id));
  const stcw = PUBLIC_STCW_CODES.map((code) => courses.data.find((c) => c.code === code)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => ({
    ...shape(c),
    batches: (batches.data ?? []).filter((b) => idsByCode.get(c.code)?.has(b.course_id) && (b.starts_on > today || LATE_ENROLLMENT_CODES.includes(c.code)))
      // Seats left are shown on the Courses page and the form; a full batch stays listed as "Full".
      .map((b) => ({ id: b.id, number: b.batch_number, startsOn: b.starts_on, endsOn: b.ends_on, capacity: b.capacity, seatsLeft: b.status === "Full" ? 0 : Math.max(0, b.capacity - b.confirmed_count) })),
  }));
  // The In-House picker leaves out every STCW / MARINA Domestic course: only the five above are offered.
  const seen = new Set<string>();
  // Every New Wave in-house course runs online (owner, 7 Oct 2026).
  const inHouse = courses.data.filter((c) => !stcwCodes.has(c.code)).map((c) => ({ ...shape(c), modality: "Online" })).filter((c) => !STCW_CATEGORIES.has(c.category) && !/stcw|domestic/i.test(c.category))
    .filter((c) => { const keys = [`code:${c.code.trim().toUpperCase()}`, `name:${c.name.trim().toLowerCase().replace(/\s+/g, " ")}`]; if (keys.some((k) => seen.has(k))) return false; keys.forEach((k) => seen.add(k)); return true; });
  return NextResponse.json({ stcw, inHouse }, { headers: { "Cache-Control": "no-store" } });
}
