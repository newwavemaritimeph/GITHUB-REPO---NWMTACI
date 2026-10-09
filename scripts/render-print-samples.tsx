/**
 * Renders every portal printable with sample data, using the same code the
 * portal prints with, into output/print-templates/ — one PDF each plus one
 * combined "New-Wave-Printables.pdf". The Training Admission Record and the
 * acknowledgement receipt are web pages printed from the browser, so they are
 * rendered to HTML and printed to PDF with the installed Chrome or Edge.
 *
 *   npx tsx scripts/render-print-samples.tsx
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import { createAdmissionInvoicePdf, createCashierReportPdf, createDailyExpensesPdf, createExpenseVoucherPdf, createPayslipPdf, createTrainingInstructionsPdf } from "../lib/documents";
import { createMismoListPdf } from "../lib/print/mismo-list";
import { createReconciliationSheetPdf } from "../lib/print/reconciliation-sheet";
import { createResourcePlanPdf } from "../lib/print/resource-plan";
import { planRows, type PlanBatch } from "../lib/admin-assistant";
import { TarSheets, type TarProps } from "../app/portal/admission-record/[id]/tar-sheets";
import { ReceiptSheets, type ReceiptProps } from "../app/portal/payment-receipt/[id]/receipt-sheets";

const OUT = path.resolve("output/print-templates");
const root = path.resolve(".");
const logoBytes = new Uint8Array(await readFile("public/new-wave-emblem.png"));
const css = await readFile("app/portal/admission-record/[id]/admission-record.css", "utf8");
const browser = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));
const made: { file: string; title: string }[] = [];

async function save(file: string, title: string, bytes: Uint8Array) {
  await writeFile(path.join(OUT, file), bytes);
  made.push({ file, title });
  console.log(`  ✓ ${file}`);
}

/** Prints a React page (TAR layout) to a legal-size PDF with headless Chrome/Edge. */
async function printHtml(file: string, title: string, element: React.ReactElement) {
  if (!browser) { console.log(`  ✗ ${file}: Chrome or Edge not found`); return; }
  const logoUrl = pathToFileURL(path.join(root, "public/brand/new-wave-emblem.png")).href;
  const body = renderToStaticMarkup(element).replaceAll('src="/brand/', `src="${logoUrl.replace(/new-wave-emblem\.png$/, "")}`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500;600&display=swap"><style>:root{--font-ui:"Geist";--font-geist-mono:"Geist Mono"}*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:Geist,system-ui,sans-serif}${css}</style></head><body>${body}</body></html>`;
  const htmlPath = path.join(OUT, file.replace(/\.pdf$/, ".html"));
  await writeFile(htmlPath, html);
  execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=4000", `--print-to-pdf=${path.join(OUT, file)}`, pathToFileURL(htmlPath).href], { stdio: "ignore" });
  made.push({ file, title });
  console.log(`  ✓ ${file}`);
}

await mkdir(OUT, { recursive: true });
console.log("Rendering New Wave printables…");

// ---- Training Admission Record (single course and multi-course) -------------------
const tar: TarProps = {
  arNumber: "AR-2026-001204", issued: "Oct 12, 2026, 9:42 AM", name: "DELA CRUZ, JUAN PEREZ",
  trainee: { appNo: "NWMTACI-0000411", srn: "SRN-2210441", rank: "Able Seaman", mobile: "0917 100 2001", company: "Qapla Maritime" },
  courses: [
    { id: "1", code: "UBT-PSSR", name: "Updating Training on Basic Training – PSSR", dates: "12 Oct (Mon)", time: "8:00–17:00", room: "ROOM 101", fee: 180000 },
    { id: "2", code: "PSCMT", name: "Crowd Management Training", dates: "13–14 Oct (Tue–Wed)", time: "8:00–17:00", room: "ROOM 102", fee: 130000 },
  ],
  misc: [{ label: "T-Shirt", amount: 15000 }], discounts: [{ label: "Referral rebate (Qapla Maritime)", amount: 20000 }],
  payments: [{ id: "p1", number: "PAY-2026-001498", dateLabel: "12 Oct", method: "GCash", ref: "7012345678901", amount: 200000 }],
  feesTotal: 310000, due: 305000, paid: 200000, balance: 105000, status: "PARTIALLY PAID", officer: "Sophia Ugadan", cashier: "Karen Mallari",
};
await printHtml("01-training-admission-record.pdf", "Training Admission Record", <TarSheets {...tar} />);
const many = ["UBT-PSSR|Updating Training on Basic Training – PSSR", "STPPDSPPS|Ship Security Awareness", "PSCMT|Crowd Management Training", "PSCMHBT|Crisis Management and Human Behavior", "CCMD|Crisis Management – Domestic", "HPT|Hydraulic and Pneumatic Training", "SFA|Standard First Aid", "BOSH|Basic Occupational Safety and Health"]
  .map((x, i) => { const [code, name] = x.split("|"); return { id: String(i), code, name, dates: `${12 + i} Oct`, time: "8:00–17:00", room: i % 2 ? "ROOM 102" : "ROOM 101", fee: 120000 + i * 15000 }; });
const manyFees = many.reduce((s, c) => s + c.fee, 0);
await printHtml("02-training-admission-record-multi-course.pdf", "Training Admission Record (8 courses, 2 pages)", <TarSheets {...tar} arNumber="AR-2026-001205" courses={many} misc={[]} discounts={[]} feesTotal={manyFees} due={manyFees} paid={manyFees} balance={0} status="FULLY PAID"
  payments={[{ id: "a", number: "PAY-2026-001510", dateLabel: "12 Oct", method: "Cash", ref: "—", amount: 600000 }, { id: "b", number: "PAY-2026-001511", dateLabel: "12 Oct", method: "UnionBank", ref: "UB-88123007", amount: manyFees - 600000 }]} />);

// ---- Acknowledgement receipt -----------------------------------------------------
const receipt: ReceiptProps = {
  receiptNo: "AR-2026-001198", name: "GARCIA, LIZA MARIE", received: "Oct 12, 2026, 9:30 AM", cashier: "Karen Mallari", status: "PARTIALLY PAID",
  payment: { number: "PAY-2026-001498", method: "PSBank", reference: "PSB-55120931", amount: 50000, remarks: null },
  trainee: { appNo: "NWMTACI-0000409", srn: "SRN-2001983", rank: "Ordinary Seaman", mobile: "0917 100 2004", company: null },
  appliedTo: [{ id: "e5", number: "ENR-2026-000862", code: "UBT-PSSR", name: "Updating Training on Basic Training – PSSR", dates: "12 Oct", applied: 50000 }],
  totalDue: 180000, totalPaid: 50000, balance: 130000,
};
await printHtml("03-acknowledgement-receipt.pdf", "Acknowledgement Receipt", <ReceiptSheets {...receipt} />);

// ---- Expense voucher (first print and a reprint) ---------------------------------
const voucher = {
  number: "CV-2026-000131", requestNumber: "ER-2026-000209", issuedAt: "October 12, 2026", payee: "Meralco", category: "Utilities", purpose: "September electricity bill, main office",
  amountCentavos: 845000, lines: [{ description: "Electricity, Sep 2026 (Acct 1234-5678)", quantity: 1, unitCentavos: 820000 }, { description: "Late payment surcharge", quantity: 1, unitCentavos: 25000 }],
  paymentChannel: "GCash", referenceNumber: "7019988776655", supportingDocument: "Meralco bill no. 0098812", requestedBy: "Karen Mallari", modeOfPayment: "GCash", status: "Released",
  preparedBy: "Karen Mallari", preparedAt: "Cashier · Oct 11, 2026", approvedBy: "Kat Garcia", approvedAt: "Accounting Manager · Oct 12, 2026", releasedBy: "Karen Mallari", releasedAt: "Cashier · Oct 12, 2026, 2:10 PM", logoBytes,
};
await save("04-expense-voucher.pdf", "Expense Voucher", await createExpenseVoucherPdf(voucher));
await save("05-expense-voucher-reprint.pdf", "Expense Voucher (Reprint 1)", await createExpenseVoucherPdf({ ...voucher, printLabel: "Reprint 1" }));

// ---- Cashier summary report ------------------------------------------------------
const channels = ["Cash", "GCash", "PSBank", "UnionBank"];
const cell = (vals: number[][]) => channels.map((channel, i) => ({ channel, count: vals[i][0], totalCentavos: vals[i][1] }));
await save("06-cashier-summary-report.pdf", "Cashier Summary Report", await createCashierReportPdf({
  dateLabel: "Monday, October 12, 2026", preparedBy: "Karen Mallari", checkedBy: "Kat Garcia", logoBytes, channels,
  position: { previousLabel: "Counted at closing, Oct 11", previousCentavos: 500000, cashCollectedCentavos: 360000, cashExpensesCentavos: 125000, onHandCentavos: 735000, countedCentavos: 734000, overShortCentavos: -1000 },
  matrix: [
    { source: "Direct walk-ins", cells: cell([[2, 360000], [1, 180000], [1, 50000], [0, 0]]), count: 4, totalCentavos: 590000 },
    { source: "Agencies", cells: cell([[0, 0], [1, 130000], [0, 0], [1, 120000]]), count: 2, totalCentavos: 250000 },
    { source: "Consultancies", cells: cell([[0, 0], [0, 0], [1, 250000], [0, 0]]), count: 1, totalCentavos: 250000 },
  ],
  groups: [
    { kind: "Direct walk-in", name: "Walk-ins", subtotalCentavos: 590000, rows: [
      { receipt: "AR-2026-001198", time: "9:30 AM", trainee: "GARCIA, Liza", course: "UBT-PSSR", channel: "PSBank", reference: "PSB-55120931", amountCentavos: 50000, proof: true },
      { receipt: "AR-2026-001199", time: "10:05 AM", trainee: "FLORES, Ken", course: "UBT-PSSR", channel: "Cash", reference: "", amountCentavos: 180000 },
      { receipt: "AR-2026-001200", time: "11:40 AM", trainee: "DELA CRUZ, Juan", course: "UBT-PSSR", channel: "GCash", reference: "7012345678901", amountCentavos: 180000, proof: true },
      { receipt: "AR-2026-001201", time: "2:15 PM", trainee: "TORRES, Ella", course: "SFA", channel: "Cash", reference: "", amountCentavos: 180000 }] },
    { kind: "Agency", name: "Qapla Maritime", subtotalCentavos: 250000, rows: [
      { receipt: "AR-2026-001202", time: "3:00 PM", trainee: "SANTOS, Maria", course: "PSCMT", channel: "GCash", reference: "7000999123", amountCentavos: 130000, proof: true },
      { receipt: "AR-2026-001203", time: "3:20 PM", trainee: "AQUINO, Rey", course: "STPPDSPPS", channel: "UnionBank", reference: "UB-88123011", amountCentavos: 120000, proof: true }] },
    { kind: "Consultancy", name: "Costa Crewing Consultancy", subtotalCentavos: 250000, rows: [
      { receipt: "AR-2026-001204", time: "3:45 PM", trainee: "MENDOZA, Carlo", course: "PSCMHBT", channel: "PSBank", reference: "PSB-55120977", amountCentavos: 250000, proof: true }] },
  ],
  expenses: [
    { voucher: "CV-2026-000129", payee: "Office Warehouse", category: "Supplies", channel: "Cash", reference: "", status: "Released", amountCentavos: 125000 },
    { voucher: "CV-2026-000131", payee: "Meralco", category: "Utilities", channel: "GCash", reference: "7019988776655", status: "Released", amountCentavos: 845000 }],
  expenseTotals: [{ channel: "Cash", totalCentavos: 125000 }, { channel: "GCash", totalCentavos: 845000 }],
}));

// ---- Expenses summary (date range) -----------------------------------------------
await save("07-expenses-summary.pdf", "Expenses Summary (Oct 1–12)", await createDailyExpensesPdf({
  title: "Expenses Summary", dateLabel: "October 1 – 12, 2026", preparedBy: "Kat Garcia", logoBytes,
  rows: [
    { number: "CV-2026-000124", payee: "PLDT", category: "Utilities", channel: "GCash", reference: "7011100223", status: "Released", amountCentavos: 289900 },
    { number: "CV-2026-000126", payee: "LBC Express", category: "Courier", channel: "Cash", reference: "", status: "Released", amountCentavos: 50000 },
    { number: "CV-2026-000128", payee: "LBC Express", category: "Courier", channel: "Cash", reference: "", status: "Released", amountCentavos: 50000 },
    { number: "CV-2026-000129", payee: "Office Warehouse", category: "Supplies", channel: "Cash", reference: "", status: "Released", amountCentavos: 125000 },
    { number: "CV-2026-000130", payee: "Requisition RQ-2026-0006", category: "Supplies", channel: "Cash", reference: "", status: "Approved", amountCentavos: 202000 },
    { number: "CV-2026-000131", payee: "Meralco", category: "Utilities", channel: "GCash", reference: "7019988776655", status: "Released", amountCentavos: 845000 }],
  totalCentavos: 1561900, paidCentavos: 1359900,
  channelTotals: [{ channel: "Cash", count: 4, totalCentavos: 427000 }, { channel: "GCash", count: 2, totalCentavos: 1134900 }],
}));

// ---- Enrollment record (payment invoice + admission slip) --------------------------
await save("08-enrollment-record.pdf", "Enrollment Record (Invoice and Admission Slip)", await createAdmissionInvoicePdf({
  reference: "ENR-2026-000871", traineeName: "Juan Perez Dela Cruz", traineeNumber: "NWMTACI-0000411", srn: "SRN-2210441", mobile: "0917 100 2001", email: "juan.dc@example.com",
  courses: [{ course: "Updating Training on Basic Training – PSSR (UBT-PSSR)", schedule: "Oct 12, 2026", time: "8:00 AM – 5:00 PM", venue: "ROOM 101", instructor: "Capt. R. Villanueva" },
    { course: "Crowd Management Training (PSCMT)", schedule: "Oct 13–14, 2026", time: "8:00 AM – 5:00 PM", venue: "ROOM 102", instructor: "Engr. L. Cruz" }],
  registrationStatus: "Enrolled", issuedAt: "October 12, 2026", officer: "Sophia Ugadan", cashier: "Karen Mallari",
  lines: [{ description: "UBT-PSSR training fee", amountCentavos: 180000 }, { description: "PSCMT training fee", amountCentavos: 130000 }, { description: "T-Shirt", detail: "Miscellaneous", amountCentavos: 15000 }, { description: "Referral rebate", detail: "Qapla Maritime", amountCentavos: 20000, negative: true }],
  dueCentavos: 305000, paidCentavos: 200000, balanceCentavos: 105000, paymentStatus: "PARTIALLY PAID", logoBytes,
}));

// ---- Training instructions -------------------------------------------------------
await save("09-training-instructions.pdf", "Training Instructions", await createTrainingInstructionsPdf({
  traineeName: "Juan Perez Dela Cruz", formalName: "DELA CRUZ, JUAN PEREZ", nwmtaciNumber: "NWMTACI-0000411", srn: "SRN-2210441",
  courseName: "Updating Training on Basic Training – PSSR (UBT-PSSR)", batchNumber: "BCH-2026-0412", dateOfTraining: "Monday, October 12, 2026", time: "8:00 AM – 5:00 PM", classroom: "ROOM 101",
  mode: "Face-to-face", duration: "1 day", googleClassroomLink: "https://classroom.google.com/c/NzAxMjM0?cjc=abc1234", classCode: "abc1234", reference: "ENR-2026-000871", issuedAt: "October 9, 2026", logoBytes,
}));

// ---- Payment reconciliation day sheet ----------------------------------------------
await save("10-payment-reconciliation-day-sheet.pdf", "Payment Reconciliation Day Sheet (GCash)", await createReconciliationSheetPdf("2026-10-11", "GCash", { rows: [
  { id: "1", payment_number: "PAY-2026-001490", receipt_number: "AR-2026-001190", received_at: "2026-10-11T02:15:00Z", amount_centavos: 180000, reference_number: "7012345678901", trainee: "REYES, Paolo", recorded_by: "Karen Mallari", proof_link: null, status: "Reconciled", remarks: null, checked_by: "Admin Assistant", checked_at: null },
  { id: "2", payment_number: "PAY-2026-001491", receipt_number: "AR-2026-001191", received_at: "2026-10-11T03:40:00Z", amount_centavos: 130000, reference_number: "7012345611112", trainee: "AQUINO, Rey", recorded_by: "Kat Garcia", proof_link: null, status: null, remarks: null, checked_by: null, checked_at: null },
  { id: "3", payment_number: "PAY-2026-001492", receipt_number: "AR-2026-001192", received_at: "2026-10-11T06:05:00Z", amount_centavos: 250000, reference_number: "7012349900001", trainee: "MENDOZA, Carlo", recorded_by: "Karen Mallari", proof_link: null, status: "Not in History", remarks: "Not on the printout", checked_by: "Admin Assistant", checked_at: null },
  { id: "4", payment_number: "PAY-2026-001493", receipt_number: "AR-2026-001193", received_at: "2026-10-11T07:30:00Z", amount_centavos: 90000, reference_number: "7012340000777", trainee: "BAUTISTA, Ana", recorded_by: "Karen Mallari", proof_link: null, status: null, remarks: null, checked_by: null, checked_at: null }] }));

// ---- Resource plan ---------------------------------------------------------------
const pb = (id: string, no: string, code: string, name: string, s: string, e: string, n: number, room: string | null, ins: string | null): PlanBatch => ({ id, batchNumber: no, courseId: code, courseCode: code, courseName: name, startsOn: s, endsOn: e, students: n, capacity: 24, classroomId: room, instructorId: ins });
const plan = planRows([
  pb("a", "BCH-2026-002475", "UBT-PSSR", "Updating Training on Basic Training – PSSR", "2026-10-12", "2026-10-12", 18, "r1", "i1"),
  pb("b", "BCH-2026-002493", "CCMD", "Crowd and Crisis Management – Domestic", "2026-10-12", "2026-10-14", 9, "r2", null),
  pb("c", "BCH-2026-002469", "STPPDSPPS", "Safety Training for Personnel", "2026-10-12", "2026-10-12", 14, null, "i3"),
  pb("d", "BCH-2026-002466", "PSCMT", "Crowd Management Training", "2026-10-13", "2026-10-14", 26, "r1", "i4"),
  pb("e", "BCH-2026-002476", "UBT-PSSR", "Updating Training on Basic Training – PSSR", "2026-10-13", "2026-10-13", 6, "r1", "i3"),
  pb("f", "BCH-2026-002480", "HPT", "Hydraulic and Pneumatic Training", "2026-10-14", "2026-10-16", 10, "r3", "i2"),
  pb("g", "BCH-2026-002482", "PSCMHBT", "Passenger Ship Crisis Management", "2026-10-15", "2026-10-17", 11, null, null),
], [{ id: "r1", name: "ROOM 101", capacity: 24 }, { id: "r2", name: "ROOM 102", capacity: 24 }, { id: "r3", name: "Simulator Room", capacity: 12 }],
  [{ id: "i1", complete_name: "Capt. R. Villanueva" }, { id: "i2", complete_name: "C/E M. Ramos" }, { id: "i3", complete_name: "2/O J. Dizon" }, { id: "i4", complete_name: "Engr. L. Cruz" }],
  [{ instructor_id: "i1", course_id: "UBT-PSSR", valid_until: "2027-03-31" }, { instructor_id: "i3", course_id: "UBT-PSSR", valid_until: "2027-01-15" }, { instructor_id: "i3", course_id: "STPPDSPPS", valid_until: "2026-09-30" }, { instructor_id: "i4", course_id: "PSCMT", valid_until: "2027-04-30" }, { instructor_id: "i2", course_id: "HPT", valid_until: "2026-10-20" }]);
await save("11-resource-plan.pdf", "Resource Plan", await createResourcePlanPdf("2026-10-12", "2026-10-25", "2026-10-12", plan));

// ---- MARINA MISMO lists ----------------------------------------------------------
const tr = (id: string, last: string, first: string, mid: string | null, birth: string, srn: string, rank: string, due: number, p11: number, p16: number) => ({ enrollmentId: id, lastName: last, firstName: first, middleName: mid, birthdate: birth, srn, rank, dueCentavos: due, paidBy11: p11, paidBy16: p16, paidNow: p16 });
const mismo = [{ id: "b1", batchNumber: "BCH-2026-002475", courseName: "Updating Training on Basic Training – PSSR", courseCode: "UBT-PSSR", startsOn: "2026-10-12", endsOn: "2026-10-12", room: "ROOM 101", instructor: "Capt. R. Villanueva", submittedAt: null, submittedCount: null, trainees: [
  tr("1", "DELA CRUZ", "Juan", "Perez", "1990-04-12", "SRN-2210441", "AB", 180000, 180000, 180000),
  tr("2", "GARCIA", "Liza", "Marie", "1992-11-30", "SRN-2001983", "OS", 180000, 50000, 180000),
  tr("3", "FLORES", "Ken", null, "1993-03-27", "SRN-1901777", "Oiler", 180000, 180000, 180000),
  tr("4", "VILLAR", "Mark", "Santos", "1997-07-07", "SRN-2400112", "Wiper", 180000, 0, 0)] }];
await save("12-mismo-final-list.pdf", "MARINA MISMO Final List (4:00 PM)", await createMismoListPdf("2026-10-12", mismo, "final", { logo: logoBytes, preparedBy: "Ana Reyes" }));
await save("13-mismo-unsettled-11am.pdf", "Not Settled as of 11:00 AM (for the instructor)", await createMismoListPdf("2026-10-12", mismo, "unsettled", { logo: logoBytes, preparedBy: "Ana Reyes" }));

// ---- Payslip -----------------------------------------------------------------------
await save("14-payslip.pdf", "Payslip", await createPayslipPdf({
  employeeNumber: "EMP-2026-000012", employeeName: "Karen Mallari", position: "Cashier", payFrequency: "Semi-monthly", dateHired: "March 1, 2024", period: "October 1 – 15, 2026", payDate: "October 15, 2026",
  earnings: [{ label: "Basic pay", amountCentavos: 1250000 }, { label: "Overtime (4 hrs)", amountCentavos: 85000 }],
  deductions: [{ label: "SSS", amountCentavos: 56250 }, { label: "PhilHealth", amountCentavos: 31250 }, { label: "Pag-IBIG", amountCentavos: 10000 }, { label: "Withholding tax", amountCentavos: 42000 }],
  grossCentavos: 1335000, totalDeductionsCentavos: 139500, netCentavos: 1195500, preparedBy: "Kat Garcia", logoBytes,
}));

// ---- One combined file ---------------------------------------------------------------
const all = await PDFDocument.create();
for (const m of made) {
  const src = await PDFDocument.load(await readFile(path.join(OUT, m.file)));
  for (const page of await all.copyPages(src, src.getPageIndices())) all.addPage(page);
}
all.setTitle("New Wave Maritime — Portal Printables (sample data)");
await writeFile(path.join(OUT, "New-Wave-Printables.pdf"), await all.save());
console.log(`\nDone: ${made.length} printables in ${path.relative(root, OUT)}, plus New-Wave-Printables.pdf (all in one).`);
