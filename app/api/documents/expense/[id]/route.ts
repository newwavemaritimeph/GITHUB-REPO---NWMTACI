import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildExpenseVoucher } from "@/lib/expense-voucher";

export const runtime = "nodejs";

// Opened in a new tab, so refusals are a short readable page rather than JSON.
const notice = (message: string, status: number) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Expense voucher</title><body style="font:16px/1.5 system-ui,sans-serif;color:#123F63;padding:32px;max-width:560px"><h1 style="font-size:22px">Expense voucher</h1><p>${message.replace(/</g, "&lt;")}</p><p style="color:#5f7180">Close this tab to go back to the portal.</p></body>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

/**
 * Expense voucher PDF. Cashier / Accounting / Admin, once Accounting has
 * approved it. It prints once; every further print needs a reprint request
 * approved by the Accounting Manager (202610080020).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: row } = await db.from("expenses").select("id,status").eq("id", id).maybeSingle();
  if (!row) return notice("Voucher not found.", 404);
  // A voided voucher (202610090038) opens as a VOID copy and is never counted as a print.
  if (row.status === "Void") {
    const voided = await buildExpenseVoucher(db, id);
    if (!voided) return notice("Voucher not found.", 404);
    return new Response(voided.bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${voided.voucherNumber}-void.pdf"`, "cache-control": "private, no-store" } });
  }
  if (row.status !== "Approved" && row.status !== "Paid") return notice("The voucher is issued once the Accounting Manager approves the expense.", 409);

  // ?copy=1: a file copy for viewing (Vouchers tab). Marked, and never counted as a print.
  if (new URL(request.url).searchParams.get("copy") === "1") {
    const copy = await buildExpenseVoucher(db, id, { label: "File copy - not for release" });
    if (!copy) return notice("The voucher is issued once the Accounting Manager approves the expense.", 409);
    return new Response(copy.bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${copy.voucherNumber}-file-copy.pdf"`, "cache-control": "private, no-store" } });
  }
  const { data: printNumber, error } = await db.rpc("record_voucher_print", { target: id });
  // Before database update 202610080020 the limit is not enforced yet.
  const missing = !!error && /record_voucher_print|function .* does not exist/i.test(error.message);
  if (error && !missing) return notice(error.message, 409);
  const voucher = await buildExpenseVoucher(db, id, { printNumber: missing ? undefined : Number(printNumber) });
  if (!voucher) return notice("The voucher is issued once the Accounting Manager approves the expense.", 409);
  if (!missing) await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes.includes("cashier") ? "cashier" : staff.roleCodes[0] ?? null, action: "expense_voucher.printed", record_type: "expense", record_id: id, new_values: { print: Number(printNumber), voucher: voucher.voucherNumber } });
  return new Response(voucher.bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${voucher.voucherNumber}-expense-voucher.pdf"`, "cache-control": "private, no-store" } });
}
