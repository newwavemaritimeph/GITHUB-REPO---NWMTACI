import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildCashierReport } from "@/lib/cashier-report";
import { createCashierReportPdf } from "@/lib/documents";

export const runtime = "nodejs";

/** Cashier summary report PDF for ?date=YYYY-MM-DD (Manila). Cashier / Accounting / Admin; every export is audited. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "cashier", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Choose a valid date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: profile } = await db.from("profiles").select("complete_name").eq("id", staff.user.id).maybeSingle();
  const report = await buildCashierReport(db, date, profile?.complete_name ?? staff.user.email ?? "");
  const bytes = await createCashierReportPdf(report);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: staff.roleCodes.includes("cashier") ? "cashier" : staff.roleCodes[0] ?? null, action: "report.exported", record_type: "report", record_id: `cashier-summary:${date}`, new_values: { report: "cashier-summary", date } });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="cashier-summary-${date}.pdf"`, "cache-control": "private, no-store" } });
}
