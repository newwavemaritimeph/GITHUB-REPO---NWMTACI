import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BatchRoster } from "@/lib/batch-roster";
import type { DocumentControl } from "@/lib/document-controls";
import { FOOT, INK, LEGAL_LANDSCAPE, MUTED, NAVY, SIDE, drawLetterhead, finishPages, fitText, loadBrand, newPage, safe } from "@/lib/print/letterhead";

/** Batch trainee list (owner, 3 Nov 2026) on the shared Corporate Two-Tone letterhead, legal landscape (10 Nov 2026). */
const longDate = (d: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const peso = (c: number) => `PHP ${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hhmm = (t: string | null) => (t ? new Date(`2000-01-01T${t.slice(0, 5)}:00`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");

export async function createBatchRosterPdf(r: BatchRoster, opts: { logo?: Uint8Array; preparedBy?: string | null; control?: DocumentControl | null } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Batch ${r.batch.batchNumber} - Trainee List`);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const brand = await loadBrand(pdf, opts.logo), { reg, bold } = brand;
  const rule = rgb(0.75, 0.8, 0.84), head = rgb(0.9, 0.96, 0.99), zebra = rgb(0.97, 0.98, 0.99);
  const [W] = LEGAL_LANDSCAPE, CW = W - 2 * SIDE;
  // Payment takes what is left of the width.
  const cols: { label: string; w: number; r?: boolean }[] = [{ label: "#", w: 27 }, { label: "Trainee", w: 190 }, { label: "NWMTACI No.", w: 104 }, { label: "SRN", w: 84 }, { label: "Rank", w: 86 }, { label: "Mobile", w: 92 }, { label: "Source", w: 132 }, { label: "Status", w: 66 }, { label: "Payment", w: CW - 831 }, { label: "Req.", w: 50, r: true }];
  let page: PDFPage = newPage(pdf, brand, LEGAL_LANDSCAPE); let y = 0;
  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = reg, color = INK) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const header = (cont: boolean) => {
    y = drawLetterhead(page, brand, opts.control, { title: cont ? `TRAINEE LIST - ${r.batch.batchNumber}` : "TRAINEE LIST", right: cont ? undefined : `Batch ${r.batch.batchNumber}`, cont });
    if (!cont) {
      const b = r.batch, enrolled = r.rows.filter((x) => x.status !== "Pending").length, pending = r.rows.length - enrolled;
      // The course name is long, so it gets a full line of its own.
      text("Course:", SIDE, y, 10, bold, MUTED); text(fitText(`${b.code} - ${b.course}`, reg, 10, CW - 74), SIDE + 74, y, 10);
      y -= 15;
      const items: [string, string][] = [["Batch", b.batchNumber], ["Dates", b.startsOn === b.endsOn ? longDate(b.startsOn) : `${longDate(b.startsOn)} - ${longDate(b.endsOn)}`], ["Time", [hhmm(b.dailyStart), hhmm(b.dailyEnd)].filter(Boolean).join(" - ") || "8:00 AM - 5:00 PM"], ["Room", b.room ?? "To be assigned"], ["Instructor", b.instructor ?? "To be assigned"], ["Trainees", `${enrolled} enrolled - ${pending} pending - ${Math.max(0, b.capacity - b.held)} slots left of ${b.capacity}`]];
      items.forEach(([k, v], i) => { const col = i % 2, row = Math.floor(i / 2), x = SIDE + col * (CW / 2), yy = y - row * 15; text(`${k}:`, x, yy, 10, bold, MUTED); text(fitText(v, reg, 10, CW / 2 - 84), x + 74, yy, 10); });
      y -= Math.ceil(items.length / 2) * 15 + 4;
    }
    let x = SIDE;
    page.drawRectangle({ x: SIDE, y: y - 19, width: CW, height: 19, color: head });
    for (const c of cols) { const lab = c.label.toUpperCase(); if (c.r) text(lab, x + c.w - 5 - bold.widthOfTextAtSize(lab, 9), y - 13, 9, bold, NAVY); else text(lab, x + 5, y - 13, 9, bold, NAVY); x += c.w; }
    y -= 19;
  };
  header(false);
  r.rows.forEach((row, i) => {
    if (y - 18 < FOOT + 20) { page = newPage(pdf, brand, LEGAL_LANDSCAPE); header(true); }
    if (i % 2) page.drawRectangle({ x: SIDE, y: y - 18, width: CW, height: 18, color: zebra });
    const pay = row.payment === "Balance" ? `Balance ${peso(row.balanceCentavos)}` : row.payment;
    const cells = [String(i + 1), row.name, row.nwmtaciNo, row.srn, row.rank, row.mobile, row.source, row.status, pay, `${row.requirements} of 4`];
    let x = SIDE;
    cells.forEach((v, k) => { const c = cols[k]; const f = k === 1 ? bold : reg; const t = fitText(v, f, 10, c.w - 10); if (c.r) text(t, x + c.w - 5 - f.widthOfTextAtSize(t, 10), y - 12.5, 10, f); else text(t, x + 5, y - 12.5, 10, f); x += c.w; });
    page.drawLine({ start: { x: SIDE, y: y - 18 }, end: { x: SIDE + CW, y: y - 18 }, thickness: 0.4, color: rule });
    y -= 18;
  });
  if (!r.rows.length) { text("No trainees on this batch yet.", SIDE + 5, y - 14, 10.5, reg, MUTED); y -= 22; }
  if (y - 70 < FOOT) { page = newPage(pdf, brand, LEGAL_LANDSCAPE); y = drawLetterhead(page, brand, opts.control, { title: `TRAINEE LIST - ${r.batch.batchNumber}`, cont: true }); }
  y -= 50;
  const sig = (label: string, name: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 220, y }, thickness: 0.7, color: INK }); text(name, x, y + 5, 10.5, bold); text(label, x, y - 13, 9.5, reg, MUTED); };
  sig("Prepared by", opts.preparedBy ?? "", SIDE); sig("Noted by · Admin", "", SIDE + 320);
  finishPages(pdf, brand, opts.control);
  return pdf.save();
}
