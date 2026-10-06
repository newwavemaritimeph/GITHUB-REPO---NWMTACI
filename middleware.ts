import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_TIMEOUT_MS, supabaseConfig, withAuthTimeout } from "@/lib/supabase/config";

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
    global: {
      // Bound every auth round trip. An unreachable or slow Supabase host must
      // not hold the request open until the platform timeout turns it into a
      // 504 — a project that stops resolving in DNS once took the whole site
      // down this way, public pages included.
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) }),
    },
  });

  // IMPORTANT: refresh the auth token. Do not add logic between creating the
  // client and calling getUser(), per @supabase/ssr guidance.
  //
  // Fail open. withAuthTimeout bounds the whole call, not just the fetch:
  // measured against an unreachable host, this request took ~51s even with an
  // AbortSignal on fetch, because gotrue retries the refresh internally. A
  // request that times out is served signed-out; protected pages already
  // redirect to /staff-login on a missing session, so the worst case is
  // re-signing in rather than an outage.
  await withAuthTimeout(supabase.auth.getUser());

  return response;
}

export const config = {
  matcher: [
    // Only where a session actually matters. The public marketing and
    // registration pages never read a session, so they must keep rendering
    // even when Supabase is down.
    "/portal/:path*",
    "/auth/:path*",
    "/api/:path*",
  ],
};
