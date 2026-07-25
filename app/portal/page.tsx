import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PortalApp } from "@/components/portal-app";
import { PortalLiveApp } from "@/components/portal-live-app";
import { isDemoMode } from "@/lib/system/mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserRoleNames } from "@/lib/supabase/roles";
import { MFA_COOKIE, isMfaEnforced, mfaEnforcementEnabled, verifyMfaCookie } from "@/lib/mfa";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  // The unauthenticated browser-local workspace is a development convenience and
  // must never be reachable from a deployed site. In production a missing
  // Supabase configuration is a misconfiguration, not an invitation to open the
  // staff workspace to anyone holding the URL.
  if (process.env.NODE_ENV === "production") {
    if (!isSupabaseConfigured()) redirect("/staff-login");
  } else if (isDemoMode() || !isSupabaseConfigured()) {
    return <PortalApp previewMode />;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/staff-login");
  const { data: staffRole } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!staffRole) redirect("/registration-search");

  // Step-up MFA for privileged roles (Admin / Accounting) — only when enabled.
  if (mfaEnforcementEnabled()) {
    const roleNames = await getUserRoleNames(user.id);
    if (isMfaEnforced(roleNames)) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const cookieStore = await cookies();
      const emailPassed = verifyMfaCookie(cookieStore.get(MFA_COOKIE)?.value, user.id);
      if (aal?.currentLevel !== "aal2" && !emailPassed) redirect("/portal/mfa");
    }
  }

  return <PortalLiveApp />;
}
