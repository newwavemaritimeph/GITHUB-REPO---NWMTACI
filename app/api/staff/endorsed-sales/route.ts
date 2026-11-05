import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildEndorsedSales, endorsedRange } from "@/lib/endorsed-sales";

export const runtime = "nodejs";

/** Sales from Endorsed Courses: ?period&end or ?from&to. Accounting / Admin. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const range = endorsedRange(new URL(request.url).searchParams);
  if (!range) return NextResponse.json({ error: "Choose a period and date." }, { status: 400 });
  try {
    return NextResponse.json(await buildEndorsedSales(createSupabaseAdminClient(), range), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the report." }, { status: 500 });
  }
}
