import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createReconciliationSheetPdf } from "@/lib/print/reconciliation-sheet";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadReconDay } from "@/lib/reconciliation-server";
import { manilaDay, parseChannel } from "@/lib/reconciliation";

export const runtime = "nodejs";


/**
 * GCash reconciliation day sheet (owner, 9 Oct 2026): the day's GCash payments
 * with an "In history" tick column, to lay beside the printed GCash history.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "admin_assistant", "accounting"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const today = manilaDay(new Date().toISOString());
  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? today, channel = parseChannel(params.get("channel"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const day = await loadReconDay(db, date, today, channel);
  const bytes = await createReconciliationSheetPdf(date, channel, day);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "report.exported", record_type: "report", record_id: `reconciliation:${channel}:${date}`, new_values: { date, channel, payments: day.rows.length } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${channel.toLowerCase()}-reconciliation-${date}.pdf"`, "cache-control": "no-store" } });
}
