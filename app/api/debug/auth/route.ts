import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only auth diagnostic. Reports which cookies the server receives and
 * whether it can read the Supabase session — nothing sensitive (cookie names
 * only, plus the caller's own id/email). Visit /api/debug/auth in the browser
 * while signed in to see the raw truth about the session the server sees.
 */
export async function GET() {
  const jar = await cookies();
  const names = jar.getAll().map((c) => c.name);
  const authCookies = names.filter((n) => n.startsWith("sb-") || n.includes("auth-token"));

  let session: { userId: string; email: string | null } | null = null;
  let getUserError: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) getUserError = error.message;
    if (data.user) session = { userId: data.user.id, email: data.user.email ?? null };
  } catch (e) {
    getUserError = e instanceof Error ? e.message : "unknown error";
  }

  return NextResponse.json(
    {
      totalCookies: names.length,
      authCookiesPresent: authCookies,
      sessionReadableByServer: Boolean(session),
      session,
      getUserError,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
