import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildCashierReport } from "@/lib/cashier-report";

export const runtime = "nodejs";

/** Cashier summary report for ?date=YYYY-MM-DD (Manila), as data for the Report screen. Cashier / Accounting / Admin. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Choose a valid date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: profile } = await db.from("profiles").select("complete_name").eq("id", staff.user.id).maybeSingle();
  const { logoBytes: _logo, ...report } = await buildCashierReport(db, date, profile?.complete_name ?? staff.user.email ?? "");
  void _logo;
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
