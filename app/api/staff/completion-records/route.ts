import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { manilaDay } from "@/lib/reconciliation";
import { cleanTasks, listCompletionBatches, loadCompletion } from "@/lib/completion-record-server";
import { completionProblems, fitResult } from "@/lib/completion-record";

export const runtime = "nodejs";

/**
 * Training Completion Records (owner, 9 Oct 2026): the MISMO Compliance Officer
 * (and the Admin) prepare the Training Completion and Record of Assessment
 * Report for each STCW batch. GET lists batches or loads one; POST saves.
 */
const ROLES = ["mismo_officer", "admin"];
const MIGRATION = "Apply database update 202610090039 first.";
const text = (n: number) => z.string().trim().max(n).default("");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default("");
const task = z.object({ title: z.string().trim().min(1).max(400), criteria: z.string().trim().max(600).default("") });
const result = z.object({ pct: z.number().min(0).max(100).nullable(), ticks: z.array(z.boolean().nullable()).max(8), cert: z.string().trim().max(60).default("") });
const saveInput = z.object({
  action: z.literal("save"), batchId: z.string().uuid(),
  fields: z.object({ classNo: text(40), resitClassNo: text(40), resitDuration: text(80), writtenPlace: text(60), practicalPlace: text(60), assessor: text(120), coaValidity: text(60), assessedOn: day, director: text(120), directorOn: day }),
  results: z.record(z.string().uuid(), result),
});
const tasksInput = z.object({ action: z.literal("tasks"), courseId: z.string().uuid(), batchId: z.string().uuid().optional(), tasks: z.array(task).max(8) });
const printInput = z.object({ action: z.literal("printed"), batchId: z.string().uuid() });
const input = z.discriminatedUnion("action", [saveInput, tasksInput, printInput]);
const missing = (m: string) => /training_completion_records|course_assessment_tasks|does not exist|schema cache/i.test(m);

export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ROLES.includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const db = createSupabaseAdminClient();
  const batch = new URL(request.url).searchParams.get("batch");
  try {
    if (batch) {
      const payload = await loadCompletion(db, batch);
      return payload ? NextResponse.json(payload, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }
    return NextResponse.json(await listCompletionBatches(db, manilaDay(new Date().toISOString())), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the records." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ROLES.includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the entries." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const role = staff.roleCodes.includes("mismo_officer") ? "mismo_officer" : "admin";
  const body = parsed.data;
  const now = new Date().toISOString();

  if (body.action === "tasks") {
    const tasks = cleanTasks(body.tasks);
    const { error } = await db.from("course_assessment_tasks").upsert({ course_id: body.courseId, tasks, updated_by: staff.user.id, updated_at: now }, { onConflict: "course_id" });
    if (error) return NextResponse.json({ error: missing(error.message) ? MIGRATION : error.message }, { status: 400 });
    await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: role, action: "assessment_tasks.saved", record_type: "course", record_id: body.courseId, new_values: { tasks } });
    // An unprinted record of this course picks up the new tasks.
    if (body.batchId) await db.from("training_completion_records").update({ tasks, updated_at: now }).eq("batch_id", body.batchId).neq("status", "Printed");
    return NextResponse.json({ ok: true });
  }

  const current = await loadCompletion(db, body.batchId);
  if (!current) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  if (!current.ready) return NextResponse.json({ error: MIGRATION }, { status: 400 });

  if (body.action === "printed") {
    if (current.status === "Not Started") return NextResponse.json({ error: "Save the record first." }, { status: 400 });
    const problems = completionProblems(current.fields, current.trainees, current.results, current.tasks.length);
    if (problems.length) return NextResponse.json({ error: `Complete first: ${problems.join(" · ")}.` }, { status: 400 });
    const { error } = await db.from("training_completion_records").update({ status: "Printed", print_count: current.printCount + 1, printed_at: now, printed_by: staff.user.id }).eq("batch_id", body.batchId);
    if (error) throw error;
    await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: role, action: "completion_record.printed", record_type: "batch", record_id: body.batchId, new_values: { print: current.printCount + 1, class_no: current.fields.classNo } });
    return NextResponse.json({ ok: true });
  }

  // Save: only trainees enrolled in the batch; results fitted to the record's tasks.
  const taskCount = current.tasks.length;
  const allowed = new Set(current.trainees.map((t) => t.enrollmentId));
  const results = Object.fromEntries(Object.entries(body.results).filter(([id]) => allowed.has(id)).map(([id, r]) => [id, fitResult(r, taskCount)]));
  const f = body.fields;
  const merged = Object.fromEntries(current.trainees.map((t) => [t.enrollmentId, results[t.enrollmentId] ?? current.results[t.enrollmentId]]));
  const status = completionProblems(f, current.trainees, merged, taskCount).length ? "Draft" : "Ready";
  const row = { batch_id: body.batchId, class_no: f.classNo || null, resit_class_no: f.resitClassNo || null, resit_duration: f.resitDuration || null, written_place: f.writtenPlace || null, practical_place: f.practicalPlace || null,
    assessor: f.assessor || null, coa_validity: f.coaValidity || null, assessed_on: f.assessedOn || null, director: f.director || null, director_on: f.directorOn || null,
    tasks: current.tasks, results: merged, status: current.status === "Printed" ? "Printed" : status, updated_by: staff.user.id, updated_at: now };
  const { error } = await db.from("training_completion_records").upsert(row, { onConflict: "batch_id" });
  if (error) return NextResponse.json({ error: missing(error.message) ? MIGRATION : error.message }, { status: 400 });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: role, action: "completion_record.saved", record_type: "batch", record_id: body.batchId, prior_values: current.status === "Not Started" ? null : { fields: current.fields, results: current.results }, new_values: { fields: f, results: merged } });
  return NextResponse.json({ ok: true, status: row.status });
}
