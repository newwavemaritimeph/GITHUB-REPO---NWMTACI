import QRCode from "qrcode";
import { StandardFonts, rgb, type PDFDocument, type PDFPage } from "pdf-lib";
import { justified, ordinal } from "@/lib/certificate-layouts";

/**
 * Fills a certificate template converted from New Wave's Word files
 * (scripts/certificate-templates, owner 20 Oct 2026). `fields` (version 2) holds
 * where each placeholder sat in the Word layout; the portal writes the values
 * there in Times (built in) and prints the QR inside the QR Verify box.
 */
export type TemplateFieldsV2 = {
  version: 2;
  name?: { cx: number; y: number; size: number; bold?: boolean; maxW: number };
  conducted?: { x: number; y: number; w: number; size: number; leading: number; align: number; text: string };
  issued?: { cx: number; y: number; size: number; text: string };
  certNo?: { x: number; y: number; size: number };
  regNo?: { x: number; y: number; size: number };
  qr?: { x: number; y: number; w: number; h: number };
  /** A template whose hours line was left blank (CSF "[__] Hours"): covered and printed. */
  hours?: { cx: number; y: number; size: number; text: string; cover: { x: number; y: number; w: number; h: number } };
};
export type OverlayFill = { name: string; startsOn: string | null; endsOn: string | null; issuedOn: string; certificateNumber: string; registrationNumber: string; verifyUrl: string | null; copyNo?: number };

export const isFieldsV2 = (f: unknown): f is TemplateFieldsV2 => !!f && typeof f === "object" && (f as { version?: unknown }).version === 2;

const INK = rgb(0, 0, 0);
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const longDate = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));

/** The Word paragraph with its date placeholders filled: [DATE], or [START DATE] / [END DATE]. */
export function conductedText(text: string, startsOn: string | null, endsOn: string | null) {
  const start = startsOn ?? endsOn, end = endsOn ?? startsOn;
  return text.replace("[START DATE]", start ? longDate(start) : "").replace("[END DATE]", end ? longDate(end) : "").replace("[DATE]", end ? longDate(end) : "");
}

/** "Issued this ______ day of ________________ 20____ in ..." → "Issued this 15th day of October 2026 in ...". */
export function issuedText(text: string, issuedOn: string) {
  const day = Number(issuedOn.slice(8, 10));
  const month = new Intl.DateTimeFormat("en-PH", { month: "long", timeZone: "Asia/Manila" }).format(new Date(`${issuedOn}T00:00:00+08:00`));
  return text.replace(/Issued this\s*_+\s*day of\s*_+\s*20_+/, `Issued this ${day}${ordinal(day)} day of ${month} ${issuedOn.slice(0, 4)}`);
}

export async function drawTemplateFields(pdf: PDFDocument, page: PDFPage, f: TemplateFieldsV2, fill: OverlayFill) {
  const reg = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  if (f.name) {
    const font = f.name.bold === false ? reg : bold, name = safe(fill.name.toUpperCase());
    let size = f.name.size;
    while (size > 10 && font.widthOfTextAtSize(name, size) > f.name.maxW) size -= 0.5;
    page.drawText(name, { x: f.name.cx - font.widthOfTextAtSize(name, size) / 2, y: f.name.y, size, font, color: INK });
  }
  if (f.conducted) {
    const text = safe(conductedText(f.conducted.text, fill.startsOn, fill.endsOn)).replace(/\s+/g, " ");
    if (f.conducted.align === 3) justified(page, text, f.conducted.x, f.conducted.y, f.conducted.w, f.conducted.leading, f.conducted.size, reg);
    else {
      // Left or centred: wrap at the paragraph width.
      const words = text.split(" "), lines: string[] = [];
      for (const w of words) { const last = lines[lines.length - 1]; if (last && reg.widthOfTextAtSize(`${last} ${w}`, f.conducted.size) <= f.conducted.w) lines[lines.length - 1] = `${last} ${w}`; else lines.push(w); }
      lines.forEach((l, i) => { const lw = reg.widthOfTextAtSize(l, f.conducted!.size); page.drawText(l, { x: f.conducted!.align === 1 ? f.conducted!.x + (f.conducted!.w - lw) / 2 : f.conducted!.x, y: f.conducted!.y - i * f.conducted!.leading, size: f.conducted!.size, font: reg, color: INK }); });
    }
  }
  if (f.issued) {
    const text = safe(issuedText(f.issued.text, fill.issuedOn));
    page.drawText(text, { x: f.issued.cx - reg.widthOfTextAtSize(text, f.issued.size) / 2, y: f.issued.y, size: f.issued.size, font: reg, color: INK });
  }
  if (f.hours) {
    page.drawRectangle({ ...f.hours.cover, width: f.hours.cover.w, height: f.hours.cover.h, color: rgb(1, 1, 1) });
    page.drawText(f.hours.text, { x: f.hours.cx - bold.widthOfTextAtSize(f.hours.text, f.hours.size) / 2, y: f.hours.y, size: f.hours.size, font: bold, color: INK });
  }
  if (f.certNo && fill.certificateNumber) page.drawText(safe(fill.certificateNumber), { x: f.certNo.x, y: f.certNo.y, size: f.certNo.size, font: reg, color: INK });
  if (f.regNo && fill.registrationNumber) page.drawText(safe(fill.registrationNumber), { x: f.regNo.x, y: f.regNo.y, size: f.regNo.size, font: reg, color: INK });
  // A reprint says so under the numbers (owner's QR plan, 20 Oct 2026).
  if (fill.copyNo && fill.copyNo > 1) {
    const at = f.regNo ?? f.certNo;
    if (at) page.drawText(`REPRINT - COPY ${fill.copyNo}`, { x: at.x, y: at.y - at.size * 1.25, size: Math.max(6, at.size - 1.5), font: bold, color: rgb(0.45, 0.1, 0.05) });
  }
  if (f.qr && fill.verifyUrl) {
    // Generated at print, never stored: error correction M, quiet zone 1, 600 px.
    const png = await QRCode.toBuffer(fill.verifyUrl, { errorCorrectionLevel: "M", margin: 1, width: 600, type: "png" });
    const img = await pdf.embedPng(new Uint8Array(png));
    const { x, y, w, h } = f.qr, caption = Math.max(5, Math.min(7, h * 0.11)), side = Math.min(w, h - caption * 1.6);
    page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1) });
    page.drawImage(img, { x: x + (w - side) / 2, y: y + h - side, width: side, height: side });
    const label = "SCAN TO VERIFY", hb = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText(label, { x: x + (w - hb.widthOfTextAtSize(label, caption)) / 2, y: y + caption * 0.35, size: caption, font: hb, color: rgb(0.07, 0.25, 0.39) });
  }
}
