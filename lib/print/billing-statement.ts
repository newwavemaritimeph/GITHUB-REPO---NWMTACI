import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BillingStatement } from "@/lib/billing-statement";

/** Billing Statement (owner, 22 Oct 2026), A4 portrait on New Wave letterhead. */
const peso = (c: number) => (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/₱/g, "PHP ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

/**
 * The company's payment of a statement (owner, 29 Oct 2026), printed on the same template:
 * titled Acknowledgement Receipt, with the payment box, and an Original and Duplicate copy.
 */
export type StatementReceipt = { method: string; reference: string | null; receivedOn: string; amount: number; words: string; cashier: string };

export async function createBillingStatementPdf(s: BillingStatement, logoBytes?: Uint8Array, receipt?: StatementReceipt) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${receipt ? "Acknowledgement Receipt" : "Billing Statement"} ${s.bsNumber}`);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (logoBytes) { try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; } }
  const navy = rgb(0.07, 0.25, 0.39), blue = rgb(0.02, 0.44, 0.82), orange = rgb(0.95, 0.34, 0.08), ink = rgb(0.07, 0.07, 0.07), muted = rgb(0.37, 0.44, 0.5), rule = rgb(0.2, 0.2, 0.2), tint = rgb(0.99, 0.95, 0.9), good = rgb(0.04, 0.48, 0.24);
  const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;
  const fit = (t: string, f: PDFFont, size: number, w: number) => { let v = safe(t); while (v.length > 1 && f.widthOfTextAtSize(v, size) > w) v = v.slice(0, -1); return v; };
  const cols = [{ label: "Date Enrolled", w: 112 }, { label: "Name", w: 160 }, { label: "Training", w: 82 }, { label: "Status", w: 82 }, { label: "Amount", w: CW - 436, r: true }];
  const title = receipt ? "Acknowledgement Receipt" : "Billing Statement";

  // One copy of the document (a receipt prints an Original and a Duplicate).
  const drawCopy = (copyLabel: string | null) => {
    let page: PDFPage = pdf.addPage([W, H]);
    let y = H - M;
    const text = (t: string, x: number, yy: number, size: number, f: PDFFont = reg, color = ink) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
    const right = (t: string, xr: number, yy: number, size: number, f: PDFFont = reg, color = ink) => { const v = safe(t); page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color }); };
    const box = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => page.drawRectangle({ x, y: yy - h, width: w, height: h, borderColor: rule, borderWidth: 0.7, ...(fill ? { color: fill } : {}) });
    const letterhead = (cont: boolean) => {
      if (logo) page.drawImage(logo, { x: M, y: y - 42, width: 42, height: 42 });
      const lx = M + (logo ? 52 : 0);
      text("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", lx, y - 13, 9.6, bold, navy);
      text("Ride the New Wave of Maritime Excellence", lx, y - 25, 8.5, reg, blue);
      text("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila", lx, y - 35, 7, reg, muted);
      text("0948 847 6530 - newwavemaritime@gmail.com", lx, y - 44, 7, reg, muted);
      // Form block (owner, 22 Oct 2026): the form's own control details.
      ([["Form No:", "NW-FMGR-04-24"], ["Revision No:", ""], ["Revision Date:", ""], ["Issued Date:", "12/03/2025"]] as [string, string][]).forEach(([k, v], i) => {
        const yy = y - 10 - i * 9.5;
        right(k, W - M - 62, yy, 6.6, bold, muted);
        text(v, W - M - 59, yy, 6.6, reg, ink);
      });
      page.drawRectangle({ x: W - M - 112, y: y - 44, width: 112, height: 42, borderColor: rgb(0.75, 0.8, 0.84), borderWidth: 0.6 });
      y -= 54;
      page.drawRectangle({ x: M, y, width: CW, height: 2.2, color: navy });
      page.drawRectangle({ x: M, y: y - 1.4, width: CW * 0.28, height: 1.4, color: orange });
      if (copyLabel) right(copyLabel, W - M, y - 10, 7, bold, orange);
      y -= 26;
      text(title, M, y, 18, bold, ink);
      right(cont ? "continued" : `${receipt ? `BS No. ${s.bsNumber} - ` : ""}Date: ${receipt ? receipt.receivedOn : s.date}`, W - M, y + 2, 9.5, reg, ink);
      y -= 26;
      if (!cont) {
        const lw = 110, rh = 18;
        const lines: [string, string, boolean][] = [[receipt ? "Received from:" : "Bill to:", s.billTo, true], ["Billing Coverage:", s.coverage, false]];
        if (receipt) lines.push(["Payment:", `${receipt.method}${receipt.reference ? ` - Ref. ${receipt.reference}` : ""}`, false], ["Amount Received:", `PHP ${peso(receipt.amount)} - ${receipt.words}`, true]);
        lines.forEach(([k, v, b]) => {
          box(M, y, lw, rh); box(M + lw, y, CW - lw, rh);
          text(k, M + 6, y - 12.5, 9.5); text(fit(v, b ? bold : reg, 9.5, CW - lw - 12), M + lw + 6, y - 12.5, 9.5, b ? bold : reg);
          y -= rh;
        });
        y -= 12;
      }
      let x = M;
      for (const c of cols) { box(x, y, c.w, 18, orange); const lab = c.label.toUpperCase(); if (c.r) right(lab, x + c.w - 6, y - 12.5, 8, bold, rgb(1, 1, 1)); else text(lab, x + 6, y - 12.5, 8, bold, rgb(1, 1, 1)); x += c.w; }
      y -= 18;
    };
    letterhead(false);
    const row = (cells: string[], f: PDFFont = reg, fill?: ReturnType<typeof rgb>) => {
      const rh = 16;
      if (y - rh < M + 90) { page = pdf.addPage([W, H]); y = H - M; letterhead(true); }
      let x = M;
      cells.forEach((v, i) => { const c = cols[i]; if (c) { box(x, y, c.w, rh, fill); if (c.r) right(v, x + c.w - 6, y - 11.5, 9, f); else text(fit(v, f, 9, c.w - 10), x + 6, y - 11.5, 9, f); x += c.w; } });
      y -= rh;
    };
    for (const r of s.rows) row([r.enrolled, r.name, r.training, r.status.toUpperCase(), peso(r.amount)]);
    if (!s.rows.length) row(["", "No enrollments in this coverage", "", "", ""]);
    // Total spans the first four columns.
    if (y - 18 < M + 90) { page = pdf.addPage([W, H]); y = H - M; letterhead(true); }
    const tw = CW - cols[4].w;
    box(M, y, tw, 18, tint); box(M + tw, y, cols[4].w, 18, tint);
    text(`TOTAL ${receipt ? "PAID" : ""} - ${s.rows.length} ENROLLMENT${s.rows.length === 1 ? "" : "S"}`.replace("  ", " "), M + 6, y - 12.5, 9.5, bold);
    right(peso(s.total), W - M - 6, y - 12.5, 10, bold);
    if (receipt) { y -= 42; text("PAID", M, y, 16, bold, good); text("Thank you. This acknowledges the payment above for the trainees listed.", M + 46, y + 3, 8.5, reg, muted); }
    y -= receipt ? 44 : 64;
    const sig = (label: string, name: string, x: number) => { text(label, x, y + 24, 9, reg, muted); page.drawLine({ start: { x, y }, end: { x: x + 150, y }, thickness: 0.7, color: ink }); const size = reg.widthOfTextAtSize(safe(name), 8.5) > 150 ? 7 : 8.5; text(fit(name, reg, size, 150), x, y - 12, size, reg, muted); };
    if (receipt) { sig("Received by:", receipt.cashier || "Cashier", M); sig("Noted by:", "Accounting", M + (CW - 150) / 2); sig("Paid by:", s.billTo, W - M - 150); }
    else { sig("Prepared by:", "Accounting", M); sig("Noted by:", "Admin", M + (CW - 150) / 2); sig("Received by:", s.billTo, W - M - 150); }
  };
  if (receipt) { drawCopy("ORIGINAL COPY - COMPANY"); drawCopy("DUPLICATE COPY - OFFICE FILE"); } else drawCopy(null);
  const pages = pdf.getPages();
  pages.forEach((p, i) => { const v = `Page ${i + 1} of ${pages.length}`; p.drawText(v, { x: W - M - reg.widthOfTextAtSize(v, 7.5), y: M - 14, size: 7.5, font: reg, color: muted }); });
  return pdf.save();
}
