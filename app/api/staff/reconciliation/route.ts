import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadGcashDay } from "@/lib/reconciliation-server";
import { manilaDay } from "@/lib/reconciliation";

export const runtime = "nodejs";

/** GCash reconciliation day (owner, 9 Oct 2026): Admin Assistant checks; Accounting and the Admin view. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "admin_assistant", "accounting"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const today = manilaDay(new Date().toISOString());
  const asked = new URL(request.url).searchParams.get("date") ?? today;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  try {
    return NextResponse.json(await loadGcashDay(createSupabaseAdminClient(), day, today), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the GCash payments." }, { status: 400 });
  }
}
