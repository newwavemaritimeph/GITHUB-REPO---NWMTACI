import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { payStatus } from "@/lib/company-charges";

/**
 * Company Charge List — Statement of Account per agency or consultancy (owner, 22 Oct 2026):
 * referred trainees at the full training fee (rebate not taken off), payments, balance,
 * payment status and rebate status. A4 portrait on New Wave letterhead.
 */
export type ChargeRow = { name: string; number: string; course: string; training: string; fee: number; paid: number; rebate: number; rebateStatus: string };
export type CompanyStatement = { statementNo: string; company: string; kind: string; rule: string; periodLabel: string; printedOn: string; rows: ChargeRow[] };

const peso = (c: number) => `${c < 0 ? "-" : ""}${(Math.abs(c) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/₱/g, "PHP ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function createCompanyStatementPdf(statements: CompanyStatement[], logoBytes?: Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Company Charge List");
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (logoBytes) { try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; } }
  const navy = rgb(0.07, 0.25, 0.39), blue = rgb(0.02, 0.44, 0.82), orange = rgb(0.95, 0.34, 0.08), ink = rgb(0.06, 0.15, 0.22), muted = rgb(0.37, 0.44, 0.5), line = rgb(0.82, 0.87, 0.9), soft = rgb(0.95, 0.97, 0.98), head = rgb(0.9, 0.96, 0.99), green = rgb(0.04, 0.48, 0.24), amber = rgb(0.64, 0.28, 0.04), red = rgb(0.71, 0.14, 0.09);
  const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;
  const fit = (t: string, f: PDFFont, size: number, w: number) => { let s = safe(t); while (s.length > 1 && f.widthOfTextAtSize(s, size) > w) s = s.slice(0, -1); return s; };
  const text = (p: PDFPage, t: string, x: number, y: number, size: number, f: PDFFont = reg, color = ink) => p.drawText(safe(t), { x, y, size, font: f, color });
  const right = (p: PDFPage, t: string, xr: number, y: number, size: number, f: PDFFont = reg, color = ink) => { const v = safe(t); p.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y, size, font: f, color }); };
  // Columns: # | Trainee | Course | Training | Fee | Rebate | Status (payment, rebate status under it)
  const cols = [{ w: 18 }, { w: 140 }, { w: 66 }, { w: 64 }, { w: 64, r: true }, { w: 60, r: true }, { w: CW - 412 }];
  for (const s of statements) {
    let page = pdf.addPage([W, H]);
    let y = H - M;
    const letterhead = (cont: boolean) => {
      if (logo) page.drawImage(logo, { x: M, y: y - 42, width: 42, height: 42 });
      const lx = M + (logo ? 52 : 0);
      text(page, "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", lx, y - 13, 11.5, bold, navy);
      text(page, "Ride the New Wave of Maritime Excellence", lx, y - 25, 8.5, reg, blue);
      text(page, "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila - 0948 847 6530 - newwavemaritime@gmail.com", lx, y - 36, 7, reg, muted);
      y -= 50;
      page.drawRectangle({ x: M, y, width: CW, height: 2.2, color: navy });
      page.drawRectangle({ x: M, y: y - 1.4, width: CW * 0.28, height: 1.4, color: orange });
      y -= 26;
      text(page, "Company Charge List", M, y, 18, bold, ink);
      right(page, cont ? "continued" : `No. ${s.statementNo}`, W - M, y + 6, 8.5, bold, muted);
      right(page, s.printedOn, W - M, y - 5, 8.5, reg, muted);
      y -= 18;
      if (!cont) {
        const bh = 42, w3 = CW / 3;
        page.drawRectangle({ x: M, y: y - bh, width: CW, height: bh, color: soft, borderColor: line, borderWidth: 0.6 });
        ([["Charged To", s.company, s.kind], ["Period", s.periodLabel, "by training date"], ["Rebate Rule", s.rule, ""]] as [string, string, string][]).forEach(([k, v, sub], i) => {
          const x = M + i * w3;
          if (i) page.drawLine({ start: { x, y }, end: { x, y: y - bh }, thickness: 0.4, color: line });
          text(page, k.toUpperCase(), x + 8, y - 10, 6.3, bold, muted);
          text(page, fit(v, bold, 9.5, w3 - 16), x + 8, y - 22, 9.5, bold, ink);
          if (sub) text(page, fit(sub, reg, 7.5, w3 - 16), x + 8, y - 33, 7.5, reg, muted);
        });
        y -= bh + 14;
      }
      // Table head
      page.drawRectangle({ x: M, y: y - 16, width: CW, height: 16, color: head });
      let x = M;
      ["#", "Trainee", "Course", "Training", "Fee", "Rebate", "Status"].forEach((h, i) => { if (cols[i].r) right(page, h.toUpperCase(), x + cols[i].w - 5, y - 11, 6.8, bold, navy); else text(page, h.toUpperCase(), x + 5, y - 11, 6.8, bold, navy); x += cols[i].w; });
      y -= 16;
    };
    letterhead(false);
    s.rows.forEach((r, i) => {
      const rh = 26;
      if (y - rh < M + 150) { page = pdf.addPage([W, H]); y = H - M; letterhead(true); }
      if (i % 2) page.drawRectangle({ x: M, y: y - rh, width: CW, height: rh, color: soft });
      const status = payStatus(r);
      let x = M;
      const cells: [string, string?][] = [[String(i + 1)], [r.name, r.number], [r.course], [r.training], [peso(r.fee)], [r.rebate ? peso(r.rebate) : "-"], [status, r.rebateStatus === "None" ? "No rebate" : `Rebate ${r.rebateStatus.toLowerCase()}`]];
      cells.forEach(([main, sub], c) => {
        const w = cols[c].w, f = c === 1 || c === 6 ? bold : reg;
        const color = c === 6 ? (status === "Paid" ? green : status === "Partly Paid" ? amber : red) : c === 0 ? muted : ink;
        if (cols[c].r) right(page, main, x + w - 5, y - 11, 8.5, reg, ink);
        else text(page, fit(main, f, 8.5, w - 8), x + 5, y - 11, 8.5, f, color);
        if (sub) text(page, fit(sub, reg, 6.6, w - 8), x + 5, y - 21, 6.6, reg, muted);
        x += w;
      });
      page.drawLine({ start: { x: M, y: y - rh }, end: { x: M + CW, y: y - rh }, thickness: 0.4, color: line });
      y -= rh;
    });
    if (!s.rows.length) { text(page, "No referred trainees in this period.", M + 5, y - 14, 9, reg, muted); y -= 22; }
    // Amount due box
    const fee = s.rows.reduce((t, r) => t + r.fee, 0);
    const deducted = s.rows.filter((r) => r.rebateStatus === "Deducted").reduce((t, r) => t + r.rebate, 0), rebates = s.rows.reduce((t, r) => t + r.rebate, 0);
    y -= 14;
    const bw = 230, bx = W - M - bw, bh = 82;
    page.drawRectangle({ x: bx, y: y - bh, width: bw, height: bh, borderColor: navy, borderWidth: 1.4, color: rgb(1, 1, 1) });
    const line2 = (k: string, v: string, yy: number, f: PDFFont = reg, size = 9, color = ink) => { text(page, k, bx + 10, yy, size, f, color); right(page, v, bx + bw - 10, yy, size, f, color); };
    line2(`Trainees`, String(s.rows.length), y - 15);
    line2("Total Rebates", peso(rebates), y - 29);
    page.drawLine({ start: { x: bx + 10, y: y - 36 }, end: { x: bx + bw - 10, y: y - 36 }, thickness: 0.8, color: navy });
    line2("Total Fees", `PHP ${peso(fee)}`, y - 52, bold, 12, navy);
    line2(`Rebates deducted ${peso(deducted)} - not deducted ${peso(rebates - deducted)}`, "", y - 70, reg, 7.5, muted);
    y -= bh + 46;
    const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 200, y }, thickness: 0.7, color: ink }); text(page, label, x, y - 12, 8.5, reg, muted); };
    sig("Prepared by (Accounting)", M);
    sig("Noted by (Admin)", W - M - 200);
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => right(p, `Page ${i + 1} of ${pages.length}`, W - M, M - 14, 7.5, reg, muted));
  return pdf.save();
}
