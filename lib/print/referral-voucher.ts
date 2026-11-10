import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DocumentControl } from "@/lib/document-controls";
import { drawControlBlock } from "@/lib/print/control-block";
import { pesosInWords } from "@/lib/amount-words";
import type { ReferralVoucherSnapshot } from "@/lib/referral-voucher";

/** Referral Voucher, Design 1 · Classic (owner, 10 Nov 2026), A4 portrait on New Wave letterhead, like the Billing Statement. */
const peso = (c: number) => (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/₱/g, "PHP ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const longDay = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${iso}T00:00:00+08:00`));

export async function createReferralVoucherPdf(s: ReferralVoucherSnapshot, logoBytes?: Uint8Array, control?: DocumentControl | null) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Referral Voucher ${s.number}`);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (logoBytes) { try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; } }
  const navy = rgb(0.07, 0.25, 0.39), blue = rgb(0.02, 0.44, 0.82), orange = rgb(0.95, 0.34, 0.08), ink = rgb(0.07, 0.07, 0.07), muted = rgb(0.37, 0.44, 0.5), rule = rgb(0.2, 0.2, 0.2), tint = rgb(0.99, 0.95, 0.9), label = rgb(0.96, 0.95, 0.91), white = rgb(1, 1, 1);
  const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;
  const fit = (t: string, f: PDFFont, size: number, w: number) => { let v = safe(t); while (v.length > 1 && f.widthOfTextAtSize(v, size) > w) v = v.slice(0, -1); return v; };
  const cols = [{ label: "#", w: 26 }, { label: "Date Enrolled", w: 90 }, { label: "Trainee Name", w: 190 }, { label: "Course", w: CW - 26 - 90 - 190 - 96 }, { label: "Rebate", w: 96, r: true }];
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = reg, color = ink) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, xr: number, yy: number, size: number, f: PDFFont = reg, color = ink) => { const v = safe(t); page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color }); };
  const box = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => page.drawRectangle({ x, y: yy - h, width: w, height: h, borderColor: rule, borderWidth: 0.6, ...(fill ? { color: fill } : {}) });

  const letterhead = (cont: boolean) => {
    if (logo) page.drawImage(logo, { x: M, y: y - 42, width: 42, height: 42 });
    const lx = M + (logo ? 52 : 0);
    text("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", lx, y - 13, 9.6, bold, navy);
    text("Ride the New Wave of Maritime Excellence", lx, y - 25, 8.5, reg, blue);
    text("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila", lx, y - 35, 7, reg, muted);
    text("0948 847 6530 - newwavemaritime@gmail.com", lx, y - 44, 7, reg, muted);
    drawControlBlock(page, { reg, bold }, control, { right: W - M, top: y - 2, width: 125, rowHeight: 10.5, size: 6.4 });
    y -= 54;
    page.drawRectangle({ x: M, y, width: CW, height: 2.2, color: navy });
    page.drawRectangle({ x: M, y: y - 1.4, width: CW * 0.28, height: 1.4, color: orange });
    y -= 26;
    text("REFERRAL VOUCHER", M, y, 17, bold, navy);
    right(cont ? `${s.number} - continued` : s.number, W - M, y + 1, 12, bold, orange);
    y -= 18;
    if (!cont) {
      // Referral details: two pairs per row.
      const pairs: [string, string][] = [["Referred By", s.partner], ["Voucher No.", s.number], ["Type", s.kind || "Agency"], ["Period", `${longDay(s.from)} - ${longDay(s.to)}`], ["Referral Code", s.referralCode ?? "-"], ["Trainees", String(s.rows.length)], ["Contact", s.contact ?? "-"], ["Date Issued", longDay(s.issuedOn)]];
      const lw = 82, vw = CW / 2 - lw, rh = 17;
      for (let i = 0; i < pairs.length; i += 2) {
        [pairs[i], pairs[i + 1]].forEach(([k, v], j) => { const x = M + j * (CW / 2); box(x, y, lw, rh, label); box(x + lw, y, vw, rh); text(k, x + 5, y - 11.5, 8.5, reg, muted); text(fit(v, bold, 9, vw - 10), x + lw + 5, y - 11.5, 9, bold); });
        y -= rh;
      }
      y -= 12;
    }
    let x = M;
    for (const c of cols) { box(x, y, c.w, 17, navy); const lab = c.label.toUpperCase(); if (c.r) right(lab, x + c.w - 6, y - 11.5, 8, bold, white); else text(lab, x + 6, y - 11.5, 8, bold, white); x += c.w; }
    y -= 17;
  };
  letterhead(false);
  const row = (cells: string[], f: PDFFont = reg) => {
    const rh = 16;
    if (y - rh < M + 120) { page = pdf.addPage([W, H]); y = H - M; letterhead(true); }
    let x = M;
    cells.forEach((v, i) => { const c = cols[i]; box(x, y, c.w, rh); if (c.r) right(v, x + c.w - 6, y - 11, 9, f); else text(fit(v, f, 9, c.w - 10), x + 6, y - 11, 9, f); x += c.w; });
    y -= rh;
  };
  s.rows.forEach((r, i) => row([String(i + 1), longDay(r.enrolledOn), r.trainee, r.courseCode ? `${r.courseCode}${r.course ? ` - ${r.course}` : ""}` : r.course, peso(r.rebateCentavos)]));
  if (y - 60 < M + 90) { page = pdf.addPage([W, H]); y = H - M; letterhead(true); }
  const tw = CW - cols[4].w;
  box(M, y, tw, 19, tint); box(M + tw, y, cols[4].w, 19, tint);
  text(`TOTAL REBATE - ${s.rows.length} TRAINEE${s.rows.length === 1 ? "" : "S"}`, M + 6, y - 13, 9.5, bold);
  right(`PHP ${peso(s.totalCentavos)}`, W - M - 6, y - 13, 10, bold);
  y -= 32;
  text(fit(`Amount in words: ${pesosInWords(s.totalCentavos)}`, reg, 8.5, CW), M, y, 8.5, reg, muted);
  // Prepared By and Received By, each with a date line.
  y -= 70;
  const sig = (title: string, name: string, role: string, x: number) => {
    const w = 200;
    text(title, x, y + 30, 9, reg, muted);
    if (name) text(fit(name, bold, 9.5, w), x, y + 4, 9.5, bold);
    page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.7, color: ink });
    text(role, x, y - 11, 8, reg, muted);
    text("Date:", x, y - 32, 8.5, reg, muted);
    page.drawLine({ start: { x: x + 26, y: y - 33 }, end: { x: x + w, y: y - 33 }, thickness: 0.5, color: muted });
  };
  sig("Prepared By", s.preparedBy, "Accounting", M);
  sig("Received By", "", "Partner Representative - Signature Over Printed Name", W - M - 200);
  const pages = pdf.getPages();
  pages.forEach((p, i) => { const v = `Page ${i + 1} of ${pages.length}`; p.drawText(v, { x: W - M - reg.widthOfTextAtSize(v, 7.5), y: M - 14, size: 7.5, font: reg, color: muted }); });
  return pdf.save();
}
