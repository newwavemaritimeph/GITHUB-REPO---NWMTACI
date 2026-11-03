import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { loadBatchRoster } from "@/lib/batch-roster";
import { createBatchRosterPdf } from "@/lib/print/batch-roster";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Batch trainee list as PDF (owner, 3 Nov 2026); audited as an export. */
export async function GET(request: Request) {
  const staff = await requireStaff(["admin", "admin_assistant", "registration", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const batchId = new URL(request.url).searchParams.get("batchId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return NextResponse.json({ error: "Choose a batch." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const roster = await loadBatchRoster(db, batchId);
  if (!roster) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((b) => new Uint8Array(b)).catch(() => undefined);
  const { data: me } = await db.from("profiles").select("complete_name").eq("id", staff.user.id).maybeSingle();
  const bytes = await createBatchRosterPdf(roster, { logo, preparedBy: (me?.complete_name as string | undefined) ?? null });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "report.exported", record_type: "batch_roster", record_id: batchId, new_values: { batch: roster.batch.batchNumber, trainees: roster.rows.length } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="batch-${roster.batch.batchNumber}.pdf"`, "cache-control": "no-store" } });
}
