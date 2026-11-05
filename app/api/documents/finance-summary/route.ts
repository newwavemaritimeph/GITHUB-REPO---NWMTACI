import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PERIODS, type Period } from "@/lib/accounting-periods";
import { buildFinanceSummary, channelTotal, channelsUsed, sideTotal, type Line, type SalesLine } from "@/lib/finance-summary";
import { createFinanceSummaryPdf } from "@/lib/print/finance-summary";
import { loadDocumentControl } from "@/lib/document-controls";

export const runtime = "nodejs";

/** Cash and Sales Summary as A4 PDF, or Excel with ?format=xlsx. Accounting / Admin; audited. */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "accounting"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const period = url.searchParams.get("period") as Period | null;
  const end = url.searchParams.get("end") ?? "";
  if (!period || !(PERIODS as readonly string[]).includes(period) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return NextResponse.json({ error: "Choose a period and date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const s = await buildFinanceSummary(db, period, end);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const xlsx = url.searchParams.get("format") === "xlsx";
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "report.exported", record_type: "report", record_id: `finance-summary:${period}:${s.from}:${s.to}`, new_values: { period, from: s.from, to: s.to, format: xlsx ? "xlsx" : "pdf" } });
  const name = `cash-and-sales-summary-${s.from}-to-${s.to}`;
  if (!xlsx) {
    const bytes = await createFinanceSummaryPdf(s, today, await loadDocumentControl(db, "cash_sales_summary"));
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "no-store" } });
  }
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Cash and Sales Summary");
  sheet.columns = [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  const peso = (c: number) => c / 100;
  const add = (cells: (string | number)[], bold = false) => { const r = sheet.addRow(cells); r.font = { bold }; r.eachCell((c) => { if (typeof c.value === "number") c.numFmt = "₱#,##0.00"; }); return r; };
  const head = (cells: string[]) => { const r = sheet.addRow(cells); r.font = { bold: true, color: { argb: "FFFFFFFF" } }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123F63" } }; };
  const SALE_HEADS = ["Trainees", "Course Fees", "Miscellaneous Charges", "Less Discounts", "Total Sales", "Amount Collected", "Outstanding Balance"];
  const sale = (label: string, r: SalesLine, bold = false) => { const row = add([label, r.trainees, peso(r.fees), peso(r.charges), peso(0 - r.discounts), peso(r.sales), peso(r.collected), peso(r.balance)], bold); row.getCell(2).numFmt = "0"; };
  add([`Cash and Sales Summary - ${s.title} (${s.from} to ${s.to})`], true);
  sheet.addRow([]);
  head(["Sales Summary (by training date)", ...SALE_HEADS]);
  sale("Total Sales", s.totalSales, true);
  sale("Sales from New Wave Courses", s.direct, true);
  for (const c of s.direct.categories) sale(`  ${c.name}`, c);
  sale("Sales from Endorsed Courses", s.endorsement, true);
  for (const c of s.endorsement.centers) sale(`  ${c.name}`, c);
  sheet.addRow([]);
  head(["Sales from New Wave Courses", ...SALE_HEADS]);
  for (const c of s.direct.categories) {
    add([c.name], true);
    for (const r of c.courses) sale(`  ${r.code} ${r.name}`, r);
    sale(`Total ${c.name}`, c, true);
  }
  sale("Total Sales from New Wave Courses", s.direct, true);
  add(["Less Operating Expenses for the Period", "", "", "", "", "", "", peso(0 - s.direct.expenses)]);
  add(["Gross Margin on New Wave Courses", "", "", "", "", "", "", peso(s.direct.margin)], true);
  sheet.addRow([]);
  head(["Sales from Endorsed Courses", ...SALE_HEADS]);
  for (const c of s.endorsement.centers) sale(c.name, c);
  sale("Total Sales from Endorsed Courses", s.endorsement, true);
  sheet.addRow([]);
  head(["Rebates from Endorsed Courses", "Payable to Partnered Center", "Rebate", "Rebate Received", "Rebates Receivable", "Agency Commission", "Net Rebate Income"]);
  for (const c of s.endorsement.centers) add([c.name, peso(c.payable), peso(c.rebate), peso(c.received), peso(c.due), peso(0 - c.share), peso(c.keeps)]);
  const e = s.endorsement;
  add(["Total", peso(e.payable), peso(e.rebate), peso(e.received), peso(e.rebateDue), peso(0 - e.share), peso(e.keeps)], true);
  sheet.addRow([]);
  const block = (title: string, ls: Line[]) => {
    head([title, "Endorsed Courses", "New Wave Courses", "Total"]);
    for (const l of ls) add([`${l.side === "E" ? "Endorsed Courses" : "New Wave Courses"} - ${l.label}`, l.side === "E" ? peso(l.total) : 0, l.side === "D" ? peso(l.total) : 0, peso(l.total)]);
    const te = sideTotal(ls, "E"), td = sideTotal(ls, "D");
    add([`Total ${title}`, peso(te), peso(td), peso(te + td)], true);
    for (const ch of channelsUsed(ls)) { const ce = channelTotal(ls, "E", ch), cd = channelTotal(ls, "D", ch); add([`  ${ch}`, peso(ce), peso(cd), peso(ce + cd)]); }
    sheet.addRow([]);
  };
  block("Cash Received", s.received);
  block("Disbursements", s.disbursed);
  const rE = sideTotal(s.received, "E"), rD = sideTotal(s.received, "D"), dE = sideTotal(s.disbursed, "E"), dD = sideTotal(s.disbursed, "D");
  add(["Net Cash", peso(rE - dE), peso(rD - dD), peso(rE + rD - dE - dD)], true);
  const buffer = await book.xlsx.writeBuffer();
  return new Response(buffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "no-store" } });
}
