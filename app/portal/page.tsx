import { redirect } from "next/navigation";
import { PortalApp } from "@/components/portal-app";
import { PortalLiveApp } from "@/components/portal-live-app";
import { isDemoMode } from "@/lib/system/mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  // Demo mode, and the case where no Supabase credentials exist at all, both run
  // the workspace against browser-local records and label themselves on screen.
  if (isDemoMode() || !isSupabaseConfigured()) return <PortalApp previewMode />;

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
  if (!staffRole) redirect("/trainee");
  return <PortalLiveApp />;
}
