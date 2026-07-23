import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/security";
import { suggestAttendanceStatus } from "@/lib/domain";

/**
 * Attendance for the live staff workspace.
 *
 * Sessions are created on demand from the batch's training dates, so Training
 * Operations never has to set them up by hand. State moves Planned → Open →
 * Submitted → Verified, and only a verified session counts towards a certificate.
 */

const READ_ROLES = ["admin", "training_operations", "instructor"];

type Session = {
  id: string;
  batch_training_date_id: string;
  session_name: string;
  starts_at: string;
  ends_at: string;
  late_threshold_minutes: number;
  minimum_required_minutes: number;
  state: string;
  submitted_at: string | null;
  verified_at: string | null;
};

export async function GET(request: Request) {
  const staff = await requireStaff(READ_ROLES);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const batchId = new URL(request.url).searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "A batch is required." }, { status: 400 });

  const db = createSupabaseAdminClient();

  const { data: dates, error: datesError } = await db
    .from("batch_training_dates")
    .select("id,training_date,starts_at,ends_at")
    .eq("batch_id", batchId)
    .order("training_date", { ascending: true });
  if (datesError) return NextResponse.json({ error: datesError.message }, { status: 500 });

  const dateIds = (dates ?? []).map((item) => item.id);
  const { data: existing } = dateIds.length
    ? await db.from("attendance_sessions").select("*").in("batch_training_date_id", dateIds)
    : { data: [] as Session[] };

  // Create any session that does not exist yet for this batch's training dates.
  const missing = (dates ?? [])
    .filter((date) => !(existing ?? []).some((session) => session.batch_training_date_id === date.id))
    .map((date, index) => ({
      batch_training_date_id: date.id,
      session_name: `Day ${index + 1}`,
      starts_at: date.starts_at ?? `${date.training_date}T08:00:00+08:00`,
      ends_at: date.ends_at ?? `${date.training_date}T17:00:00+08:00`,
      check_in_opens_at: date.starts_at ?? `${date.training_date}T07:00:00+08:00`,
      check_in_closes_at: date.ends_at ?? `${date.training_date}T18:00:00+08:00`,
      minimum_required_minutes: 360,
    }));
  if (missing.length) {
    const { error } = await db.from("attendance_sessions").insert(missing);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: sessions } = dateIds.length
    ? await db
        .from("attendance_sessions")
        .select("*,batch_training_dates!inner(training_date,batch_id)")
        .in("batch_training_date_id", dateIds)
        .order("starts_at", { ascending: true })
    : { data: [] };

  const sessionIds = (sessions ?? []).map((session) => session.id);
  const { data: records } = sessionIds.length
    ? await db.from("attendance_records").select("*").in("session_id", sessionIds)
    : { data: [] };

  const { data: roster } = await db
    .from("enrollments")
    .select("id,enrollment_number,enrollment_status,trainees(trainee_number,legal_first_name,legal_middle_name,legal_last_name)")
    .eq("batch_id", batchId)
    .neq("enrollment_status", "Cancelled");

  return NextResponse.json({
    sessions: sessions ?? [],
    records: records ?? [],
    roster: roster ?? [],
    canVerify: staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role)),
  });
}

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-state"), sessionId: z.string().uuid(), state: z.enum(["Open", "Submitted", "Verified"]) }),
  z.object({
    action: z.literal("mark"),
    sessionId: z.string().uuid(),
    enrollmentId: z.string().uuid(),
    status: z.enum(["Present", "Late", "Absent", "Incomplete", "Make-Up Required", "Make-Up Completed"]),
    reason: z.string().trim().min(3).max(300),
  }),
  z.object({
    action: z.literal("scan"),
    sessionId: z.string().uuid(),
    enrollmentId: z.string().uuid(),
    scanType: z.enum(["check-in", "check-out"]),
  }),
]);

export async function POST(request: Request) {
  const staff = await requireStaff(READ_ROLES);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  try {
    const input = mutation.parse(await request.json());
    const db = createSupabaseAdminClient();

    const { data: session } = await db
      .from("attendance_sessions")
      .select("id,state,starts_at,late_threshold_minutes,minimum_required_minutes")
      .eq("id", input.sessionId)
      .maybeSingle();
    if (!session) return NextResponse.json({ error: "Attendance session not found." }, { status: 404 });

    if (input.action === "set-state") {
      if (input.state === "Verified" && !staff.roleCodes.some((role) => ["admin", "training_operations"].includes(role))) {
        return NextResponse.json({ error: "Only Training Operations may verify attendance." }, { status: 403 });
      }
      if (input.state === "Submitted" && session.state !== "Open") {
        return NextResponse.json({ error: "Only an open session can be submitted." }, { status: 409 });
      }
      if (input.state === "Verified" && session.state !== "Submitted") {
        return NextResponse.json({ error: "Attendance must be submitted before it is verified." }, { status: 409 });
      }
      const patch: Record<string, unknown> = { state: input.state };
      if (input.state === "Open") patch.started_by = staff.user.id;
      if (input.state === "Submitted") patch.submitted_at = new Date().toISOString();
      if (input.state === "Verified") {
        patch.verified_by = staff.user.id;
        patch.verified_at = new Date().toISOString();
      }
      const { error } = await db.from("attendance_sessions").update(patch).eq("id", session.id);
      if (error) throw error;
      return NextResponse.json({ ok: true, state: input.state });
    }

    // A verified session is locked; corrections go through a change request.
    if (session.state === "Verified") {
      return NextResponse.json({ error: "This session is verified and locked." }, { status: 409 });
    }

    const { data: existing } = await db
      .from("attendance_records")
      .select("id,checked_in_at,checked_out_at,status")
      .eq("session_id", session.id)
      .eq("enrollment_id", input.enrollmentId)
      .maybeSingle();

    if (input.action === "mark") {
      const row = {
        session_id: session.id,
        enrollment_id: input.enrollmentId,
        status: input.status,
        method: "Manual" as const,
        manual_reason: input.reason,
        updated_at: new Date().toISOString(),
      };
      const { error } = existing
        ? await db.from("attendance_records").update(row).eq("id", existing.id)
        : await db.from("attendance_records").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true, status: input.status });
    }

    // scan
    if (session.state !== "Open") {
      return NextResponse.json({ error: "Open the session before scanning." }, { status: 409 });
    }
    const now = new Date();
    if (input.scanType === "check-in") {
      if (existing?.checked_in_at) return NextResponse.json({ error: "Already checked in." }, { status: 409 });
      const late = now.getTime() > new Date(session.starts_at).getTime() + session.late_threshold_minutes * 60_000;
      const row = {
        session_id: session.id,
        enrollment_id: input.enrollmentId,
        checked_in_at: now.toISOString(),
        status: late ? ("Late" as const) : ("Present" as const),
        method: "QR" as const,
        updated_at: now.toISOString(),
      };
      const { error } = existing
        ? await db.from("attendance_records").update(row).eq("id", existing.id)
        : await db.from("attendance_records").insert(row);
      if (error) throw error;
      return NextResponse.json({ ok: true, status: row.status, at: row.checked_in_at });
    }

    if (!existing?.checked_in_at) {
      return NextResponse.json({ error: "Check-in is required before check-out." }, { status: 409 });
    }
    if (existing.checked_out_at) return NextResponse.json({ error: "Already checked out." }, { status: 409 });

    const status = suggestAttendanceStatus({
      checkedInAt: new Date(existing.checked_in_at),
      checkedOutAt: now,
      sessionStartsAt: new Date(session.starts_at),
      lateThresholdMinutes: session.late_threshold_minutes,
      minimumRequiredMinutes: session.minimum_required_minutes,
    });
    const attendedMinutes = Math.max(
      0,
      Math.floor((now.getTime() - new Date(existing.checked_in_at).getTime()) / 60_000),
    );
    const { error } = await db
      .from("attendance_records")
      .update({ checked_out_at: now.toISOString(), attended_minutes: attendedMinutes, status, updated_at: now.toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
    return NextResponse.json({ ok: true, status, attendedMinutes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record attendance." },
      { status: 400 },
    );
  }
}
