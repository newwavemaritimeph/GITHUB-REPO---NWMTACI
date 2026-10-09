import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadMismoDay } from "@/lib/mismo-server";

export const runtime = "nodejs";

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/** MARINA MISMO lists for a day (MISMO Compliance Officer, Admin). */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "mismo_officer"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const date = new URL(request.url).searchParams.get("date") ?? manilaToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const day = await loadMismoDay(db, date);
  // Recent submissions for the history list.
  const { data: history } = await db.from("mismo_submissions").select("batch_id,list_date,trainee_count,submitted_at,profiles:submitted_by(complete_name),batches(batch_number,courses(name,code))").order("submitted_at", { ascending: false }).limit(100);
  return NextResponse.json({ ...day, now: new Date().toISOString(), history: history ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
