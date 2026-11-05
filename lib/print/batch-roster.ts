import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BatchRoster } from "@/lib/batch-roster";
import type { DocumentControl } from "@/lib/document-controls";
import { drawControlBlock } from "@/lib/print/control-block";

/** Batch trainee list (owner, 3 Nov 2026): A4 landscape, letterhead, batch box, numbered list, signatures. */
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/₱/g, "PHP ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const longDate = (d: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const peso = (c: number) => `PHP ${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hhmm = (t: string | null) => (t ? new Date(`2000-01-01T${t.slice(0, 5)}:00`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");

export async function createBatchRosterPdf(r: BatchRoster, opts: { logo?: Uint8Array; preparedBy?: string | null; control?: DocumentControl | null } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Batch ${r.batch.batchNumber} - Trainee List`);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (opts.logo) { try { logo = await pdf.embedPng(opts.logo); } catch { logo = null; } }
  const navy = rgb(0.07, 0.25, 0.39), blue = rgb(0.02, 0.44, 0.82), orange = rgb(0.95, 0.34, 0.08), ink = rgb(0.06, 0.15, 0.22), muted = rgb(0.37, 0.44, 0.5), rule = rgb(0.75, 0.8, 0.84), head = rgb(0.9, 0.96, 0.99), zebra = rgb(0.97, 0.98, 0.99);
  const W = 841.89, H = 595.28, M = 32, CW = W - 2 * M;
  // Payment takes what is left of the width (about 100 pt).
  const cols: { label: string; w: number; r?: boolean }[] = [{ label: "#", w: 22 }, { label: "Trainee", w: 150 }, { label: "NWMTACI No.", w: 84 }, { label: "SRN", w: 70 }, { label: "Rank", w: 70 }, { label: "Mobile", w: 76 }, { label: "Source", w: 110 }, { label: "Status", w: 54 }, { label: "Payment", w: CW - 676 }, { label: "Req.", w: 40, r: true }];
  const fit = (t: string, f: PDFFont, size: number, w: number) => { let v = safe(t); while (v.length > 1 && f.widthOfTextAtSize(v, size) > w) v = v.slice(0, -1); return v; };
  let page: PDFPage = pdf.addPage([W, H]); let y = H - M;
  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = reg, color = ink) => page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const header = (cont: boolean) => {
    if (logo) page.drawImage(logo, { x: M, y: y - 36, width: 36, height: 36 });
    const lx = M + (logo ? 44 : 0);
    text("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", lx, y - 12, 10, bold, navy);
    text("Ride the New Wave of Maritime Excellence", lx, y - 24, 8.5, reg, blue);
    text("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila - 0948 847 6530", lx, y - 34, 7.5, reg, muted);
    drawControlBlock(page, { reg, bold }, opts.control, { right: W - M, top: y, width: 125, rowHeight: 9.5 });
    y -= 46;
    page.drawRectangle({ x: M, y, width: CW, height: 2, color: navy }); page.drawRectangle({ x: M, y: y - 1.4, width: CW * 0.25, height: 1.4, color: orange });
    y -= 20;
    text(cont ? `Trainee List - ${r.batch.batchNumber} (continued)` : "Trainee List", M, y, 15, bold, ink);
    if (!cont) {
      y -= 18;
      const b = r.batch, enrolled = r.rows.filter((x) => x.status !== "Pending").length, pending = r.rows.length - enrolled;
      // The course name is long, so it gets a full line of its own.
      text("Course:", M, y, 8.5, bold, muted); text(fit(`${b.code} - ${b.course}`, reg, 8.5, CW - 62), M + 62, y, 8.5);
      y -= 13;
      const items: [string, string][] = [["Batch", b.batchNumber], ["Dates", b.startsOn === b.endsOn ? longDate(b.startsOn) : `${longDate(b.startsOn)} - ${longDate(b.endsOn)}`], ["Time", [hhmm(b.dailyStart), hhmm(b.dailyEnd)].filter(Boolean).join(" - ") || "8:00 AM - 5:00 PM"], ["Room", b.room ?? "To be assigned"], ["Instructor", b.instructor ?? "To be assigned"], ["Trainees", `${enrolled} enrolled - ${pending} pending - ${Math.max(0, b.capacity - b.held)} slots left of ${b.capacity}`]];
      items.forEach(([k, v], i) => { const col = i % 2, row = Math.floor(i / 2), x = M + col * (CW / 2), yy = y - row * 13; text(`${k}:`, x, yy, 8.5, bold, muted); text(fit(v, reg, 8.5, CW / 2 - 70), x + 62, yy, 8.5); });
      y -= Math.ceil(items.length / 2) * 13 + 6;
    } else y -= 10;
    let x = M;
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 16, color: head });
    for (const c of cols) { const lab = c.label.toUpperCase(); if (c.r) text(lab, x + c.w - 4 - bold.widthOfTextAtSize(lab, 7.5), y - 11, 7.5, bold, navy); else text(lab, x + 4, y - 11, 7.5, bold, navy); x += c.w; }
    y -= 16;
  };
  header(false);
  r.rows.forEach((row, i) => {
    if (y - 15 < M + 70) { page = pdf.addPage([W, H]); y = H - M; header(true); }
    if (i % 2) page.drawRectangle({ x: M, y: y - 15, width: CW, height: 15, color: zebra });
    const pay = row.payment === "Balance" ? `Balance ${peso(row.balanceCentavos)}` : row.payment;
    const cells = [String(i + 1), row.name, row.nwmtaciNo, row.srn, row.rank, row.mobile, row.source, row.status, pay, `${row.requirements} of 4`];
    let x = M;
    cells.forEach((v, k) => { const c = cols[k]; const f = k === 1 ? bold : reg; const t = fit(v, f, 8, c.w - 8); if (c.r) text(t, x + c.w - 4 - f.widthOfTextAtSize(t, 8), y - 10.5, 8, f); else text(t, x + 4, y - 10.5, 8, f); x += c.w; });
    page.drawLine({ start: { x: M, y: y - 15 }, end: { x: M + CW, y: y - 15 }, thickness: 0.4, color: rule });
    y -= 15;
  });
  if (!r.rows.length) { text("No trainees on this batch yet.", M + 4, y - 12, 9, reg, muted); y -= 18; }
  if (y - 60 < M) { page = pdf.addPage([W, H]); y = H - M; }
  y -= 44;
  const sig = (label: string, name: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 180, y }, thickness: 0.7, color: ink }); text(name, x, y + 4, 9, bold); text(label, x, y - 11, 8, reg, muted); };
  sig("Prepared by", opts.preparedBy ?? "", M); sig("Noted by · Admin", "", M + 260);
  const pages = pdf.getPages();
  pages.forEach((p, i) => { const v = `Page ${i + 1} of ${pages.length}`; p.drawText(v, { x: W - M - reg.widthOfTextAtSize(v, 7.5), y: M - 14, size: 7.5, font: reg, color: muted }); });
  return pdf.save();
}
