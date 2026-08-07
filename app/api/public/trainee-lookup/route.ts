import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/security";
import { isSrn, normalizeSrn } from "@/lib/validation";

export const runtime = "nodejs";

// Returning-applicant autofill: given a 10-digit SRN, return that trainee's saved
// enrollment-form fields so the public form can prefill them. Rate-limited to slow
// enumeration. Returns only form-relevant fields — no IDs, no enrollment history.
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ found: false });
  try {
    await enforceRateLimit(request, "trainee-lookup", 10, 60);
    const form = Object.fromEntries(await request.formData());
    const raw = typeof form.srn === "string" ? form.srn : "";
    if (!isSrn(raw)) return NextResponse.json({ found: false });
    const db = createSupabaseAdminClient();
    const { data } = await db.from("trainees")
      .select("legal_first_name,legal_middle_name,legal_last_name,suffix,birthdate,place_of_birth,address,mobile,email,rank,company")
      .eq("srn", normalizeSrn(raw))
      .limit(1).maybeSingle();
    if (!data) return NextResponse.json({ found: false });
    return NextResponse.json({
      found: true,
      applicant: {
        firstName: data.legal_first_name ?? "",
        middleName: data.legal_middle_name ?? "",
        lastName: data.legal_last_name ?? "",
        suffix: data.suffix ?? "",
        birthDate: data.birthdate ?? "",
        placeOfBirth: data.place_of_birth ?? "",
        address: data.address ?? "",
        mobile: data.mobile ?? "",
        email: data.email ?? "",
        rank: data.rank ?? "",
        company: data.company ?? "",
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const rateLimited = error instanceof Error && error.message === "RATE_LIMITED";
    return NextResponse.json({ found: false, error: rateLimited ? "Too many attempts." : undefined }, { status: rateLimited ? 429 : 200 });
  }
}
