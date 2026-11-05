import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mismoWork } from "@/lib/mismo";
import { loadMismoDay, loadMismoEntries } from "@/lib/mismo-server";

export const runtime = "nodejs";

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const fresh = { headers: { "Cache-Control": "no-store" } };

/**
 * MARINA MISMO lists (MISMO Compliance Officer, Admin): a day or a period; ?work=1 for the trainees still to encode;
 * ?log=1 for everyone already encoded.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "mismo_officer"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const params = new URL(request.url).searchParams, date = params.get("date") ?? manilaToday(), to = params.get("to") ?? date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < date) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  if (Date.parse(to) - Date.parse(date) > 366 * 86_400_000) return NextResponse.json({ error: "Choose a period of one year or less." }, { status: 400 });
  const db = createSupabaseAdminClient();
  if (params.get("log") === "1") {
    // Batches marked submitted before each trainee got a tick (5 Nov 2026) stay on record.
    const { data: history } = await db.from("mismo_submissions").select("batch_id,list_date,trainee_count,submitted_at,profiles:submitted_by(complete_name),batches(batch_number,courses(name,code))").order("submitted_at", { ascending: false }).limit(1000);
    return NextResponse.json({ entries: await loadMismoEntries(db), history: history ?? [] }, fresh);
  }
  const work = params.get("work") === "1";
  const day = await loadMismoDay(db, date, to, { staffing: !work });
  return NextResponse.json({ ...day, batches: work ? mismoWork(day.batches) : day.batches, now: new Date().toISOString() }, fresh);
}
