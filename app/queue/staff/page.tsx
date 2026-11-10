import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { QueueStaff } from "@/components/queue/queue-staff";
import { isSupabaseConfigured, withAuthTimeout } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserRoleNames } from "@/lib/supabase/roles";
import { MFA_COOKIE, isMfaEnforced, mfaEnforcementEnabled, verifyMfaCookie } from "@/lib/mfa";
import { requireStaff } from "@/lib/security";

export const dynamic = "force-dynamic";
export const metadata = { title: "Queue Console" };

/** /staff (queue plan §10): the same staff accounts and sign-in as ITMS, with the same step-up rule. */
export default async function QueueStaffPage() {
  const host = (await headers()).get("x-forwarded-host") ?? (await headers()).get("host") ?? "";
  const here = host.toLowerCase().startsWith("queue.") ? "/staff" : "/queue/staff";
  if (!isSupabaseConfigured()) redirect("/staff-login");
  const supabase = await createSupabaseServerClient();
  const user = (await withAuthTimeout(supabase.auth.getUser()))?.data.user;
  if (!user) redirect(`/staff-login?next=${encodeURIComponent(here)}`);
  if (mfaEnforcementEnabled()) {
    const roleNames = await getUserRoleNames(user.id);
    if (isMfaEnforced(roleNames)) {
      const aal = (await withAuthTimeout(supabase.auth.mfa.getAuthenticatorAssuranceLevel()))?.data;
      const emailPassed = verifyMfaCookie((await cookies()).get(MFA_COOKIE)?.value, user.id);
      if (aal?.currentLevel !== "aal2" && !emailPassed) redirect("/portal/mfa");
    }
  }
  const staff = await requireStaff(["registration", "cashier", "releasing_officer", "admin"]);
  if (!staff) return <main className="q-wrap"><section className="q-card"><h1>Not Available</h1><p className="q-note">The queue console is for Registration, the Cashier, the Releasing Officer and the Admin.</p></section></main>;
  return <QueueStaff />;
}
