import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCompletion } from "@/lib/completion-record-server";
import { completionProblems } from "@/lib/completion-record";
import { CompletionSheet } from "@/components/portal/completion-sheet";
import { CompletionPrintControls } from "./print-controls";
import "./completion-record.css";

/** Printable Training Completion and Record of Assessment Report for one STCW batch (owner, 9 Oct 2026). */
export const dynamic = "force-dynamic";

export default async function CompletionRecordPage({ params }: { params: Promise<{ batchId: string }> }) {
  const staff = await requireStaff(["mismo_officer", "admin"]);
  if (!staff) redirect("/staff-login");
  const { batchId } = await params;
  const db = createSupabaseAdminClient();
  const record = await loadCompletion(db, batchId);
  if (!record) notFound();
  const problems = completionProblems(record.fields, record.trainees, record.results, record.tasks.length);
  return <main className="tcr-page">
    <CompletionPrintControls batchId={batchId} title={`${record.batch.batchNumber} · ${record.batch.courseCode}`} complete={!problems.length} />
    {problems.length > 0 && <div className="tcr-warn">Not ready to print. Complete in Completion Records: {problems.join(" · ")}.</div>}
    <CompletionSheet courseName={record.batch.courseName} startsOn={record.batch.startsOn} endsOn={record.batch.endsOn} tasks={record.tasks} trainees={record.trainees} results={record.results} fields={record.fields} />
  </main>;
}
