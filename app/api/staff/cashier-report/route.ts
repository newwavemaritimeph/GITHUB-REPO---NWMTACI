import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildCashierReport } from "@/lib/cashier-report";
import { MAX_RANGE_DAYS, buildSummaryRange } from "@/lib/summary-range";

export const runtime = "nodejs";

/** Cashier summary report for ?date=YYYY-MM-DD (Manila), as data for the Report screen. Cashier / Accounting / Admin. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const params = new URL(request.url).searchParams, date = params.get("date") ?? "";
  const iso = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  // A period (?from=&to=) for Accounting's Daily Summary, Design 3 (owner, 10 Nov 2026).
  if (params.has("from") || params.has("to")) {
    const from = params.get("from"), to = params.get("to");
    if (!iso(from) || !iso(to) || from > to) return NextResponse.json({ error: "Choose a valid period." }, { status: 400 });
    if ((Date.parse(to) - Date.parse(from)) / 86400000 >= MAX_RANGE_DAYS) return NextResponse.json({ error: `Choose a period of ${MAX_RANGE_DAYS} days or less.` }, { status: 400 });
    return NextResponse.json(await buildSummaryRange(createSupabaseAdminClient(), from, to), { headers: { "Cache-Control": "no-store" } });
  }
  if (!iso(date)) return NextResponse.json({ error: "Choose a valid date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: profile } = await db.from("profiles").select("complete_name").eq("id", staff.user.id).maybeSingle();
  const { logoBytes: _logo, ...report } = await buildCashierReport(db, date, profile?.complete_name ?? staff.user.email ?? "");
  void _logo;
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
