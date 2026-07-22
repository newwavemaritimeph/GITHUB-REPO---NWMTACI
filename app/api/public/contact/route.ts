import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/security";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The secure contact form is not connected yet." }, { status: 503 });
  try {
    const ipHash = await enforceRateLimit(request, "contact", 5, 30);
    const input = z.object({ name: z.string().min(2).max(120), email: z.string().email(), mobile: z.string().max(30).optional(), message: z.string().min(10).max(2000) }).parse(Object.fromEntries(await request.formData()));
    const db = createSupabaseAdminClient();
    const { error } = await db.from("contact_messages").insert({ complete_name: input.name, email: input.email.toLowerCase(), mobile: input.mobile, message: input.message, ip_hash: ipHash });
    if (error) throw error;
    return NextResponse.json({ ok: true, message: "Your message was sent to New Wave." });
  } catch { return NextResponse.json({ error: "Please review your message and try again." }, { status: 400 }); }
}
