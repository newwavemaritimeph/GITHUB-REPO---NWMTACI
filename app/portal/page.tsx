import { redirect } from "next/navigation";
import { PortalApp } from "@/components/portal-app";
import { PortalLiveApp } from "@/components/portal-live-app";
import { isDemoMode } from "@/lib/system/mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  return <PortalLiveApp />;
}
