import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";
import { processEmailJobs } from "@/lib/email-jobs";
import { isEmail, isPhContactNumber } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Certificate delivery request (owner, 8 Oct 2026). The trainee confirms who
 * they are with their NWMTACI number and birth date, picks the certificate and
 * gives the address. Registration checks it, the Cashier collects the LBC fee,
 * the Releasing Officer ships. Only the trainee's first name and their course
 * list are ever returned, and only after the number and birth date match.
 */

const fee = () => "₱500.00";
const clean = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const longDate = (d?: string | null) => (d ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`)) : "");

const who = z.object({ nwmtaciNo: z.string().trim().min(4).max(40), birthdate: z.string().date() });
const submitInput = who.extend({
  enrollmentId: z.string().uuid(),
  recipientName: z.string().trim().min(2).max(160),
  mobile: z.string().trim().refine(isPhContactNumber, "Enter a valid mobile number."),
  addressLine: z.string().trim().min(5).max(240),
  city: z.string().trim().min(2).max(80),
  province: z.string().trim().min(2).max(80),
  zip: z.string().trim().max(10).optional(),
  email: z.string().trim().refine(isEmail, "Enter a valid email address."),
  agree: z.literal(true),
});

async function findTrainee(db: ReturnType<typeof createSupabaseAdminClient>, nwmtaciNo: string, birthdate: string) {
  const no = clean(nwmtaciNo);
  if (!no) return null;
  const { data } = await db.from("trainees").select("id,legal_first_name,legal_last_name,email,birthdate").or(`application_number.eq.${no},trainee_number.eq.${no}`).limit(2);
  const t = (data ?? []).find((r) => r.birthdate === birthdate);
  return t ?? null;
}

async function certificatesOf(db: ReturnType<typeof createSupabaseAdminClient>, traineeId: string) {
  const { data } = await db.from("enrollments").select("id,enrollment_status,partner_offer_id,courses(name),batches(starts_on,ends_on)").eq("trainee_id", traineeId).eq("enrollment_status", "Enrolled").is("partner_offer_id", null).order("created_at", { ascending: false }).limit(20);
  return (data ?? []).map((e) => { const b = first(e.batches as unknown as { starts_on: string; ends_on: string } | null); const c = first(e.courses as unknown as { name: string } | null); return { id: e.id as string, course: c?.name ?? "Course", dates: b ? `${longDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${longDate(b.ends_on)}` : ""}` : "" }; });
}

const limited = () => NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });

/** GET ?no=DR-…&birthdate=YYYY-MM-DD → the status of a request. */
export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  try { await enforceRateLimit(request, "delivery-track", 30); } catch { return limited(); }
  const url = new URL(request.url);
  const no = clean(url.searchParams.get("no") ?? ""), birthdate = url.searchParams.get("birthdate") ?? "";
  if (!no || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return NextResponse.json({ error: "Enter your request number and birth date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: r } = await db.from("delivery_requests").select("request_number,status,decline_reason,tracking_number,shipped_on,city,province,created_at,trainees(birthdate,legal_first_name),enrollments(courses(name))").eq("request_number", no).maybeSingle();
  const t = first(r?.trainees as unknown as { birthdate: string; legal_first_name: string } | null);
  if (!r || t?.birthdate !== birthdate) return NextResponse.json({ error: "We could not find a request with this number and birth date." }, { status: 404 });
  const course = first(first(r.enrollments as unknown as { courses: { name: string } | { name: string }[] | null } | null)?.courses ?? null)?.name ?? "";
  return NextResponse.json({ requestNumber: r.request_number, status: r.status, declineReason: r.decline_reason, trackingNumber: r.tracking_number, shippedOn: r.shipped_on, destination: `${r.city}, ${r.province}`, course, firstName: t?.legal_first_name ?? "", fee: fee() }, { headers: { "Cache-Control": "no-store" } });
}

/** POST {step:"lookup", nwmtaciNo, birthdate} or {step:"submit", …}. */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const db = createSupabaseAdminClient();
  if (body.step === "lookup") {
    try { await enforceRateLimit(request, "delivery-lookup", 20); } catch { return limited(); }
    const parsed = who.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter your NWMTACI number and birth date." }, { status: 400 });
    const t = await findTrainee(db, parsed.data.nwmtaciNo, parsed.data.birthdate);
    if (!t) return NextResponse.json({ error: "We could not match this NWMTACI number and birth date." }, { status: 404 });
    return NextResponse.json({ firstName: t.legal_first_name, certificates: await certificatesOf(db, t.id) });
  }
  if (body.step !== "submit") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try { await enforceRateLimit(request, "delivery-submit", 6, 60); } catch { return limited(); }
  const parsed = submitInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please complete the form." }, { status: 400 });
  const input = parsed.data;
  const t = await findTrainee(db, input.nwmtaciNo, input.birthdate);
  if (!t) return NextResponse.json({ error: "We could not match this NWMTACI number and birth date." }, { status: 404 });
  const certs = await certificatesOf(db, t.id);
  const chosen = certs.find((c) => c.id === input.enrollmentId);
  if (!chosen) return NextResponse.json({ error: "Choose one of your courses." }, { status: 400 });
  const { data: open } = await db.from("delivery_requests").select("request_number").eq("enrollment_id", chosen.id).in("status", ["Requested", "With the Cashier", "Paid"]).maybeSingle();
  if (open) return NextResponse.json({ error: `A delivery request for this certificate is already open (${open.request_number}).` }, { status: 409 });
  const { data: ref, error: refError } = await db.rpc("next_reference", { prefix: "DR" });
  if (refError) return NextResponse.json({ error: "Could not create the request. Please try again." }, { status: 500 });
  const row = { request_number: String(ref), trainee_id: t.id, enrollment_id: chosen.id, recipient_name: input.recipientName, mobile: input.mobile, address_line: input.addressLine, city: input.city, province: input.province, zip: input.zip || null, email: input.email.toLowerCase() };
  const { error } = await db.from("delivery_requests").insert(row);
  if (error) return NextResponse.json({ error: error.code === "42P01" ? "Delivery requests are not open yet." : "Could not save the request." }, { status: 500 });
  await db.from("audit_logs").insert({ actor_id: null, actor_role: "trainee", action: "delivery.requested", record_type: "enrollment", record_id: chosen.id, new_values: { request_number: row.request_number, city: input.city, province: input.province } });
  const origin = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const address = [input.addressLine, input.city, input.province, input.zip].filter(Boolean).join(", ");
  const { data: job } = await db.from("email_jobs").insert({ idempotency_key: `delivery:${row.request_number}:received`, template_code: "delivery.received", recipient: row.email, variables: { trainee_name: `${t.legal_first_name} ${t.legal_last_name}`, request_number: row.request_number, course_name: chosen.course, address, fee: fee(), track_url: `${origin}/certificate-delivery?no=${row.request_number}` } }).select("id").maybeSingle();
  if (job?.id) await processEmailJobs(db, { ids: [job.id], origin }).catch(() => undefined);
  return NextResponse.json({ ok: true, requestNumber: row.request_number });
}
