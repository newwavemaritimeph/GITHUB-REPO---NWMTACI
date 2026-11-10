import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { EndorsedRow, endorsedSales } from "@/lib/endorsed-sales";
import { ascii, day, money } from "@/lib/print/finance-summary";
import type { DocumentControl } from "@/lib/document-controls";
import { FOOT, LEGAL_LANDSCAPE, SIDE, drawLetterhead, finishPages, loadBrand, newPage as brandPage } from "@/lib/print/letterhead";

type Report = ReturnType<typeof endorsedSales> & { title: string; from: string; to: string };
const COLUMNS: { head: string; w: number; right?: boolean }[] = [
  { head: "Trainee", w: 0.21 }, { head: "Course", w: 0.07 }, { head: "Training\nDate", w: 0.09 }, { head: "Course\nFee", w: 0.08, right: true }, { head: "Amount\nCollected", w: 0.08, right: true }, { head: "Outstanding\nBalance", w: 0.08, right: true },
  { head: "Partnered\nCenter", w: 0.08 }, { head: "Rebate", w: 0.07 }, { head: "Rebate\nAmount", w: 0.08, right: true }, { head: "Agency\nCommission", w: 0.08, right: true }, { head: "Net Rebate\nIncome", w: 0.08, right: true },
];

/** The Endorsed Courses report, one ledger per center (Design 2), on the shared Corporate Two-Tone letterhead, legal landscape (10 Nov 2026). Amounts in PHP. */
export async function createEndorsedSalesPdf(s: Report, printed: string, logoBytes?: Uint8Array, control?: DocumentControl | null) {
  const pdf = await PDFDocument.create();
  const brand = await loadBrand(pdf, logoBytes), { reg, bold } = brand;
  const navy = rgb(0.07, 0.25, 0.39), muted = rgb(0.31, 0.4, 0.47), ink = rgb(0.06, 0.15, 0.22), rule = rgb(0.86, 0.9, 0.93), tint = rgb(0.9, 0.96, 0.98), orange = rgb(0.95, 0.34, 0.08), red = rgb(0.71, 0.24, 0.05), white = rgb(1, 1, 1);
  const [W] = LEGAL_LANDSCAPE, M = SIDE, CW = W - 2 * M;
  let page: PDFPage = brandPage(pdf, brand, LEGAL_LANDSCAPE);
  let y = 0;
  const text = (t: string, x: number, at: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(ascii(t), { x, y: at, size, font, color });
  const right = (t: string, xr: number, at: number, size: number, font: PDFFont = reg, color = ink) => { const v = ascii(t); page.drawText(v, { x: xr - font.widthOfTextAtSize(v, size), y: at, size, font, color }); };
  const fit = (t: string, size: number, width: number, font: PDFFont = reg) => { let v = ascii(t); if (font.widthOfTextAtSize(v, size) <= width) return v; while (v.length > 1 && font.widthOfTextAtSize(`${v}...`, size) > width) v = v.slice(0, -1); return `${v}...`; };

  const header = (continued: boolean) => {
    y = drawLetterhead(page, brand, control, { title: "ENDORSED COURSES", cont: continued });
    if (!continued) { text(`${s.title} - ${day(s.from)} to ${day(s.to)} - by training date - amounts in PHP - printed ${day(printed)}`, M, y + 2, 10.5, bold, orange); y -= 12; }
  };
  const columnHeads = () => {
    page.drawRectangle({ x: M, y: y - 26, width: CW, height: 26, color: navy });
    let x = M;
    for (const c of COLUMNS) {
      const w = CW * c.w, parts = c.head.split("\n");
      parts.forEach((part, k) => { const at = y - (parts.length > 1 ? 11 : 16) - k * 10; if (c.right) right(part, x + w - 5, at, 8.4, bold, white); else text(part, x + 5, at, 8.4, bold, white); });
      x += w;
    }
    y -= 26;
  };
  const newPage = (heads: boolean) => { page = brandPage(pdf, brand, LEGAL_LANDSCAPE); header(true); if (heads) columnHeads(); };

  const cells = (r: EndorsedRow) => [r.trainee, r.code, r.trainingDate ? day(r.trainingDate) : "-", money(r.fee), money(r.collected), money(r.balance), r.centerState, r.rebateState, money(r.rebate), money(r.share), money(r.keeps)];
  const row = (r: EndorsedRow) => {
    if (y - 26 < FOOT + 16) newPage(true);
    let x = M;
    COLUMNS.forEach((c, i) => {
      const w = CW * c.w, v = cells(r)[i];
      if (i === 0) { text(fit(v, 9.6, w - 10, bold), x + 5, y - 11, 9.6, bold); text(fit(r.traineeNo, 8, w - 10), x + 5, y - 21, 8, reg, muted); }
      else if (c.right) right(v, x + w - 5, y - 15, 9.6, reg, i === 5 && r.balance > 0 ? red : ink);
      else text(fit(v, 9.6, w - 10), x + 5, y - 15, 9.6);
      x += w;
    });
    y -= 26;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: rule });
  };
  const subtotal = (label: string, t: Report["totals"]) => {
    if (y - 20 < FOOT + 16) newPage(true);
    page.drawRectangle({ x: M, y: y - 20, width: CW, height: 20, color: tint });
    text(label, M + 5, y - 13.5, 9.6, bold, navy);
    const values = [money(t.fees), money(t.collected), money(t.balance), "", "", money(t.rebate), money(t.share), money(t.keeps)];
    let x = M + CW * (COLUMNS[0].w + COLUMNS[1].w + COLUMNS[2].w);
    COLUMNS.slice(3).forEach((c, i) => { const w = CW * c.w; if (values[i]) right(values[i], x + w - 5, y - 13.5, 9.6, bold, navy); x += w; });
    y -= 20;
  };

  header(false);
  if (!s.centers.length) text("No endorsed trainees in this period.", M, y - 14, 11, reg, muted);
  for (const c of s.centers) {
    if (y - 86 < FOOT + 16) newPage(false);
    text(c.name, M, y - 13, 13, bold, navy);
    right(`${c.totals.trainees} Trainee${c.totals.trainees === 1 ? "" : "s"} - Remitted to Partnered Center ${money(c.totals.centerPaid)} - Payable ${money(c.totals.centerOwed)}`, W - M, y - 13, 9.6, reg, muted);
    y -= 19;
    columnHeads();
    c.rows.forEach(row);
    subtotal(`Total - ${c.name}`, c.totals);
    y -= 12;
  }

  // Grand totals and signatures stay together.
  const t = s.totals;
  if (y - 150 < FOOT) newPage(false);
  const facts: [string, string][] = [["Trainees", String(t.trainees)], ["Course\nFees", money(t.fees)], ["Amount\nCollected", money(t.collected)], ["Outstanding\nBalance", money(t.balance)], ["Remitted to\nPartnered Centers", money(t.centerPaid)], ["Payable to\nPartnered Centers", money(t.centerOwed)], ["Rebates\nReceivable", money(t.rebateDue)], ["Rebates\nReceived", money(t.rebateReceived)], ["Agency\nCommissions", money(t.share)], ["Net Rebate\nIncome", money(t.keeps)]];
  const fw = CW / facts.length;
  page.drawRectangle({ x: M, y: y - 52, width: CW, height: 52, color: tint });
  facts.forEach(([label, value], i) => { label.split("\n").forEach((part, k) => text(part, M + i * fw + 6, y - 13 - k * 10, 8, reg, muted)); text(value, M + i * fw + 6, y - 43, 10.5, bold, navy); });
  y -= 98;
  const sign = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 240, y }, thickness: 0.7, color: ink }); text(label, x, y - 14, 10, reg, muted); };
  sign("Prepared by (Accounting)", M);
  sign("Noted by (Admin)", W - M - 240);
  finishPages(pdf, brand, control);
  return pdf.save();
}
