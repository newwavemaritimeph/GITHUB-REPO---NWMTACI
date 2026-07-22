/**
 * Demo mode runs the portal and trainee workspace against browser-local records
 * instead of Supabase, so the full registration → payment → certificate workflow
 * is explorable before staff accounts and operational data exist in the database.
 *
 * Set NEXT_PUBLIC_DEMO_MODE=true in .env.local to enable it. Leave it unset (or
 * "false") for the real Supabase-authenticated path.
 */
export function isDemoMode() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
