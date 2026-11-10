import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { QUEUE_TOKEN } from "@/lib/queue";

export const runtime = "nodejs";

/** The trainee's live ticket (queue plan §8, queue_ticket_status): number, service, status, window, ahead. No name or mobile. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured() || !QUEUE_TOKEN.test(token)) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  const { data, error } = await createSupabaseAdminClient().rpc("queue_ticket_status", { target_token: token });
  if (error) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!data) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
