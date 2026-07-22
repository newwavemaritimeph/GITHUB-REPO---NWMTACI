import ExcelJS from "exceljs";
import { ENDORSEMENT_OFFERS } from "@/lib/endorsement-catalog";
import { IN_HOUSE_COURSES } from "@/lib/in-house-catalog";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { requireStaff } from "@/lib/security";

export async function GET() {
  if (!isSupabaseConfigured()) return new Response("Secure reporting is not configured.", { status: 503 });
  if (!(await requireStaff())) return new Response("Not authorized", { status: 403 });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "New Wave Maritime";
  const ownSheet = workbook.addWorksheet("New Wave Courses", { views: [{ state: "frozen", ySplit: 1 }] });
  ownSheet.columns = [
    { header: "Code", key: "code", width: 16 }, { header: "Course", key: "course", width: 58 }, { header: "Category", key: "category", width: 28 },
    { header: "Modality", key: "modality", width: 20 }, { header: "Duration", key: "duration", width: 18 }, { header: "Price", key: "price", width: 16, style: { numFmt: "₱#,##0.00" } },
  ];
  ownSheet.addRows(IN_HOUSE_COURSES.map((course) => ({ code: course.code, course: course.course, category: course.category, modality: course.modality, duration: course.duration, price: course.priceCentavos / 100 })));
  const endorsedSheet = workbook.addWorksheet("Endorsed Courses", { views: [{ state: "frozen", ySplit: 1 }] });
  endorsedSheet.columns = [
    { header: "Course", key: "course", width: 58 }, { header: "Center", key: "center", width: 26 }, { header: "Duration", key: "duration", width: 18 },
    { header: "Training Fee", key: "fee", width: 17, style: { numFmt: "₱#,##0.00" } }, { header: "Rebate", key: "rebate", width: 17, style: { numFmt: "₱#,##0.00" } }, { header: "Partner Payable", key: "payable", width: 19, style: { numFmt: "₱#,##0.00" } },
  ];
  endorsedSheet.addRows(ENDORSEMENT_OFFERS.map((offer) => ({ course: offer.course, center: offer.center, duration: offer.duration, fee: offer.trainingFeeCentavos / 100, rebate: offer.rebateCentavos / 100, payable: offer.partnerPayableCentavos / 100 })));
  for (const sheet of workbook.worksheets) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123F63" } };
  }
  const output = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(output), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=new-wave-course-catalog.xlsx" } });
}
