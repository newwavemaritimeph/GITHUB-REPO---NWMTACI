import { createSupabaseAdminClient } from "./supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Delete UNPAID ("pending") enrollments: courses shorter than 2 days once unpaid
// for more than 24 hours, and any course whose training starts within the next 12
// hours (or already started). Paid enrollments are never touched. Returns the count.
export async function pruneUnpaidEnrollments(admin: AdminClient): Promise<number> {
  const now = Date.now();
  const { data: rows, error } = await admin.from("enrollments")
    .select("id,created_at,batch_id,enrollment_status,courses(duration_days),batches(starts_on,daily_start)")
    .neq("enrollment_status", "Cancelled").limit(5000);
  if (error) throw new Error(error.message);
  const { data: allocs } = await admin.from("payment_allocations").select("enrollment_id");
  const paid = new Set((allocs ?? []).map((a) => (a as { enrollment_id: string }).enrollment_id));
  const toDelete: string[] = [];
  for (const e of rows ?? []) {
    if (paid.has(e.id)) continue;
    const course = one(e.courses as { duration_days?: number } | { duration_days?: number }[] | null);
    const batch = one(e.batches as { starts_on?: string; daily_start?: string | null } | { starts_on?: string; daily_start?: string | null }[] | null);
    const durationDays = Number(course?.duration_days ?? 99);
    const ageHours = e.created_at ? (now - new Date(e.created_at).getTime()) / 3_600_000 : 0;
    let remove = false;
    if (durationDays < 2 && ageHours > 24) remove = true;
    if (batch?.starts_on) {
      const startMs = new Date(`${batch.starts_on}T${(batch.daily_start ?? "08:00").slice(0, 5)}:00+08:00`).getTime();
      if (startMs <= now + 12 * 3_600_000) remove = true;
    }
    if (remove) toDelete.push(e.id);
  }
  for (const id of toDelete) await hardDeleteEnrollment(admin, id);
  return toDelete.length;
}

// Hard-delete an UNPAID enrollment and its dependent rows, decrement the batch
// seat count, and remove a fresh public-signup trainee that has no other
// enrollments. Callers MUST verify the enrollment has no posted payments first.
export async function hardDeleteEnrollment(admin: AdminClient, enrollmentId: string) {
  const { data: enr } = await admin.from("enrollments").select("id,batch_id,trainee_id").eq("id", enrollmentId).maybeSingle();
  if (!enr) return;
  // Dependent rows (none are append-only for an unpaid enrollment). Errors are ignored
  // so a table missing on the current schema (e.g. pre-migration) doesn't abort the delete.
  for (const table of ["enrollment_charges", "agency_rebates", "enrollment_requests", "training_instructions", "make_up_assignments", "certificates", "invoices", "receipts", "payables", "training_feedback"]) {
    await admin.from(table).delete().eq("enrollment_id", enrollmentId);
  }
  await admin.from("enrollments").delete().eq("id", enrollmentId);
  if (enr.batch_id) {
    const { data: b } = await admin.from("batches").select("confirmed_count,capacity,status").eq("id", enr.batch_id).maybeSingle();
    if (b) {
      const next = Math.max(0, Number(b.confirmed_count) - 1);
      await admin.from("batches").update({ confirmed_count: next, status: b.status === "Full" && next < Number(b.capacity) ? "Open" : b.status }).eq("id", enr.batch_id);
    }
  }
  // Remove the trainee only if it was a fresh public sign-up (account_state 'Pending', no login)
  // and it has no remaining enrollments.
  if (enr.trainee_id) {
    const { data: rest } = await admin.from("enrollments").select("id").eq("trainee_id", enr.trainee_id).limit(1);
    if (!rest || !rest.length) {
      const { data: t } = await admin.from("trainees").select("id,account_state").eq("id", enr.trainee_id).maybeSingle();
      if (t && t.account_state === "Pending") await admin.from("trainees").delete().eq("id", enr.trainee_id);
    }
  }
}
