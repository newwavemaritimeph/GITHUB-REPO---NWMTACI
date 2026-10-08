import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/google-classroom";
import { uploadProofToDrive } from "@/lib/google-drive";

export const runtime = "nodejs";

/**
 * Proof of payment straight to Google Drive (owner, 7 Oct 2026). The Cashier's
 * GCash, PSBank or UnionBank screenshot is filed in Drive under Mode › Month as
 * "LASTNAME - YYYY-MM-DD"; the portal keeps only the Drive reference. The
 * returned proofId is then sent with the payment.
 */
const metadataSchema = z.object({
  traineeId: z.string().uuid(),
  mode: z.string().trim().min(1).max(80),
  receivedAt: z.string().datetime({ offset: true }),
  reference: z.string().trim().min(1).max(80),
});
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("proof");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the proof of payment." }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Use a PNG, JPEG, WebP or PDF file." }, { status: 400 });
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "The proof file must be smaller than 4 MB." }, { status: 400 });
    const meta = metadataSchema.parse({ traineeId: form.get("traineeId"), mode: form.get("mode"), receivedAt: form.get("receivedAt"), reference: form.get("reference") });
    if (!googleConfigured()) return NextResponse.json({ error: "Google is not set up yet. Add the Google keys in Vercel, then connect Google." }, { status: 400 });

    const db = createSupabaseAdminClient();
    const { data: method } = await db.from("payment_methods").select("name,active,requires_reference").eq("name", meta.mode).maybeSingle();
    if (!method?.active || !method.requires_reference) return NextResponse.json({ error: "A proof of payment is filed only for GCash, PSBank and UnionBank." }, { status: 400 });
    const { data: trainee } = await db.from("trainees").select("legal_last_name").eq("id", meta.traineeId).maybeSingle();
    if (!trainee) return NextResponse.json({ error: "Trainee not found." }, { status: 404 });

    const drive = await uploadProofToDrive(db, { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, mode: method.name, receivedAt: meta.receivedAt, lastName: trainee.legal_last_name });
    const { data: proof, error } = await db.from("payment_proofs").insert({
      storage_path: null, original_filename: file.name.slice(0, 255), content_type: file.type,
      extracted_reference: null, verified_reference: meta.reference, verified_by: staff.user.id, verified_at: new Date().toISOString(),
      drive_file_id: drive.fileId, drive_link: drive.link, drive_path: drive.path,
    }).select("id").single();
    if (error) {
      if (/drive_|storage_path/i.test(error.message)) return NextResponse.json({ error: "Apply database update 202610070017 first. The file was saved to Google Drive." }, { status: 400 });
      throw error;
    }
    const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("valid", true).ilike("reference_number", meta.reference);
    return NextResponse.json({ proofId: proof.id, driveLink: drive.link, drivePath: drive.path, duplicateReference: (count ?? 0) > 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the proof to Google Drive.";
    return NextResponse.json({ error: /not connected|revoked|expired/i.test(message) ? "Google is not connected. Ask Registration or Admin to connect Google (Instructions › Google Classroom)." : message }, { status: 400 });
  }
}
