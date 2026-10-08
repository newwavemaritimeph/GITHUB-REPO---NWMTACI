import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildExpenseVoucher } from "@/lib/expense-voucher";

export const runtime = "nodejs";

/** Expense voucher PDF. Cashier / Accounting / Admin, and only once Accounting has approved it (the voucher number exists). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: exists } = await db.from("expenses").select("id").eq("id", id).maybeSingle();
  if (!exists) return NextResponse.json({ error: "Voucher not found." }, { status: 404 });
  const voucher = await buildExpenseVoucher(db, id);
  if (!voucher) return NextResponse.json({ error: "The voucher is issued once the Accounting Manager approves the expense." }, { status: 409 });
  return new Response(voucher.bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${voucher.voucherNumber}-expense-voucher.pdf"`, "cache-control": "private, no-store" } });
}
