import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowedWindows } from "@/lib/queue";
import { broadcastQueue, manilaDay } from "@/lib/queue-server";

export const runtime = "nodejs";

const QUEUE_ROLES = ["registration", "cashier", "releasing_officer", "admin"];

/** Staff console data: the windows this account may serve, each window's ticket and waiting list (with names, today only), and today's numbers. */
export async function GET() {
  const staff = await requireStaff(QUEUE_ROLES);
  if (!staff) return NextResponse.json({ error: "Sign in with a Registration, Cashier, Releasing Officer or Admin account." }, { status: 403 });
  const db = createSupabaseAdminClient(), day = manilaDay();
  const [w, s, t] = await Promise.all([
    db.from("queue_windows").select("no,name,service_codes").eq("active", true).order("no"),
    db.from("queue_services").select("code,name").order("sort"),
    db.from("queue_tickets").select("id,ticket_no,service_code,status,window_no,full_name,mobile,created_at,called_at,finished_at,recall_count").eq("day", day).order("created_at"),
  ]);
  if (w.error) return NextResponse.json({ error: "Apply database update 202610290093 first." }, { status: 400 });
  const mine = allowedWindows(staff.roleCodes, (w.data ?? []).map((x) => x.no as number));
  const tickets = t.data ?? [];
  const served = tickets.filter((k) => k.called_at);
  const waits = served.map((k) => (Date.parse(k.called_at as string) - Date.parse(k.created_at as string)) / 60000);
  return NextResponse.json({
    windows: (w.data ?? []).filter((x) => mine.includes(x.no as number)),
    services: s.data ?? [],
    tickets: tickets.filter((k) => k.window_no === null || mine.includes(k.window_no as number)),
    stats: { waiting: tickets.filter((k) => k.status === "waiting").length, served: tickets.filter((k) => k.status === "done").length, noShows: tickets.filter((k) => k.status === "no_show").length, avgWait: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0 },
  }, { headers: { "cache-control": "no-store" } });
}

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("call-next"), window: z.number().int() }),
  z.object({ action: z.enum(["recall", "done", "no_show"]), ticketId: z.string().uuid() }),
]);

/** Call Next, Recall, Done and No-Show, each only at a window this account may serve. */
export async function POST(request: Request) {
  const staff = await requireStaff(QUEUE_ROLES);
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 403 });
  const input = action.parse(await request.json());
  const db = createSupabaseAdminClient();
  const { data: windows } = await db.from("queue_windows").select("no").eq("active", true);
  const mine = allowedWindows(staff.roleCodes, (windows ?? []).map((x) => x.no as number));
  if (input.action === "call-next") {
    if (!mine.includes(input.window)) return NextResponse.json({ error: "That window is not yours." }, { status: 403 });
    const { data, error } = await db.rpc("queue_call_next", { target_window: input.window, actor: staff.user.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: true, ticket: null });
    const t = data as { ticket_no: string; service_code: string; window_no: number };
    await broadcastQueue({ type: "call", ticket_no: t.ticket_no, service_code: t.service_code, window_no: t.window_no });
    return NextResponse.json({ ok: true, ticket: t });
  }
  const { data: ticket } = await db.from("queue_tickets").select("window_no").eq("id", input.ticketId).maybeSingle();
  if (!ticket || !mine.includes(ticket.window_no as number)) return NextResponse.json({ error: "That ticket is not at your window." }, { status: 403 });
  const { data, error } = await db.rpc("queue_set", { target_ticket: input.ticketId, target_action: input.action, actor: staff.user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const t = data as { ticket_no: string; service_code: string; window_no: number };
  await broadcastQueue({ type: input.action === "recall" ? "recall" : input.action, ticket_no: t.ticket_no, service_code: t.service_code, window_no: t.window_no });
  return NextResponse.json({ ok: true, ticket: t });
}
