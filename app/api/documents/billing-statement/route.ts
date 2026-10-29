import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bsNumber, coverageLabel, longDate, type BillingRow } from "@/lib/billing-statement";
import { createBillingStatementPdf } from "@/lib/print/billing-statement";

export const runtime = "nodejs";

/**
 * Billing Statement PDF (?agency=&from=&to=): prints the issued statement that is not voided, with the
 * trainees and amounts as issued. Issuing it (typed amounts, BS No.) is the billing-statement-issue action.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const agency = url.searchParams.get("agency") ?? "", from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(agency) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return NextResponse.json({ error: "Choose the partner and the billing coverage." }, { status: 400 });
  const db = createSupabaseAdminClient();
  type Saved = { id: string; bs_number: number; bill_to: string; rows: BillingRow[]; total_centavos: number; issued_at: string };
  const found = await db.from("billing_statements").select("id,bs_number,bill_to,rows,total_centavos,issued_at").eq("agency_id", agency).eq("coverage_from", from).eq("coverage_to", to).order("issued_at", { ascending: false });
  if (found.error) return NextResponse.json({ error: /billing_statements/.test(found.error.message) ? "Apply database update 202610220058 first." : found.error.message }, { status: 400 });
  const ids = (found.data ?? []).map((x) => x.id as string);
  const { data: voids } = ids.length ? await db.from("billing_statement_voids").select("billing_statement_id").in("billing_statement_id", ids) : { data: [] };
  const voided = new Set((voids ?? []).map((v) => v.billing_statement_id as string));
  const saved = ((found.data ?? []) as Saved[]).find((x) => !voided.has(x.id)) ?? null;

  // Issuing (with the amounts Accounting typed) is the billing-statement-issue action (29 Oct 2026).
  if (!saved) return NextResponse.json({ error: "Issue the statement first from Accounting › Reports › Billing Statement." }, { status: 404 });
  const s = saved as Saved;
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((b) => new Uint8Array(b)).catch(() => undefined);
  const issuedDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(s.issued_at));
  const bytes = await createBillingStatementPdf({ bsNumber: bsNumber(s.bs_number), date: longDate(issuedDay), billTo: s.bill_to, kind: "", coverage: coverageLabel(from, to), rows: s.rows, total: Number(s.total_centavos) }, logo);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "billing_statement.printed", record_type: "billing_statement", record_id: bsNumber(s.bs_number), new_values: { agency, from, to, total: s.total_centavos } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="billing-statement-${bsNumber(s.bs_number)}.pdf"`, "cache-control": "no-store" } });
}
