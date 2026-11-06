import QRCode from "qrcode";
import { PDFArray, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, rgb, type PDFDocument, type PDFPage, type PDFStream } from "pdf-lib";
import { justified, ordinal } from "@/lib/certificate-layouts";
import { IDENTITY, apply, mul, tokens, type M } from "@/lib/certificate-template";

/**
 * Fills a certificate template converted from New Wave's Word files
 * (scripts/certificate-templates, owner 20 Oct 2026). `fields` (version 2) holds
 * where each placeholder sat in the Word layout; the portal writes the values
 * there in Times (built in) and prints the QR inside the QR Verify box.
 */
type NumberAt = { x: number; y: number; size: number; bold?: boolean; body?: boolean;
  /** Drawn before the value, from x: the words came off the page with the sample value beside them. */
  label?: string };
export type TemplateFieldsV2 = {
  version: 2;
  /** Read from the uploaded PDF (lib/certificate-autolayout), so these positions belong to this very file. */
  auto?: boolean;
  pageW?: number;
  pageH?: number;
  /** Sample text the PDF would not give up, hidden behind white boxes. */
  cover?: { x: number; y: number; w: number; h: number }[];
  name?: { cx: number; y: number; size: number; bold?: boolean; maxW: number };
  conducted?: { x: number; y: number; w: number; size: number; leading: number; align: number; text: string };
  /** Centred on cx, or from x (UBT-PSSR, owner 5 Nov 2026). */
  issued?: { cx?: number; x?: number; y: number; size: number; text: string };
  /** bold, or body (the template's own font, as the label beside it); otherwise Times. */
  certNo?: NumberAt;
  regNo?: NumberAt;
  qr?: { x: number; y: number; w: number; h: number };
  /** A template whose hours line was left blank (CSF "[__] Hours"): covered and printed. */
  hours?: { cx: number; y: number; size: number; text: string; cover: { x: number; y: number; w: number; h: number } };
  /** MARINA STCW templates (Safety, Crowd, Crisis; owner 20 Oct 2026): "Date of Issue:" value and the Trainee Photo box. */
  issueDate?: NumberAt;
  photo?: { x: number; y: number; w: number; h: number };
  /** The name and the Conducted paragraph in a sans font, as in the MARINA STCW Word files (Arial). */
  sans?: boolean;
  /** Sample text printed on the owner's PDF, removed before filling (UBT-PSSR, owner 5 Nov 2026). */
  lift?: LiftZone[];
  /** Words the owner's PDF lacks or has wrong, drawn on every certificate: centred on cx, or from x. */
  fixed?: { text: string; cx?: number; x?: number; y: number; size: number; bold?: boolean }[];
};
export type LiftZone = { yMin: number; yMax: number; xMin?: number; xMax?: number };
export type OverlayFill = { name: string; startsOn: string | null; endsOn: string | null; issuedOn: string; certificateNumber: string; registrationNumber: string; verifyUrl: string | null;
  /** Template view (owner, 20 Oct 2026): the description with blank dates, a "TRAINEE NAME" guide, no numbers or QR. */
  blank?: boolean };

export const isFieldsV2 = (f: unknown): f is TemplateFieldsV2 => !!f && typeof f === "object" && (f as { version?: unknown }).version === 2;

const INK = rgb(0, 0, 0);
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const longDate = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));

/** The Word paragraph with its date placeholders filled: [DATE], or [START DATE] / [END DATE]; [ASSESS DATE] is the last training day. */
export function conductedText(text: string, startsOn: string | null, endsOn: string | null) {
  const start = startsOn ?? endsOn, end = endsOn ?? startsOn;
  return text.replace("[START DATE]", start ? longDate(start) : "").replace("[END DATE]", end ? longDate(end) : "").replace("[DATE]", end ? longDate(end) : "").replace("[ASSESS DATE]", end ? longDate(end) : "");
}

/** "Issued this ______ day of ________________ 20____ in ..." → "Issued this 15th day of October 2026 in ...". */
export function issuedText(text: string, issuedOn: string) {
  const day = Number(issuedOn.slice(8, 10));
  const month = new Intl.DateTimeFormat("en-PH", { month: "long", timeZone: "Asia/Manila" }).format(new Date(`${issuedOn}T00:00:00+08:00`));
  return text.replace(/Issued this\s*_+\s*day of\s*_+\s*20_+/, `Issued this ${day}${ordinal(day)} day of ${month} ${issuedOn.slice(0, 4)}`);
}

/**
 * Removes the text of a template page that starts inside the zones, so a PDF made with sample text can be
 * used as it is. It follows the page's text positions, so PDFs from any program work, not only Word's.
 * Call it on the template's own document before copying the page. Returns how many pieces were removed.
 */
export function liftTemplateText(doc: PDFDocument, page: PDFPage, zones: LiftZone[]) {
  const contents = page.node.Contents();
  if (!contents) return 0;
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  let text = "";
  for (const s of streams) text += Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : (s as PDFStream).getContents()).toString("latin1") + "\n";
  let removed = 0, ctm: M = IDENTITY, tm: M = IDENTITY, line: M = IDENTITY, leading = 0, nums: number[] = [], kept = "", from = 0, lastOp = 0;
  const stack: M[] = [];
  const move = (tx: number, ty: number) => { line = mul([1, 0, 0, 1, tx, ty], line); tm = line; };
  for (const tok of tokens(text)) {
    if (tok.t === "num") { nums.push(tok.v); continue; }
    if (tok.t === "name") continue;
    const a = nums, op = tok.v;
    nums = [];
    if (op === "q") stack.push(ctm);
    else if (op === "Q") ctm = stack.pop() ?? IDENTITY;
    else if (op === "cm" && a.length >= 6) ctm = mul(a.slice(-6) as M, ctm);
    else if (op === "BT") tm = line = IDENTITY;
    else if (op === "Tm" && a.length >= 6) tm = line = a.slice(-6) as M;
    else if ((op === "Td" || op === "TD") && a.length >= 2) { if (op === "TD") leading = -a[a.length - 1]; move(a[a.length - 2], a[a.length - 1]); }
    else if (op === "TL" && a.length) leading = a[a.length - 1];
    else if (op === "T*" || op === "'" || op === '"') move(0, -leading);
    if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
      const [x, y] = apply(mul(tm, ctm), 0, 0);
      if (zones.some((z) => y >= z.yMin && y <= z.yMax && (z.xMin === undefined || x >= z.xMin) && (z.xMax === undefined || x < z.xMax))) { kept += text.slice(from, lastOp); from = tok.end; removed += 1; }
    }
    lastOp = tok.end;
  }
  if (removed) page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(Buffer.from(kept + text.slice(from), "latin1"))));
  return removed;
}

/** How far to move number lines left so none passes the page's right margin. They move together, so they stay lined up. */
export const numberShift = (lines: { x: number; width: number }[], pageW: number) => Math.max(0, ...lines.map((l) => l.x + l.width - (pageW - 36)));

export async function drawTemplateFields(pdf: PDFDocument, page: PDFPage, f: TemplateFieldsV2, fill: OverlayFill) {
  const reg = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const body = f.sans ? await pdf.embedFont(StandardFonts.Helvetica) : reg, bodyBold = f.sans ? await pdf.embedFont(StandardFonts.HelveticaBold) : bold;
  for (const c of f.cover ?? []) page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: rgb(1, 1, 1) });
  for (const w of f.fixed ?? []) {
    const font = w.bold ? bodyBold : body;
    page.drawText(w.text, { x: w.x ?? (w.cx ?? 0) - font.widthOfTextAtSize(w.text, w.size) / 2, y: w.y, size: w.size, font, color: INK });
  }
  if (f.name) {
    const font = f.name.bold === false ? body : bodyBold, name = fill.blank ? "TRAINEE NAME" : safe(fill.name.toUpperCase());
    let size = f.name.size;
    while (size > 10 && font.widthOfTextAtSize(name, size) > f.name.maxW) size -= 0.5;
    page.drawText(name, { x: f.name.cx - font.widthOfTextAtSize(name, size) / 2, y: f.name.y, size, font, color: fill.blank ? rgb(0.72, 0.76, 0.8) : INK });
  }
  if (f.conducted) {
    const filled = fill.blank ? f.conducted.text.replace(/\[(START DATE|END DATE|DATE|ASSESS DATE)\]/g, "________________") : conductedText(f.conducted.text, fill.startsOn, fill.endsOn);
    const text = safe(filled).replace(/\s+/g, " ");
    if (f.conducted.align === 3) justified(page, text, f.conducted.x, f.conducted.y, f.conducted.w, f.conducted.leading, f.conducted.size, body);
    else {
      // Left or centred: wrap at the paragraph width.
      const words = text.split(" "), lines: string[] = [];
      for (const w of words) { const last = lines[lines.length - 1]; if (last && body.widthOfTextAtSize(`${last} ${w}`, f.conducted.size) <= f.conducted.w) lines[lines.length - 1] = `${last} ${w}`; else lines.push(w); }
      lines.forEach((l, i) => { const lw = body.widthOfTextAtSize(l, f.conducted!.size); page.drawText(l, { x: f.conducted!.align === 1 ? f.conducted!.x + (f.conducted!.w - lw) / 2 : f.conducted!.x, y: f.conducted!.y - i * f.conducted!.leading, size: f.conducted!.size, font: body, color: INK }); });
    }
  }
  if (f.issued) {
    const text = safe(fill.blank ? f.issued.text : issuedText(f.issued.text, fill.issuedOn));
    page.drawText(text, { x: f.issued.x ?? (f.issued.cx ?? 0) - body.widthOfTextAtSize(text, f.issued.size) / 2, y: f.issued.y, size: f.issued.size, font: body, color: INK });
  }
  if (f.hours) {
    page.drawRectangle({ ...f.hours.cover, width: f.hours.cover.w, height: f.hours.cover.h, color: rgb(1, 1, 1) });
    page.drawText(f.hours.text, { x: f.hours.cx - bold.widthOfTextAtSize(f.hours.text, f.hours.size) / 2, y: f.hours.y, size: f.hours.size, font: bold, color: INK });
  }
  const textOf = (at: NumberAt, value: string) => safe([at.label, fill.blank ? "" : value].filter(Boolean).join(" "));
  const fontOf = (at: NumberAt) => (at.bold ? bodyBold : at.body ? body : reg);
  const labelled = (at: NumberAt | undefined, value: string, shift = 0) => {
    const text = at && textOf(at, value);
    if (at && text) page.drawText(text, { x: at.x - (at.label ? shift : 0), y: at.y, size: at.size, font: fontOf(at), color: INK });
  };
  labelled(f.issueDate, fill.issuedOn ? longDate(fill.issuedOn) : "");
  // Only a line drawn with its label can move; one printed after the template's own label stays put.
  const numbers = [[f.certNo, fill.certificateNumber], [f.regNo, fill.registrationNumber]] as const;
  const shift = numberShift(numbers.flatMap(([at, value]) => (at?.label ? [{ x: at.x, width: fontOf(at).widthOfTextAtSize(textOf(at, value), at.size) }] : [])), page.getWidth());
  for (const [at, value] of numbers) labelled(at, value, shift);
  // Reprints are not marked on the certificate (owner, 20 Oct 2026): the copy number stays internal, in the print audit.
  if (f.qr && fill.verifyUrl && !fill.blank) {
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
