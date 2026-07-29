import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/supabase/config";

/**
 * Keeps the Supabase auth session fresh on every request.
 *
 * @supabase/ssr rotates refresh tokens, and React Server Components cannot
 * persist the rotated token back to cookies. Without this middleware the token
 * goes stale after the first refresh, so server route handlers (e.g. the Admin
 * configuration API) stop seeing the session — reporting "no session" — even
 * though the browser still appears logged in. Running getUser() here refreshes
 * the session and re-writes the cookies before any page or route handler runs.
 *
 * See: https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // If Supabase isn't configured (e.g. demo/local), do nothing.
  if (!supabaseConfig.url || !supabaseConfig.anonKey) return response;

  const supabase = createServerClient(supabaseConfig.url, supabaseConfig.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANT: refresh the auth token. Do not add logic between creating the
  // client and calling getUser(), per @supabase/ssr guidance.
  const { data: { user } } = await supabase.auth.getUser();

  // Verification stamp: proves the middleware executed and whether it saw a user.
  response.headers.set("x-nwm-mw", user ? "user" : "anon");

  return response;
}

export const config = {
  matcher: [
    // Run on all paths except Next internals and static image assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
