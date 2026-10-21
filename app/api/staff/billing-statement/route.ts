import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bsNumber, buildBillingRows, statementTotal } from "@/lib/billing-statement";

export const runtime = "nodejs";

/** Billing Statement preview: ?from=&to= (date enrolled). One entry per referring partner. Accounting / Admin. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return NextResponse.json({ error: "Choose the billing coverage." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const partners = await buildBillingRows(db, from, to);
  // Statements already issued for this coverage keep their BS No. (empty before migration 202610220058).
  const { data: issued } = await db.from("billing_statements").select("agency_id,bs_number").eq("coverage_from", from).eq("coverage_to", to);
  const numberOf = new Map(((issued ?? []) as { agency_id: string; bs_number: number }[]).map((s) => [s.agency_id, bsNumber(s.bs_number)]));
  return NextResponse.json({ from, to, statements: partners.map((p) => ({ ...p, total: statementTotal(p.rows), bsNumber: numberOf.get(p.agencyId) ?? null })) }, { headers: { "Cache-Control": "no-store" } });
}
