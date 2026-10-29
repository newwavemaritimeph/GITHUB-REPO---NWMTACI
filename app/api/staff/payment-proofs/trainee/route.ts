import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleConfigured } from "@/lib/google-classroom";
import { uploadProofToDrive } from "@/lib/google-drive";

export const runtime = "nodejs";

/**
 * Proof of payment uploaded by Registration for a trainee (owner, 29 Oct 2026; moved
 * from the public website). Filed in Google Drive only (Mode › Month, "LASTNAME - date")
 * and listed on the Cashier Dashboard until a receipt uses it or it is marked Not Valid.
 */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const meta = z.object({
  traineeId: z.string().uuid(), mode: z.string().trim().min(1).max(80),
  amount: z.coerce.number().positive().max(10_000_000), reference: z.string().trim().min(3).max(80),
});

export async function POST(request: Request) {
  const staff = await requireStaff(["admin", "registration"]);
  if (!staff) return NextResponse.json({ error: "Only Registration uploads a trainee's proof of payment." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("proof");
    const parsed = meta.safeParse({ traineeId: form.get("traineeId"), mode: form.get("mode"), amount: form.get("amount"), reference: form.get("reference") });
    if (!parsed.success) return NextResponse.json({ error: "Enter the mode of payment, the amount and the reference number." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the photo or PDF of the proof of payment." }, { status: 400 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "Use a PNG, JPEG, WebP or PDF file." }, { status: 400 });
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "The file must be smaller than 4 MB." }, { status: 400 });
    if (!googleConfigured()) return NextResponse.json({ error: "Google is not set up yet. Add the Google keys in Vercel, then connect Google." }, { status: 400 });

    const db = createSupabaseAdminClient();
    const { data: mode } = await db.from("payment_methods").select("name,active,requires_reference").eq("name", parsed.data.mode).maybeSingle();
    if (!mode?.active || !mode.requires_reference) return NextResponse.json({ error: "A proof of payment is filed only for GCash, PSBank and UnionBank." }, { status: 400 });
    const { data: trainee } = await db.from("trainees").select("id,legal_last_name").eq("id", parsed.data.traineeId).maybeSingle();
    if (!trainee) return NextResponse.json({ error: "Trainee not found." }, { status: 404 });

    const submittedAt = new Date().toISOString(), amount = Math.round(parsed.data.amount * 100);
    const drive = await uploadProofToDrive(db, { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, mode: mode.name, receivedAt: submittedAt, lastName: trainee.legal_last_name });
    const { data: proof, error } = await db.from("payment_proofs").insert({
      storage_path: null, original_filename: file.name.slice(0, 255), content_type: file.type, extracted_reference: parsed.data.reference.toUpperCase(),
      drive_file_id: drive.fileId, drive_link: drive.link, drive_path: drive.path,
      trainee_id: trainee.id, source: "Trainee", claimed_method: mode.name, claimed_amount_centavos: amount, submitted_at: submittedAt,
    }).select("id").single();
    if (error) return NextResponse.json({ error: /trainee_id|source|claimed_|submitted_at/i.test(error.message) ? "Apply database update 202610290060 first. The file was saved to Google Drive." : error.message }, { status: 400 });
    await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "payment_proof.submitted", record_type: "payment_proof", record_id: proof.id, new_values: { trainee_id: trainee.id, method: mode.name, amount_centavos: amount, drive_path: drive.path } });
    return NextResponse.json({ ok: true, driveLink: drive.link, drivePath: drive.path });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the proof to Google Drive.";
    return NextResponse.json({ error: /not connected|revoked|expired/i.test(message) ? "Google is not connected yet. Open Instructions › Templates and click Connect Google, then tick every permission." : message }, { status: 400 });
  }
}
