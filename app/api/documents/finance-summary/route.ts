import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PERIODS, type Period } from "@/lib/accounting-periods";
import { buildFinanceSummary, channelTotal, channelsUsed, sideTotal, type Line } from "@/lib/finance-summary";
import { createFinanceSummaryPdf } from "@/lib/print/finance-summary";

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
    const bytes = await createFinanceSummaryPdf(s, today);
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "no-store" } });
  }
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Cash and Sales Summary");
  sheet.columns = [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  const peso = (c: number) => c / 100;
  const add = (cells: (string | number)[], bold = false) => { const r = sheet.addRow(cells); r.font = { bold }; r.eachCell((c) => { if (typeof c.value === "number") c.numFmt = "₱#,##0.00"; }); return r; };
  const head = (cells: string[]) => { const r = sheet.addRow(cells); r.font = { bold: true, color: { argb: "FFFFFFFF" } }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123F63" } }; };
  add([`Cash and Sales Summary - ${s.title} (${s.from} to ${s.to})`], true);
  sheet.addRow([]);
  const block = (title: string, ls: Line[]) => {
    head([title, "Endorsement", "Direct", "Total"]);
    for (const l of ls) add([`${l.side === "E" ? "Endorsement" : "Direct"} - ${l.label}`, l.side === "E" ? peso(l.total) : 0, l.side === "D" ? peso(l.total) : 0, peso(l.total)]);
    const e = sideTotal(ls, "E"), d = sideTotal(ls, "D");
    add([`Total ${title}`, peso(e), peso(d), peso(e + d)], true);
    for (const ch of channelsUsed(ls)) { const ce = channelTotal(ls, "E", ch), cd = channelTotal(ls, "D", ch); add([`  ${ch}`, peso(ce), peso(cd), peso(ce + cd)]); }
    sheet.addRow([]);
  };
  block("Cash Received", s.received);
  block("Disbursements", s.disbursed);
  const rE = sideTotal(s.received, "E"), rD = sideTotal(s.received, "D"), dE = sideTotal(s.disbursed, "E"), dD = sideTotal(s.disbursed, "D");
  add(["Net Cash", peso(rE - dE), peso(rD - dD), peso(rE + rD - dE - dD)], true);
  sheet.addRow([]);
  head(["Direct Sales (by training date)", "Trainees", "Sales"]);
  for (const c of s.direct.courses) add([`${c.code} ${c.name}`, c.trainees, peso(c.sales)]);
  add(["Course Fees", s.direct.trainees, peso(s.direct.fees)], true);
  add(["Add Miscellaneous Charges", "", peso(s.direct.charges)]);
  add(["Less Discounts", "", peso(-s.direct.discounts)]);
  add(["Direct Sales", "", peso(s.direct.sales)], true);
  add(["Collected", "", peso(s.direct.collected)]);
  add(["Balance Still Due", "", peso(s.direct.balance)]);
  add(["Less Direct Expenses (period)", "", peso(-s.direct.expenses)]);
  add(["Direct Gross Margin", "", peso(s.direct.margin)], true);
  sheet.addRow([]);
  head(["Training Endorsement (by training date)", "Trainees", "Fees Billed", "Paid to Center", "Rebate", "Agency Share", "New Wave Keeps"]);
  for (const c of s.endorsement.centers) add([c.name, c.trainees, peso(c.fees), peso(c.payable), peso(c.rebate), peso(-c.share), peso(c.keeps)]);
  const e = s.endorsement;
  add(["Total", e.trainees, peso(e.fees), peso(e.payable), peso(e.rebate), peso(-e.share), peso(e.keeps)], true);
  add(["Rebates received", "", "", "", peso(e.received)]);
  add(["Rebates still due from centers", "", "", "", peso(e.rebateDue)]);
  const buffer = await book.xlsx.writeBuffer();
  return new Response(buffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "no-store" } });
}
