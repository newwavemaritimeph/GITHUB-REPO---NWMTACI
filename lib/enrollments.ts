import { createSupabaseAdminClient } from "./supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

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
