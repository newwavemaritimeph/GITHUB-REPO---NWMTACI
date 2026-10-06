import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withAuthTimeout } from "@/lib/supabase/config";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next")?.startsWith("/") ? url.searchParams.get("next")! : "/registration-search";
  if (code) { const supabase = await createSupabaseServerClient(); await withAuthTimeout(supabase.auth.exchangeCodeForSession(code)); }
  return NextResponse.redirect(new URL(next, request.url));
}
