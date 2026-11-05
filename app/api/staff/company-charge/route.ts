import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadInvoiceSetup } from "@/lib/service-invoice";

export const runtime = "nodejs";

export type ChargeStatement = { id: string; agencyId: string; bsNumber: string; billTo: string; kind: string; from: string; to: string; issuedAt: string; trainees: number; total: number; paid: number };
export type ChargePayment = { id: string; statementId: string; bsNumber: string; billTo: string; statementBalance: number; amount: number; method: string; reference: string | null; receivedAt: string; proofLink: string | null; invoiceId: string | null; siNumber: string | null };

/** Company Charge (owner, 5 Nov 2026): issued statements that are not voided, their payments and invoices, and the SI setup. Accounting, Admin. */
export async function GET() {
  const staff = await requireStaff(["admin", "accounting"]);
  if (!staff) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const db = createSupabaseAdminClient();
  const [st, vds, ags] = await Promise.all([
    db.from("billing_statements").select("id,agency_id,bs_number,bill_to,coverage_from,coverage_to,rows,total_centavos,issued_at").order("issued_at", { ascending: false }).limit(1000),
    db.from("billing_statement_voids").select("billing_statement_id"),
    db.from("marketing_agencies").select("id,kind"),
  ]);
  if (st.error) return NextResponse.json({ error: st.error.message }, { status: 500 });
  const voided = new Set((vds.data ?? []).map((v) => v.billing_statement_id as string));
  const kinds = new Map((ags.data ?? []).map((a) => [a.id as string, (a.kind as string | null) ?? "Agency"]));
  const statements = (st.data ?? []).filter((s) => !voided.has(s.id as string));
  type Pay = { id: string; billing_statement_id: string; amount_centavos: number; method: string; reference_number: string | null; received_at: string; proof_id?: string | null };
  const readPays = (cols: string) => db.from("company_payments").select(cols).order("received_at", { ascending: false }).limit(2000);
  let payRes = await readPays("id,billing_statement_id,amount_centavos,method,reference_number,received_at,proof_id");
  if (payRes.error) payRes = await readPays("id,billing_statement_id,amount_centavos,method,reference_number,received_at");
  if (payRes.error) return NextResponse.json({ error: payRes.error.message }, { status: 500 });
  const pays = (payRes.data ?? []) as unknown as Pay[];
  const paidBy = new Map<string, number>();
  for (const p of pays) paidBy.set(p.billing_statement_id, (paidBy.get(p.billing_statement_id) ?? 0) + Number(p.amount_centavos));
  const invoices = await db.from("service_invoices").select("id,company_payment_id,si_number").limit(2000);
  const invoiceOf = new Map(((invoices.error ? [] : invoices.data ?? []) as { id: string; company_payment_id: string; si_number: string }[]).map((i) => [i.company_payment_id, i]));
  const proofIds = pays.map((p) => p.proof_id).filter((x): x is string => !!x);
  const proofs = proofIds.length ? await db.from("payment_proofs").select("id,drive_link").in("id", proofIds) : { data: [] };
  const linkOf = new Map((proofs.data ?? []).map((p) => [p.id as string, p.drive_link as string | null]));
  const byId = new Map(statements.map((s) => [s.id as string, s]));
  const number = (n: unknown) => String(n).padStart(6, "0");
  return NextResponse.json({
    statements: statements.map((s): ChargeStatement => ({ id: s.id as string, agencyId: s.agency_id as string, bsNumber: number(s.bs_number), billTo: s.bill_to as string, kind: kinds.get(s.agency_id as string) ?? "Agency", from: s.coverage_from as string, to: s.coverage_to as string, issuedAt: s.issued_at as string, trainees: ((s.rows ?? []) as unknown[]).length, total: Number(s.total_centavos), paid: paidBy.get(s.id as string) ?? 0 })),
    payments: pays.filter((p) => byId.has(p.billing_statement_id)).map((p): ChargePayment => { const s = byId.get(p.billing_statement_id)!, inv = invoiceOf.get(p.id); return { id: p.id, statementId: p.billing_statement_id, bsNumber: number(s.bs_number), billTo: s.bill_to as string, statementBalance: Number(s.total_centavos) - (paidBy.get(p.billing_statement_id) ?? 0), amount: Number(p.amount_centavos), method: p.method, reference: p.reference_number, receivedAt: p.received_at, proofLink: p.proof_id ? linkOf.get(p.proof_id) ?? null : null, invoiceId: inv?.id ?? null, siNumber: inv?.si_number ?? null }; }),
    setup: await loadInvoiceSetup(db),
  }, { headers: { "Cache-Control": "no-store" } });
}
