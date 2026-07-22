import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashValue, requireStaff } from "@/lib/security";

const scanSchema = z.object({ sessionId: z.string().uuid(), token: z.string().min(32).max(512), scanType: z.enum(["check-in","check-out"]), idempotencyKey: z.string().uuid() });

export async function POST(request: Request) {
  const staff = await requireStaff(["admin","training_operations","instructor"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const input = scanSchema.parse(await request.json());
    const db = createSupabaseAdminClient();
    const tokenHash = await hashValue(input.token);
    const { data: token } = await db.from("attendance_tokens").select("enrollment_id,active,expires_at,revoked_at").eq("token_hash", tokenHash).maybeSingle();
    if (!token?.active || token.revoked_at || (token.expires_at && new Date(token.expires_at) <= new Date())) return NextResponse.json({ error: "QR token is invalid or expired." }, { status: 400 });
    const { data: session } = await db.from("attendance_sessions").select("state,check_in_opens_at,check_in_closes_at").eq("id", input.sessionId).maybeSingle();
    if (!session || !["Open","Ongoing"].includes(session.state)) return NextResponse.json({ error: "Attendance session is closed." }, { status: 400 });
    const now = new Date().toISOString();
    const { data: record } = await db.from("attendance_records").select("id,checked_in_at,checked_out_at,status").eq("session_id", input.sessionId).eq("enrollment_id", token.enrollment_id).maybeSingle();
    if (input.scanType === "check-out" && !record?.checked_in_at) return NextResponse.json({ error: "Check-in is required before check-out." }, { status: 400 });
    if ((input.scanType === "check-in" && record?.checked_in_at) || (input.scanType === "check-out" && record?.checked_out_at)) return NextResponse.json({ error: "This scan was already recorded." }, { status: 409 });
    const base = { session_id: input.sessionId, enrollment_id: token.enrollment_id, method: "QR", status: record?.status ?? "Present" };
    const mutation = record
      ? db.from("attendance_records").update(input.scanType === "check-in" ? { checked_in_at: now } : { checked_out_at: now }).eq("id", record.id)
      : db.from("attendance_records").insert(input.scanType === "check-in" ? { ...base, checked_in_at: now } : { ...base, checked_out_at: now });
    const { data: saved, error } = await mutation.select("id").single();
    if (error) throw error;
    await db.from("attendance_events").insert({ attendance_record_id: saved.id, idempotency_key: input.idempotencyKey, event_type: input.scanType, actor_id: staff.user.id, server_payload: { recordedAt: now } });
    return NextResponse.json({ ok: true, recordedAt: now });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record attendance." }, { status: 400 }); }
}
