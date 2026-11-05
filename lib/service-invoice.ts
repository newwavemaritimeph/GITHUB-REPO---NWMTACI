import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pesosInWords } from "@/lib/amount-words";
import { bsNumber, coverageLabel, longDate, type BillingRow } from "@/lib/billing-statement";

/**
 * Service Invoice for a company's payment (owner, 5 Nov 2026): one invoice per payment, numbered by the system from the
 * format Accounting sets once. The snapshot is what prints, so an issued invoice never changes.
 */
export type InvoiceSetup = { controlNo: string; formNo: string; revisionNo: string; revisionDate: string; issuedDate: string; tin: string; format: string; lastNumber: number };
export type InvoiceLine = { name: string; training: string; amount: number };
export type InvoiceSnapshot = { billTo: string; bsNumber: string; coverage: string; paidOn: string; method: string; reference: string | null; rows: InvoiceLine[]; total: number; words: string; tin?: string; control?: { controlNo: string; formNo: string; revisionNo: string; revisionDate: string; issuedDate: string } };

export const BLANK_SETUP: InvoiceSetup = { controlNo: "", formNo: "", revisionNo: "", revisionDate: "", issuedDate: "", tin: "", format: "SI-{YYYY}-{N:6}", lastNumber: 0 };
/** The format needs the running number, or every invoice would print the same SI No. */
export const siFormatProblem = (format: string) => (/\{N(:\d{1,2})?\}/.test(format) ? (format.length <= 40 ? null : "Keep the format to 40 characters.") : "The format needs the running number, for example {N:6}.");
/** The statement's trainees this payment settled, with what it applied to each. */
export const invoiceLines = (rows: BillingRow[], applied: Map<string, number>): InvoiceLine[] => rows.filter((r) => r.enrollmentId && applied.has(r.enrollmentId)).map((r) => ({ name: r.name, training: r.training, amount: applied.get(r.enrollmentId!)! }));

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const manilaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));

/** The setup, or null before migration 202610290083 is run. */
export async function loadInvoiceSetup(db: Admin): Promise<InvoiceSetup | null> {
  const { data, error } = await db.from("service_invoice_settings").select("control_no,form_no,revision_no,revision_date,issued_date,tin,format,last_number").maybeSingle();
  if (error) return null;
  if (!data) return BLANK_SETUP;
  return { controlNo: data.control_no as string, formNo: data.form_no as string, revisionNo: data.revision_no as string, revisionDate: data.revision_date as string, issuedDate: data.issued_date as string, tin: data.tin as string, format: data.format as string, lastNumber: Number(data.last_number) };
}

/** Issues the invoice of a company payment, or returns the one it already has. */
export async function issueServiceInvoice(db: Admin, companyPaymentId: string, actorId: string) {
  const { data: cp, error: cpError } = await db.from("company_payments").select("id,billing_statement_id,amount_centavos,method,reference_number,received_at,payment_ids").eq("id", companyPaymentId).maybeSingle();
  if (cpError || !cp) throw new Error("Company payment not found.");
  const { data: bs } = await db.from("billing_statements").select("bs_number,bill_to,coverage_from,coverage_to,rows").eq("id", cp.billing_statement_id).maybeSingle();
  if (!bs) throw new Error("Billing Statement not found.");
  const payIds = (cp.payment_ids ?? []) as string[];
  const { data: allocs, error: allocError } = payIds.length ? await db.from("payment_allocations").select("enrollment_id,amount_centavos").in("payment_id", payIds) : { data: [], error: null };
  if (allocError) throw new Error(allocError.message);
  const applied = new Map<string, number>();
  for (const a of allocs ?? []) applied.set(a.enrollment_id as string, (applied.get(a.enrollment_id as string) ?? 0) + Number(a.amount_centavos));
  const total = Number(cp.amount_centavos);
  const snapshot: InvoiceSnapshot = { billTo: bs.bill_to as string, bsNumber: bsNumber(Number(bs.bs_number)), coverage: coverageLabel(bs.coverage_from as string, bs.coverage_to as string), paidOn: longDate(manilaDay(cp.received_at as string)), method: cp.method as string, reference: (cp.reference_number as string | null) ?? null, rows: invoiceLines((bs.rows ?? []) as BillingRow[], applied), total, words: pesosInWords(total) };
  const { data, error } = await db.rpc("issue_service_invoice", { target_payment: companyPaymentId, target_statement: cp.billing_statement_id, target_amount: total, target_snapshot: snapshot, actor: actorId }).single();
  if (error) throw new Error(/issue_service_invoice|service_invoice/.test(error.message) ? "Apply database update 202610290083 first." : error.message);
  const issued = data as { invoice_id: string; invoice_number: string };
  await db.from("audit_logs").insert({ actor_id: actorId, action: "service_invoice.issued", record_type: "service_invoice", record_id: issued.invoice_id, new_values: { si_number: issued.invoice_number, company_payment: companyPaymentId, amount_centavos: total } });
  return { id: issued.invoice_id, number: issued.invoice_number };
}
