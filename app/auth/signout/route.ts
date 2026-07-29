import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MFA_COOKIE } from "@/lib/mfa";

// Sign-out MUST be POST-only.
//
// A GET handler here is fatal: Next.js prefetches <Link> targets and browsers
// speculatively load links, so a GET /auth/signout fires automatically when the
// portal renders — signing the user out a split second after they sign in
// (destroying their session, so every API route then sees "no session"). Only
// an explicit POST (from the sign-out button's form) may end the session.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  (await cookies()).delete(MFA_COOKIE);
  // 303 See Other → the browser follows with a GET to the login page.
  return NextResponse.redirect(new URL("/staff-login", request.url), 303);
}
