import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MISMO_COURSE_CODES, cutDateOf, entryMovedFrom, manilaInstant, ticksToClear, type MismoBatch, type MismoDay, type MismoEntry, type MismoRemoved } from "@/lib/mismo";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Long periods overrun the URL and the 1,000-row cap, and a read that failed quietly would show paid trainees as unpaid. */
async function inChunks<T>(ids: string[], size: number, read: (part: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += size) parts.push(ids.slice(i, i + size));
  const results = await Promise.all(parts.map(read));
  for (const r of results) if (r.error) throw new Error(r.error.message);
  return results.flatMap((r) => (r.data ?? []) as T[]);
}

/**
 * Every STCW (MISMO) batch in class from `date` to `to`, with each trainee's due and what they had paid by 11:00 AM and
 * 4:00 PM of the batch's first class day in that period, and now.
 */
export async function loadMismoDay(db: Admin, date: string, to: string = date, opts: { staffing?: boolean } = {}): Promise<MismoDay> {
  const { data: courses } = await db.from("courses").select("id,code,name").in("code", MISMO_COURSE_CODES);
  const courseById = new Map((courses ?? []).map((c) => [c.id as string, c as { id: string; code: string; name: string }]));
  if (!courseById.size) return { date, to, batches: [] };
  const { data: batches } = await db.from("batches").select("id,batch_number,course_id,starts_on,ends_on,status,venue").in("course_id", [...courseById.keys()]).lte("starts_on", to).gte("ends_on", date).neq("status", "Cancelled").order("starts_on");
  const list = (batches ?? []) as { id: string; batch_number: string; course_id: string; starts_on: string; ends_on: string; venue: string | null }[];
  if (!list.length) return { date, to, batches: [] };
  const batchIds = list.map((b) => b.id);
  const [enrollments, staffing, submissions] = await Promise.all([
    inChunks(batchIds, 30, (part) => db.from("enrollments").select("id,batch_id,selling_price_centavos,enrollment_status,trainees(legal_last_name,legal_first_name,legal_middle_name,birthdate,srn,rank)").in("batch_id", part).in("enrollment_status", ["Enrolled", "Pending", "Open Schedule"])),
    opts.staffing === false ? new Map<string, { room: string | null; instructor: string | null }>() : loadStaffing(db, batchIds),
    // Batch marks from before 5 Nov 2026. Nothing depends on them, and the live database has no such table: the list must still load.
    inChunks<{ batch_id: string; submitted_at: string; trainee_count: number }>(batchIds, 100, (part) => db.from("mismo_submissions").select("batch_id,submitted_at,trainee_count").in("batch_id", part)).catch(() => []),
  ]);
  const rows = enrollments as unknown as { id: string; batch_id: string; selling_price_centavos: number; trainees: { legal_last_name: string; legal_first_name: string; legal_middle_name: string | null; birthdate: string | null; srn: string | null; rank: string | null } | null }[];
  const ids = rows.map((e) => e.id);
  const [charges, allocations, companyCharged] = await Promise.all([
    inChunks<{ enrollment_id: string; amount_centavos: number; event_type: string }>(ids, 100, (part) => db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", part).eq("valid", true)),
    inChunks<{ enrollment_id: string; amount_centavos: number; payments: unknown }>(ids, 100, (part) => db.from("payment_allocations").select("enrollment_id,amount_centavos,payments(received_at,valid)").in("enrollment_id", part)),
    inChunks<{ id: string }>(ids, 100, (part) => db.from("enrollments").select("id").in("id", part).not("company_charge_agency_id", "is", null)),
  ]);
  const billed = new Set(companyCharged.map((x) => x.id));
  const due = new Map<string, number>(rows.map((e) => [e.id, Number(e.selling_price_centavos ?? 0)]));
  for (const c of charges) due.set(c.enrollment_id, (due.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos));
  const batchOf = new Map(rows.map((e) => [e.id, e.batch_id])), startOf = new Map(list.map((b) => [b.id, b.starts_on]));
  const paid = new Map<string, { b11: number; b16: number; now: number; last: string | null }>();
  for (const a of allocations) {
    const p = first(a.payments as unknown as { received_at: string; valid: boolean } | null);
    if (!p || p.valid === false) continue;
    const cur = paid.get(a.enrollment_id) ?? { b11: 0, b16: 0, now: 0, last: null };
    const amt = Number(a.amount_centavos);
    cur.now += amt;
    const when = Date.parse(p.received_at), cut = cutDateOf(startOf.get(batchOf.get(a.enrollment_id) ?? "") ?? date, date);
    if (when <= Date.parse(manilaInstant(cut, 16))) cur.b16 += amt;
    if (when <= Date.parse(manilaInstant(cut, 11))) cur.b11 += amt;
    if (!cur.last || p.received_at > cur.last) cur.last = p.received_at;
    paid.set(a.enrollment_id, cur);
  }
  // Encoded ticks (migration 202610290080) and what they were encoded under (202610290082): tolerant before either is run.
  type Tick = { enrollment_id: string; done_at: string; batch_number?: string | null; class_start?: string | null };
  const readTicks = (cols: string) => inChunks<Tick>(ids, 100, (part) => db.from("mismo_entries").select(cols).in("enrollment_id", part));
  const ticks = await readTicks("enrollment_id,done_at,batch_number,class_start").catch(() => readTicks("enrollment_id,done_at")).catch(() => [] as Tick[]);
  const tickOf = new Map(ticks.map((x) => [x.enrollment_id, x]));
  const sub = new Map(submissions.map((s) => [s.batch_id, s]));
  const out: MismoBatch[] = list.map((b) => {
    const c = courseById.get(b.course_id)!;
    const st = staffing.get(b.id);
    const trainees = rows.filter((e) => e.batch_id === b.id).map((e) => {
      const t = first(e.trainees); const p = paid.get(e.id) ?? { b11: 0, b16: 0, now: 0, last: null };
      const tick = tickOf.get(e.id), moved = tick ? entryMovedFrom({ batchNumber: tick.batch_number, classStart: tick.class_start }, { batchNumber: b.batch_number, startsOn: b.starts_on }) : null;
      return { enrollmentId: e.id, lastName: t?.legal_last_name ?? "", firstName: t?.legal_first_name ?? "", middleName: t?.legal_middle_name ?? null, birthdate: t?.birthdate ?? null, srn: t?.srn ?? null, rank: t?.rank ?? null, dueCentavos: due.get(e.id) ?? 0, paidBy11: p.b11, paidBy16: p.b16, paidNow: p.now, companyCharge: billed.has(e.id), entryAt: moved ? null : tick?.done_at ?? null, movedFrom: moved, lastPaidAt: p.last };
    }).sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName));
    const s = sub.get(b.id);
    return { id: b.id, batchNumber: b.batch_number, courseName: c.name, courseCode: c.code, startsOn: b.starts_on, endsOn: b.ends_on, room: st?.room ?? b.venue ?? null, instructor: st?.instructor ?? null, trainees, submittedAt: s?.submitted_at ?? null, submittedCount: s?.trainee_count ?? null, cutDate: cutDateOf(b.starts_on, date) };
  });
  return { date, to, batches: out };
}

/** Every encoded trainee, newest first, for the Encoded tab. A tick that no longer holds because the trainee moved is left out. */
export async function loadMismoEntries(db: Admin): Promise<MismoEntry[]> {
  type One<T> = T | T[] | null;
  type Row = { enrollment_id: string; done_at: string; batch_number?: string | null; class_start?: string | null; profiles: One<{ complete_name: string }>;
    enrollments: One<{ enrollment_status: string; batches: One<{ batch_number: string; starts_on: string; ends_on: string; courses: One<{ code: string }> }>; trainees: One<{ legal_last_name: string; legal_first_name: string; legal_middle_name: string | null; srn: string | null }> }> };
  const read = async (cols: string) => {
    const out: Row[] = [];
    for (let from = 0; from < 5000; from += 1000) {
      const { data, error } = await db.from("mismo_entries").select(cols).order("done_at", { ascending: false }).range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as unknown as Row[]));
      if ((data ?? []).length < 1000) break;
    }
    return out;
  };
  const joins = "enrollment_id,done_at,profiles:done_by(complete_name),enrollments(enrollment_status,batches(batch_number,starts_on,ends_on,courses(code)),trainees(legal_last_name,legal_first_name,legal_middle_name,srn))";
  const rows = await read(`${joins},batch_number,class_start`).catch(() => read(joins)).catch(() => [] as Row[]);
  return rows.flatMap((r) => {
    const e = first(r.enrollments), b = first(e?.batches), t = first(e?.trainees);
    if (entryMovedFrom({ batchNumber: r.batch_number, classStart: r.class_start }, { batchNumber: b?.batch_number ?? "", startsOn: b?.starts_on ?? "" })) return [];
    return [{ enrollmentId: r.enrollment_id, lastName: t?.legal_last_name ?? "", firstName: t?.legal_first_name ?? "", middleName: t?.legal_middle_name ?? null, srn: t?.srn ?? null, batchNumber: b?.batch_number ?? "—", code: first(b?.courses)?.code ?? "—", startsOn: b?.starts_on ?? "", endsOn: b?.ends_on ?? "", doneAt: r.done_at, by: first(r.profiles)?.complete_name ?? "—", cancelled: e?.enrollment_status === "Cancelled" }];
  });
}

/**
 * A payment voided after encoding takes the trainee off MISMO (owner, 5 Nov 2026): the tick goes, so if they pay again they
 * return to For Encoding. Called once the payment is void. The audit log keeps who was removed and why, with what MARINA
 * has them under, and that entry is the officer's alert.
 */
export async function clearMismoAfterVoid(db: Admin, paymentId: string, actorId: string, reason: string) {
  const { data: hit } = await db.from("payment_allocations").select("enrollment_id").eq("payment_id", paymentId);
  const ids = [...new Set((hit ?? []).map((a) => a.enrollment_id as string))];
  if (!ids.length) return;
  // "*": the batch encoded under needs 202610290082, and a column missing before it must not stop the removal.
  const { data: ticks } = await db.from("mismo_entries").select("*").in("enrollment_id", ids);
  const tickOf = new Map(((ticks ?? []) as { enrollment_id: string; batch_number?: string | null; class_start?: string | null }[]).map((t) => [t.enrollment_id, t]));
  const ticked = [...tickOf.keys()];
  if (!ticked.length) return;
  const [{ data: enrollments }, { data: charges }, { data: allocations }] = await Promise.all([
    db.from("enrollments").select("id,selling_price_centavos,company_charge_agency_id,batches(batch_number,starts_on,courses(code)),trainees(legal_last_name,legal_first_name,legal_middle_name,srn)").in("id", ticked),
    db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", ticked).eq("valid", true),
    db.from("payment_allocations").select("enrollment_id,amount_centavos,payments(valid)").in("enrollment_id", ticked),
  ]);
  type Enrollment = { id: string; selling_price_centavos: number; company_charge_agency_id?: string | null; batches?: unknown; trainees?: unknown };
  const list = (enrollments ?? []) as unknown as Enrollment[];
  const clear = ticksToClear(
    list,
    (charges ?? []) as { enrollment_id: string; amount_centavos: number; event_type: string }[],
    ((allocations ?? []) as unknown as { enrollment_id: string; amount_centavos: number; payments: unknown }[]).map((a) => ({ enrollment_id: a.enrollment_id, amount_centavos: a.amount_centavos, valid: first(a.payments as { valid: boolean } | null)?.valid !== false })),
  );
  if (!clear.length) return;
  const { error } = await db.from("mismo_entries").delete().in("enrollment_id", clear);
  if (error) throw new Error(error.message);
  await db.from("audit_logs").insert(clear.map((id) => {
    const e = list.find((x) => x.id === id), tick = tickOf.get(id);
    const t = first(e?.trainees as { legal_last_name?: string; legal_first_name?: string; legal_middle_name?: string | null; srn?: string | null } | null);
    const b = first(e?.batches as { batch_number?: string; starts_on?: string; courses?: unknown } | null);
    return { actor_id: actorId, action: "mismo.removed_after_void", record_type: "enrollment", record_id: id, reason,
      new_values: { payment_id: paymentId, name: `${t?.legal_last_name ?? ""}, ${t?.legal_first_name ?? ""}${t?.legal_middle_name ? ` ${t.legal_middle_name}` : ""}`, srn: t?.srn ?? null, code: first(b?.courses as { code?: string } | null)?.code ?? null, batch_number: tick?.batch_number ?? b?.batch_number ?? null, class_start: tick?.class_start ?? b?.starts_on ?? null } };
  }));
}

/** Everyone a void took off MISMO whose MARINA entry the officer has not yet marked corrected, newest first. */
export async function loadMismoRemoved(db: Admin): Promise<MismoRemoved[]> {
  const read = (action: string) => db.from("audit_logs").select("id,record_id,new_values,reason,created_at").eq("action", action).order("created_at", { ascending: false }).limit(500);
  const [{ data: removed }, { data: cleared }] = await Promise.all([read("mismo.removed_after_void"), read("mismo.void_alert_cleared")]);
  const done = new Set((cleared ?? []).map((c) => (c.new_values as { alert_id?: string } | null)?.alert_id));
  return (removed ?? []).filter((r) => !done.has(r.id as string)).map((r) => {
    const v = (r.new_values ?? {}) as { name?: string; srn?: string | null; code?: string | null; batch_number?: string | null; class_start?: string | null };
    return { id: r.id as string, enrollmentId: r.record_id as string, name: v.name ?? "—", srn: v.srn ?? null, code: v.code ?? null, batchNumber: v.batch_number ?? null, classStart: v.class_start ?? null, reason: (r.reason as string | null) ?? "", at: r.created_at as string };
  });
}

async function loadStaffing(db: Admin, batchIds: string[]) {
  const map = new Map<string, { room: string | null; instructor: string | null }>();
  const dates = await inChunks<{ id: string; batch_id: string }>(batchIds, 100, (part) => db.from("batch_training_dates").select("id,batch_id").in("batch_id", part));
  if (!dates.length) return map;
  const assigns = await inChunks<{ batch_training_date_id: string; instructor_id: string | null; classroom_id: string | null }>(dates.map((d) => d.id), 100, (part) => db.from("resource_assignments").select("batch_training_date_id,instructor_id,classroom_id").in("batch_training_date_id", part));
  if (!assigns.length) return map;
  const [{ data: emps }, { data: rooms }] = await Promise.all([
    db.from("employees").select("id,complete_name").in("id", [...new Set(assigns.map((a) => a.instructor_id).filter((x): x is string => !!x))]),
    db.from("classrooms").select("id,name").in("id", [...new Set(assigns.map((a) => a.classroom_id).filter((x): x is string => !!x))]),
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
