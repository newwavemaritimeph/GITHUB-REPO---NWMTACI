import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isStcwCategory } from "@/lib/certificate-rules";
import { MISMO_COURSE_CODES } from "@/lib/mismo";
import { fitResult, type AssessmentTask, type CompletionFields, type CompletionTrainee, type TraineeResult } from "@/lib/completion-record";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const missingTable = (message?: string) => !!message && /training_completion_records|course_assessment_tasks|does not exist|schema cache/i.test(message);

export type CompletionBatch = { id: string; batchNumber: string; startsOn: string; endsOn: string; courseId: string; courseCode: string; courseName: string; trainees: number; status: "Not Started" | "Draft" | "Ready" | "Printed" };
export type CompletionPayload = {
  ready: boolean;
  batch: CompletionBatch;
  tasks: AssessmentTask[];
  courseTasks: AssessmentTask[];
  trainees: CompletionTrainee[];
  fields: CompletionFields;
  results: Record<string, TraineeResult>;
  status: CompletionBatch["status"];
  printCount: number;
  printedAt: string | null;
  lastSignatories: Pick<CompletionFields, "assessor" | "coaValidity" | "director"> | null;
  /** The PDF filed in Google Drive › TCROA (migration 202610090040); null until filed. */
  drive: { fileId: string; link: string | null; path: string | null; filedAt: string | null } | null;
};

const EMPTY: CompletionFields = { classNo: "", resitClassNo: "", resitDuration: "", writtenPlace: "", practicalPlace: "", assessor: "", coaValidity: "", assessedOn: "", director: "", directorOn: "" };
const isStcw = (code: string, category: string | null | undefined) => isStcwCategory(category) || MISMO_COURSE_CODES.includes(code.toUpperCase());
export const cleanTasks = (v: unknown): AssessmentTask[] => (Array.isArray(v) ? v : []).map((t) => ({ title: String((t as AssessmentTask)?.title ?? "").trim(), criteria: String((t as AssessmentTask)?.criteria ?? "").trim() })).filter((t) => t.title).slice(0, 8);

/** STCW batches whose training has ended (last 120 days), newest first, with their record status. */
export async function listCompletionBatches(db: Admin, today: string): Promise<{ ready: boolean; batches: CompletionBatch[] }> {
  const since = new Date(`${today}T12:00:00+08:00`); since.setUTCDate(since.getUTCDate() - 120);
  const { data, error } = await db.from("batches").select("id,batch_number,starts_on,ends_on,course_id,confirmed_count,status,courses(code,name,course_categories(name))")
    .lte("ends_on", today).gte("ends_on", since.toISOString().slice(0, 10)).neq("status", "Cancelled").order("ends_on", { ascending: false }).limit(400);
  if (error) throw error;
  const rows = (data ?? []).map((b) => { const c = one(b.courses as unknown as { code: string; name: string; course_categories?: { name: string } | { name: string }[] | null } | null); return { b, c }; })
    .filter(({ c }) => c && isStcw(c.code, one(c.course_categories)?.name));
  const ids = rows.map(({ b }) => b.id as string);
  const status = new Map<string, CompletionBatch["status"]>();
  let ready = true;
  if (ids.length) {
    const rec = await db.from("training_completion_records").select("batch_id,status").in("batch_id", ids);
    if (rec.error) { if (!missingTable(rec.error.message)) throw rec.error; ready = false; }
    for (const r of rec.data ?? []) status.set(r.batch_id as string, r.status as CompletionBatch["status"]);
  }
  return { ready, batches: rows.map(({ b, c }) => ({ id: b.id as string, batchNumber: b.batch_number as string, startsOn: b.starts_on as string, endsOn: b.ends_on as string, courseId: b.course_id as string, courseCode: c!.code, courseName: c!.name, trainees: Number(b.confirmed_count ?? 0), status: status.get(b.id as string) ?? "Not Started" })) };
}

/** One batch's record: portal trainee details plus everything encoded so far. */
export async function loadCompletion(db: Admin, batchId: string): Promise<CompletionPayload | null> {
  const { data: b } = await db.from("batches").select("id,batch_number,starts_on,ends_on,course_id,confirmed_count,courses(code,name,course_categories(name))").eq("id", batchId).maybeSingle();
  if (!b) return null;
  const c = one(b.courses as unknown as { code: string; name: string; course_categories?: { name: string } | { name: string }[] | null } | null);
  const { data: ens, error: enError } = await db.from("enrollments").select("id,created_at,trainees(legal_first_name,legal_middle_name,legal_last_name,suffix,birthdate,place_of_birth,rank)").eq("batch_id", batchId).eq("enrollment_status", "Enrolled").order("created_at");
  if (enError) throw enError;
  const trainees: CompletionTrainee[] = (ens ?? []).map((e) => {
    const t = one(e.trainees as unknown as { legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; suffix?: string | null; birthdate?: string | null; place_of_birth?: string | null; rank?: string | null } | null);
    const name = t ? `${t.legal_last_name}, ${t.legal_first_name}${t.suffix ? ` ${t.suffix}` : ""}${t.legal_middle_name ? ` ${t.legal_middle_name}` : ""}`.toUpperCase() : "—";
    return { enrollmentId: e.id as string, name, birthdate: t?.birthdate ?? null, placeOfBirth: t?.place_of_birth ?? null, rank: t?.rank ?? null };
  });

  let ready = true;
  const tpl = await db.from("course_assessment_tasks").select("tasks").eq("course_id", b.course_id).maybeSingle();
  if (tpl.error) { if (!missingTable(tpl.error.message)) throw tpl.error; ready = false; }
  const courseTasks = cleanTasks(tpl.data?.tasks);
  const rec = ready ? await db.from("training_completion_records").select("*").eq("batch_id", batchId).maybeSingle() : { data: null, error: null };
  if (rec.error) { if (!missingTable(rec.error.message)) throw rec.error; ready = false; }
  const r = rec.data as Record<string, unknown> | null;
  // A printed record keeps the tasks it was printed with; otherwise the course's current tasks.
  const tasks = r && (r.status === "Printed" || cleanTasks(r.tasks).length) ? cleanTasks(r.tasks) : courseTasks;
  const stored = (r?.results ?? {}) as Record<string, Partial<TraineeResult>>;
  const results = Object.fromEntries(trainees.map((t) => [t.enrollmentId, fitResult(stored[t.enrollmentId], tasks.length)]));
  const s = (k: string) => String(r?.[k] ?? "");
  const fields: CompletionFields = r ? { classNo: s("class_no"), resitClassNo: s("resit_class_no"), resitDuration: s("resit_duration"), writtenPlace: s("written_place"), practicalPlace: s("practical_place"), assessor: s("assessor"), coaValidity: s("coa_validity"), assessedOn: s("assessed_on"), director: s("director"), directorOn: s("director_on") } : { ...EMPTY };

  let lastSignatories: CompletionPayload["lastSignatories"] = null;
  if (ready) {
    const { data: last } = await db.from("training_completion_records").select("assessor,coa_validity,director").not("assessor", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (last) lastSignatories = { assessor: String(last.assessor ?? ""), coaValidity: String(last.coa_validity ?? ""), director: String(last.director ?? "") };
  }
  return {
    ready,
    batch: { id: b.id as string, batchNumber: b.batch_number as string, startsOn: b.starts_on as string, endsOn: b.ends_on as string, courseId: b.course_id as string, courseCode: c?.code ?? "—", courseName: c?.name ?? "", trainees: trainees.length, status: (r?.status as CompletionBatch["status"]) ?? "Not Started" },
    tasks, courseTasks, trainees, fields, results,
    status: (r?.status as CompletionBatch["status"]) ?? "Not Started",
    printCount: Number(r?.print_count ?? 0), printedAt: (r?.printed_at as string | null) ?? null, lastSignatories,
    drive: r?.drive_file_id ? { fileId: String(r.drive_file_id), link: (r.drive_link as string | null) ?? null, path: (r.drive_path as string | null) ?? null, filedAt: (r.drive_filed_at as string | null) ?? null } : null,
  };
}
