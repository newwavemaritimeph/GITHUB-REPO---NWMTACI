import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { InvoiceSnapshot } from "@/lib/service-invoice";
import { drawControlBlock } from "@/lib/print/control-block";

/**
 * Service Invoice (owner, 5 Nov 2026; Company Charge Design 1), A4 portrait: New Wave header with the navy title bar,
 * the setup's Control No. and form details at the upper right, an Original for the company and a Duplicate for the file.
 */
const peso = (c: number) => (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/₱/g, "PHP ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function createServiceInvoicePdf(number: string, s: InvoiceSnapshot, logoBytes?: Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Service Invoice ${number}`);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (logoBytes) { try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; } }
  const navy = rgb(0.07, 0.25, 0.39), blue = rgb(0.02, 0.44, 0.82), orange = rgb(0.95, 0.34, 0.08), ink = rgb(0.07, 0.07, 0.07), muted = rgb(0.37, 0.44, 0.5), rule = rgb(0.73, 0.78, 0.83), tint = rgb(0.9, 0.96, 0.99), white = rgb(1, 1, 1);
  const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;
  const fit = (t: string, f: PDFFont, size: number, w: number) => { let v = safe(t); while (v.length > 1 && f.widthOfTextAtSize(v, size) > w) v = v.slice(0, -1); return v; };
  const cols = [{ label: "#", w: 24 }, { label: "Trainee", w: 226 }, { label: "Training", w: 170 }, { label: "Amount", w: CW - 420, r: true }];
  const control = { formNo: s.control?.formNo ?? "", revisionNo: s.control?.revisionNo ?? "", revisionDate: s.control?.revisionDate ?? "", issuedDate: s.control?.issuedDate ?? "" };

  const drawCopy = (copyLabel: string) => {
    let page: PDFPage = pdf.addPage([W, H]);
    let y = H - M;
    const text = (t: string, x: number, yy: number, size: number, f: PDFFont = reg, color = ink) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
    const right = (t: string, xr: number, yy: number, size: number, f: PDFFont = reg, color = ink) => { const v = safe(t); page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color }); };
    const head = (cont: boolean) => {
      if (logo) page.drawImage(logo, { x: M, y: y - 44, width: 44, height: 44 });
      const lx = M + (logo ? 52 : 0);
      text("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", lx, y - 12, 9.4, bold, navy);
      text("Ride the New Wave of Maritime Excellence", lx, y - 23, 8.2, reg, blue);
      text("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila", lx, y - 33, 7, reg, muted);
      text(`0948 847 6530 - newwavemaritime@gmail.com${s.tin ? ` - TIN ${s.tin}` : ""}`, lx, y - 42, 7, reg, muted);
      drawControlBlock(page, { reg, bold }, control, { right: W - M, top: y + 2, width: 118, labelWidth: 46, rowHeight: 10, size: 6.2, always: true, firstRows: [["Control No.", s.control?.controlNo ?? ""]] });
      y -= 60;
      page.drawRectangle({ x: M, y: y - 22, width: CW, height: 22, color: navy });
      page.drawRectangle({ x: M, y: y - 25, width: CW, height: 3, color: orange });
      text("SERVICE INVOICE", M + 10, y - 15.5, 11.5, bold, white);
      right(`SI NO. ${number}`, W - M - 10, y - 15.5, 10.5, bold, white);
      y -= 37;
      right(copyLabel, W - M, y + 4, 7, bold, orange);
      if (!cont) {
        const meta: [string, string, string, string][] = [["Bill To", s.billTo, "Date Paid", s.paidOn], ["BS No.", s.bsNumber, "Mode of Payment", s.method], ["Coverage", s.coverage, "Reference No.", s.reference || "None"]];
        y -= 10;
        for (const [a, b, c, d] of meta) {
          text(a, M, y, 8.5, reg, muted); text(fit(b, bold, 9, 190), M + 62, y, 9, bold);
          text(c, M + 280, y, 8.5, reg, muted); text(fit(d, bold, 9, CW - 372), M + 372, y, 9, bold);
          y -= 15;
        }
        y -= 4;
      }
      let x = M;
      for (const c of cols) { page.drawRectangle({ x, y: y - 18, width: c.w, height: 18, color: tint, borderColor: rule, borderWidth: 0.6 }); const lab = c.label.toUpperCase(); if (c.r) right(lab, x + c.w - 6, y - 12.5, 7.6, bold, navy); else text(lab, x + 5, y - 12.5, 7.6, bold, navy); x += c.w; }
      y -= 18;
    };
    head(false);
    s.rows.forEach((r, i) => {
      if (y - 16 < M + 110) { page = pdf.addPage([W, H]); y = H - M; head(true); }
      const cells = [String(i + 1), r.name, r.training, peso(r.amount)];
      let x = M;
      cells.forEach((v, n) => { const c = cols[n]; page.drawRectangle({ x, y: y - 16, width: c.w, height: 16, borderColor: rule, borderWidth: 0.6 }); if ((c as { r?: boolean }).r) right(v, x + c.w - 6, y - 11.2, 9); else text(fit(v, reg, 9, c.w - 10), x + 5, y - 11.2, 9); x += c.w; });
      y -= 16;
    });
    y -= 16;
    text("Total Amount", M, y, 11, bold);
    right(`PHP ${peso(s.total)}`, W - M, y, 11.5, bold);
    y -= 14;
    text(fit(s.words, reg, 8.6, CW), M, y, 8.6, reg, muted);
    y -= 52;
    const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 150, y }, thickness: 0.7, color: ink }); text(label, x + (150 - reg.widthOfTextAtSize(label, 8.5)) / 2, y - 11, 8.5, reg, muted); };
    sig("Prepared By", M); sig("Approved By", M + (CW - 150) / 2); sig("Received By", W - M - 150);
  };
  drawCopy("ORIGINAL COPY - COMPANY");
  drawCopy("DUPLICATE COPY - OFFICE FILE");
  const pages = pdf.getPages();
  pages.forEach((p, i) => { const v = `Page ${i + 1} of ${pages.length}`; p.drawText(v, { x: W - M - reg.widthOfTextAtSize(v, 7.5), y: M - 14, size: 7.5, font: reg, color: muted }); });
  return pdf.save();
}
