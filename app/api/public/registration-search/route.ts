import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/security";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Status search will open after production setup." }, { status: 503 });
  try {
    await enforceRateLimit(request, "registration-search", 10, 15);
    const input = z.object({ reference: z.string().regex(/^REG-\d{4}-\d{6}$/), email: z.string().email() }).parse(Object.fromEntries(await request.formData()));
    const db = createSupabaseAdminClient();
    const { data } = await db.from("trainees").select("id,profile_id,account_state,enrollments(enrollment_status)").eq("email", input.email.toLowerCase()).eq("registration_reference", input.reference).limit(1).maybeSingle();
    const enrollment = Array.isArray(data?.enrollments) ? data.enrollments[0] : data?.enrollments;
    return NextResponse.json(data ? { reference: input.reference, status: enrollment?.enrollment_status ?? data.account_state, nextStep: data.profile_id ? "Sign in to your trainee account for full details." : "Check your email for the account activation link." } : { reference: input.reference, status: "Not found", nextStep: "Check the reference and registered email." }, { status: data ? 200 : 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "RATE_LIMITED" ? "Too many attempts." : "Invalid search details." }, { status: 400 }); }
}
