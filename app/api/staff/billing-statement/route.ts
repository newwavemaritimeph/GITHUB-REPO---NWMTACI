import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bsNumber, buildBillingRows, statementTotal, type BillingRow } from "@/lib/billing-statement";

export const runtime = "nodejs";

/**
 * Billing Statement preview: ?from=&to= (date enrolled). One entry per referring partner, with the
 * issued statement (BS No. and the amounts as issued) when there is one that is not voided. Accounting / Admin.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return NextResponse.json({ error: "Choose the billing coverage." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const partners = await buildBillingRows(db, from, to);
  const { data: issued } = await db.from("billing_statements").select("id,agency_id,bs_number,rows,total_centavos,issued_at").eq("coverage_from", from).eq("coverage_to", to).order("issued_at", { ascending: false });
  const ids = (issued ?? []).map((s) => s.id as string);
  const { data: voids } = ids.length ? await db.from("billing_statement_voids").select("billing_statement_id").in("billing_statement_id", ids) : { data: [] };
  const voided = new Set((voids ?? []).map((v) => v.billing_statement_id as string));
  const live = new Map<string, { id: string; bs_number: number; rows: BillingRow[]; total_centavos: number }>();
  for (const s of (issued ?? []) as { id: string; agency_id: string; bs_number: number; rows: BillingRow[]; total_centavos: number }[]) if (!voided.has(s.id) && !live.has(s.agency_id)) live.set(s.agency_id, s);
  return NextResponse.json({ from, to, statements: partners.map((p) => { const s = live.get(p.agencyId); return s ? { ...p, rows: s.rows, total: Number(s.total_centavos), bsNumber: bsNumber(s.bs_number), statementId: s.id } : { ...p, total: statementTotal(p.rows), bsNumber: null, statementId: null }; }) }, { headers: { "Cache-Control": "no-store" } });
}
