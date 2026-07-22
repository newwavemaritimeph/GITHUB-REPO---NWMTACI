import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/security";

const registrationSchema = z.object({
  firstName: z.string().trim().min(2).max(80), middleName: z.string().trim().max(80).optional().default(""), lastName: z.string().trim().min(2).max(80), suffix: z.string().trim().max(20).optional().default(""),
  srn: z.string().trim().max(40).optional().default(""), email: z.string().email(), presentAddress: z.string().trim().min(8).max(500), mobile: z.string().trim().min(7).max(30),
  placeOfBirth: z.string().trim().min(2).max(160), birthDate: z.string().date(), rank: z.string().trim().min(2).max(100), company: z.string().trim().max(160).optional().default(""),
  emergencyContactName: z.string().trim().min(2).max(160), emergencyContactMobile: z.string().trim().min(7).max(30),
  courseCode: z.string().trim().min(2).max(40), courseName: z.string().trim().min(2).max(240), scheduleId: z.string().uuid(), termsAccepted: z.literal("on"),
});

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Registration will open after the secure production environment is connected." }, { status: 503 });
  try {
    const ipHash = await enforceRateLimit(request, "public-registration", 5, 30);
    const body = registrationSchema.parse(Object.fromEntries(await request.formData()));
    const db = createSupabaseAdminClient();
    const { data: terms } = await db.from("terms_documents").select("version").eq("active", true).lte("effective_from", new Date().toISOString().slice(0,10)).order("effective_from", { ascending: false }).limit(1).maybeSingle();
    if (!terms) throw new Error("No approved terms are active.");
    const { data, error } = await db.rpc("submit_public_registration", {
      target_first_name: body.firstName,target_middle_name: body.middleName,target_last_name: body.lastName,target_suffix: body.suffix,target_srn: body.srn,
      target_email: body.email.toLowerCase(),target_address: body.presentAddress,target_mobile: body.mobile,target_place_of_birth: body.placeOfBirth,target_birthdate: body.birthDate,
      target_rank: body.rank,target_company: body.company,target_emergency_name: body.emergencyContactName,target_emergency_mobile: body.emergencyContactMobile,
      target_batch: body.scheduleId,target_terms_version: terms.version,target_ip_hash: ipHash,target_marketing_agency: null,
    });
    if (error) throw error;
    const result = data as { registration_reference:string;trainee_id:string;email:string;complete_name:string };
    try {
      const invitation = await db.auth.admin.inviteUserByEmail(result.email, { data: { complete_name: result.complete_name, trainee_id: result.trainee_id }, redirectTo: `${process.env.APP_BASE_URL ?? new URL(request.url).origin}/auth/callback?next=/trainee` });
      if (invitation.data.user) await db.from("trainees").update({ profile_id: invitation.data.user.id }).eq("id", result.trainee_id);
    } catch { /* Registration remains valid; Admin can resend account activation. */ }
    return NextResponse.json({ reference: result.registration_reference, accountInvitationQueued: true });
  } catch (error) {
    const status = error instanceof Error && error.message === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: status === 429 ? "Too many registration attempts. Please try again later." : error instanceof Error ? error.message : "Please review your registration details." }, { status });
  }
}
