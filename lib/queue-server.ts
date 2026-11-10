import { supabaseConfig } from "@/lib/supabase/config";
import { QUEUE_CHANNEL, type QueueBroadcast } from "@/lib/queue";

/**
 * Sends one queue event on the public Realtime channel (Supabase REST broadcast). Numbers only; the pages also poll,
 * so a dropped broadcast only delays the update. Server-only: uses the service role key.
 */
export async function broadcastQueue(event: QueueBroadcast) {
  if (!supabaseConfig.url || !supabaseConfig.serviceRoleKey) return;
  const payload: QueueBroadcast = { type: event.type, ticket_no: event.ticket_no, service_code: event.service_code, window_no: event.window_no };
  try {
    await fetch(`${supabaseConfig.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: supabaseConfig.serviceRoleKey, authorization: `Bearer ${supabaseConfig.serviceRoleKey}` },
      body: JSON.stringify({ messages: [{ topic: QUEUE_CHANNEL, event: "queue", payload }] }),
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* the pages poll as well */ }
}

/** Today in Manila. */
export const manilaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
