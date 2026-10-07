import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/security";
import { isSrn, normalizeSrn } from "@/lib/validation";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Status search will open after production setup." }, { status: 503 });
  try {
    await enforceRateLimit(request, "registration-search", 10, 15);
    const form = Object.fromEntries(await request.formData());
    const db = createSupabaseAdminClient();
    // awaiting_course / application_number come from migration 202610070003.
    const select = "registration_reference,profile_id,account_state,awaiting_course,application_number,enrollments(enrollment_status)";
    let data;
    // SRN-only lookup, or the classic reference + email lookup.
    if (typeof form.srn === "string" && isSrn(form.srn)) {
      ({ data } = await db.from("trainees").select(select).eq("srn", normalizeSrn(form.srn)).limit(1).maybeSingle());
    } else {
      const input = z.object({ reference: z.string().regex(/^REG-\d{4}-\d{6}$/), email: z.string().email() }).parse(form);
      ({ data } = await db.from("trainees").select(select).eq("email", input.email.toLowerCase()).eq("registration_reference", input.reference).limit(1).maybeSingle());
    }
    const enrollment = Array.isArray(data?.enrollments) ? data.enrollments[0] : data?.enrollments;
    const reference = data?.registration_reference ?? (typeof form.reference === "string" ? form.reference : "—");
    // A website application still being screened: either no course assigned yet,
    // or a Pending enrollment. Show the NWMTACI number the applicant quotes.
    const row = data as { awaiting_course?: boolean; application_number?: string | null } | null;
    const screening = !!row?.awaiting_course || enrollment?.enrollment_status === "Pending";
    return NextResponse.json(data ? { reference: row?.application_number ?? reference, status: screening ? "Application under screening" : enrollment?.enrollment_status ?? data.account_state, nextStep: screening ? "Send your enrollment number with a photo of your valid ID to facebook.com/newwavemtc. Our Registration team will confirm your course, schedule and fee." : data.profile_id ? "Sign in to your trainee account for full details." : "Check your email for the account activation link." } : { reference, status: "Not found", nextStep: "Check the details you entered." }, { status: data ? 200 : 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "RATE_LIMITED" ? "Too many attempts." : "Invalid search details." }, { status: 400 }); }
}
