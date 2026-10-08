import { readFile } from "node:fs/promises";
import path from "node:path";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createExpenseVoucherPdf, type ExpenseVoucherLine } from "@/lib/documents";
import { googleConfigured } from "@/lib/google-classroom";
import { fileInDrive, replaceDriveFile, voucherNaming, VOUCHER_ROOT } from "@/lib/google-drive";

/**
 * Expense vouchers (owner, 7 Oct 2026): one builder for the voucher PDF, used
 * by the portal's voucher link and by the automatic Google Drive filing
 * (NWMTACI Expense Vouchers / Category / YYYY-MM Month / date CV-no - PAYEE.pdf).
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const fmt = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(value)) : "");

const fmtTime = (value: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(value));

async function logo() { try { return new Uint8Array(await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png"))); } catch { return undefined; } }

/** The voucher PDF bytes, or null when the expense has no voucher yet (not approved). */
export async function buildExpenseVoucher(db: Admin, id: string, options: { printNumber?: number; label?: string } = {}) {
  const { data } = await db.from("expenses")
    .select("id,expense_number,payee,category,amount_centavos,purpose,status,created_at,requester:profiles!expenses_requested_by_fkey(complete_name),approver:profiles!expenses_approved_by_fkey(complete_name)")
    .eq("id", id).maybeSingle();
  if (!data) return null;
  // Flow fields (202610070018), channel (202608100001) and lines (202610080019); tolerate their absence.
  const { data: extra } = await db.from("expenses").select("voucher_number,request_number,approved_at,released_at,released_by,payment_channel,reference_number,drive_file_id").eq("id", id).maybeSingle();
  const x = (extra ?? {}) as { voucher_number?: string | null; request_number?: string | null; approved_at?: string | null; released_at?: string | null; released_by?: string | null; payment_channel?: string | null; reference_number?: string | null; drive_file_id?: string | null };
  const { data: lineData } = await db.from("expenses").select("line_items,supporting_document").eq("id", id).maybeSingle();
  const l = (lineData ?? {}) as { line_items?: ExpenseVoucherLine[] | null; supporting_document?: string | null };
  if (data.status !== "Approved" && data.status !== "Paid") return null;
  const requester = one(data.requester as { complete_name: string } | { complete_name: string }[] | null)?.complete_name ?? "";
  const approver = one(data.approver as { complete_name: string } | { complete_name: string }[] | null)?.complete_name ?? "";
  const released = data.status === "Paid";
  const { data: releaser } = released && x.released_by ? await db.from("profiles").select("complete_name").eq("id", x.released_by).maybeSingle() : { data: null };
  const voucherNumber = x.voucher_number ?? data.expense_number;
  const bytes = await createExpenseVoucherPdf({
    number: voucherNumber,
    requestNumber: x.request_number && x.request_number !== voucherNumber ? x.request_number : "",
    issuedAt: fmt(x.approved_at ?? data.created_at),
    payee: data.payee, category: data.category, purpose: data.purpose,
    amountCentavos: Number(data.amount_centavos),
    lines: Array.isArray(l.line_items) ? l.line_items : [],
    paymentChannel: x.payment_channel ?? "", referenceNumber: x.reference_number ?? "",
    supportingDocument: l.supporting_document ?? "",
    requestedBy: requester, modeOfPayment: x.payment_channel ?? "", status: released ? "Released" : "Approved",
    preparedBy: requester, preparedAt: `Cashier · ${fmt(data.created_at)}`,
    approvedBy: approver, approvedAt: `Accounting Manager · ${fmt(x.approved_at)}`,
    releasedBy: released ? (releaser as { complete_name?: string } | null)?.complete_name ?? "" : "",
    releasedAt: released && x.released_at ? `Cashier · ${fmtTime(x.released_at)}` : "Cashier",
    printLabel: options.label ?? (options.printNumber && options.printNumber > 1 ? `Reprint ${options.printNumber - 1}` : undefined),
    logoBytes: await logo(),
  });
  return { bytes, voucherNumber, category: data.category, payee: data.payee, approvedAt: x.approved_at ?? data.created_at, driveFileId: x.drive_file_id ?? null };
}

/**
 * File (or refresh) the voucher in Google Drive. Best-effort: a Drive problem
 * never blocks the approval or release; the result is returned for display.
 */
export async function fileVoucherInDrive(db: Admin, id: string) {
  if (!googleConfigured()) return { state: "Not configured" as const };
  try {
    const voucher = await buildExpenseVoucher(db, id);
    if (!voucher) return { state: "No voucher" as const };
    if (voucher.driveFileId) {
      await replaceDriveFile(db, voucher.driveFileId, voucher.bytes, "application/pdf");
      return { state: "Updated" as const };
    }
    const naming = voucherNaming({ category: voucher.category, approvedAt: voucher.approvedAt, voucherNumber: voucher.voucherNumber, payee: voucher.payee });
    const filed = await fileInDrive(db, { rootKey: VOUCHER_ROOT.key, rootName: VOUCHER_ROOT.name, folders: naming.folders, base: naming.base, ext: "pdf", mime: "application/pdf", bytes: voucher.bytes });
    await db.from("expenses").update({ drive_file_id: filed.fileId, drive_link: filed.link }).eq("id", id);
    return { state: "Filed" as const, link: filed.link, path: filed.path };
  } catch (e) {
    console.error("Voucher Drive filing failed:", id, e instanceof Error ? e.message : e);
    return { state: "Failed" as const, error: e instanceof Error ? e.message : "Could not reach Google Drive." };
  }
}
