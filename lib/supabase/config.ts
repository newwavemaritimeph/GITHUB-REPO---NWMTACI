export const supabaseConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};

export function isSupabaseConfigured() {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

/** Longest we wait on a Supabase Auth call before treating the caller as signed out. */
export const AUTH_TIMEOUT_MS = 3000;

/**
 * Bounds a Supabase Auth call and never throws.
 *
 * gotrue retries a failed token refresh internally with backoff, so a project
 * that is paused, deleted, or simply slow can hold a single request open for
 * ~50 seconds — long enough for the hosting platform to turn it into a 504.
 * An AbortSignal on the underlying fetch is not enough, because each retry
 * gets a fresh signal. Racing a timer caps the call regardless of what the
 * client does internally.
 *
 * Returns null when the call times out or fails, which callers read as
 * "no session" and handle by redirecting to sign-in.
 */
export async function withAuthTimeout<T>(call: PromiseLike<T>): Promise<T | null> {
  try {
    return await Promise.race([
      call,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTH_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}
