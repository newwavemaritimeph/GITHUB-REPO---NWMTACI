import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Admin › Portal Sounds (owner, 10 Nov 2026): the new-arrival chime per role. Admin only, audited. */
const input = z.object({ sound: z.object({ registration: z.boolean(), cashier: z.boolean(), releasing_officer: z.boolean(), mismo_officer: z.boolean() }) });

export async function POST(request: Request) {
  const staff = await requireStaff(["admin"]);
  if (!staff) return NextResponse.json({ error: "Only the Admin can change the portal sounds." }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the settings." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: prior, error: pe } = await db.from("organization_settings").select("id,portal_sound").maybeSingle();
  if (pe || !prior) return NextResponse.json({ error: pe && /portal_sound/.test(pe.message) ? "Apply database update 202611100096 first." : pe?.message ?? "Settings not found." }, { status: 400 });
  const { error } = await db.from("organization_settings").update({ portal_sound: parsed.data.sound }).eq("id", prior.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "admin", action: "settings.portal_sound", record_type: "organization_settings", record_id: "1", prior_values: { portal_sound: prior.portal_sound }, new_values: { portal_sound: parsed.data.sound } });
  return NextResponse.json({ ok: true });
}
