import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withAuthTimeout } from "@/lib/supabase/config";
import { getUserRoleNames } from "@/lib/supabase/roles";
import { MFA_COOKIE, isMfaEnforced, mfaEnforcementEnabled, verifyMfaCookie } from "@/lib/mfa";
import { MfaGate } from "@/components/mfa-gate";

export const dynamic = "force-dynamic";

export default async function MfaPage() {
  if (!mfaEnforcementEnabled()) redirect("/portal");

  const supabase = await createSupabaseServerClient();
  // Bounded so an unreachable Supabase project cannot stall this page into a 504.
  const session = await withAuthTimeout(supabase.auth.getUser());
  const user = session?.data.user;
  if (!user) redirect("/staff-login");

  const roleNames = await getUserRoleNames(user.id);
  if (!isMfaEnforced(roleNames)) redirect("/portal");

  const aal = (await withAuthTimeout(supabase.auth.mfa.getAuthenticatorAssuranceLevel()))?.data;
  const cookieStore = await cookies();
  if (aal?.currentLevel === "aal2" || verifyMfaCookie(cookieStore.get(MFA_COOKIE)?.value, user.id)) redirect("/portal");

  const factors = (await withAuthTimeout(supabase.auth.mfa.listFactors()))?.data;
  const hasTotp = (factors?.totp ?? []).some((factor) => factor.status === "verified");
  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Extra Verification</h1>
        <p className="auth-sub">This account requires a second step to sign in.</p>
        <MfaGate email={user.email ?? ""} hasTotp={hasTotp} emailConfigured={emailConfigured} />
      </div>
    </main>
  );
}
