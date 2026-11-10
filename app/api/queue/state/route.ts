import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { manilaDay } from "@/lib/queue-server";

export const runtime = "nodejs";

/**
 * The office monitor (queue plan §8, queue-display-state): each open window with the ticket it is serving, the next 8
 * waiting tickets, the services and the ticker. Ticket numbers only (a first name only when the Admin turns it on).
 * Phase 2 adds the display device key.
 */
export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The queue is not available right now." }, { status: 503 });
  const db = createSupabaseAdminClient(), day = manilaDay();
  const [w, s, t, cfg] = await Promise.all([
    db.from("queue_windows").select("no,name,service_codes").eq("active", true).order("no"),
    db.from("queue_services").select("code,name,default_window").eq("active", true).order("sort"),
    db.from("queue_tickets").select("ticket_no,service_code,status,window_no,full_name,created_at,called_at,recall_count").eq("day", day).in("status", ["waiting", "serving"]).order("created_at"),
    db.from("queue_settings").select("show_first_name,ticker_message,open_time,close_time,closed_message").eq("id", 1).maybeSingle(),
  ]);
  if (w.error || !cfg.data) return NextResponse.json({ error: "Apply database update 202610290093 first." }, { status: 503 });
  const showName = !!cfg.data.show_first_name;
  const shown = (x: { ticket_no: string; service_code: string; window_no: number | null; full_name: string | null }) => ({ ticket_no: x.ticket_no, service_code: x.service_code, window_no: x.window_no, ...(showName && x.full_name ? { first_name: x.full_name.split(/\s+/)[0] } : {}) });
  const tickets = t.data ?? [];
  return NextResponse.json({
    windows: (w.data ?? []).map((x) => { const now = tickets.find((k) => k.status === "serving" && k.window_no === x.no); return { no: x.no, name: x.name, service_codes: x.service_codes, serving: now ? { ...shown(now), called_at: now.called_at, recall_count: now.recall_count } : null }; }),
    waiting: tickets.filter((k) => k.status === "waiting").slice(0, 8).map(shown),
    waitingCount: tickets.filter((k) => k.status === "waiting").length,
    services: s.data ?? [],
    ticker: cfg.data.ticker_message, openTime: cfg.data.open_time, closeTime: cfg.data.close_time,
  }, { headers: { "cache-control": "no-store" } });
}
