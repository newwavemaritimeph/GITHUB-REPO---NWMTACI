import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * One trainee's details, read-only, opened from a name in the Batch window (owner, 10 Nov 2026: the MISMO
 * Compliance Officer sees birth date, place of birth, rank, emergency contact and the rest). No payments.
 */
export async function GET(request: Request) {
  const staff = await requireStaff(["admin", "admin_assistant", "registration", "cashier", "accounting", "mismo_officer"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const enrollmentId = new URL(request.url).searchParams.get("enrollmentId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(enrollmentId)) return NextResponse.json({ error: "Choose a trainee." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: e } = await db.from("enrollments").select("trainee_id").eq("id", enrollmentId).maybeSingle();
  if (!e) return NextResponse.json({ error: "Trainee not found." }, { status: 404 });
  const [{ data: t }, { data: courses }] = await Promise.all([
    db.from("trainees").select("legal_first_name,legal_middle_name,legal_last_name,suffix,application_number,trainee_number,srn,rank,birthdate,place_of_birth,sex,nationality,address,mobile,email,company,emergency_contact").eq("id", e.trainee_id).maybeSingle(),
    db.from("enrollments").select("id,enrollment_status,scheduled_on,courses(code,name),batches(batch_number,starts_on,ends_on)").eq("trainee_id", e.trainee_id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (!t) return NextResponse.json({ error: "Trainee not found." }, { status: 404 });
  const em = (t.emergency_contact ?? {}) as { name?: string; mobile?: string | null };
  return NextResponse.json({
    name: `${t.legal_last_name}, ${[t.legal_first_name, t.legal_middle_name, t.suffix].filter(Boolean).join(" ")}`.toUpperCase(),
    nwmtaciNo: t.application_number ?? t.trainee_number, traineeNo: t.trainee_number, srn: t.srn, rank: t.rank,
    birthdate: t.birthdate, placeOfBirth: t.place_of_birth, sex: t.sex, nationality: t.nationality, address: t.address,
    mobile: t.mobile, email: t.email, company: t.company, emergencyName: em.name || null, emergencyMobile: em.mobile || null,
    courses: (courses ?? []).map((c) => {
      const course = one(c.courses as { code: string; name: string } | { code: string; name: string }[] | null);
      const b = one(c.batches as { batch_number: string; starts_on: string; ends_on: string } | { batch_number: string; starts_on: string; ends_on: string }[] | null);
      return { id: c.id as string, code: course?.code ?? "", name: course?.name ?? "", batch: b?.batch_number ?? null, startsOn: b?.starts_on ?? (c.scheduled_on as string | null), endsOn: b?.ends_on ?? (c.scheduled_on as string | null), status: c.enrollment_status as string };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}
