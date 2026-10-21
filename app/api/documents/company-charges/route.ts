import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PERIODS, type Period } from "@/lib/accounting-periods";
import { buildCompanyCharges } from "@/lib/company-charges";
import { createCompanyStatementPdf } from "@/lib/print/company-charges";

export const runtime = "nodejs";

/** Company Charge List PDF on New Wave letterhead: one company (?agency=) or all, one statement each. Audited. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const period = url.searchParams.get("period") as Period | null, end = url.searchParams.get("end") ?? "", agency = url.searchParams.get("agency");
  if (!period || !(PERIODS as readonly string[]).includes(period) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return NextResponse.json({ error: "Choose a period and date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const report = await buildCompanyCharges(db, period, end);
  const picked = agency ? report.statements.filter((s) => s.agencyId === agency) : report.statements;
  const statements = picked.length ? picked : [{ agencyId: agency ?? "", statementNo: "-", company: "No referred trainees", kind: "", rule: "", periodLabel: report.title, printedOn: "", rows: [] }];
  const logo = await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png")).then((b) => new Uint8Array(b)).catch(() => undefined);
  const bytes = await createCompanyStatementPdf(statements, logo);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "report.exported", record_type: "report", record_id: `company-charges:${report.from}:${report.to}`, new_values: { period, from: report.from, to: report.to, agency: agency ?? "all", companies: statements.length } });
  const name = `company-charge-list-${statements.length === 1 ? statements[0].company.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "all"}-${report.from}-to-${report.to}`;
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "no-store" } });
}
