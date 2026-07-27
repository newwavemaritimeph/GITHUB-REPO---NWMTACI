import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createExpenseVoucherPdf } from "@/lib/documents";

export const runtime = "nodejs";
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const fmt = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(value)) : "—");

/** Expense-voucher PDF. Cashier/Accounting/Admin — only after Accounting has
 * APPROVED (or paid) the voucher. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data } = await db.from("expenses")
    .select("id,expense_number,payee,category,amount_centavos,purpose,status,created_at,requested_by,approved_by,requester:profiles!expenses_requested_by_fkey(complete_name),approver:profiles!expenses_approved_by_fkey(complete_name)")
    .eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Voucher not found." }, { status: 404 });
  if (data.status !== "Approved" && data.status !== "Paid") return NextResponse.json({ error: "This voucher can be generated only after Accounting approves it." }, { status: 409 });

  const requester = one(data.requester as { complete_name: string } | { complete_name: string }[] | null)?.complete_name ?? "";
  const approver = one(data.approver as { complete_name: string } | { complete_name: string }[] | null)?.complete_name ?? "";

  let logoBytes: Uint8Array | undefined;
  try { logoBytes = new Uint8Array(await (await fetch(new URL("/new-wave-emblem.png", request.url))).arrayBuffer()); } catch { logoBytes = undefined; }

  const bytes = await createExpenseVoucherPdf({
    number: data.expense_number,
    issuedAt: fmt(data.created_at),
    payee: data.payee,
    category: data.category,
    purpose: data.purpose,
    amountCentavos: Number(data.amount_centavos),
    requestedBy: requester,
    modeOfPayment: "",
    status: data.status,
    preparedBy: requester,
    approvedBy: approver,
    logoBytes,
  });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${data.expense_number}-expense-voucher.pdf"`, "cache-control": "private, no-store" } });
}
