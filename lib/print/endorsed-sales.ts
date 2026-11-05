import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { EndorsedRow, endorsedSales } from "@/lib/endorsed-sales";
import { ascii, day, money } from "@/lib/print/finance-summary";
import type { DocumentControl } from "@/lib/document-controls";
import { drawControlLine } from "@/lib/print/control-block";

type Report = ReturnType<typeof endorsedSales> & { title: string; from: string; to: string };
const COLUMNS: { head: string; w: number; right?: boolean }[] = [
  { head: "Trainee", w: 0.21 }, { head: "Course", w: 0.07 }, { head: "Training\nDate", w: 0.09 }, { head: "Course\nFee", w: 0.08, right: true }, { head: "Amount\nCollected", w: 0.08, right: true }, { head: "Outstanding\nBalance", w: 0.08, right: true },
  { head: "Partnered\nCenter", w: 0.08 }, { head: "Rebate", w: 0.07 }, { head: "Rebate\nAmount", w: 0.08, right: true }, { head: "Agency\nCommission", w: 0.08, right: true }, { head: "Net Rebate\nIncome", w: 0.08, right: true },
];

/** The Endorsed Courses report, A4 landscape, one ledger per center (Design 2) under Header 3. Amounts in PHP. */
export async function createEndorsedSalesPdf(s: Report, printed: string, logoBytes?: Uint8Array, control?: DocumentControl | null) {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.07, 0.25, 0.39), muted = rgb(0.31, 0.4, 0.47), ink = rgb(0.06, 0.15, 0.22), rule = rgb(0.86, 0.9, 0.93), tint = rgb(0.9, 0.96, 0.98), orange = rgb(0.95, 0.34, 0.08), red = rgb(0.71, 0.24, 0.05), white = rgb(1, 1, 1);
  const W = 841.89, H = 595.28, M = 30, CW = W - 2 * M;
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (logoBytes) { try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; } }
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (t: string, x: number, at: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(ascii(t), { x, y: at, size, font, color });
  const right = (t: string, xr: number, at: number, size: number, font: PDFFont = reg, color = ink) => { const v = ascii(t); page.drawText(v, { x: xr - font.widthOfTextAtSize(v, size), y: at, size, font, color }); };
  const fit = (t: string, size: number, width: number, font: PDFFont = reg) => { let v = ascii(t); if (font.widthOfTextAtSize(v, size) <= width) return v; while (v.length > 1 && font.widthOfTextAtSize(`${v}...`, size) > width) v = v.slice(0, -1); return `${v}...`; };

  // Header 3 "Report First" (owner's choice, 4 Nov 2026), as on the Cashier Summary Report.
  const header = (continued: boolean) => {
    text(continued ? "Endorsed Courses (continued)" : "Endorsed Courses", M, y - 17, continued ? 13 : 20, bold, navy);
    text(`${s.title} - ${day(s.from)} to ${day(s.to)} - by training date - amounts in PHP - printed ${day(printed)}`, M, y - 31, 9, bold, orange);
    const logoS = 34, detailsX = W - M - (logo ? logoS + 7 : 0);
    if (logo) { const d = logo.scaleToFit(logoS, logoS); page.drawImage(logo, { x: W - M - logoS + (logoS - d.width) / 2, y: y - logoS + (logoS - d.height) / 2, width: d.width, height: d.height }); }
    right("New Wave Maritime Training and Assessment Center, Inc.", detailsX, y - 10, 7.6, bold, navy);
    right("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000", detailsX, y - 19, 6.6, reg, muted);
    right("0948-847-6530  |  (02) 8553 0310  |  newwavemaritime@gmail.com", detailsX, y - 27, 6.6, reg, muted);
    page.drawRectangle({ x: M, y: y - 41, width: CW, height: 2, color: navy });
    if (drawControlLine(page, reg, control, { right: W - M, y: y - 49 })) y -= 7;
    y -= 50;
  };
  const columnHeads = () => {
    page.drawRectangle({ x: M, y: y - 21, width: CW, height: 21, color: navy });
    let x = M;
    for (const c of COLUMNS) {
      const w = CW * c.w, parts = c.head.split("\n");
      parts.forEach((part, k) => { const at = y - (parts.length > 1 ? 9 : 13) - k * 8; if (c.right) right(part, x + w - 4, at, 6.8, bold, white); else text(part, x + 4, at, 6.8, bold, white); });
      x += w;
    }
    y -= 21;
  };
  const newPage = (heads: boolean) => { page = pdf.addPage([W, H]); y = H - M; header(true); if (heads) columnHeads(); };

  const cells = (r: EndorsedRow) => [r.trainee, r.code, r.trainingDate ? day(r.trainingDate) : "-", money(r.fee), money(r.collected), money(r.balance), r.centerState, r.rebateState, money(r.rebate), money(r.share), money(r.keeps)];
  const row = (r: EndorsedRow) => {
    if (y - 21 < M + 16) newPage(true);
    let x = M;
    COLUMNS.forEach((c, i) => {
      const w = CW * c.w, v = cells(r)[i];
      if (i === 0) { text(fit(v, 7.8, w - 8, bold), x + 4, y - 9, 7.8, bold); text(fit(r.traineeNo, 6.4, w - 8), x + 4, y - 17, 6.4, reg, muted); }
      else if (c.right) right(v, x + w - 4, y - 12, 7.8, reg, i === 5 && r.balance > 0 ? red : ink);
      else text(fit(v, 7.8, w - 8), x + 4, y - 12, 7.8);
      x += w;
    });
    y -= 21;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: rule });
  };
  const subtotal = (label: string, t: Report["totals"]) => {
    if (y - 16 < M + 16) newPage(true);
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 16, color: tint });
    text(label, M + 4, y - 11, 7.8, bold, navy);
    const values = [money(t.fees), money(t.collected), money(t.balance), "", "", money(t.rebate), money(t.share), money(t.keeps)];
    let x = M + CW * (COLUMNS[0].w + COLUMNS[1].w + COLUMNS[2].w);
    COLUMNS.slice(3).forEach((c, i) => { const w = CW * c.w; if (values[i]) right(values[i], x + w - 4, y - 11, 7.8, bold, navy); x += w; });
    y -= 16;
  };

  header(false);
  if (!s.centers.length) text("No endorsed trainees in this period.", M, y - 14, 10, reg, muted);
  for (const c of s.centers) {
    if (y - 70 < M + 16) newPage(false);
    text(c.name, M, y - 11, 11, bold, navy);
    right(`${c.totals.trainees} Trainee${c.totals.trainees === 1 ? "" : "s"} - Remitted to Partnered Center ${money(c.totals.centerPaid)} - Payable ${money(c.totals.centerOwed)}`, W - M, y - 11, 8, reg, muted);
    y -= 16;
    columnHeads();
    c.rows.forEach(row);
    subtotal(`Total - ${c.name}`, c.totals);
    y -= 12;
  }

  // Grand totals and signatures stay together.
  const t = s.totals;
  if (y - 120 < M) newPage(false);
  const facts: [string, string][] = [["Trainees", String(t.trainees)], ["Course\nFees", money(t.fees)], ["Amount\nCollected", money(t.collected)], ["Outstanding\nBalance", money(t.balance)], ["Remitted to\nPartnered Centers", money(t.centerPaid)], ["Payable to\nPartnered Centers", money(t.centerOwed)], ["Rebates\nReceivable", money(t.rebateDue)], ["Rebates\nReceived", money(t.rebateReceived)], ["Agency\nCommissions", money(t.share)], ["Net Rebate\nIncome", money(t.keeps)]];
  const fw = CW / facts.length;
  page.drawRectangle({ x: M, y: y - 42, width: CW, height: 42, color: tint });
  facts.forEach(([label, value], i) => { label.split("\n").forEach((part, k) => text(part, M + i * fw + 5, y - 11 - k * 8, 6.6, reg, muted)); text(value, M + i * fw + 5, y - 34, 8.6, bold, navy); });
  y -= 84;
  const sign = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 200, y }, thickness: 0.7, color: ink }); text(label, x, y - 12, 8, reg, muted); };
  sign("Prepared by (Accounting)", M);
  sign("Noted by (Admin)", W - M - 200);
  return pdf.save();
}
