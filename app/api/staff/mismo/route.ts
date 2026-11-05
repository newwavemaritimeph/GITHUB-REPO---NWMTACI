import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { entryDays, type EntryRow } from "@/lib/mismo";
import { loadMismoDay } from "@/lib/mismo-server";

export const runtime = "nodejs";

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/** MARINA MISMO lists for a day or a period (MISMO Compliance Officer, Admin). */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "mismo_officer"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const params = new URL(request.url).searchParams, date = params.get("date") ?? manilaToday(), to = params.get("to") ?? date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < date) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  if (Date.parse(to) - Date.parse(date) > 366 * 86_400_000) return NextResponse.json({ error: "Choose a period of one year or less." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const day = await loadMismoDay(db, date, to);
  // Recent submissions for the history list.
  const { data: history } = await db.from("mismo_submissions").select("batch_id,list_date,trainee_count,submitted_at,profiles:submitted_by(complete_name),batches(batch_number,courses(name,code))").order("submitted_at", { ascending: false }).limit(1000);
  // Encoded ticks (migration 202610290080); none before it is run.
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const { data: ticks, error: tickError } = await db.from("mismo_entries").select("done_at,profiles:done_by(complete_name),enrollments(batch_id,batches(batch_number,courses(code)))").order("done_at", { ascending: false }).limit(3000);
  const rows: EntryRow[] = tickError ? [] : ((ticks ?? []) as unknown as { done_at: string; profiles: { complete_name: string } | { complete_name: string }[] | null; enrollments: { batch_id: string | null; batches: { batch_number: string; courses: { code: string } | { code: string }[] | null } | { batch_number: string; courses: { code: string } | { code: string }[] | null }[] | null } | null }[]).map((r) => { const b = one(r.enrollments?.batches); return { doneAt: r.done_at, by: one(r.profiles)?.complete_name ?? "—", batchId: r.enrollments?.batch_id ?? "", batchNumber: b?.batch_number ?? "—", code: one(b?.courses)?.code ?? "—" }; });
  return NextResponse.json({ ...day, now: new Date().toISOString(), history: history ?? [], entryDays: entryDays(rows) }, { headers: { "Cache-Control": "no-store" } });
}
