import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createMismoListPdf } from "@/lib/print/mismo-list";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadMismoDay } from "@/lib/mismo-server";

export const runtime = "nodejs";


/**
 * MARINA MISMO lists as PDF (MISMO Compliance Officer, Admin).
 * list=final: trainees settled by 4:00 PM, for the MARINA MISMO Portal.
 * list=unsettled: trainees not settled as of 11:00 AM, for the instructor.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "mismo_officer"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "", batchId = url.searchParams.get("batch"), list = url.searchParams.get("list") === "unsettled" ? "unsettled" : "final";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const day = await loadMismoDay(db, date);
  const batches = day.batches.filter((b) => !batchId || b.id === batchId);
  if (!batches.length) return NextResponse.json({ error: "No STCW class on this day." }, { status: 404 });

  // Letterhead emblem and the name of the officer printing it (Prepared by).
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((b) => new Uint8Array(b)).catch(() => undefined);
  const { data: me } = await db.from("profiles").select("complete_name").eq("id", staff.user.id).maybeSingle();
  const bytes = await createMismoListPdf(date, batches, list, { logo, preparedBy: staff.roleCodes.includes("mismo_officer") ? (me?.complete_name as string | undefined) ?? null : null });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "mismo_officer", action: "report.exported", record_type: "mismo_list", record_id: `${date}:${batchId ?? "all"}`, new_values: { list } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="mismo-${list}-${date}.pdf"`, "cache-control": "no-store" } });
}
