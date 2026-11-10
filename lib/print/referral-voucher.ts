import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DocumentControl } from "@/lib/document-controls";
import { pesosInWords } from "@/lib/amount-words";
import type { ReferralVoucherSnapshot } from "@/lib/referral-voucher";
import { FOOT, INK, LEGAL, MUTED, NAVY, SIDE, drawLetterhead, finishPages, fitText, loadBrand, newPage, safe } from "@/lib/print/letterhead";

/** Referral Voucher, Design 1 · Classic (owner, 10 Nov 2026), on the shared Corporate Two-Tone letterhead, legal paper. */
const peso = (c: number) => (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDay = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${iso}T00:00:00+08:00`));

export async function createReferralVoucherPdf(s: ReferralVoucherSnapshot, logoBytes?: Uint8Array, control?: DocumentControl | null, status?: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Referral Voucher ${s.number}`);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const brand = await loadBrand(pdf, logoBytes), { reg, bold } = brand;
  const rule = rgb(0.2, 0.2, 0.2), tint = rgb(0.99, 0.95, 0.9), label = rgb(0.96, 0.95, 0.91), white = rgb(1, 1, 1);
  const [W] = LEGAL, CW = W - 2 * SIDE;
  const cols = [{ label: "#", w: 28 }, { label: "Date Enrolled", w: 96 }, { label: "Trainee Name", w: 186 }, { label: "Course", w: CW - 28 - 96 - 186 - 100 }, { label: "Rebate", w: 100, r: true }];
  let page: PDFPage = newPage(pdf, brand);
  let y = 0;
  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = reg, color = INK) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, xr: number, yy: number, size: number, f: PDFFont = reg, color = INK) => { const v = safe(t); page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color }); };
  const box = (x: number, yy: number, w: number, h: number, fill?: ReturnType<typeof rgb>) => page.drawRectangle({ x, y: yy - h, width: w, height: h, borderColor: rule, borderWidth: 0.6, ...(fill ? { color: fill } : {}) });
  const tableHead = () => { let x = SIDE; for (const c of cols) { box(x, y, c.w, 20, NAVY); const lab = c.label.toUpperCase(); if (c.r) right(lab, x + c.w - 7, y - 13.5, 9, bold, white); else text(lab, x + 7, y - 13.5, 9, bold, white); x += c.w; } y -= 20; };
  y = drawLetterhead(page, brand, control, { title: "REFERRAL VOUCHER", right: s.number });
  // Referral details: two pairs per row.
  const pairs: [string, string][] = [["Referred By", s.partner], ["Voucher No.", s.number], ["Type", s.kind || "Agency"], ["Period", `${longDay(s.from)} - ${longDay(s.to)}`], ["Referral Code", s.referralCode ?? "-"], ["Trainees", String(s.rows.length)], ["Contact", s.contact ?? "-"], ["Date Issued", longDay(s.issuedOn)],
    // How the partner is paid (owner, 10 Nov 2026): set by the Cashier, approved by Accounting.
    ["Mode of Payment", s.mode ?? "-"], ["Status", status ?? "For Approval"], ["Payee Account", s.payeeAccount ?? "-"], ["Reference", s.reference ?? "-"]];
  const lw = 94, vw = CW / 2 - lw, rh = 20;
  for (let i = 0; i < pairs.length; i += 2) {
    [pairs[i], pairs[i + 1]].forEach(([k, v], j) => { const x = SIDE + j * (CW / 2); box(x, y, lw, rh, label); box(x + lw, y, vw, rh); text(k, x + 6, y - 13.5, 10, reg, MUTED); text(fitText(v, bold, 10.5, vw - 12), x + lw + 6, y - 13.5, 10.5, bold); });
    y -= rh;
  }
  y -= 14;
  tableHead();
  const row = (cells: string[]) => {
    const h = 19;
    if (y - h < FOOT + 20) { page = newPage(pdf, brand); y = drawLetterhead(page, brand, control, { title: "REFERRAL VOUCHER", cont: true }); tableHead(); }
    let x = SIDE;
    cells.forEach((v, i) => { const c = cols[i]; box(x, y, c.w, h); if (c.r) right(v, x + c.w - 7, y - 13, 10.5, reg); else text(fitText(v, reg, 10.5, c.w - 12), x + 7, y - 13, 10.5, reg); x += c.w; });
    y -= h;
  };
  s.rows.forEach((r, i) => row([String(i + 1), longDay(r.enrolledOn), r.trainee, r.courseCode ? `${r.courseCode}${r.course ? ` - ${r.course}` : ""}` : r.course, peso(r.rebateCentavos)]));
  // The total, the amount in words and both signatures stay together.
  if (y - 170 < FOOT) { page = newPage(pdf, brand); y = drawLetterhead(page, brand, control, { title: "REFERRAL VOUCHER", cont: true }); }
  const tw = CW - cols[4].w;
  box(SIDE, y, tw, 22, tint); box(SIDE + tw, y, cols[4].w, 22, tint);
  text(`TOTAL REBATE - ${s.rows.length} TRAINEE${s.rows.length === 1 ? "" : "S"}`, SIDE + 7, y - 15, 11, bold);
  right(`PHP ${peso(s.totalCentavos)}`, W - SIDE - 7, y - 15, 11.5, bold);
  y -= 38;
  text(fitText(`Amount in words: ${pesosInWords(s.totalCentavos)}`, reg, 10, CW), SIDE, y, 10, reg, MUTED);
  y -= 80;
  const sig = (title: string, name: string, role: string, x: number) => {
    const w = 230;
    text(title, x, y + 34, 10, reg, MUTED);
    if (name) text(fitText(name, bold, 11, w), x, y + 5, 11, bold);
    page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.7, color: INK });
    text(role, x, y - 13, 9, reg, MUTED);
    text("Date:", x, y - 36, 10, reg, MUTED);
    page.drawLine({ start: { x: x + 30, y: y - 37 }, end: { x: x + w, y: y - 37 }, thickness: 0.5, color: MUTED });
  };
  sig("Prepared By", s.preparedBy, "Accounting", SIDE);
  sig("Received By", "", "Partner Representative - Signature Over Printed Name", W - SIDE - 230);
  finishPages(pdf, brand, control);
  return pdf.save();
}
