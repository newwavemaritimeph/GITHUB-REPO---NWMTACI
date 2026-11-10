import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BillingStatement } from "@/lib/billing-statement";
import type { DocumentControl } from "@/lib/document-controls";
import { FOOT, INK, LEGAL, MUTED, ORANGE, SIDE, drawLetterhead, finishPages, fitText, loadBrand, newPage, safe } from "@/lib/print/letterhead";

/** Billing Statement (owner, 22 Oct 2026) on the shared Corporate Two-Tone letterhead, legal paper (10 Nov 2026). */
const peso = (c: number) => (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The company's payment of a statement (owner, 29 Oct 2026), printed on the same template:
 * titled Acknowledgement Receipt, with the payment box, and an Original and Duplicate copy.
 */
export type StatementReceipt = { method: string; reference: string | null; receivedOn: string; amount: number; words: string; cashier: string };

export async function createBillingStatementPdf(s: BillingStatement, logoBytes?: Uint8Array, receipt?: StatementReceipt, control?: DocumentControl | null) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${receipt ? "Acknowledgement Receipt" : "Billing Statement"} ${s.bsNumber}`);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const brand = await loadBrand(pdf, logoBytes), { reg, bold } = brand;
  const rule = rgb(0.2, 0.2, 0.2), tint = rgb(0.99, 0.95, 0.9), good = rgb(0.04, 0.48, 0.24), white = rgb(1, 1, 1);
  const [W] = LEGAL, CW = W - 2 * SIDE;
  const cols = [{ label: "Date Enrolled", w: 116 }, { label: "Name", w: 186 }, { label: "Training", w: 96 }, { label: "Status", w: 92 }, { label: "Amount", w: CW - 490, r: true }];
  const title = receipt ? "ACKNOWLEDGEMENT RECEIPT" : "BILLING STATEMENT";

  // One copy of the document (a receipt prints an Original and a Duplicate).
  const drawCopy = (copyLabel: string | null) => {
    let page: PDFPage = newPage(pdf, brand);
    let y = 0;
    const text = (t: string, x: number, yy: number, size: number, f: PDFFont = reg, color = INK) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
    const right = (t: string, xr: number, yy: number, size: number, f: PDFFont = reg, color = INK) => { const v = safe(t); page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color }); };
    const box = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => page.drawRectangle({ x, y: yy - h, width: w, height: h, borderColor: rule, borderWidth: 0.7, ...(fill ? { color: fill } : {}) });
    const tableHead = () => { let x = SIDE; for (const c of cols) { box(x, y, c.w, 20, ORANGE); const lab = c.label.toUpperCase(); if (c.r) right(lab, x + c.w - 7, y - 13.5, 9, bold, white); else text(lab, x + 7, y - 13.5, 9, bold, white); x += c.w; } y -= 20; };
    const head = (cont: boolean) => {
      y = drawLetterhead(page, brand, control, { title, right: cont ? undefined : `${receipt ? `BS No. ${s.bsNumber} - ` : ""}Date: ${receipt ? receipt.receivedOn : s.date}`, cont });
      if (copyLabel && !cont) right(copyLabel, W - SIDE, y + 6, 8.5, bold, ORANGE);
      if (!cont) {
        const lw = 124, rh = 21;
        const lines: [string, string, boolean][] = [[receipt ? "Received from:" : "Bill to:", s.billTo, true], ["Billing Coverage:", s.coverage, false]];
        if (receipt) lines.push(["Payment:", `${receipt.method}${receipt.reference ? ` - Ref. ${receipt.reference}` : ""}`, false], ["Amount Received:", `PHP ${peso(receipt.amount)} - ${receipt.words}`, true]);
        lines.forEach(([k, v, b]) => {
          box(SIDE, y, lw, rh); box(SIDE + lw, y, CW - lw, rh);
          text(k, SIDE + 7, y - 14.5, 10.5); text(fitText(v, b ? bold : reg, 10.5, CW - lw - 14), SIDE + lw + 7, y - 14.5, 10.5, b ? bold : reg);
          y -= rh;
        });
        y -= 14;
      }
      tableHead();
    };
    head(false);
    const row = (cells: string[], f: PDFFont = reg, fill?: ReturnType<typeof rgb>) => {
      const rh = 19;
      if (y - rh < FOOT + 20) { page = newPage(pdf, brand); head(true); }
      let x = SIDE;
      cells.forEach((v, i) => { const c = cols[i]; if (c) { box(x, y, c.w, rh, fill); if (c.r) right(v, x + c.w - 7, y - 13, 10.5, f); else text(fitText(v, f, 10.5, c.w - 12), x + 7, y - 13, 10.5, f); x += c.w; } });
      y -= rh;
    };
    for (const r of s.rows) row([r.enrolled, r.name, r.training, r.status.toUpperCase(), peso(r.amount)]);
    if (!s.rows.length) row(["", "No enrollments in this coverage", "", "", ""]);
    // The total, the PAID mark and the signatures stay together.
    if (y - 150 < FOOT) { page = newPage(pdf, brand); head(true); }
    const tw = CW - cols[4].w;
    box(SIDE, y, tw, 22, tint); box(SIDE + tw, y, cols[4].w, 22, tint);
    text(`TOTAL ${receipt ? "PAID" : ""} - ${s.rows.length} ENROLLMENT${s.rows.length === 1 ? "" : "S"}`.replace("  ", " "), SIDE + 7, y - 15, 11, bold);
    right(peso(s.total), W - SIDE - 7, y - 15, 11.5, bold);
    if (receipt) { y -= 48; text("PAID", SIDE, y, 18, bold, good); text("Thank you. This acknowledges the payment above for the trainees listed.", SIDE + 54, y + 4, 10, reg, MUTED); }
    y -= receipt ? 50 : 76;
    const sig = (label: string, name: string, x: number) => { text(label, x, y + 28, 10, reg, MUTED); page.drawLine({ start: { x, y }, end: { x: x + 170, y }, thickness: 0.7, color: INK }); const size = reg.widthOfTextAtSize(safe(name), 10) > 170 ? 8.5 : 10; text(fitText(name, reg, size, 170), x, y - 14, size, reg, MUTED); };
    if (receipt) { sig("Received by:", receipt.cashier || "Cashier", SIDE); sig("Noted by:", "Accounting", SIDE + (CW - 170) / 2); sig("Paid by:", s.billTo, W - SIDE - 170); }
    else { sig("Prepared by:", "Accounting", SIDE); sig("Noted by:", "Admin", SIDE + (CW - 170) / 2); sig("Received by:", s.billTo, W - SIDE - 170); }
  };
  if (receipt) { drawCopy("ORIGINAL COPY - COMPANY"); drawCopy("DUPLICATE COPY - OFFICE FILE"); } else drawCopy(null);
  finishPages(pdf, brand, control);
  return pdf.save();
}
