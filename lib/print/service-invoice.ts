import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { InvoiceSnapshot } from "@/lib/service-invoice";
import { FOOT, INK, LEGAL, MUTED, NAVY, ORANGE, RULE, SIDE, drawLetterhead, finishPages, fitText, loadBrand, newPage, safe } from "@/lib/print/letterhead";

/**
 * Service Invoice (owner, 5 Nov 2026; Company Charge Design 1) on the shared Corporate Two-Tone letterhead, legal
 * paper (10 Nov 2026): the setup's Control No. and form details at the upper right, an Original for the company
 * and a Duplicate for the file.
 */
const peso = (c: number) => (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function createServiceInvoicePdf(number: string, s: InvoiceSnapshot, logoBytes?: Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Service Invoice ${number}`);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const brand = await loadBrand(pdf, logoBytes), { reg, bold } = brand;
  const tint = rgb(0.9, 0.96, 0.99);
  const [W] = LEGAL, CW = W - 2 * SIDE;
  const cols = [{ label: "#", w: 28 }, { label: "Trainee", w: 236 }, { label: "Training", w: 186 }, { label: "Amount", w: CW - 450, r: true }];
  const control = { formNo: s.control?.formNo ?? "", revisionNo: s.control?.revisionNo ?? "", revisionDate: s.control?.revisionDate ?? "", issuedDate: s.control?.issuedDate ?? "" };
  const headOpts = { title: "SERVICE INVOICE", right: `SI NO. ${number}`, firstRows: [["Control No.", s.control?.controlNo ?? ""]] as [string, string][], extraLine: s.tin ? `TIN ${s.tin}` : undefined };

  const drawCopy = (copyLabel: string) => {
    let page: PDFPage = newPage(pdf, brand);
    let y = 0;
    const text = (t: string, x: number, yy: number, size: number, f: PDFFont = reg, color = INK) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
    const right = (t: string, xr: number, yy: number, size: number, f: PDFFont = reg, color = INK) => { const v = safe(t); page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color }); };
    const tableHead = () => {
      let x = SIDE;
      for (const c of cols) { page.drawRectangle({ x, y: y - 20, width: c.w, height: 20, color: tint, borderColor: RULE, borderWidth: 0.6 }); const lab = c.label.toUpperCase(); if (c.r) right(lab, x + c.w - 7, y - 13.5, 9, bold, NAVY); else text(lab, x + 7, y - 13.5, 9, bold, NAVY); x += c.w; }
      y -= 20;
    };
    y = drawLetterhead(page, brand, control, headOpts);
    right(copyLabel, W - SIDE, y + 6, 8.5, bold, ORANGE);
    const meta: [string, string, string, string][] = [["Bill To", s.billTo, "Date Paid", s.paidOn], ["BS No.", s.bsNumber, "Mode of Payment", s.method], ["Coverage", s.coverage, "Reference No.", s.reference || "None"]];
    y -= 10;
    for (const [a, b, c, d] of meta) {
      text(a, SIDE, y, 10, reg, MUTED); text(fitText(b, bold, 10.5, 210), SIDE + 74, y, 10.5, bold);
      text(c, SIDE + 300, y, 10, reg, MUTED); text(fitText(d, bold, 10.5, CW - 404), SIDE + 404, y, 10.5, bold);
      y -= 17;
    }
    y -= 6;
    tableHead();
    s.rows.forEach((r, i) => {
      if (y - 19 < FOOT + 20) { page = newPage(pdf, brand); y = drawLetterhead(page, brand, control, { title: "SERVICE INVOICE", cont: true }); tableHead(); }
      const cells = [String(i + 1), r.name, r.training, peso(r.amount)];
      let x = SIDE;
      cells.forEach((v, n) => { const c = cols[n]; page.drawRectangle({ x, y: y - 19, width: c.w, height: 19, borderColor: RULE, borderWidth: 0.6 }); if ((c as { r?: boolean }).r) right(v, x + c.w - 7, y - 13, 10.5); else text(fitText(v, reg, 10.5, c.w - 12), x + 7, y - 13, 10.5); x += c.w; });
      y -= 19;
    });
    // The total, the words and the signatures stay together.
    if (y - 130 < FOOT) { page = newPage(pdf, brand); y = drawLetterhead(page, brand, control, { title: "SERVICE INVOICE", cont: true }); }
    y -= 20;
    text("Total Amount", SIDE, y, 12.5, bold);
    right(`PHP ${peso(s.total)}`, W - SIDE, y, 13, bold);
    y -= 16;
    text(fitText(s.words, reg, 10, CW), SIDE, y, 10, reg, MUTED);
    y -= 62;
    const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 170, y }, thickness: 0.7, color: INK }); text(label, x + (170 - reg.widthOfTextAtSize(label, 10)) / 2, y - 13, 10, reg, MUTED); };
    sig("Prepared By", SIDE); sig("Approved By", SIDE + (CW - 170) / 2); sig("Received By", W - SIDE - 170);
  };
  drawCopy("ORIGINAL COPY - COMPANY");
  drawCopy("DUPLICATE COPY - OFFICE FILE");
  finishPages(pdf, brand, control);
  return pdf.save();
}
