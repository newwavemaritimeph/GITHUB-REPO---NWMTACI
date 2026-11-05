import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildEndorsedSales, endorsedRange, type EndorsedTotals } from "@/lib/endorsed-sales";
import { createEndorsedSalesPdf } from "@/lib/print/endorsed-sales";

export const runtime = "nodejs";

/** Sales from Endorsed Courses as an A4 PDF, or Excel with ?format=xlsx. Accounting / Admin; audited. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const range = endorsedRange(url.searchParams);
  if (!range) return NextResponse.json({ error: "Choose a period and date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const s = await buildEndorsedSales(db, range);
  const xlsx = url.searchParams.get("format") === "xlsx";
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "report.exported", record_type: "report", record_id: `endorsed-sales:${s.from}:${s.to}`, new_values: { from: s.from, to: s.to, format: xlsx ? "xlsx" : "pdf" } });
  const name = `sales-from-endorsed-courses-${s.from}-to-${s.to}`;
  if (!xlsx) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    let logoBytes: Uint8Array | undefined;
    try { logoBytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "new-wave-emblem.png"))); } catch { logoBytes = undefined; }
    const bytes = await createEndorsedSalesPdf(s, today, logoBytes);
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "no-store" } });
  }
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sales from Endorsed Courses");
  const heads = ["Center", "Trainee", "NWMTACI No.", "Enrollment No.", "Status", "Course Code", "Course", "Training Date", "Fee", "Collected", "Balance", "Payable to Center", "Paid to Center", "Center Status", "Rebate", "Rebate Received", "Rebate Status", "Agency Share", "New Wave Keeps"];
  sheet.columns = heads.map((_, i) => ({ width: i === 1 || i === 6 ? 34 : 17 }));
  const peso = (c: number) => c / 100;
  const add = (cells: (string | number)[], bold = false) => { const r = sheet.addRow(cells); r.font = { bold }; r.eachCell((c) => { if (typeof c.value === "number") c.numFmt = "₱#,##0.00"; }); };
  const total = (label: string, t: EndorsedTotals) => add([label, `${t.trainees} Trainee${t.trainees === 1 ? "" : "s"}`, "", "", "", "", "", "", peso(t.fees), peso(t.collected), peso(t.balance), peso(t.payable), peso(t.centerPaid), "", peso(t.rebate), peso(t.rebateReceived), "", peso(t.share), peso(t.keeps)], true);
  add([`Sales from Endorsed Courses - ${s.title} (${s.from} to ${s.to}) - by training date`], true);
  sheet.addRow([]);
  const head = sheet.addRow(heads);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123F63" } };
  for (const c of s.centers) {
    for (const r of c.rows) add([r.center, r.trainee, r.traineeNo, r.enrollmentNo, r.status, r.code, r.course, r.trainingDate, peso(r.fee), peso(r.collected), peso(r.balance), peso(r.payable), peso(r.centerPaid), r.centerState, peso(r.rebate), peso(r.rebateReceived), r.rebateState, peso(r.share), peso(r.keeps)]);
    total(`Total - ${c.name}`, c.totals);
  }
  total("Grand Total", s.totals);
  const buffer = await book.xlsx.writeBuffer();
  return new Response(buffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "no-store" } });
}
