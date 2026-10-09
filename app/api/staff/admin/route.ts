import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadOverdue } from "@/lib/reconciliation-server";
import { manilaDay, manilaDayBounds } from "@/lib/reconciliation";
import { MISMO_COURSE_CODES } from "@/lib/mismo";
import { isStcwCategory } from "@/lib/certificate-rules";
import type { HolidayDay, MarinaStatus } from "@/lib/admin-dashboard";

export const runtime = "nodejs";

type Db = ReturnType<typeof createSupabaseAdminClient>;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00+08:00`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Admin workspace data (owner, 9 Oct 2026). Admin only.
 *  ?view=dashboard&from&to — enrollments per day, collections and releases per channel,
 *     STCW classes in session today, unreconciled payments, MISMO status, holidays on training days.
 *  ?view=trainee&id — one trainee's enrollments and every payment, including voided ones.
 *  ?view=vouchers&from&to — approved, released and voided expense vouchers.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.includes("admin")) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const db = createSupabaseAdminClient();
  const params = new URL(request.url).searchParams;
  const today = manilaDay(new Date().toISOString());
  const from = ISO.test(params.get("from") ?? "") ? params.get("from")! : today;
  const to = ISO.test(params.get("to") ?? "") ? params.get("to")! : today;
  try {
    const view = params.get("view");
    const body = view === "trainee" ? await trainee(db, params.get("id") ?? "")
      : view === "vouchers" ? await vouchers(db, from, to)
      : await dashboard(db, today, from <= to ? from : to, from <= to ? to : from);
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the Admin data." }, { status: 400 });
  }
}

async function dashboard(db: Db, today: string, from: string, to: string) {
  const start = manilaDayBounds(from).start, end = manilaDayBounds(to).end;
  const [enr, pay, exp] = await Promise.all([
    db.from("enrollments").select("created_at").gte("created_at", start).lte("created_at", end).limit(20000),
    db.from("payments").select("amount_centavos,method").eq("valid", true).gte("received_at", start).lte("received_at", end).limit(20000),
    db.from("expenses").select("id,amount_centavos").eq("status", "Paid").gte("paid_at", start).lte("paid_at", end).limit(20000),
  ]);
  if (enr.error) throw enr.error;
  if (pay.error) throw pay.error;
  if (exp.error) throw exp.error;
  const perDay: Record<string, number> = {};
  for (const r of enr.data ?? []) { const d = manilaDay(r.created_at as string); perDay[d] = (perDay[d] ?? 0) + 1; }
  // Release channel arrives with migration 202608100001; Cash before it.
  const channelById = new Map<string, string>();
  const expIds = (exp.data ?? []).map((e) => e.id as string);
  for (let i = 0; i < expIds.length; i += 300) {
    const { data } = await db.from("expenses").select("id,payment_channel").in("id", expIds.slice(i, i + 300));
    for (const r of data ?? []) channelById.set(r.id as string, (r as { payment_channel?: string | null }).payment_channel ?? "Cash");
  }

  // Classes in session today, with their room and instructor (Resource Planning).
  const { data: todayDates } = await db.from("batch_training_dates").select("batch_id").eq("training_date", today);
  const todayIds = [...new Set((todayDates ?? []).map((d) => d.batch_id as string))];
  const { data: todayBatches } = todayIds.length ? await db.from("batches").select("id,batch_number,starts_on,ends_on,confirmed_count,capacity,status,venue,courses(code,name,course_categories(name))").in("id", todayIds).neq("status", "Cancelled") : { data: [] };
  const plans = new Map<string, { classroom_id: string | null; instructor_id: string | null }>();
  if (todayIds.length) {
    const { data } = await db.from("batch_resources").select("batch_id,classroom_id,instructor_id").in("batch_id", todayIds);
    for (const p of data ?? []) plans.set(p.batch_id as string, { classroom_id: p.classroom_id as string | null, instructor_id: p.instructor_id as string | null });
  }
  const roomIds = [...new Set([...plans.values()].map((p) => p.classroom_id).filter(Boolean))] as string[];
  const instructorIds = [...new Set([...plans.values()].map((p) => p.instructor_id).filter(Boolean))] as string[];
  const [rooms, people] = await Promise.all([
    roomIds.length ? db.from("classrooms").select("id,name,capacity").in("id", roomIds) : Promise.resolve({ data: [] as { id: string; name: string; capacity: number }[] }),
    instructorIds.length ? db.from("instructors").select("id,complete_name").in("id", instructorIds) : Promise.resolve({ data: [] as { id: string; complete_name: string }[] }),
  ]);
  const roomName = new Map((rooms.data ?? []).map((r) => [r.id as string, r as { name: string; capacity: number }]));
  const personName = new Map((people.data ?? []).map((r) => [r.id as string, r.complete_name as string]));
  const classes = (todayBatches ?? []).map((b) => {
    const c = one(b.courses as unknown as { code: string; name: string; course_categories?: { name: string } | { name: string }[] | null } | null);
    const plan = plans.get(b.id as string);
    const room = plan?.classroom_id ? roomName.get(plan.classroom_id) ?? null : null;
    return { id: b.id as string, batchNumber: b.batch_number as string, courseCode: c?.code ?? "—", courseName: c?.name ?? "", stcw: isStcwCategory(one(c?.course_categories)?.name) || MISMO_COURSE_CODES.includes((c?.code ?? "").toUpperCase()),
      startsOn: b.starts_on as string, endsOn: b.ends_on as string, students: Number(b.confirmed_count ?? 0), capacity: Number(b.capacity ?? 24),
      room: room?.name ?? null, roomSeats: room?.capacity ?? null, instructor: plan?.instructor_id ? personName.get(plan.instructor_id) ?? null : null };
  }).sort((a, z) => a.courseCode.localeCompare(z.courseCode));

  // MARINA MISMO: today's MISMO batches still to submit after the 4:00 PM cut-off.
  const mismoToday = classes.filter((c) => MISMO_COURSE_CODES.includes(c.courseCode.toUpperCase()));
  let mismoSubmitted = 0;
  if (mismoToday.length) {
    const { data } = await db.from("mismo_submissions").select("batch_id").in("batch_id", mismoToday.map((c) => c.id)).eq("list_date", today);
    mismoSubmitted = (data ?? []).length;
  }
  const afterCutoff = new Date() >= new Date(`${today}T16:00:00+08:00`);

  // Unprinted certificates past their due day are computed in the browser from the portal data.
  const overdue = await loadOverdue(db, today).catch(() => []);
  const holidays = await holidayDays(db, `${today.slice(0, 7)}-01`, addDays(today, 150));

  return {
    today, from, to,
    enrollmentsPerDay: perDay,
    enrollments: (enr.data ?? []).length,
    collections: (pay.data ?? []).map((p) => ({ channel: p.method as string, amount: Number(p.amount_centavos) })),
    releases: (exp.data ?? []).map((e) => ({ channel: channelById.get(e.id as string) ?? "Cash", amount: Number(e.amount_centavos) })),
    classes,
    mismo: { batches: mismoToday.length, submitted: mismoSubmitted, afterCutoff },
    unreconciled: overdue.map((c) => ({ channel: c.channel, count: c.count, total: c.total, oldest: c.days.map((d) => d.day).sort()[0] ?? null })),
    holidays,
  };
}

/** Each holiday in the range with the batches in class that day. Empty before migration 202610090038. */
async function holidayDays(db: Db, from: string, to: string): Promise<HolidayDay[]> {
  const { data, error } = await db.from("holidays").select("holiday_date,name,kind,marina_status,marina_note").gte("holiday_date", from).lte("holiday_date", to).order("holiday_date");
  if (error || !data?.length) return [];
  const dates = data.map((h) => h.holiday_date as string);
  const { data: rows } = await db.from("batch_training_dates").select("training_date,batches!inner(batch_number,confirmed_count,status,courses(code))").in("training_date", dates).neq("batches.status", "Cancelled");
  const byDate = new Map<string, { batchNumber: string; courseCode: string; students: number }[]>();
  for (const r of rows ?? []) {
    const b = one(r.batches as unknown as { batch_number: string; confirmed_count: number; courses?: { code: string } | { code: string }[] | null } | null);
    if (!b) continue;
    const list = byDate.get(r.training_date as string) ?? [];
    if (!list.some((x) => x.batchNumber === b.batch_number)) list.push({ batchNumber: b.batch_number, courseCode: one(b.courses)?.code ?? "—", students: Number(b.confirmed_count ?? 0) });
    byDate.set(r.training_date as string, list);
  }
  return data.map((h) => ({ date: h.holiday_date as string, name: h.name as string, kind: h.kind as string, marinaStatus: h.marina_status as MarinaStatus, marinaNote: (h.marina_note as string | null) ?? null, batches: (byDate.get(h.holiday_date as string) ?? []).sort((a, z) => a.courseCode.localeCompare(z.courseCode)) }));
}

async function trainee(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Choose a trainee.");
  const { data: enrollments, error } = await db.from("enrollments").select("id,enrollment_number,enrollment_status,selling_price_centavos,created_at,courses(code,name),batches(batch_number,starts_on,ends_on)").eq("trainee_id", id).order("created_at", { ascending: false });
  if (error) throw error;
  const ids = (enrollments ?? []).map((e) => e.id as string);
  const [charges, allocations] = await Promise.all([
    ids.length ? db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", ids).eq("valid", true) : Promise.resolve({ data: [] as { enrollment_id: string; amount_centavos: number; event_type: string }[] }),
    ids.length ? db.from("payment_allocations").select("payment_id,enrollment_id,amount_centavos,payments(valid)").in("enrollment_id", ids) : Promise.resolve({ data: [] as { payment_id: string; enrollment_id: string; amount_centavos: number; payments: unknown }[] }),
  ]);
  const due = new Map<string, number>(), paid = new Map<string, number>();
  for (const c of charges.data ?? []) due.set(c.enrollment_id, (due.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos));
  for (const a of allocations.data ?? []) if (one(a.payments as { valid: boolean } | null)?.valid !== false) paid.set(a.enrollment_id, (paid.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
  const courseOf = new Map((enrollments ?? []).map((e) => [e.id as string, one(e.courses as unknown as { code: string } | null)?.code ?? "—"]));
  const coursesByPayment = new Map<string, string[]>();
  for (const a of allocations.data ?? []) coursesByPayment.set(a.payment_id, [...new Set([...(coursesByPayment.get(a.payment_id) ?? []), courseOf.get(a.enrollment_id) ?? "—"])]);

  const base = "id,payment_number,amount_centavos,method,reference_number,received_at,valid,profiles:cashier_id(complete_name),receipts(receipt_number)";
  let pays = await db.from("payments").select(`${base},void_reason,voided_at`).eq("trainee_id", id).order("received_at", { ascending: false });
  if (pays.error) pays = await db.from("payments").select(base).eq("trainee_id", id).order("received_at", { ascending: false }) as typeof pays;
  if (pays.error) throw pays.error;
  return {
    enrollments: (enrollments ?? []).map((e) => {
      const b = one(e.batches as unknown as { batch_number: string; starts_on: string; ends_on: string } | null);
      const c = one(e.courses as unknown as { code: string; name: string } | null);
      const total = Number(e.selling_price_centavos) + (due.get(e.id as string) ?? 0);
      return { id: e.id as string, number: e.enrollment_number as string, status: e.enrollment_status as string, courseCode: c?.code ?? "—", courseName: c?.name ?? "", batch: b?.batch_number ?? null, startsOn: b?.starts_on ?? null, endsOn: b?.ends_on ?? null, due: total, paid: paid.get(e.id as string) ?? 0 };
    }),
    payments: ((pays.data ?? []) as unknown as Record<string, unknown>[]).map((p) => ({
      id: p.id as string, number: p.payment_number as string, receipt: one(p.receipts as { receipt_number: string } | null)?.receipt_number ?? null,
      amount: Number(p.amount_centavos), method: p.method as string, reference: (p.reference_number as string | null) ?? null, receivedAt: p.received_at as string,
      recordedBy: one(p.profiles as { complete_name: string } | null)?.complete_name ?? null, courses: coursesByPayment.get(p.id as string) ?? [],
      valid: p.valid !== false, voidReason: (p.void_reason as string | null) ?? null, voidedAt: (p.voided_at as string | null) ?? null,
    })),
  };
}

async function vouchers(db: Db, from: string, to: string) {
  const start = manilaDayBounds(from).start, end = manilaDayBounds(to).end;
  const { data, error } = await db.from("expenses").select("id,expense_number,payee,category,amount_centavos,status,created_at,paid_at").in("status", ["Approved", "Paid", "Void"]).gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  const extra = new Map<string, Record<string, unknown>>();
  const ids = (data ?? []).map((e) => e.id as string);
  for (let i = 0; i < ids.length; i += 300) {
    const { data: x } = await db.from("expenses").select("id,voucher_number,payment_channel,void_reason,voided_at").in("id", ids.slice(i, i + 300));
    for (const r of x ?? []) extra.set((r as { id: string }).id, r as Record<string, unknown>);
  }
  return {
    from, to,
    vouchers: (data ?? []).map((e) => { const x = extra.get(e.id as string) ?? {}; return { id: e.id as string, number: (x.voucher_number as string | null) ?? (e.expense_number as string), payee: e.payee as string, category: e.category as string, amount: Number(e.amount_centavos), status: e.status as string, channel: (x.payment_channel as string | null) ?? null, createdAt: e.created_at as string, paidAt: (e.paid_at as string | null) ?? null, voidReason: (x.void_reason as string | null) ?? null, voidedAt: (x.voided_at as string | null) ?? null }; }),
  };
}
