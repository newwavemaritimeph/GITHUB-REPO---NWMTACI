import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/security";
import {
  VALIDATION_MESSAGES,
  isEmail,
  isPhContactNumber,
  isSrn,
  normalizeEmail,
  normalizePhContactNumber,
  normalizeSrn,
} from "@/lib/validation";

const registrationSchema = z.object({
  firstName: z.string().trim().min(2).max(80), middleName: z.string().trim().max(80).optional().default(""), lastName: z.string().trim().min(2).max(80), suffix: z.string().trim().max(20).optional().default(""),
  // An SRN is optional, but when supplied it must be exactly 10 digits.
  srn: z.string().trim().optional().default("").refine((value) => value === "" || isSrn(value), VALIDATION_MESSAGES.srn),
  email: z.string().trim().refine(isEmail, VALIDATION_MESSAGES.email),
  presentAddress: z.string().trim().min(8).max(500),
  mobile: z.string().trim().refine(isPhContactNumber, VALIDATION_MESSAGES.contact),
  placeOfBirth: z.string().trim().min(2).max(160), birthDate: z.string().date(), rank: z.string().trim().min(2).max(100), company: z.string().trim().max(160).optional().default(""),
  emergencyContactName: z.string().trim().min(2).max(160),
  emergencyContactMobile: z.string().trim().refine(isPhContactNumber, VALIDATION_MESSAGES.contact),
  termsAccepted: z.literal("on"),
});
// 1–5 chosen schedules (batch ids) per submission.
const batchesSchema = z.array(z.string().uuid()).min(1, "Select at least one schedule.").max(5, "You can select up to 5 courses per submission.");

export const runtime = "nodejs";
export const maxDuration = 25;

// Fail loudly instead of hanging: if a DB call blocks (e.g. a locked id_sequences
// row from a stuck transaction), return a clear message rather than an endless spinner.
function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Registration will open after the secure production environment is connected." }, { status: 503 });
  try {
    const ipHash = await enforceRateLimit(request, "public-registration", 5, 30);
    const form = await request.formData();
    const body = registrationSchema.parse(Object.fromEntries(form));
    const batches = batchesSchema.parse(form.getAll("scheduleIds").map((v) => String(v)).filter(Boolean));
    const db = createSupabaseAdminClient();
    const { data: terms } = await db.from("terms_documents").select("version").eq("active", true).lte("effective_from", new Date().toISOString().slice(0,10)).order("effective_from", { ascending: false }).limit(1).maybeSingle();
    if (!terms) throw new Error("No approved terms are active.");
    const { data, error } = await withTimeout(db.rpc("submit_public_registration", {
      target_first_name: body.firstName,target_middle_name: body.middleName,target_last_name: body.lastName,target_suffix: body.suffix,target_srn: normalizeSrn(body.srn) ?? "",
      target_email: normalizeEmail(body.email),target_address: body.presentAddress,target_mobile: normalizePhContactNumber(body.mobile)!,target_place_of_birth: body.placeOfBirth,target_birthdate: body.birthDate,
      target_rank: body.rank,target_company: body.company,target_emergency_name: body.emergencyContactName,target_emergency_mobile: normalizePhContactNumber(body.emergencyContactMobile)!,
      target_batches: batches,target_terms_version: terms.version,target_ip_hash: ipHash,target_marketing_agency: null,
    }), 15000, "The registration service is busy (a previous submission may still be finalizing). Please try again in a minute.");
    if (error) throw error;
    const result = data as { registration_reference:string;trainee_id:string;email:string;complete_name:string };
    // Trainees have no portal account. They follow their enrollment through the
    // public status lookup using this reference plus their registered email.
    return NextResponse.json({ reference: result.registration_reference });
  } catch (error) {
    const status = error instanceof Error && error.message === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: status === 429 ? "Too many registration attempts. Please try again later." : error instanceof Error ? error.message : "Please review your registration details." }, { status });
  }
}
