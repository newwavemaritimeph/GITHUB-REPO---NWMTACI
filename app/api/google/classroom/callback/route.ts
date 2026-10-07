import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CLASSROOM_SCOPES, accountEmail, exchangeCode, googleConfigured, sealToken } from "@/lib/google-classroom";

export const runtime = "nodejs";

/** Google sends the owner back here after consent: store the encrypted refresh token and replace any older connection. */
export async function GET(request: Request) {
  const url = new URL(request.url), origin = url.origin;
  const back = (status: string) => { const r = NextResponse.redirect(`${origin}/portal?classroom=${status}`); r.cookies.delete({ name: "nw_gc_state", path: "/api/google/classroom" }); return r; };
  const staff = await requireStaff(["admin", "registration"]);
  if (!staff) return NextResponse.redirect(`${origin}/staff-login`);
  if (!googleConfigured()) return back("not-configured");
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith("nw_gc_state="))?.slice("nw_gc_state=".length);
  if (url.searchParams.get("error")) return back("cancelled");
  if (!state || !code || !cookie || cookie !== state) return back("invalid");
  try {
    const tokens = await exchangeCode(code, origin);
    if (!tokens.refresh_token) return back("no-refresh");
    const granted = (tokens.scope ?? "").split(" ");
    if (!CLASSROOM_SCOPES.filter((s) => s.startsWith("https://")).every((s) => granted.includes(s))) return back("missing-scope");
    const email = await accountEmail(tokens.access_token!);
    const db = createSupabaseAdminClient();
    const now = new Date().toISOString();
    await db.from("google_connections").update({ revoked_at: now }).eq("provider", "classroom").is("revoked_at", null);
    const { error } = await db.from("google_connections").insert({ provider: "classroom", account_email: email, refresh_token_encrypted: sealToken(tokens.refresh_token), scopes: tokens.scope ?? "", connected_by: staff.user.id });
    if (error) return back(/google_connections/i.test(error.message) ? "needs-migration" : "error");
    await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "registration", action: "google_classroom.connected", record_type: "google_connection", record_id: email, new_values: { account_email: email, scopes: tokens.scope } });
    return back("connected");
  } catch {
    return back("error");
  }
}
