import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MISMO_COURSE_CODES, manilaInstant, type MismoBatch, type MismoDay } from "@/lib/mismo";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Every STCW (MISMO) batch in class on `date`, with each trainee's due and what they had paid by 11:00 AM, 4:00 PM and now. */
export async function loadMismoDay(db: Admin, date: string): Promise<MismoDay> {
  const { data: courses } = await db.from("courses").select("id,code,name").in("code", MISMO_COURSE_CODES);
  const courseById = new Map((courses ?? []).map((c) => [c.id as string, c as { id: string; code: string; name: string }]));
  if (!courseById.size) return { date, batches: [] };
  const { data: batches } = await db.from("batches").select("id,batch_number,course_id,starts_on,ends_on,status,venue").in("course_id", [...courseById.keys()]).lte("starts_on", date).gte("ends_on", date).neq("status", "Cancelled").order("starts_on");
  const list = (batches ?? []) as { id: string; batch_number: string; course_id: string; starts_on: string; ends_on: string; venue: string | null }[];
  if (!list.length) return { date, batches: [] };
  const batchIds = list.map((b) => b.id);
  const [{ data: enrollments }, staffing, submissions] = await Promise.all([
    db.from("enrollments").select("id,batch_id,selling_price_centavos,enrollment_status,trainees(legal_last_name,legal_first_name,legal_middle_name,birthdate,srn,rank)").in("batch_id", batchIds).in("enrollment_status", ["Enrolled", "Pending", "Open Schedule"]),
    loadStaffing(db, batchIds),
    db.from("mismo_submissions").select("batch_id,submitted_at,trainee_count").in("batch_id", batchIds),
  ]);
  const rows = (enrollments ?? []) as unknown as { id: string; batch_id: string; selling_price_centavos: number; trainees: { legal_last_name: string; legal_first_name: string; legal_middle_name: string | null; birthdate: string | null; srn: string | null; rank: string | null } | null }[];
  const ids = rows.map((e) => e.id);
  const [{ data: charges }, { data: allocations }] = ids.length ? await Promise.all([
    db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", ids).eq("valid", true),
    db.from("payment_allocations").select("enrollment_id,amount_centavos,payments(received_at,valid)").in("enrollment_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const due = new Map<string, number>(rows.map((e) => [e.id, Number(e.selling_price_centavos ?? 0)]));
  for (const c of charges ?? []) due.set(c.enrollment_id, (due.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos));
  const at11 = Date.parse(manilaInstant(date, 11)), at16 = Date.parse(manilaInstant(date, 16));
  const paid = new Map<string, { b11: number; b16: number; now: number }>();
  for (const a of allocations ?? []) {
    const p = first(a.payments as unknown as { received_at: string; valid: boolean } | null);
    if (!p || p.valid === false) continue;
    const cur = paid.get(a.enrollment_id) ?? { b11: 0, b16: 0, now: 0 };
    const amt = Number(a.amount_centavos);
    cur.now += amt;
    const when = Date.parse(p.received_at);
    if (when <= at16) cur.b16 += amt;
    if (when <= at11) cur.b11 += amt;
    paid.set(a.enrollment_id, cur);
  }
  const sub = new Map(((submissions.data ?? []) as { batch_id: string; submitted_at: string; trainee_count: number }[]).map((s) => [s.batch_id, s]));
  const out: MismoBatch[] = list.map((b) => {
    const c = courseById.get(b.course_id)!;
    const st = staffing.get(b.id);
    const trainees = rows.filter((e) => e.batch_id === b.id).map((e) => {
      const t = first(e.trainees); const p = paid.get(e.id) ?? { b11: 0, b16: 0, now: 0 };
      return { enrollmentId: e.id, lastName: t?.legal_last_name ?? "", firstName: t?.legal_first_name ?? "", middleName: t?.legal_middle_name ?? null, birthdate: t?.birthdate ?? null, srn: t?.srn ?? null, rank: t?.rank ?? null, dueCentavos: due.get(e.id) ?? 0, paidBy11: p.b11, paidBy16: p.b16, paidNow: p.now };
    }).sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName));
    const s = sub.get(b.id);
    return { id: b.id, batchNumber: b.batch_number, courseName: c.name, courseCode: c.code, startsOn: b.starts_on, endsOn: b.ends_on, room: st?.room ?? b.venue ?? null, instructor: st?.instructor ?? null, trainees, submittedAt: s?.submitted_at ?? null, submittedCount: s?.trainee_count ?? null };
  });
  return { date, batches: out };
}

async function loadStaffing(db: Admin, batchIds: string[]) {
  const map = new Map<string, { room: string | null; instructor: string | null }>();
  const { data: dates } = await db.from("batch_training_dates").select("id,batch_id").in("batch_id", batchIds);
  if (!dates?.length) return map;
  const { data: assigns } = await db.from("resource_assignments").select("batch_training_date_id,instructor_id,classroom_id").in("batch_training_date_id", dates.map((d) => d.id));
  if (!assigns?.length) return map;
  const [{ data: emps }, { data: rooms }] = await Promise.all([
    db.from("employees").select("id,complete_name").in("id", assigns.map((a) => a.instructor_id).filter(Boolean)),
    db.from("classrooms").select("id,name").in("id", assigns.map((a) => a.classroom_id).filter(Boolean)),
  ]);
  const dateToBatch = new Map(dates.map((d) => [d.id as string, d.batch_id as string]));
  const emp = new Map((emps ?? []).map((e) => [e.id as string, e.complete_name as string]));
  const room = new Map((rooms ?? []).map((r) => [r.id as string, r.name as string]));
  for (const a of assigns) {
    const b = dateToBatch.get(a.batch_training_date_id);
    if (!b) continue;
    const cur = map.get(b) ?? { room: null, instructor: null };
    cur.room = cur.room ?? (a.classroom_id ? room.get(a.classroom_id) ?? null : null);
    cur.instructor = cur.instructor ?? (a.instructor_id ? emp.get(a.instructor_id) ?? null : null);
    map.set(b, cur);
  }
  return map;
}
