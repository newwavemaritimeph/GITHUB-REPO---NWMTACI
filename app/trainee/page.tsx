import { redirect } from "next/navigation";
import { TraineePortal } from "@/components/trainee-portal";
import { isDemoMode } from "@/lib/system/mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TraineePage() {
  // In demo mode the portal renders its own sign-in against browser-local records.
  if (isDemoMode() || !isSupabaseConfigured()) return <TraineePortal previewMode />;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/registration-search");
  return <TraineePortal />;
}
