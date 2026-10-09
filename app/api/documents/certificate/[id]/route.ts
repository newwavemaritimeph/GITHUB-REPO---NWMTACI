import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canPrint } from "@/lib/certificate-rules";
import { buildCertificatePdf, certificateContext, claimCertificateNumber, ensureCertificate } from "@/lib/certificates";

export const runtime = "nodejs";

// Opened in a new tab, so refusals are a short readable page rather than JSON.
const notice = (message: string, status: number) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificate</title><body style="font:16px/1.5 system-ui,sans-serif;color:#123F63;padding:32px;max-width:560px"><h1 style="font-size:22px">Certificate</h1><p>${message.replace(/</g, "&lt;")}</p><p style="color:#5f7180">Close this tab to go back to the portal.</p></body>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const WHY: Record<string, string> = {
  "Training not finished": "The training has not finished yet.",
  "Waiting for payment": "The training fee is not settled. The Cashier must record the balance first.",
  "Waiting for evaluation": "The trainee has not submitted the evaluation form yet.",
  "Waiting for photo": "Upload the trainee's 2x2 photo first.",
  "Void requested": "A void request is waiting for the Admin.",
  Cancelled: "This certificate is cancelled.",
};

/**
 * Certificate PDF for one enrollment (owner, 8 Oct 2026). Admin and the
 * Releasing Officer only. ?preview=1 is watermarked and never counted; the
 * Certificate No. is assigned at the first preview. Without it the PDF is the
 * real print: fee settled, training ended, evaluation in, and one print (plus
 * one per paid reprint request or Admin-approved void).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "releasing_officer"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const db = createSupabaseAdminClient();
  let ctx = await certificateContext(db, id);
  if (!ctx) return notice("Enrollment not found.", 404);
  if (WHY[ctx.view.state] && !(preview && ctx.view.state === "Waiting for photo")) return notice(WHY[ctx.view.state], 409);
  if (!preview && !canPrint(ctx.view)) return notice("This certificate was already printed. A reprint needs a paid Reprinting request or an Admin-approved void.", 409);
  if (!preview && !ctx.issuanceEnabled) return notice("Certificate printing is turned off. The Admin turns it on in Certificate numbering.", 409);
  try {
    const certId = await ensureCertificate(db, ctx);
    if (!ctx.cert?.certificate_number) {
      await claimCertificateNumber(db, certId, staff.user.id);
      ctx = (await certificateContext(db, id))!;
    }
    // Doc. No. and Registration No. are taken at the print itself (migration 202610090037; skipped before it).
    if (!preview && (!ctx.numbers.doc || !ctx.numbers.reg)) {
      const { error: numError } = await db.rpc("claim_certificate_doc_numbers", { target_certificate: certId, actor: staff.user.id });
      if (numError && !/claim_certificate_doc_numbers|does not exist|schema cache/i.test(numError.message)) return notice(numError.message, 409);
      if (!numError) ctx = (await certificateContext(db, id))!;
    }
    // Build first so a template problem never uses up the print.
    const bytes = await buildCertificatePdf(db, ctx, preview ? "preview" : "print");
    if (!preview) {
      const { error } = await db.rpc("record_certificate_print", { target_certificate: certId, actor: staff.user.id });
      if (error) return notice(error.message, 409);
    } else {
      await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "releasing_officer", action: "certificate.previewed", record_type: "certificate", record_id: certId, new_values: { certificate_number: ctx.cert?.certificate_number ?? null } });
    }
    const name = `certificate-${ctx.cert?.certificate_number ?? ctx.enrollment.enrollment_number}${preview ? "-preview" : ""}.pdf`;
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "no-store" } });
  } catch (error) {
    return notice(error instanceof Error ? error.message : "The certificate could not be prepared.", 409);
  }
}
