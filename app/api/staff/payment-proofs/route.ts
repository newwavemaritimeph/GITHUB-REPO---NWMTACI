import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const metadataSchema = z.object({
  extractedReference: z.string().trim().max(80).optional().default(""),
  verifiedReference: z.string().trim().min(1).max(80),
});
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("proof");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a payment screenshot." }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Use a PNG, JPEG, or WebP screenshot." }, { status: 400 });
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "The screenshot must be smaller than 10 MB." }, { status: 400 });
    const metadata = metadataSchema.parse({ extractedReference: form.get("extractedReference") ?? "", verifiedReference: form.get("verifiedReference") });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "payment-proof";
    const path = `${staff.user.id}/${crypto.randomUUID()}-${safeName}`;
    const db = createSupabaseAdminClient();
    const { error: uploadError } = await db.storage.from("payment-proofs").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data: proof, error: insertError } = await db.from("payment_proofs").insert({
      storage_path: path, original_filename: file.name.slice(0, 255), content_type: file.type,
      extracted_reference: metadata.extractedReference || null, verified_reference: metadata.verifiedReference,
      verified_by: staff.user.id, verified_at: new Date().toISOString(),
    }).select("id").single();
    if (insertError) {
      await db.storage.from("payment-proofs").remove([path]);
      throw insertError;
    }
    const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("valid", true).ilike("reference_number", metadata.verifiedReference);
    return NextResponse.json({ proofId: proof.id, duplicateReference: (count ?? 0) > 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to store the payment proof." }, { status: 400 });
  }
}
