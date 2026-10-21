import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PERIODS, type Period } from "@/lib/accounting-periods";
import { buildCompanyCharges } from "@/lib/company-charges";

export const runtime = "nodejs";

/** Company Charge List: ?period=…&end=YYYY-MM-DD. Accounting / Admin. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const period = url.searchParams.get("period") as Period | null, end = url.searchParams.get("end") ?? "";
  if (!period || !(PERIODS as readonly string[]).includes(period) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return NextResponse.json({ error: "Choose a period and date." }, { status: 400 });
  return NextResponse.json(await buildCompanyCharges(createSupabaseAdminClient(), period, end), { headers: { "Cache-Control": "no-store" } });
}
