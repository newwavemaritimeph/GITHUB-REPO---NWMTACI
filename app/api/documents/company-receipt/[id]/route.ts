import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bsNumber, coverageLabel, longDate, type BillingRow } from "@/lib/billing-statement";
import { createBillingStatementPdf } from "@/lib/print/billing-statement";
import { inWords } from "@/app/portal/payment-receipt/[id]/receipt-sheets";

export const runtime = "nodejs";

/**
 * Acknowledgement Receipt for a company's Billing Statement payment (owner, 29 Oct 2026), on the
 * published Billing Statement template: the trainees this payment settled, marked PAID, with an
 * Original (company) and a Duplicate (office file).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: cp } = await db.from("company_payments").select("id,billing_statement_id,amount_centavos,method,reference_number,received_at,payment_ids,recorded_by").eq("id", id).maybeSingle();
  if (!cp) return NextResponse.json({ error: "Company payment not found." }, { status: 404 });
  const payIds = (cp.payment_ids as string[]).length ? (cp.payment_ids as string[]) : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: bs }, { data: allocs }, { data: cashier }] = await Promise.all([
    db.from("billing_statements").select("bs_number,bill_to,coverage_from,coverage_to,rows").eq("id", cp.billing_statement_id).maybeSingle(),
    db.from("payment_allocations").select("enrollment_id,amount_centavos").in("payment_id", payIds),
    cp.recorded_by ? db.from("profiles").select("complete_name").eq("id", cp.recorded_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!bs) return NextResponse.json({ error: "Billing Statement not found." }, { status: 404 });
  const applied = new Map<string, number>();
  for (const a of allocs ?? []) applied.set(a.enrollment_id as string, (applied.get(a.enrollment_id as string) ?? 0) + Number(a.amount_centavos));
  const rows: BillingRow[] = ((bs.rows ?? []) as BillingRow[]).filter((r) => r.enrollmentId && applied.has(r.enrollmentId)).map((r) => ({ ...r, status: "Paid", amount: applied.get(r.enrollmentId!)! }));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const receivedOn = longDate(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(cp.received_at as string)));
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((b) => new Uint8Array(b)).catch(() => undefined);
  const bsNo = bsNumber(Number(bs.bs_number));
  const bytes = await createBillingStatementPdf({ bsNumber: bsNo, date: receivedOn, billTo: bs.bill_to as string, kind: "", coverage: coverageLabel(bs.coverage_from as string, bs.coverage_to as string), rows, total },
    logo, { method: cp.method as string, reference: (cp.reference_number as string | null) ?? null, receivedOn, amount: Number(cp.amount_centavos), words: inWords(Number(cp.amount_centavos)), cashier: (cashier as { complete_name?: string } | null)?.complete_name ?? "" });
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "company_receipt.printed", record_type: "company_payment", record_id: id, new_values: { bs_number: bsNo } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="company-receipt-BS${bsNo}.pdf"`, "cache-control": "no-store" } });
}
