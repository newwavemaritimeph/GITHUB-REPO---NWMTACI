import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Returns a short-lived signed URL + metadata for a certificate template, so the
// browser can fetch the template file to render a certificate PDF client-side.
// Training Operations / Admin only.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "training_operations", "releasing_officer"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: template } = await db.from("certificate_templates").select("id,storage_path,fields").eq("id", id).maybeSingle();
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const { data, error } = await db.storage.from("certificate-templates").createSignedUrl(template.storage_path, 3600);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create a template link." }, { status: 400 });
  const isPdf = template.storage_path.toLowerCase().endsWith(".pdf");
  return NextResponse.json({ url: data.signedUrl, isPdf, fields: template.fields ?? [] }, { headers: { "cache-control": "no-store" } });
}
