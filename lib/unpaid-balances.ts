import { automaticEndDate } from "@/lib/scheduling";

/**
 * Trainees whose training has ended (or ends today) and who still owe a balance
 * (owner, 7 Oct 2026). Shown on the Cashier dashboard and emailed at 4:00 PM.
 * Training end = the batch's last day; for a picked start date (no batch) it is
 * the start date plus the course duration, Sundays skipped.
 */

type One<T> = T | T[] | null | undefined;
const first = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export type BalanceEnrollment = {
  id: string; enrollment_number: string; trainee_id: string; course_id: string; enrollment_status: string;
  selling_price_centavos: number; paid_centavos: number; charges_centavos?: number; discounts_centavos?: number;
  scheduled_on?: string | null;
  batches?: One<{ ends_on: string; batch_number?: string; starts_on?: string }>;
  trainees?: One<{ legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string; trainee_number?: string; mobile?: string }>;
  courses?: One<{ name: string; code?: string }>;
};

export type UnpaidBalance = { id: string; enrollmentNumber: string; traineeId: string; traineeName: string; course: string; trainingEnd: string; endsToday: boolean; dueCentavos: number; paidCentavos: number; balanceCentavos: number };

export function trainingEnd(e: BalanceEnrollment, durationOf: (courseId: string) => string | null | undefined) {
  const batch = first(e.batches);
  if (batch?.ends_on) return batch.ends_on;
  if (e.scheduled_on) return automaticEndDate(e.scheduled_on, durationOf(e.course_id) ?? "1");
  return null;
}

export function unpaidAfterTraining(enrollments: BalanceEnrollment[], durationOf: (courseId: string) => string | null | undefined, today: string): UnpaidBalance[] {
  const rows: UnpaidBalance[] = [];
  for (const e of enrollments) {
    if (e.enrollment_status === "Cancelled") continue;
    const end = trainingEnd(e, durationOf);
    if (!end || end > today) continue;
    const due = Number(e.selling_price_centavos) + Number(e.charges_centavos ?? 0) - Number(e.discounts_centavos ?? 0);
    const paid = Number(e.paid_centavos ?? 0);
    const balance = due - paid;
    if (balance <= 0) continue;
    const t = first(e.trainees), c = first(e.courses);
    rows.push({
      id: e.id, enrollmentNumber: e.enrollment_number, traineeId: e.trainee_id,
      traineeName: t ? `${t.legal_first_name} ${t.legal_middle_name ?? ""} ${t.legal_last_name}`.replace(/\s+/g, " ").trim() : e.enrollment_number,
      course: c ? `${c.code ? `${c.code} · ` : ""}${c.name}` : "Course", trainingEnd: end, endsToday: end === today,
      dueCentavos: due, paidCentavos: paid, balanceCentavos: balance,
    });
  }
  return rows.sort((a, b) => a.trainingEnd.localeCompare(b.trainingEnd) || b.balanceCentavos - a.balanceCentavos);
}
