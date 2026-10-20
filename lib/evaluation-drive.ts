import { readFile } from "node:fs/promises";
import path from "node:path";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/google-classroom";
import { fileInDrive, manilaDate } from "@/lib/google-drive";
import { createEvaluationPdf, type EvaluationPdfInput } from "@/lib/print/evaluation";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const EVALUATION_ROOT = { key: "evaluations", name: "NWMTACI Training Evaluations" };

/** NWMTACI Training Evaluations / BT / 2026-10 October / DELA CRUZ, Juan - BT - 2026-10-20.pdf. Pure, so it is unit-tested. */
export function evaluationNaming(input: { courseCode: string; lastName: string; firstName: string; submittedAt: string }) {
  const clean = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const code = clean(input.courseCode).toUpperCase() || "COURSE";
  const date = manilaDate(input.submittedAt);
  const [year, month] = date.split("-");
  return {
    folders: [{ key: `evaluations/${code}`, name: code }, { key: `evaluations/${code}/${year}-${month}`, name: `${year}-${month} ${MONTHS[Number(month) - 1]}` }],
    base: `${clean(input.lastName).toUpperCase() || "TRAINEE"}, ${clean(input.firstName)} - ${code} - ${date}`,
  };
}

async function logo() { try { return new Uint8Array(await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png"))); } catch { return undefined; } }

/** Builds the evaluation PDF and files it in Drive. Throws when Google is not connected or Drive fails; the caller records nothing then. */
export async function fileEvaluationInDrive(db: Admin, input: Omit<EvaluationPdfInput, "logo"> & { firstName: string; lastName: string }) {
  if (!googleConfigured()) throw new Error("Google Drive is not configured.");
  const bytes = await createEvaluationPdf({ ...input, logo: await logo() });
  const naming = evaluationNaming({ courseCode: input.courseCode, lastName: input.lastName, firstName: input.firstName, submittedAt: input.submittedAt });
  const filed = await fileInDrive(db, { rootKey: EVALUATION_ROOT.key, rootName: EVALUATION_ROOT.name, folders: naming.folders, base: naming.base, ext: "pdf", mime: "application/pdf", bytes });
  return { fileId: filed.fileId, link: filed.link };
}
