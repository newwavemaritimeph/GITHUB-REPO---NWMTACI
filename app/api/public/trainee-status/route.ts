import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";
import { certificateContext } from "@/lib/certificates";

export const runtime = "nodejs";

const input = z.object({ nwmtaciNo: z.string().trim().min(4).max(40), birthdate: z.string().date() });
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const longDate = (d?: string | null) => (d ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`)) : "");

/**
 * Trainee status on the website (owner, 8 Oct 2026). With the NWMTACI number
 * and birth date, the trainee sees each course: schedule, enrollment status,
 * balance, and whether the certificate is printed and ready for pick-up.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Trainee status opens after production setup." }, { status: 503 });
  try { await enforceRateLimit(request, "trainee-status", 15); } catch { return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 }); }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your NWMTACI number and birth date." }, { status: 400 });
  const no = parsed.data.nwmtaciNo.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const db = createSupabaseAdminClient();
  const { data: trainees } = await db.from("trainees").select("id,legal_first_name,birthdate,application_number,trainee_number,awaiting_course").or(`application_number.eq.${no},trainee_number.eq.${no}`).limit(2);
  const t = (trainees ?? []).find((r) => r.birthdate === parsed.data.birthdate);
  if (!t) return NextResponse.json({ error: "We could not match this NWMTACI number and birth date." }, { status: 404 });
  const { data: enrollments } = await db.from("enrollments").select("id,enrollment_status,partner_offer_id,courses(name,code),batches(starts_on,ends_on)").eq("trainee_id", t.id).order("created_at", { ascending: false }).limit(20);
  const { data: handed } = await db.from("enrollments").select("id,handed_to_cashier_at").eq("trainee_id", t.id);
  const handedSet = new Set(((handed ?? []) as { id: string; handed_to_cashier_at?: string | null }[]).filter((h) => h.handed_to_cashier_at).map((h) => h.id));
  const { data: deliveries } = await db.from("delivery_requests").select("enrollment_id,status,tracking_number").eq("trainee_id", t.id);
  const deliveryBy = new Map(((deliveries ?? []) as { enrollment_id: string; status: string; tracking_number: string | null }[]).map((d) => [d.enrollment_id, d]));
  const courses = [];
  for (const e of enrollments ?? []) {
    const c = first(e.courses as unknown as { name: string; code: string } | null), b = first(e.batches as unknown as { starts_on: string; ends_on: string } | null);
    const ctx = await certificateContext(db, e.id);
    const status = e.enrollment_status === "Pending" ? (handedSet.has(e.id) ? "For payment" : "Under screening") : e.enrollment_status === "Open Schedule" ? "Enrolled · schedule to follow" : e.enrollment_status;
    const d = deliveryBy.get(e.id);
    const state = ctx?.view.state;
    const certificate = e.enrollment_status === "Cancelled" || e.partner_offer_id ? null
      : state === "Released" ? (d?.status === "Shipped" || d?.status === "Delivered" ? `Sent by LBC${d.tracking_number ? ` · tracking no. ${d.tracking_number}` : ""}` : "Released")
      : state === "Printed" ? "Printed — ready for pick-up at our office (bring a valid ID)"
      : state === "Void requested" ? "Being reprinted"
      : state === "Due" ? "Being prepared"
      : state === "Waiting for payment" ? "Settle your balance first"
      : state === "Waiting for evaluation" ? "Submit the evaluation form in your Google Classroom"
      : "After your training";
    courses.push({
      course: c?.name ?? "Course", code: c?.code ?? "",
      schedule: b ? `${longDate(b.starts_on)}${b.ends_on !== b.starts_on ? ` – ${longDate(b.ends_on)}` : ""}` : "Schedule to follow",
      status, balanceCentavos: ctx?.balanceCentavos ?? 0, certificate,
      ready: state === "Printed", delivery: d ? d.status : null,
    });
  }
  return NextResponse.json({ firstName: t.legal_first_name, nwmtaciNo: t.application_number ?? t.trainee_number, awaitingCourse: !!t.awaiting_course, courses }, { headers: { "Cache-Control": "no-store" } });
}
