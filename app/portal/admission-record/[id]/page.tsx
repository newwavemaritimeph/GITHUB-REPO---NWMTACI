import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TarSheets } from "./tar-sheets";
import "./admission-record.css";

/**
 * Training Admission Record (Oct 2026, "Design 01 · classic official").
 * Two copies (original and duplicate) on one legal sheet (8.5 × 14 in): the trainee's admission
 * slip and acknowledgement receipt with its AR number, every active course,
 * fees including miscellaneous charges, each payment received, and the terms
 * and conditions. Amounts are read live; the AR number comes from
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
type PaymentRow = { id: string; payment_number: string; received_at: string; method: string; reference_number: string | null; valid: boolean; cashier_id: string | null };

export default async function AdmissionRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) redirect("/staff-login");
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: record } = await db.from("admission_records").select("id,ar_number,trainee_id,enrollment_ids,issued_by,issued_at,last_printed_at").eq("id", id).maybeSingle();
  if (!record) notFound();
  const ids = record.enrollment_ids as string[];

  const [traineeRes, enrollRes, chargeRes, allocRes, officerRes] = await Promise.all([
    db.from("trainees").select("trainee_number,legal_first_name,legal_middle_name,legal_last_name,suffix,srn,rank,mobile,company,application_number").eq("id", record.trainee_id).maybeSingle(),
    db.from("enrollments").select("id,enrollment_number,enrollment_status,selling_price_centavos,created_at,batch_id,courses(code,name),batches(batch_number,starts_on,ends_on,daily_start,daily_end,venue)").in("id", ids),
    db.from("enrollment_charges").select("enrollment_id,description,amount_centavos,event_type,valid").in("enrollment_id", ids).eq("valid", true),
    db.from("payment_allocations").select("enrollment_id,amount_centavos,payments(id,payment_number,received_at,method,reference_number,valid,cashier_id)").in("enrollment_id", ids),
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
      return { id: e.id, code: c?.code ?? "", name: c?.name ?? "Course", start: b?.starts_on ?? null, dates: trainingDates(b?.starts_on, b?.ends_on), time: b ? `${hhmm(b.daily_start) || "8:00"}–${hhmm(b.daily_end) || "17:00"}` : "—", room: (e.batch_id && roomByBatch.get(e.batch_id)) || b?.venue || "To be assigned", fee: Number(e.selling_price_centavos) }; })
    .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999"));

  const misc = (chargeRes.data ?? []).filter((c) => c.event_type !== "discount").map((c) => ({ label: c.description as string, amount: Number(c.amount_centavos) }));
  const discounts = (chargeRes.data ?? []).filter((c) => c.event_type === "discount").map((c) => ({ label: c.description as string, amount: Number(c.amount_centavos) }));

  // One line per payment, summing its allocations across the covered enrollments.
  type PayRow = { id: string; number: string; date: string; method: string; ref: string; amount: number; cashierId: string | null };
  const payMap = new Map<string, PayRow>();
  for (const a of allocRes.data ?? []) {
    const p = one(a.payments as unknown as PaymentRow | PaymentRow[] | null);
    if (!p || p.valid === false) continue;
    const row = payMap.get(p.id) ?? { id: p.id, number: p.payment_number, date: p.received_at, method: p.method, ref: p.reference_number || "—", amount: 0, cashierId: p.cashier_id };
    row.amount += Number(a.amount_centavos);
    payMap.set(p.id, row);
  }
  const payments = [...payMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const lastCashierId = payments.at(-1)?.cashierId ?? null;
  const cashier = lastCashierId ? (await db.from("profiles").select("complete_name").eq("id", lastCashierId).maybeSingle()).data?.complete_name ?? "" : "";

  const feesTotal = courses.reduce((s, c) => s + c.fee, 0), miscTotal = misc.reduce((s, m) => s + m.amount, 0), discTotal = discounts.reduce((s, d) => s + d.amount, 0);
  const due = feesTotal + miscTotal - discTotal, paid = payments.reduce((s, p) => s + p.amount, 0), balance = Math.max(0, due - paid);
  const status = due > 0 && paid >= due ? "FULLY PAID" : paid > 0 ? "PARTIALLY PAID" : "UNPAID";
  const name = `${t.legal_last_name}, ${[t.legal_first_name, t.legal_middle_name, t.suffix].filter(Boolean).join(" ")}`.toUpperCase();
  const issued = manila({ dateStyle: "medium", timeStyle: "short" }).format(new Date(record.issued_at));
  const officer = (officerRes.data as { complete_name?: string } | null)?.complete_name ?? "";
  const payDate = manila({ day: "numeric", month: "short" });
  return <TarSheets arNumber={record.ar_number} issued={issued} name={name}
    trainee={{ appNo: t.application_number ?? t.trainee_number, srn: t.srn, rank: t.rank, mobile: t.mobile, company: t.company }}
    courses={courses} misc={misc} discounts={discounts}
    payments={payments.map((p) => ({ id: p.id, number: p.number, dateLabel: payDate.format(new Date(p.date)), method: p.method, ref: p.ref, amount: p.amount }))}
    feesTotal={feesTotal} due={due} paid={paid} balance={balance} status={status} officer={officer} cashier={cashier} />;
}
