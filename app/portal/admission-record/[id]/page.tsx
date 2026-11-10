import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadDocumentControl } from "@/lib/document-controls";
import { TarSheets } from "./tar-sheets";
import "./admission-record.css";

/**
 * Training Admission Record (Oct 2026, "Design 01 · classic official").
 * Two copies (original and duplicate) on one legal sheet (8.5 × 14 in): the trainee's admission
 * slip with its TAR number, every active course and the Terms and Conditions. No fees or
 * payments since 10 Nov 2026 (owner): those stay on the Acknowledgement Receipt. The number comes from
 * admission_records (migration 202610070006), so a reprint keeps it.
 */

export const dynamic = "force-dynamic";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manila = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...opts });
const dayOf = (iso: string) => new Date(`${iso}T00:00:00+08:00`);
function trainingDates(start?: string | null, end?: string | null) {
  if (!start) return "No batch yet";
  const d = manila({ day: "numeric" }), m = manila({ month: "short" }), w = manila({ weekday: "short" });
  const s = dayOf(start), e = dayOf(end ?? start);
  if (start === (end ?? start)) return `${d.format(s)} ${m.format(s)} (${w.format(s)})`;
  const sameMonth = start.slice(0, 7) === (end ?? start).slice(0, 7);
  return `${d.format(s)}${sameMonth ? "" : ` ${m.format(s)}`}–${d.format(e)} ${m.format(e)} (${w.format(s)}–${w.format(e)})`;
}
const hhmm = (t?: string | null) => (t ? String(Number(t.slice(0, 2))) + t.slice(2, 5) : "");

type BatchRow = { batch_number: string; starts_on: string; ends_on: string; daily_start: string | null; daily_end: string | null; venue: string | null };

export default async function AdmissionRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reprint?: string }> }) {
  const staff = await requireStaff(["admin", "registration", "cashier", "accounting"]);
  if (!staff) redirect("/staff-login");
  const { id } = await params;
  // Accounting's reprint from the Trainee Account (owner, 3 Nov 2026): the copy was counted by document-reprint.
  const reprint = (await searchParams).reprint === "1" && staff.roleCodes.some((r) => ["admin", "accounting"].includes(r));
  const db = createSupabaseAdminClient();

  const { data: record } = await db.from("admission_records").select("id,ar_number,trainee_id,enrollment_ids,issued_by,issued_at,last_printed_at,print_count").eq("id", id).maybeSingle();
  if (!record) notFound();
  const ids = record.enrollment_ids as string[];

  const [traineeRes, enrollRes, officerRes] = await Promise.all([
    db.from("trainees").select("trainee_number,legal_first_name,legal_middle_name,legal_last_name,suffix,srn,rank,mobile,company,application_number").eq("id", record.trainee_id).maybeSingle(),
    db.from("enrollments").select("id,enrollment_number,enrollment_status,created_at,batch_id,scheduled_on,courses(code,name),partner_course_offers(partner_centers(name)),batches(batch_number,starts_on,ends_on,daily_start,daily_end,venue)").in("id", ids),
    record.issued_by ? db.from("profiles").select("complete_name").eq("id", record.issued_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const t = traineeRes.data;
  if (!t) notFound();

  // Rooms come from the batch's per-day resource assignments.
  const batchIds = (enrollRes.data ?? []).map((e) => e.batch_id).filter(Boolean) as string[];
  const roomByBatch = new Map<string, string>();
  if (batchIds.length) {
    const { data: dates } = await db.from("batch_training_dates").select("id,batch_id").in("batch_id", batchIds);
    const dateIds = (dates ?? []).map((d) => d.id);
    if (dateIds.length) {
      const [{ data: assigns }, { data: rooms }] = await Promise.all([
        db.from("resource_assignments").select("batch_training_date_id,classroom_id").in("batch_training_date_id", dateIds),
        db.from("classrooms").select("id,name"),
      ]);
      const dateToBatch = new Map((dates ?? []).map((d) => [d.id, d.batch_id as string]));
      const roomName = new Map((rooms ?? []).map((r) => [r.id, r.name as string]));
      for (const a of assigns ?? []) {
        const b = dateToBatch.get(a.batch_training_date_id);
        if (b && !roomByBatch.has(b) && a.classroom_id && roomName.get(a.classroom_id)) roomByBatch.set(b, roomName.get(a.classroom_id)!);
      }
    }
  }

  const courses = (enrollRes.data ?? [])
    .map((e) => { const c = one(e.courses as { code: string; name: string } | { code: string; name: string }[] | null); const b = one(e.batches as unknown as BatchRow | BatchRow[] | null);
      const center = one(one(e.partner_course_offers as unknown as { partner_centers: unknown } | { partner_centers: unknown }[] | null)?.partner_centers as { name: string } | { name: string }[] | null)?.name;
      const day = (e as { scheduled_on?: string | null }).scheduled_on ?? null;
      return { id: e.id, code: c?.code ?? "", name: center ? `${c?.name ?? "Course"} · ${center}` : c?.name ?? "Course", start: b?.starts_on ?? day, dates: b ? trainingDates(b.starts_on, b.ends_on) : trainingDates(day ?? undefined, day ?? undefined), time: b ? `${hhmm(b.daily_start) || "8:00"}–${hhmm(b.daily_end) || "17:00"}` : "—", room: (e.batch_id && roomByBatch.get(e.batch_id)) || b?.venue || center || "To be assigned" }; })
    .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999"));

  const name = `${t.legal_last_name}, ${[t.legal_first_name, t.legal_middle_name, t.suffix].filter(Boolean).join(" ")}`.toUpperCase();
  const issued = manila({ dateStyle: "medium", timeStyle: "short" }).format(new Date(record.issued_at));
  const officer = (officerRes.data as { complete_name?: string } | null)?.complete_name ?? "";
  const [control, termsControl] = await Promise.all([loadDocumentControl(db, "tar"), loadDocumentControl(db, "terms")]);
  return <TarSheets control={control} termsControl={termsControl} arNumber={record.ar_number} reprintCopy={reprint ? Number(record.print_count ?? 0) : null} issued={issued} name={name}
    trainee={{ appNo: t.application_number ?? t.trainee_number, srn: t.srn, rank: t.rank, mobile: t.mobile, company: t.company }}
    courses={courses} officer={officer} />;
}
