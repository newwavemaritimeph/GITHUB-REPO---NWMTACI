import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCompletion } from "@/lib/completion-record-server";
import { completionPdf, completionNaming } from "@/lib/completion-drive";

export const runtime = "nodejs";

/** The Training Completion and Record of Assessment Report as a PDF (Download PDF on the MISMO screen). */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["mismo_officer", "admin"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { batchId } = await params;
  const record = await loadCompletion(createSupabaseAdminClient(), batchId);
  if (!record) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  const bytes = await completionPdf(record);
  const name = completionNaming({ courseCode: record.batch.courseCode, endsOn: record.batch.endsOn, batchNumber: record.batch.batchNumber, classNo: record.fields.classNo }).base;
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name.replace(/[^\w .-]/g, "")}.pdf"`, "cache-control": "private, no-store" } });
}
