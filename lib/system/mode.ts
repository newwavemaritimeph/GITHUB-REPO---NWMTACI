/**
 * Demo mode runs the portal against browser-local records instead of Supabase,
 * so the full registration → payment → certificate workflow is explorable before
 * staff accounts and operational data exist.
 *
 * It bypasses authentication entirely. A production build therefore refuses to
 * honour it, whatever the environment variable says — otherwise setting the flag
 * on a hosting provider would expose the staff workspace to anyone with the URL.
 *
 * Set NEXT_PUBLIC_DEMO_MODE=true in .env.local for local exploration only.
 */
export function isDemoMode() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
