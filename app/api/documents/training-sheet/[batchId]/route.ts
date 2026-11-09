import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCompletion } from "@/lib/completion-record-server";
import { loadBatchRoster } from "@/lib/batch-roster";
import { loadDocumentControl } from "@/lib/document-controls";
import { isSheetKind, SHEET_FORMS, trainingDays } from "@/lib/training-sheets";
import { createTrainingSheetPdf } from "@/lib/print/training-sheets";

export const runtime = "nodejs";

/**
 * Training Reports sheets for one batch (owner, 9 Nov 2026): ?sheet=attendance|exercise|assessment, and for the
 * Attendance Sheet ?day=YYYY-MM-DD (one training day) or all days. MISMO Compliance Officer and Admin only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["mismo_officer", "admin"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url), kind = url.searchParams.get("sheet"), day = url.searchParams.get("day") ?? "";
  if (!isSheetKind(kind)) return NextResponse.json({ error: "Choose the attendance, exercise or assessment sheet." }, { status: 400 });
  const { batchId } = await params;
  const db = createSupabaseAdminClient();
  const record = await loadCompletion(db, batchId);
  if (!record) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  const roster = await loadBatchRoster(db, batchId).catch(() => null);
  const b = record.batch, allDays = trainingDays(b.startsOn, b.endsOn);
  const days = kind === "attendance" ? (allDays.includes(day) ? [day] : allDays) : [];
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((x) => new Uint8Array(x)).catch(() => undefined);
  const bytes = await createTrainingSheetPdf({
    kind, control: await loadDocumentControl(db, SHEET_FORMS[kind]), logo,
    courseCode: b.courseCode, courseName: b.courseName, classNo: record.fields.classNo || b.batchNumber, startsOn: b.startsOn, endsOn: b.endsOn,
    room: roster?.batch.room ?? null, instructor: roster?.batch.instructor ?? null, days, allDays,
    trainees: record.trainees.map((t) => ({ enrollmentId: t.enrollmentId, name: t.name, srn: t.srn ?? null })),
    tasks: record.tasks, results: record.results, exercises: record.exercises, assessor: record.fields.assessor,
  });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes.includes("mismo_officer") ? "mismo_officer" : "admin", action: "report.exported", record_type: "training_sheet", record_id: `${batchId}:${kind}${days.length === 1 ? `:${days[0]}` : ""}`, new_values: { sheet: kind, days } });
  const name = `${kind}-sheet-${b.batchNumber}${days.length === 1 ? `-${days[0]}` : ""}`.replace(/[^\w.-]/g, "");
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
}
