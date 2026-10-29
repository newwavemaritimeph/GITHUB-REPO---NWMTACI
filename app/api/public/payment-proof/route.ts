import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";
import { googleConfigured } from "@/lib/google-classroom";
import { uploadProofToDrive } from "@/lib/google-drive";
import { findTraineeBySrn } from "@/lib/trainee-proof";

export const runtime = "nodejs";

/**
 * Proof of payment from the trainee (owner, 29 Oct 2026): sent after registration or
 * from Trainee Status with the SRN and NWMTACI No. It is filed in Google Drive only
 * (Mode › Month, "LASTNAME - date") for the Cashier to view; the Cashier still records
 * the payment and issues the receipt.
 */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const meta = z.object({
  srn: z.string().trim().min(10).max(20), nwmtaciNo: z.string().trim().min(4).max(40),
  mode: z.string().trim().min(1).max(80), amount: z.coerce.number().positive().max(10_000_000), reference: z.string().trim().min(3).max(80),
});
type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Channels a trainee can pay through, with where to send it. Before migration 060 the details are blank. */
async function channels(db: Admin) {
  const full = await db.from("payment_methods").select("name,requires_reference,active,kind,sort_order,account_details").order("sort_order");
  const rows = (full.error ? (await db.from("payment_methods").select("name,requires_reference,active,sort_order").order("sort_order")).data : full.data) ?? [];
  return (rows as { name: string; requires_reference: boolean; active: boolean; kind?: string; account_details?: string | null }[])
    .filter((m) => m.active && m.requires_reference && (m.kind ?? "receivable") === "receivable")
    .map((m) => ({ name: m.name, accountDetails: m.account_details ?? "" }));
}

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ channels: [] });
  return NextResponse.json({ channels: await channels(createSupabaseAdminClient()), enabled: googleConfigured() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Upload opens after production setup." }, { status: 503 });
  try { await enforceRateLimit(request, "payment-proof", 10); } catch { return NextResponse.json({ error: "Too many uploads. Please wait a few minutes." }, { status: 429 }); }
  try {
    const form = await request.formData();
    const file = form.get("proof");
    const parsed = meta.safeParse({ srn: form.get("srn"), nwmtaciNo: form.get("nwmtaciNo"), mode: form.get("mode"), amount: form.get("amount"), reference: form.get("reference") });
    if (!parsed.success) return NextResponse.json({ error: "Enter the mode of payment, the amount and the reference number." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the photo or PDF of your proof of payment." }, { status: 400 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "Use a PNG, JPEG, WebP or PDF file." }, { status: 400 });
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "The file must be smaller than 4 MB." }, { status: 400 });
    const db = createSupabaseAdminClient();
    const trainee = await findTraineeBySrn(db, parsed.data.srn, parsed.data.nwmtaciNo);
    if (!trainee) return NextResponse.json({ error: "We could not match this SRN and NWMTACI number." }, { status: 404 });
    const mode = (await channels(db)).find((c) => c.name === parsed.data.mode);
    if (!mode) return NextResponse.json({ error: "Choose GCash, PSBank or UnionBank." }, { status: 400 });
    if (!googleConfigured()) return NextResponse.json({ error: "Upload is not available right now. Please send your proof to the Cashier." }, { status: 503 });

    const submittedAt = new Date().toISOString();
    const drive = await uploadProofToDrive(db, { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, mode: mode.name, receivedAt: submittedAt, lastName: trainee.legal_last_name });
    const { data: proof, error } = await db.from("payment_proofs").insert({
      storage_path: null, original_filename: file.name.slice(0, 255), content_type: file.type, extracted_reference: parsed.data.reference.toUpperCase(),
      drive_file_id: drive.fileId, drive_link: drive.link, drive_path: drive.path,
      trainee_id: trainee.id, source: "Trainee", claimed_method: mode.name, claimed_amount_centavos: Math.round(parsed.data.amount * 100), submitted_at: submittedAt,
    }).select("id").single();
    if (error) {
      console.error("[payment-proof] insert failed", error.message);
      return NextResponse.json({ error: "Upload is not available right now. Please send your proof to the Cashier." }, { status: 503 });
    }
    await db.from("audit_logs").insert({ actor_id: null, actor_role: "trainee", action: "payment_proof.submitted", record_type: "payment_proof", record_id: proof.id, new_values: { trainee_id: trainee.id, method: mode.name, amount_centavos: Math.round(parsed.data.amount * 100), drive_path: drive.path } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[payment-proof]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Upload is not available right now. Please send your proof to the Cashier." }, { status: 503 });
  }
}
