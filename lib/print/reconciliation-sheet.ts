import { PDFDocument, rgb } from "pdf-lib";
import type { ReconRow } from "@/lib/reconciliation-server";
import type { DocumentControl } from "@/lib/document-controls";
import { FOOT, INK, LEGAL, MUTED, NAVY, SIDE, drawLetterhead, finishPages, loadBrand, newPage } from "@/lib/print/letterhead";

const longDate = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));
const time = (iso: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const peso = (c: number) => `PHP ${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ascii = (s: string) => s.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

/**
 * Payment reconciliation day sheet (owner, 9 Oct 2026): the day's payments for one channel with an "In history" tick column.
 * On the shared Corporate Two-Tone letterhead, legal paper (10 Nov 2026).
 */
export async function createReconciliationSheetPdf(date: string, channel: string, day: { rows: ReconRow[] }, control?: DocumentControl | null, logoBytes?: Uint8Array) {
  const pdf = await PDFDocument.create();
  const brand = await loadBrand(pdf, logoBytes), { reg, bold } = brand;
  const rule = rgb(0.85, 0.89, 0.92), green = rgb(0.04, 0.48, 0.24), red = rgb(0.71, 0.14, 0.09);
  const [W] = LEGAL, M = SIDE;
  const cols = [["#", 26], ["Time", 58], ["Receipt No.", 100], ["Trainee", 152], [`${channel} Ref. No.`, 112], ["Amount", 84], ["In Hist.", 32]] as const;
  const total = day.rows.reduce((s, r) => s + r.amount_centavos, 0);
  const title = `${channel} RECONCILIATION - DAY SHEET`.toUpperCase();
  let page = newPage(pdf, brand);
  let y = 0;
  const header = (cont: boolean) => {
    y = drawLetterhead(page, brand, control, { title, cont });
    if (!cont) { page.drawText(ascii(`${longDate(date)}  -  ${day.rows.length} payment${day.rows.length === 1 ? "" : "s"}  -  ${peso(total)}`), { x: M, y, size: 11, font: reg, color: MUTED }); y -= 24; }
    let x = M;
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: NAVY });
    for (const [label, w] of cols) { page.drawText(ascii(label.toUpperCase()), { x: x + 5, y, size: 8, font: bold, color: rgb(1, 1, 1) }); x += w; }
    y -= 23;
  };
  header(false);
  day.rows.forEach((r, i) => {
    if (y < FOOT + 30) { page = newPage(pdf, brand); header(true); }
    const cells = [String(i + 1), time(r.received_at), r.receipt_number ?? r.payment_number, r.trainee, r.reference_number ?? "-", peso(r.amount_centavos)];
    let x = M;
    cells.forEach((c, k) => {
      const w = cols[k][1];
      let text = ascii(c);
      const font = k === 4 ? bold : reg;
      while (text.length > 1 && font.widthOfTextAtSize(text, 10.5) > w - 10) text = text.slice(0, -1);
      page.drawText(text, { x: k === 5 ? x + w - 5 - font.widthOfTextAtSize(text, 10.5) : x + 5, y, size: 10.5, font, color: INK });
      x += w;
    });
    // Tick box, already ticked when reconciled.
    page.drawRectangle({ x: x + 10, y: y - 2, width: 12, height: 12, borderColor: INK, borderWidth: 0.7 });
    if (r.status === "Reconciled") page.drawText("v", { x: x + 13, y: y - 0.5, size: 11, font: bold, color: green });
    if (r.status === "Not in History") page.drawText("x", { x: x + 13.5, y: y - 0.5, size: 11, font: bold, color: red });
    page.drawLine({ start: { x: M, y: y - 7 }, end: { x: W - M, y: y - 7 }, thickness: 0.5, color: rule });
    y -= 21;
  });
  if (!day.rows.length) { page.drawText(ascii(`No ${channel} payments on this day.`), { x: M, y, size: 11, font: reg, color: MUTED }); y -= 21; }
  if (y - 70 < FOOT) { page = newPage(pdf, brand); y = drawLetterhead(page, brand, control, { title, cont: true }); }
  y -= 46;
  const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 220, y }, thickness: 0.7, color: INK }); page.drawText(label, { x, y: y - 14, size: 10, font: reg, color: MUTED }); };
  sig("Checked by (Admin Assistant)", M);
  sig("Noted by (Accounting)", W - M - 220);
  finishPages(pdf, brand, control);
  return pdf.save();
}
