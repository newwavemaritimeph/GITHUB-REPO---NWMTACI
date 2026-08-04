import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// GET ?token=… → context for the public feedback page (who + which course + whether already submitted).
export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return NextResponse.json({ error: "Missing link token." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: e, error } = await admin.from("enrollments")
    .select("id,enrollment_number,trainees(legal_first_name,legal_last_name),courses(name,delivery_type)")
    .eq("feedback_token", token).maybeSingle();
  if (error || !e) return NextResponse.json({ error: "This feedback link is invalid or has expired." }, { status: 404 });
  const t = first(e.trainees) as { legal_first_name?: string; legal_last_name?: string } | null;
  const c = first(e.courses) as { name?: string; delivery_type?: string } | null;
  const { data: fb } = await admin.from("training_feedback").select("id").eq("enrollment_id", e.id).maybeSingle();
  return NextResponse.json({
    traineeName: t ? `${t.legal_first_name ?? ""} ${t.legal_last_name ?? ""}`.trim() : "Trainee",
    courseName: c?.name ?? "your training", inHouse: c?.delivery_type === "In-House",
    alreadySubmitted: Boolean(fb),
  }, { headers: { "Cache-Control": "no-store" } });
}

const submitInput = z.object({
  token: z.string().min(1),
  overallRating: z.number().int().min(1).max(5).optional(),
  instructorRating: z.number().int().min(1).max(5).optional(),
  comments: z.string().trim().max(2000).optional(),
});

// POST → record feedback (= online-training attendance). For In-House courses, mark the
// certificate "Ready to Print" so the Releasing Officer can issue/print it.
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available." }, { status: 503 });
  let body: z.infer<typeof submitInput>;
  try { body = submitInput.parse(await request.json()); }
  catch { return NextResponse.json({ error: "Please complete the form." }, { status: 400 }); }
  const admin = createSupabaseAdminClient();
  const { data: e } = await admin.from("enrollments").select("id,courses(delivery_type)").eq("feedback_token", body.token).maybeSingle();
  if (!e) return NextResponse.json({ error: "This feedback link is invalid or has expired." }, { status: 404 });
  const { error: fbErr } = await admin.from("training_feedback").upsert({
    enrollment_id: e.id, overall_rating: body.overallRating ?? null, instructor_rating: body.instructorRating ?? null,
    comments: body.comments ?? null, submitted_at: new Date().toISOString(),
  }, { onConflict: "enrollment_id" });
  if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });
  const course = first(e.courses) as { delivery_type?: string } | null;
  if (course?.delivery_type === "In-House") {
    // Ready to Print, unless the certificate is already Printed/Released/Cancelled.
    const { data: cert } = await admin.from("certificates").select("id,status").eq("enrollment_id", e.id).maybeSingle();
    if (!cert) await admin.from("certificates").insert({ enrollment_id: e.id, status: "Ready to Print", snapshot: { feedback_attendance: true } });
    else if (!["Printed", "Released", "Cancelled"].includes(cert.status)) await admin.from("certificates").update({ status: "Ready to Print", updated_at: new Date().toISOString() }).eq("id", cert.id);
  }
  return NextResponse.json({ ok: true });
}
