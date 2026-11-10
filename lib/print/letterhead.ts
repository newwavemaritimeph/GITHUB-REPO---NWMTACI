import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { FOOTER_DEFAULTS, controlRows, type DocumentControl } from "@/lib/document-controls";

/**
 * The one New Wave letterhead and footer, Design 6 · Corporate Two-Tone (owner, 10 Nov 2026): every full-page
 * report on legal paper with narrow side margins, the form details at the top right, the faint logo in the lower
 * right corner, and a footer with Issued to, Controlled by, Approved by, Page x of y and the tagline.
 */
export const LEGAL: [number, number] = [612, 1008];
export const LEGAL_LANDSCAPE: [number, number] = [1008, 612];
export const SIDE = 24;
/** Space builders keep free at the bottom of each page for the footer. */
export const FOOT = 52;
export const ORG = "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.";
export const ADDRESS = "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000";
export const CONTACTS = "+63 948 847 6530  |  (02) 8553 0310  |  newwavemaritime@gmail.com  |  facebook.com/newwavemtc";
export const TAGLINE = "Ride the New Wave of Maritime Excellence";

export const NAVY = rgb(0.071, 0.247, 0.388), ORANGE = rgb(0.949, 0.337, 0.082), INK = rgb(0.07, 0.09, 0.11), MUTED = rgb(0.34, 0.41, 0.47), RULE = rgb(0.79, 0.84, 0.87);
export const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/₱/g, "PHP ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
export const fitText = (t: string, f: PDFFont, size: number, w: number) => { let v = safe(t); while (v.length > 1 && f.widthOfTextAtSize(v, size) > w) v = v.slice(0, -1); return v; };

/** Words onto lines no wider than `w`. */
export function wrapWords(t: string, f: PDFFont, size: number, w: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of safe(t).split(" ")) { const next = line ? `${line} ${word}` : word; if (line && f.widthOfTextAtSize(next, size) > w) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  return lines.map((l) => fitText(l, f, size, w));
}

export type Brand ={ reg: PDFFont; bold: PDFFont; italic: PDFFont; logo: PDFImage | null };

export async function loadBrand(pdf: PDFDocument, logoBytes?: Uint8Array): Promise<Brand> {
  const [reg, bold, italic] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold), pdf.embedFont(StandardFonts.HelveticaBoldOblique)]);
  let logo: PDFImage | null = null;
  if (logoBytes) { try { logo = await pdf.embedPng(logoBytes); } catch { logo = null; } }
  return { reg, bold, italic, logo };
}

/** The navy and orange edge, at the top and the bottom of every page. */
function twoTone(page: PDFPage, y: number) {
  const { width: W } = page.getSize();
  page.drawRectangle({ x: 0, y, width: W * 0.74, height: 6, color: NAVY });
  page.drawRectangle({ x: W * 0.74, y, width: W * 0.26, height: 6, color: ORANGE });
}

/** A new page with the faint logo in its lower right corner, drawn first so everything prints over it. */
export function newPage(pdf: PDFDocument, brand: Brand, size: [number, number] = LEGAL) {
  const page = pdf.addPage(size);
  if (brand.logo) {
    const { width: W, height: H } = page.getSize(), s = Math.min(W, H) * 0.8;
    page.drawImage(brand.logo, { x: W - s * 0.8, y: -s * 0.16, width: s, height: s, opacity: 0.08 });
  }
  return page;
}

/**
 * The letterhead at the top of a page; returns the y where the content starts. A continuation page (`cont`)
 * gets the slim version: the edge, the name and the title marked continued.
 */
export function drawLetterhead(page: PDFPage, b: Brand, control: DocumentControl | null | undefined, opts: { title?: string; right?: string; cont?: boolean; firstRows?: [string, string][]; extraLine?: string } = {}) {
  const { width: W, height: H } = page.getSize();
  const text = (t: string, x: number, y: number, size: number, f: PDFFont = b.reg, color = INK) => page.drawText(safe(t), { x, y, size, font: f, color });
  const rightText = (t: string, xr: number, y: number, size: number, f: PDFFont, color = INK) => { const v = safe(t); page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y, size, font: f, color }); };
  twoTone(page, H - 6);
  const top = H - 22;
  if (opts.cont) {
    text(ORG, SIDE, top - 10, 9.5, b.bold, NAVY);
    if (opts.title) rightText(`${opts.title} (continued)`, W - SIDE, top - 10, 9.5, b.bold, MUTED);
    page.drawLine({ start: { x: SIDE, y: top - 18 }, end: { x: W - SIDE, y: top - 18 }, thickness: 0.6, color: RULE });
    return top - 34;
  }
  const rows = [...(opts.firstRows ?? []), ...controlRows(control, !!opts.firstRows)];
  const ctlW = rows.length ? 178 : 0, textX = SIDE + (b.logo ? 62 : 0), textW = W - SIDE - ctlW - 14 - textX;
  if (b.logo) page.drawImage(b.logo, { x: SIDE, y: top - 52, width: 52, height: 52 });
  // The name, address and contacts wrap onto a second line on a narrow (portrait) page instead of being cut.
  let ty = top - 2;
  for (const [t, size, f, color, gap] of [[ORG, 13.5, b.bold, NAVY, 15], [ADDRESS, 9, b.reg, MUTED, 11.5], [CONTACTS.replaceAll("  |  ", " | ") + (opts.extraLine ? ` | ${opts.extraLine}` : ""), 9, b.reg, MUTED, 11.5]] as const)
    for (const line of wrapWords(t, f, size, textW).slice(0, 2)) { ty -= gap; text(line, textX, ty, size, f, color); }
  // The form details as a label list, set off by an orange line.
  if (rows.length) {
    const x0 = W - SIDE - ctlW;
    page.drawRectangle({ x: x0, y: top - Math.max(54, rows.length * 13 + 2), width: 2, height: Math.max(54, rows.length * 13 + 2), color: ORANGE });
    rows.forEach(([label, value], i) => {
      const y = top - 11 - i * 13;
      text(label.toUpperCase(), x0 + 10, y, 7.5, b.reg, MUTED);
      text(fitText(value || "-", b.bold, 10, ctlW - 92), x0 + 90, y, 10, b.bold, INK);
    });
  }
  const bottom = Math.min(top - 56, ty - 6, top - rows.length * 13 - 6);
  page.drawLine({ start: { x: SIDE, y: bottom - 6 }, end: { x: W - SIDE, y: bottom - 6 }, thickness: 0.6, color: RULE });
  let y = bottom - 32;
  if (opts.title) {
    text(opts.title, SIDE, y, 17, b.bold, NAVY);
    if (opts.right) rightText(opts.right, W - SIDE, y + 1, 11, b.bold, ORANGE);
    y -= 22;
  }
  return y;
}

/** The footer on every page, once the pages are laid out: the three signatories, Page x of y, and the tagline. */
export function finishPages(pdf: PDFDocument, b: Brand, control: DocumentControl | null | undefined) {
  const pages = pdf.getPages();
  const people: [string, string][] = [["Issued to", control?.issuedTo ?? ""], ["Controlled by", control?.controlledBy ?? FOOTER_DEFAULTS.controlledBy], ["Approved by", control?.approvedBy ?? FOOTER_DEFAULTS.approvedBy]];
  pages.forEach((page, i) => {
    const { width: W } = page.getSize(), y = 22;
    page.drawLine({ start: { x: SIDE, y: 36 }, end: { x: W - SIDE, y: 36 }, thickness: 0.6, color: RULE });
    let x = SIDE;
    for (const [label, value] of people) {
      const l = `${label}: `;
      page.drawText(l, { x, y, size: 8.5, font: b.reg, color: MUTED });
      x += b.reg.widthOfTextAtSize(l, 8.5);
      if (value) { const v = safe(value); page.drawText(v, { x, y, size: 8.5, font: b.bold, color: NAVY }); x += b.bold.widthOfTextAtSize(v, 8.5); }
      else { page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + 60, y: y - 1.5 }, thickness: 0.5, color: MUTED }); x += 60; }
      x += 14;
    }
    const pg = `Page ${i + 1} of ${pages.length}`;
    page.drawText(pg, { x: (W - b.bold.widthOfTextAtSize(pg, 8.5)) / 2 + (x > W / 2 - 40 ? (x - (W / 2 - 40)) / 2 + 10 : 0), y, size: 8.5, font: b.bold, color: NAVY });
    page.drawText(TAGLINE, { x: W - SIDE - b.italic.widthOfTextAtSize(TAGLINE, 9.5), y, size: 9.5, font: b.italic, color: ORANGE });
    twoTone(page, 0);
  });
}
