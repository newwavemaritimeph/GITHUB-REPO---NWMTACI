import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bsNumber, buildBillingRows, coverageLabel, longDate, statementTotal, type BillingRow } from "@/lib/billing-statement";
import { createBillingStatementPdf } from "@/lib/print/billing-statement";

export const runtime = "nodejs";

/**
 * Billing Statement PDF (?agency=&from=&to=). The first print issues the next BS No. and keeps
 * the trainees and amounts as issued; printing the same partner and coverage again reprints it.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const agency = url.searchParams.get("agency") ?? "", from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(agency) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return NextResponse.json({ error: "Choose the partner and the billing coverage." }, { status: 400 });
  const db = createSupabaseAdminClient();
  type Saved = { bs_number: number; bill_to: string; rows: BillingRow[]; total_centavos: number; issued_at: string };
  const found = await db.from("billing_statements").select("bs_number,bill_to,rows,total_centavos,issued_at").eq("agency_id", agency).eq("coverage_from", from).eq("coverage_to", to).maybeSingle();
  if (found.error) return NextResponse.json({ error: /billing_statements/.test(found.error.message) ? "Apply database update 202610220058 first." : found.error.message }, { status: 400 });
  let saved = found.data as Saved | null;
  let reprint = true;
  if (!saved) {
    const partner = (await buildBillingRows(db, from, to)).find((p) => p.agencyId === agency);
    if (!partner) return NextResponse.json({ error: "No enrollments from this partner in that coverage." }, { status: 404 });
    const ins = await db.from("billing_statements").insert({ agency_id: agency, coverage_from: from, coverage_to: to, bill_to: partner.billTo, rows: partner.rows, total_centavos: statementTotal(partner.rows), issued_by: staff.user.id }).select("bs_number,bill_to,rows,total_centavos,issued_at").single();
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 400 });
    saved = ins.data as Saved;
    reprint = false;
  }
  const s = saved as Saved;
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((b) => new Uint8Array(b)).catch(() => undefined);
  const issuedDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(s.issued_at));
  const bytes = await createBillingStatementPdf({ bsNumber: bsNumber(s.bs_number), date: longDate(issuedDay), billTo: s.bill_to, kind: "", coverage: coverageLabel(from, to), rows: s.rows, total: Number(s.total_centavos) }, logo);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: reprint ? "billing_statement.reprinted" : "billing_statement.issued", record_type: "billing_statement", record_id: bsNumber(s.bs_number), new_values: { agency, from, to, total: s.total_centavos } });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="billing-statement-${bsNumber(s.bs_number)}.pdf"`, "cache-control": "no-store" } });
}
