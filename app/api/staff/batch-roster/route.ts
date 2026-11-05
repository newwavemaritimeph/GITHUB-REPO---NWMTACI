import { NextResponse } from "next/server";
import { loadBatchRoster } from "@/lib/batch-roster";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Every trainee on one batch, for the Batch window (owner, 3 Nov 2026). */
export async function GET(request: Request) {
  const staff = await requireStaff(["admin", "admin_assistant", "registration", "cashier", "accounting", "mismo_officer"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const batchId = new URL(request.url).searchParams.get("batchId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return NextResponse.json({ error: "Choose a batch." }, { status: 400 });
  const roster = await loadBatchRoster(createSupabaseAdminClient(), batchId);
  if (!roster) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  return NextResponse.json(roster, { headers: { "Cache-Control": "no-store" } });
}
