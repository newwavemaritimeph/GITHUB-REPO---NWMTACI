import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit, hashValue, requestIp } from "@/lib/security";
import { joinProblem, normalizeQueueMobile, queueOpen } from "@/lib/queue";
import { broadcastQueue } from "@/lib/queue-server";

export const runtime = "nodejs";

const input = z.object({ name: z.string().max(120), mobile: z.string().max(20), service: z.string().max(2), consent: z.boolean() });

/**
 * Get a queue number (queue plan §8, queue-join): office hours, the fields, 5 joins per 10 minutes per IP, one active
 * ticket per mobile a day (a repeat gets the same ticket back), then the numbered ticket and a public broadcast.
 * Trainees never write to the queue tables themselves.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The queue is not available right now." }, { status: 503 });
  try {
    const body = input.parse(await request.json());
    const db = createSupabaseAdminClient();
    const [{ data: settings }, { data: services }] = await Promise.all([
      db.from("queue_settings").select("open_time,close_time,closed_message").eq("id", 1).maybeSingle(),
      db.from("queue_services").select("code").eq("active", true),
    ]);
    if (!settings) return NextResponse.json({ error: "Apply database update 202610290093 first." }, { status: 503 });
    if (!queueOpen(settings.open_time, settings.close_time)) return NextResponse.json({ error: settings.closed_message, closed: true }, { status: 400 });
    const problem = joinProblem(body, (services ?? []).map((s) => s.code as string));
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    await enforceRateLimit(request, "queue-join", 5, 10);
    const ipHash = await hashValue(`${requestIp(request)}${process.env.IP_HASH_SALT ?? ""}`);
    const { data, error } = await db.rpc("queue_join", { target_service: body.service, target_name: body.name.trim(), target_mobile: normalizeQueueMobile(body.mobile), target_ip_hash: ipHash, actor: null });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const t = data as { ticket_no: string; ticket_token: string; service_code: string; window_no: number; existing: boolean };
    if (!t.existing) await broadcastQueue({ type: "join", ticket_no: t.ticket_no, service_code: t.service_code, window_no: t.window_no });
    return NextResponse.json({ ticketNo: t.ticket_no, token: t.ticket_token, existing: t.existing });
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many tries. Please wait a few minutes, or ask at the front desk." }, { status: 429 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Please fill in the form." }, { status: 400 });
    console.error("Queue join failed:", error);
    return NextResponse.json({ error: "We could not get you a number. Please ask at the front desk." }, { status: 500 });
  }
}
