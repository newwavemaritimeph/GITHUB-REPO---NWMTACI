import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadDocumentControl } from "@/lib/document-controls";
import { createReferralVoucherPdf } from "@/lib/print/referral-voucher";
import { voucherStatus, type ReferralVoucherSnapshot } from "@/lib/referral-voucher";

export const runtime = "nodejs";

/** Referral Voucher PDF (owner, 10 Nov 2026): the voucher exactly as kept, with its status. The Cashier, Accounting or the Admin. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting", "cashier"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Choose a voucher." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("referral_vouchers").select("id,voucher_number,snapshot").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: /referral_vouchers/.test(error.message) ? "Apply database update 202610290088 first." : error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Voucher not found." }, { status: 404 });
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((b) => new Uint8Array(b)).catch(() => undefined);
  const { data: events } = await db.from("referral_voucher_events").select("status,created_at").eq("voucher_id", id);
  const bytes = await createReferralVoucherPdf(data.snapshot as ReferralVoucherSnapshot, logo, await loadDocumentControl(db, "referral_voucher"), voucherStatus((events ?? []) as { status: string; created_at: string }[]));
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "referral_voucher.printed", record_type: "referral_voucher", record_id: id, new_values: { number: data.voucher_number } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="referral-voucher-${data.voucher_number}.pdf"`, "cache-control": "no-store" } });
}
