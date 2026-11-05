import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createServiceInvoicePdf } from "@/lib/print/service-invoice";
import type { InvoiceSnapshot } from "@/lib/service-invoice";

export const runtime = "nodejs";

/** A Service Invoice as issued, from its snapshot (owner, 5 Nov 2026). Cashier, Accounting, Admin; audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: invoice } = await db.from("service_invoices").select("id,si_number,snapshot").eq("id", id).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Service Invoice not found." }, { status: 404 });
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((b) => new Uint8Array(b)).catch(() => undefined);
  const bytes = await createServiceInvoicePdf(invoice.si_number as string, invoice.snapshot as InvoiceSnapshot, logo);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "service_invoice.printed", record_type: "service_invoice", record_id: id, new_values: { si_number: invoice.si_number } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${invoice.si_number}.pdf"`, "cache-control": "no-store" } });
}
