import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getUserRoleNames } from "@/lib/supabase/roles";
import { EMAIL_CODE_TTL_MS, EMAIL_MAX_REQUESTS_PER_HOUR, generateEmailCode, hashEmailCode, isMfaEnforced } from "@/lib/mfa";

export const runtime = "nodejs";

/** Generates a one-time email code for the signed-in privileged staff user and
 * sends it via Resend. The code is stored hashed; the plaintext never persists. */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const roles = await getUserRoleNames(user.id);
  if (!isMfaEnforced(roles)) return NextResponse.json({ error: "MFA is not required for this account." }, { status: 400 });

  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return NextResponse.json({ error: "Email delivery is not configured yet." }, { status: 503 });
  }

  const db = createSupabaseAdminClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("staff_mfa_email_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if ((count ?? 0) >= EMAIL_MAX_REQUESTS_PER_HOUR) {
    return NextResponse.json({ error: "Too many code requests. Please try again later." }, { status: 429 });
  }

  const code = generateEmailCode();
  const { error: insertError } = await db.from("staff_mfa_email_challenges").insert({
    user_id: user.id,
    code_hash: hashEmailCode(user.id, code),
    expires_at: new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString(),
  });
  if (insertError) return NextResponse.json({ error: "Could not create a verification code." }, { status: 500 });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: sendError } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: "Your New Wave sign-in code",
    text: `Your New Wave verification code is ${code}. It expires in 10 minutes. If you did not just sign in, change your password immediately.`,
    html: `<p>Your New Wave verification code is:</p>
<p style="font-size:26px;font-weight:700;letter-spacing:4px;margin:8px 0">${code}</p>
<p>It expires in 10 minutes. If you did not just sign in, change your password immediately.</p>`,
  });
  if (sendError) return NextResponse.json({ error: "Could not send the code email." }, { status: 502 });

  return NextResponse.json({ ok: true });
}
