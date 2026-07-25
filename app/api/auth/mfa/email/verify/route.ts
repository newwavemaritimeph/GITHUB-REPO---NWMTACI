import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getUserRoleNames } from "@/lib/supabase/roles";
import { EMAIL_COOKIE_TTL_MS, EMAIL_MAX_ATTEMPTS, MFA_COOKIE, isMfaEnforced, signMfaCookie, verifyEmailCode } from "@/lib/mfa";

export const runtime = "nodejs";

/** Verifies an emailed one-time code and, on success, sets the signed MFA cookie
 * that lets the portal guard admit this privileged user. */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const roles = await getUserRoleNames(user.id);
  if (!isMfaEnforced(roles)) return NextResponse.json({ error: "MFA is not required for this account." }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";

  const db = createSupabaseAdminClient();
  const { data: challenge } = await db
    .from("staff_mfa_email_challenges")
    .select("id, code_hash, attempts")
    .eq("user_id", user.id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!challenge) return NextResponse.json({ error: "No active code. Request a new one." }, { status: 400 });

  if (challenge.attempts >= EMAIL_MAX_ATTEMPTS) {
    await db.from("staff_mfa_email_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id);
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }

  if (!verifyEmailCode(user.id, code, challenge.code_hash)) {
    await db.from("staff_mfa_email_challenges").update({ attempts: challenge.attempts + 1 }).eq("id", challenge.id);
    const left = Math.max(0, EMAIL_MAX_ATTEMPTS - (challenge.attempts + 1));
    return NextResponse.json({ error: `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` }, { status: 401 });
  }

  await db.from("staff_mfa_email_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id);

  const expiresAtMs = Date.now() + EMAIL_COOKIE_TTL_MS;
  const cookieStore = await cookies();
  cookieStore.set(MFA_COOKIE, signMfaCookie(user.id, expiresAtMs), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(EMAIL_COOKIE_TTL_MS / 1000),
  });
  return NextResponse.json({ ok: true });
}
