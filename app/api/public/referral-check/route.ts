import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/security";
import { agencyForCode, normaliseReferralCode } from "@/lib/referral";

export const runtime = "nodejs";

/**
 * Public referral-code check for the registration form. Returns only the
 * agency's name, never the code list or rebates. Rate-limited against guessing.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not available yet." }, { status: 503 });
  try {
    await enforceRateLimit(request, "referral-check", 20, 15);
    const body = await request.json().catch(() => ({})) as { code?: string };
    const agency = await agencyForCode(createSupabaseAdminClient(), normaliseReferralCode(body.code));
    if (!agency) return NextResponse.json({ error: "Code not recognised." }, { status: 404 });
    return NextResponse.json({ name: agency.name });
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });
    return NextResponse.json({ error: "Code not recognised." }, { status: 404 });
  }
}
