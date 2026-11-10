import { PDFDocument, rgb } from "pdf-lib";
import type { DocumentControl } from "@/lib/document-controls";
import { LEGAL, SIDE, NAVY, ORANGE, INK, MUTED, RULE, loadBrand, newPage, drawLetterhead, finishPages, wrapWords, safe, type Brand } from "@/lib/print/letterhead";

/**
 * HR documents on the Corporate Two-Tone letterhead and footer (owner, 10 Nov 2026):
 * Certificate of Employment on A4; Notice to Explain and Memorandum on Legal.
 * The body comes from HR's template with its {{fields}} filled; issued documents print from their snapshot.
 */
export const A4: [number, number] = [595.28, 841.89];
export type HrDocType = "coe" | "nte" | "memo";
export type Signatory = { label: string; name: string; title: string };
export type HrDocSnapshot = {
  type: HrDocType; number: string; templateVersion: number; body: string; signatories: Signatory[];
  /** NTE and memo header rows (To, From, Date, Subject, Type). */
  rows?: [string, string][];
  /** COE: "TO WHOM IT MAY CONCERN" is printed above the body. */
  sample?: boolean;
};
export const DOC_TITLE: Record<HrDocType, string> = { coe: "Certificate of Employment", nte: "Notice to Explain", memo: "Memorandum" };

/** Fills {{field}} placeholders; an unknown field stays visible so HR notices it. */
export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => (key in vars ? vars[key] : all));
}

type Ctx = { page: ReturnType<typeof newPage>; b: Brand; W: number; L: number; R: number; y: number; bottom: number };
const para = (c: Ctx, text: string, size: number, gap: number, bold = false, color = INK, indent = 0) => {
  const f = bold ? c.b.bold : c.b.reg;
  for (const l of wrapWords(text, f, size, c.R - c.L - indent)) { c.page.drawText(safe(l), { x: c.L + indent, y: c.y, size, font: f, color }); c.y -= size * 1.5; }
  c.y -= gap;
};
const sign = (c: Ctx, x: number, w: number, s: Signatory) => {
  if (s.label) c.page.drawText(safe(`${s.label}:`), { x, y: c.y, size: 10, font: c.b.reg, color: MUTED });
  c.page.drawLine({ start: { x, y: c.y - 38 }, end: { x: x + w, y: c.y - 38 }, thickness: 0.8, color: INK });
  const nm = safe(s.name), nw = c.b.bold.widthOfTextAtSize(nm, 11);
  c.page.drawText(nm, { x: x + Math.max(0, (w - nw) / 2), y: c.y - 33, size: 11, font: c.b.bold, color: NAVY });
  const ti = safe(s.title), tw = c.b.reg.widthOfTextAtSize(ti, 9.5);
  c.page.drawText(ti, { x: x + Math.max(0, (w - tw) / 2), y: c.y - 50, size: 9.5, font: c.b.reg, color: MUTED });
};
/** A heading is a short line with no closing period ("1. What Happened"). */
const isHeading = (p: string) => p.length <= 60 && !/[.:;,]$/.test(p) && !p.includes("\n");

export async function buildHrDocumentPdf(doc: HrDocSnapshot, control: DocumentControl | null, logo?: Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${DOC_TITLE[doc.type]} ${doc.number}`);
  const b = await loadBrand(pdf, logo);
  const size = doc.type === "coe" ? A4 : LEGAL;
  let page = newPage(pdf, b, size);
  const top = drawLetterhead(page, b, control, { title: DOC_TITLE[doc.type], right: doc.number });
  const c: Ctx = { page, b, W: size[0], L: SIDE + 26, R: size[0] - SIDE - 26, y: top - 10, bottom: 150 };
  const ensure = (h: number) => { if (c.y - h < c.bottom) { page = newPage(pdf, b, size); c.page = page; c.y = drawLetterhead(page, b, control, { title: DOC_TITLE[doc.type], right: doc.number, cont: true }) - 10; } };
  const bodySize = doc.type === "coe" ? 12 : 11.5;

  if (doc.type === "coe") {
    c.y -= 18;
    const h = "TO WHOM IT MAY CONCERN:", hw = b.bold.widthOfTextAtSize(h, 13);
    page.drawText(h, { x: (c.W - hw) / 2, y: c.y, size: 13, font: b.bold, color: NAVY }); c.y -= 40;
  } else if (doc.rows?.length) {
    for (const [k, v] of doc.rows) {
      page.drawText(safe(`${k}:`), { x: c.L, y: c.y, size: 11, font: b.bold, color: NAVY });
      const lines = wrapWords(v, b.reg, 11, c.R - c.L - 78);
      lines.forEach((l, i) => page.drawText(safe(l), { x: c.L + 78, y: c.y - i * 15, size: 11, font: b.reg, color: INK }));
      c.y -= Math.max(1, lines.length) * 15 + 4;
    }
    page.drawLine({ start: { x: c.L, y: c.y + 6 }, end: { x: c.R, y: c.y + 6 }, thickness: 0.8, color: NAVY }); c.y -= 14;
  }

  for (const p of doc.body.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    const lines = p.split("\n");
    if (lines.length > 1 && isHeading(lines[0])) {
      ensure(40); para(c, lines[0], bodySize, 2, true, /what you need/i.test(lines[0]) ? ORANGE : NAVY);
      ensure(30); para(c, lines.slice(1).join(" "), bodySize, 8, false, INK, 14);
    } else if (isHeading(p) && doc.type === "nte") { ensure(30); para(c, p, bodySize, 2, true, NAVY); }
    else { ensure(30); para(c, lines.join(" "), bodySize, doc.type === "coe" ? 12 : 9); }
  }

  // Signature blocks, two per row.
  c.y -= doc.type === "coe" ? 24 : 12;
  const sigs = doc.signatories.filter((s) => s.name.trim());
  const w = (c.R - c.L - 40) / 2;
  for (let i = 0; i < sigs.length; i += 2) {
    ensure(70);
    sign(c, c.L, w, sigs[i]);
    if (sigs[i + 1]) sign(c, c.L + w + 40, w, sigs[i + 1]);
    c.y -= 78;
  }

  if (doc.type === "coe") page.drawText("Not valid without the company dry seal.", { x: c.L, y: c.y, size: 9, font: b.italic, color: MUTED });
  if (doc.type === "nte") {
    ensure(110);
    page.drawRectangle({ x: c.L, y: c.y - 92, width: c.R - c.L, height: 100, borderColor: RULE, borderWidth: 1 });
    page.drawText("ACKNOWLEDGMENT OF RECEIPT", { x: c.L + 10, y: c.y - 10, size: 9.5, font: b.bold, color: NAVY });
    page.drawText("Received by: ______________________________   Date and Time: ____________________", { x: c.L + 10, y: c.y - 34, size: 10.5, font: b.reg, color: INK });
    page.drawText("[  ] Refused to receive.  Served by: ________________   Witness: ________________", { x: c.L + 10, y: c.y - 58, size: 10.5, font: b.reg, color: INK });
    page.drawText("Receiving this notice does not mean you admit the acts described above.", { x: c.L + 10, y: c.y - 80, size: 9, font: b.italic, color: MUTED });
  }
  if (doc.type === "memo") {
    ensure(230);
    page.drawText("ACKNOWLEDGED BY", { x: c.L, y: c.y, size: 10, font: b.bold, color: NAVY }); c.y -= 8;
    const cols = [c.L, c.L + 230, c.L + 400, c.R], hh = 20;
    page.drawRectangle({ x: c.L, y: c.y - hh, width: c.R - c.L, height: hh, color: rgb(0.918, 0.953, 0.984) });
    ["Name", "Signature", "Date"].forEach((h, i) => page.drawText(h, { x: cols[i] + 6, y: c.y - 14, size: 9.5, font: b.bold, color: NAVY }));
    for (let r = 0; r <= 8; r++) { const yy = c.y - hh - r * 22; page.drawLine({ start: { x: c.L, y: yy }, end: { x: c.R, y: yy }, thickness: 0.6, color: RULE }); }
    for (const x of cols) page.drawLine({ start: { x, y: c.y }, end: { x, y: c.y - hh - 8 * 22 }, thickness: 0.6, color: RULE });
    page.drawLine({ start: { x: c.L, y: c.y }, end: { x: c.R, y: c.y }, thickness: 0.6, color: RULE });
    c.y -= hh + 8 * 22 + 16;
    page.drawText("Acknowledgment in MyHR counts as signing this list.", { x: c.L, y: c.y, size: 9, font: b.italic, color: MUTED });
  }
  if (doc.sample) page.drawText("SAMPLE - NOT AN ISSUED DOCUMENT", { x: SIDE, y: 48, size: 7, font: b.bold, color: MUTED });
  finishPages(pdf, b, control);
  return pdf.save();
}

/** Readable dates for the documents: "November 10, 2026" and "10th day of November 2026". */
export function longDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${iso.slice(0, 10)}T00:00:00+08:00`));
}
export function dayOf(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00+08:00`), n = Number(iso.slice(8, 10));
  const sfx = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${sfx} day of ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(d)}`;
}
