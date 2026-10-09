import { readFile } from "node:fs/promises";
import path from "node:path";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/google-classroom";
import { fileInDrive, replaceDriveFile } from "@/lib/google-drive";
import { loadCompletion, type CompletionPayload } from "@/lib/completion-record-server";
import { completionProblems } from "@/lib/completion-record";
import { createCompletionRecordPdf } from "@/lib/print/completion-record";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const TCROA_ROOT = { key: "tcroa", name: "TCROA" };

/** Drive folders and file name: TCROA / UBT-PSSR / 2026-10 October / 2026-10-08 BCH-2026-002475 Class 26-609-118.pdf. Pure, so it is unit-tested. */
export function completionNaming(input: { courseCode: string; endsOn: string; batchNumber: string; classNo: string }) {
  const clean = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const code = clean(input.courseCode).toUpperCase() || "COURSE";
  const [year, month] = input.endsOn.split("-");
  return {
    folders: [{ key: `tcroa/${code}`, name: code }, { key: `tcroa/${code}/${year}-${month}`, name: `${year}-${month} ${MONTHS[Number(month) - 1] ?? ""}`.trim() }],
    base: `${input.endsOn} ${clean(input.batchNumber)}${input.classNo.trim() ? ` Class ${clean(input.classNo)}` : ""}`,
  };
}

async function logo() { try { return new Uint8Array(await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png"))); } catch { return undefined; } }

/** The record as a PDF (also used by the download route). */
export async function completionPdf(record: CompletionPayload) {
  return createCompletionRecordPdf({ courseName: record.batch.courseName, startsOn: record.batch.startsOn, endsOn: record.batch.endsOn, tasks: record.tasks, trainees: record.trainees, results: record.results, fields: record.fields, logo: await logo() });
}

export type DriveFiling = { state: "Filed" | "Updated" | "Not configured" | "Not complete" | "Failed"; link?: string | null; path?: string | null; error?: string };

/**
 * File (or refresh) a complete record in Google Drive › TCROA. Best-effort: a
 * Drive problem never blocks saving or printing; the screen shows it and offers
 * Upload Again.
 */
export async function fileCompletionInDrive(db: Admin, batchId: string): Promise<DriveFiling> {
  if (!googleConfigured()) return { state: "Not configured" };
  try {
    const record = await loadCompletion(db, batchId);
    if (!record || completionProblems(record.fields, record.trainees, record.results, record.tasks.length).length) return { state: "Not complete" };
    const bytes = await completionPdf(record);
    const now = new Date().toISOString();
    if (record.drive?.fileId) {
      await replaceDriveFile(db, record.drive.fileId, bytes, "application/pdf");
      await db.from("training_completion_records").update({ drive_filed_at: now }).eq("batch_id", batchId);
      return { state: "Updated", link: record.drive.link, path: record.drive.path };
    }
    const naming = completionNaming({ courseCode: record.batch.courseCode, endsOn: record.batch.endsOn, batchNumber: record.batch.batchNumber, classNo: record.fields.classNo });
    const filed = await fileInDrive(db, { rootKey: TCROA_ROOT.key, rootName: TCROA_ROOT.name, folders: naming.folders, base: naming.base, ext: "pdf", mime: "application/pdf", bytes });
    await db.from("training_completion_records").update({ drive_file_id: filed.fileId, drive_link: filed.link, drive_path: filed.path, drive_filed_at: now }).eq("batch_id", batchId);
    return { state: "Filed", link: filed.link, path: filed.path };
  } catch (e) {
    console.error("Completion record Drive filing failed:", batchId, e instanceof Error ? e.message : e);
    return { state: "Failed", error: e instanceof Error ? e.message : "Could not reach Google Drive." };
  }
}
