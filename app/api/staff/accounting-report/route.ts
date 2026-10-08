import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PERIODS, type Period } from "@/lib/accounting-periods";
import { buildAccountingReport } from "@/lib/accounting-report";

export const runtime = "nodejs";

/** Period report for the Accounting Manager: ?period=Daily|Weekly|Monthly|Quarterly|Annually&end=YYYY-MM-DD. Accounting / Admin. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const period = url.searchParams.get("period") as Period | null;
  const end = url.searchParams.get("end") ?? "";
  if (!period || !(PERIODS as readonly string[]).includes(period) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return NextResponse.json({ error: "Choose a period and date." }, { status: 400 });
  const report = await buildAccountingReport(createSupabaseAdminClient(), period, end);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
