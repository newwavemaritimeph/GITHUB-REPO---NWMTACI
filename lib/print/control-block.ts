import { rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { controlLine, controlRows, type DocumentControl } from "@/lib/document-controls";

const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const fit = (t: string, font: PDFFont, size: number, width: number) => { let v = safe(t); while (v.length > 1 && font.widthOfTextAtSize(v, size) > width) v = v.slice(0, -1); return v; };
const INK = rgb(0.08, 0.16, 0.23), MUTED = rgb(0.34, 0.41, 0.47), RULE = rgb(0.73, 0.78, 0.83), TINT = rgb(0.933, 0.965, 0.984);

type At = { right: number; top: number; width?: number; labelWidth?: number; rowHeight?: number; size?: number; always?: boolean; firstRows?: [string, string][] };

/** The form's details as a small grid at a page corner (owner, 5 Nov 2026). Draws nothing when all are blank; returns its height. */
export function drawControlBlock(page: PDFPage, fonts: { reg: PDFFont; bold: PDFFont }, control: DocumentControl | null | undefined, at: At) {
  const rows = [...controlRows(control, at.always)];
  if (!rows.length) return 0;
  rows.unshift(...(at.firstRows ?? []));
  const width = at.width ?? 125, labelW = at.labelWidth ?? 48, h = at.rowHeight ?? 9, size = at.size ?? 6, x = at.right - width, valueW = width - labelW;
  rows.forEach(([label, value], i) => {
    const y = at.top - (i + 1) * h, base = y + (h - size) / 2 + 0.6;
    page.drawRectangle({ x, y, width: labelW, height: h, color: TINT, borderColor: RULE, borderWidth: 0.5 });
    page.drawRectangle({ x: x + labelW, y, width: valueW, height: h, borderColor: RULE, borderWidth: 0.5 });
    page.drawText(safe(label), { x: x + 3, y: base, size, font: fonts.bold, color: MUTED });
    if (value) page.drawText(fit(value, fonts.bold, size, valueW - 6), { x: x + labelW + 3, y: base, size, font: fonts.bold, color: INK });
  });
  return rows.length * h;
}

/** The same details as one right-aligned line, for headers with no free corner. Returns false when there is nothing to print. */
export function drawControlLine(page: PDFPage, font: PDFFont, control: DocumentControl | null | undefined, at: { right: number; y: number; size?: number }) {
  const line = safe(controlLine(control)), size = at.size ?? 6.4;
  if (!line) return false;
  page.drawText(line, { x: at.right - font.widthOfTextAtSize(line, size), y: at.y, size, font, color: MUTED });
  return true;
}
