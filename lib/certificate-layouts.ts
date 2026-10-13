import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Course-specific certificate layouts: what the portal writes on a course's
 * blank template so the print matches New Wave's own certificate. Positions
 * are in points on A4 (595.32 × 841.92), measured from the owner's sample;
 * other page sizes scale. A course without a layout uses the general overlay.
 */
export type CertificateFill = {
  name: string;
  /** Training days from the enrollment (YYYY-MM-DD). */
  startsOn: string | null;
  endsOn: string | null;
  /** Print day (YYYY-MM-DD). */
  issuedOn: string;
  certificateNumber: string;
  registrationNumber: string;
};

type Layout = (pdf: PDFDocument, page: PDFPage, fill: CertificateFill) => Promise<void>;

const A4 = { w: 595.32, h: 841.92 };
const INK = rgb(0, 0, 0);
const longDate = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));
const monthYear = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));
/** 1 → "st", 2 → "nd", 11 → "th", 24 → "th". */
export const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

/** Draws a justified paragraph from (x, y) downward; the last line stays left-aligned. */
function justified(page: PDFPage, text: string, x: number, y: number, width: number, leading: number, size: number, font: PDFFont) {
  const words = text.split(/\s+/).filter(Boolean), space = font.widthOfTextAtSize(" ", size);
  const lines: string[][] = [];
  let line: string[] = [], used = 0;
  for (const w of words) {
    const ww = font.widthOfTextAtSize(w, size);
    if (line.length && used + space + ww > width) { lines.push(line); line = []; used = 0; }
    used += (line.length ? space : 0) + ww;
    line.push(w);
  }
  if (line.length) lines.push(line);
  lines.forEach((ws, i) => {
    const last = i === lines.length - 1, widths = ws.map((w) => font.widthOfTextAtSize(w, size));
    const gap = last || ws.length < 2 ? space : (width - widths.reduce((a, b) => a + b, 0)) / (ws.length - 1);
    let cx = x;
    ws.forEach((w, j) => { page.drawText(w, { x: cx, y: y - i * leading, size, font, color: INK }); cx += widths[j] + gap; });
  });
}

/** HAZMAT with CFR (owner's sample certificate, 13 Oct 2026). */
const hazmatCfr: Layout = async (pdf, page, fill) => {
  const W = page.getWidth(), H = page.getHeight(), sx = W / A4.w, sy = H / A4.h;
  const X = (v: number) => v * sx, Y = (v: number) => v * sy, S = (v: number) => v * sx;
  const reg = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const centre = (text: string, y: number, size: number, font: PDFFont) => page.drawText(text, { x: (W - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: INK });

  // Name: bold, centred under "is issued to"; long names shrink to fit.
  const name = fill.name.toUpperCase();
  let nameSize = S(20);
  while (nameSize > S(12) && bold.widthOfTextAtSize(name, nameSize) > X(500)) nameSize -= 0.5;
  centre(name, Y(580.3), nameSize, bold);

  // Training dates from the enrollment, inside the course paragraph.
  const { startsOn: a, endsOn: b } = fill;
  const when = a && b && a !== b ? `from ${longDate(a)} to ${longDate(b)}` : a || b ? `on ${longDate((a || b)!)}` : "";
  const paragraph = `Conducted ${when} in accordance with The International Maritime Dangerous Goods (IMDG) Code, including Amendment 36-12, 49 Code of Federal Regulations (CFR) Parts 171-180 and the Model Course 1.10 Dangerous, Hazardous and Harmful Cargoes and per training procedures of the Quality Management System of this educational institution under the Blende Learning Method.`;
  justified(page, paragraph.replace(/\s+/g, " "), X(56.6), Y(266.3), X(482.1), Y(14.9), S(12), reg);

  // "Issued this 24th day of March 2026 in the City of Manila, Philippines." with a raised suffix.
  const day = Number(fill.issuedOn.slice(8, 10)), size = S(12), sup = S(8);
  const parts: [string, number, number][] = [[`Issued this ${day}`, size, 0], [ordinal(day), sup, S(3)], [` day of ${monthYear(fill.issuedOn)} in the City of Manila, Philippines.`, size, 0]];
  let x = (W - parts.reduce((s, [t, z]) => s + reg.widthOfTextAtSize(t, z), 0)) / 2;
  for (const [t, z, rise] of parts) { page.drawText(t, { x, y: Y(169.2) + rise, size: z, font: reg, color: INK }); x += reg.widthOfTextAtSize(t, z); }

  // Certificate No. and Registration No., lower left above the signatures.
  const small = S(9.96);
  [["Certificate No: ", fill.certificateNumber, 149.4], ["Registration No: ", fill.registrationNumber, 136.9]].forEach(([label, value, y]) => {
    if (value) page.drawText(`${label}${value}`, { x: X(45.1), y: Y(y as number), size: small, font: reg, color: INK });
  });
};

/** HAZMAT with CFR, whatever the catalog calls it ("HAZMAT-CFR", "HAZMAT with CFR Cargoes"). */
export const isHazmatCfr = (course: { code?: string | null; name?: string | null }) => {
  const t = `${course.code ?? ""} ${course.name ?? ""}`;
  return /hazmat/i.test(t) && /\bcfr\b/i.test(t);
};

/** The course's own layout, or null for the general overlay. */
export function certificateLayout(course: { code?: string | null; name?: string | null }): Layout | null {
  if (isHazmatCfr(course)) return hazmatCfr;
  return null;
}
