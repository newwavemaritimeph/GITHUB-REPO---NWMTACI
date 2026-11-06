import { PDFDocument } from "pdf-lib";
import { liftTemplateText, type LiftZone, type TemplateFieldsV2 } from "@/lib/certificate-overlay";

/**
 * Reads where a certificate's details sit on an uploaded PDF (owner, 5 Nov 2026: "anything that we upload
 * automatically updates in the whole portal"). The sample text comes off and the portal writes the real
 * values in its place, so a new template needs no measuring by hand.
 */
export type TemplateLine = { text: string; x: number; right: number; y: number; size: number; bold: boolean; sans: boolean };
export type ReadLayout = { fields: TemplateFieldsV2 | null; found: string[]; missing: string[]; lifted: TemplateLine[]; covered?: boolean };

const round = (n: number) => Math.round(n * 10) / 10;
const centre = (l: TemplateLine) => (l.x + l.right) / 2;

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const RANGE = `${MONTH}\\s+${DAY}\\s*(?:-|–|to)\\s*(?:${MONTH}\\s+)?${DAY},?\\s+\\d{4}`;
const DATE = new RegExp(`\\[(?:START DATE|END DATE|ASSESS DATE|DATE)\\]|\\((?:training\\s+)?date\\)|_{3,}|\\b${RANGE}|\\b${MONTH}\\s+${DAY},?\\s+\\d{4}|\\b${DAY}\\s+(?:day\\s+of\\s+)?${MONTH},?\\s+\\d{4}|\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b`, "gi");

/** The paragraph with its sample dates or blanks turned into the placeholders the certificate fills. */
export function dateSlots(paragraph: string) {
  let started = false, slots = 0;
  const text = paragraph.replace(DATE, (match, at: number) => {
    slots += 1;
    if (match.startsWith("[")) { started = true; return match; }
    const before = paragraph.slice(0, at);
    if (/assess\w*[^.]*?\bon\s*$/i.test(before)) return "[ASSESS DATE]";
    if (new RegExp(`^${RANGE}$`, "i").test(match)) { started = true; return "[START DATE] to [END DATE]"; }
    if (started && /\b(?:to|until|through|and)\s*$/i.test(before)) return "[END DATE]";
    if (!started) { started = true; return "[START DATE]"; }
    return "[ASSESS DATE]";
  });
  return { text, slots };
}

const zone = (l: TemplateLine): LiftZone => ({ yMin: round(l.y - l.size * 0.3), yMax: round(l.y + l.size * 0.55), xMin: round(l.x - 1), xMax: round(l.right + 1) });
const NAME = /^\[?\s*(?:trainee'?s?(?:\s+full)?\s+name|name\s+of\s+(?:the\s+)?trainee|full\s+name)\s*\]?$/i;
const INTRO = /(?:\b(?:issued|awarded|presented|granted)\s+to|\bcertif(?:y|ies)\s+that)\s*:?$/i;
const CERT = /^(cert(?:ificate)?\.?\s*(?:no|number|#)\.?\s*:?)\s*(.*)$/i;
const REG = /^(reg(?:istration)?\.?\s*(?:no|number|#)\.?\s*:?)\s*(.*)$/i;
const ISSUED = /^issued\s+this\s+\S+(?:\s+\S+)??\s+day\s+of\s+(?:[a-z]+\.?|_+)[\s,]+(?:20\d{2}|20_+|_+)/i;
const ISSUE_LABEL = /^(date\s+(?:of\s+)?issued?\s*:?|date\s+issued\s*:?|issued\s+on\s*:?)\s*(.*)$/i;

/** Pure: finds the certificate's details among the page's lines of text. */
/** The widest number expected, in font sizes: about 24 characters, as NWMTACI-2026-CCMD-000001. */
const NUMBER_WIDTH = 13.2;

export function layoutFromLines(lines: TemplateLine[], pageW: number, pageH: number): ReadLayout {
  const sorted = [...lines].sort((a, b) => b.y - a.y || a.x - b.x);
  const below = (l: TemplateLine) => sorted.find((o) => o.y < l.y - 1 && o.x < l.right && o.right > l.x);
  const lifted: TemplateLine[] = [];
  const margin = Math.max(20, Math.min(...sorted.map((l) => l.x), pageW / 4));
  const f: TemplateFieldsV2 = { version: 2, auto: true, pageW: round(pageW), pageH: round(pageH) };
  const found: string[] = [], missing: string[] = [];
  const report = (ok: unknown, label: string) => (ok ? found : missing).push(label);

  // The trainee's name: a sample line, or the line (or the blank space) after "issued to".
  const named = sorted.find((l) => NAME.test(l.text));
  const intro = named ? null : sorted.find((l) => INTRO.test(l.text));
  const next = intro ? below(intro) : null;
  const blank = !!intro && (!next || /^(?:[a-z]|for\b)/.test(next.text));
  const sample = named ?? (intro && !blank ? next : null);
  if (sample) { f.name = { cx: round(centre(sample)), y: sample.y, size: sample.size, bold: sample.bold, maxW: round(pageW - margin * 2) }; lifted.push(sample); }
  else if (intro && blank && next && intro.y - next.y >= intro.size * 2.2) { const size = round(intro.size * 1.6); f.name = { cx: round(centre(intro)), y: round((intro.y + next.y) / 2 - size * 0.35), size, bold: true, maxW: round(pageW - margin * 2) }; }
  report(f.name, "Trainee Name");

  // The paragraph with the training dates.
  const start = sorted.find((l) => /^conducted\b/i.test(l.text)) ?? sorted.find((l) => /\bconducted\s+(?:on|from)\b/i.test(l.text));
  const paragraph: TemplateLine[] = [];
  if (start) {
    // A paragraph that does not open with "Conducted" also takes the lines above it.
    if (!/^conducted\b/i.test(start.text)) for (let i = sorted.indexOf(start) - 1; i >= 0; i--) { const l = sorted[i], first = paragraph[0] ?? start; if (first.y - l.y > 0 || Math.abs(l.size - first.size) > 0.6 || l.y - first.y > first.size * 1.8 || Math.abs(l.x - first.x) > 3) break; paragraph.unshift(l); }
    paragraph.push(start);
    for (let cur = below(start); cur; cur = below(cur)) {
      const last = paragraph[paragraph.length - 1];
      const linedUp = Math.abs(cur.x - last.x) <= 3 || Math.abs(cur.right - last.right) <= 3 || Math.abs(centre(cur) - centre(last)) <= 4;
      if (Math.abs(cur.size - last.size) > 0.6 || last.y - cur.y > last.size * 1.8 || !linedUp || CERT.test(cur.text) || REG.test(cur.text) || ISSUED.test(cur.text) || ISSUE_LABEL.test(cur.text) || /^issued\b/i.test(cur.text)) break;
      paragraph.push(cur);
    }
    const slots = dateSlots(paragraph.map((l) => l.text).join(" ").replace(/(\w[-–]) (?=\w)/g, "$1"));
    if (slots.slots) {
      const x = Math.min(...paragraph.map((l) => l.x)), right = Math.max(...paragraph.map((l) => l.right));
      const body = paragraph.slice(0, -1);
      const justified = paragraph.length > 1 && body.every((l, i) => Math.abs(l.right - right) < 2.5 && (!i || Math.abs(l.x - x) < 2.5));
      const centred = !justified && Math.abs(centre(start) - pageW / 2) < 4 && (paragraph.length === 1 ? start.x > margin + 8 : paragraph.some((l) => Math.abs(l.x - x) > 3));
      const oneLine = paragraph.length === 1;
      f.conducted = { x: round(oneLine && centred ? margin : x), y: paragraph[0].y, w: round(oneLine ? pageW - margin - (centred ? margin : x) : right - x), size: start.size, leading: paragraph.length > 1 ? round((paragraph[0].y - paragraph[paragraph.length - 1].y) / (paragraph.length - 1)) : round(start.size * 1.15), align: justified ? 3 : centred ? 1 : 0, text: slots.text };
      lifted.push(...paragraph);
    }
  }
  report(f.conducted, "Training Dates");

  // The issue date: "Issued this ___ day of ___ 20__ ...", a "Date of Issue:" label, or both on one page.
  const issued = sorted.find((l) => ISSUED.test(l.text));
  const issueLabel = sorted.find((l) => ISSUE_LABEL.test(l.text));
  if (issued) {
    const text = issued.text.replace(ISSUED, "Issued this ______ day of ________________ 20____");
    f.issued = Math.abs(centre(issued) - pageW / 2) < 4 ? { cx: round(centre(issued)), y: issued.y, size: issued.size, text } : { x: issued.x, y: issued.y, size: issued.size, text };
    lifted.push(issued);
  }
  if (issueLabel) {
    const m = issueLabel.text.match(ISSUE_LABEL)!;
    if (m[2].replace(/[\s:.]/g, "")) { f.issueDate = { x: issueLabel.x, y: issueLabel.y, size: issueLabel.size, label: m[1].trim(), body: true, bold: issueLabel.bold }; lifted.push(issueLabel); }
    else f.issueDate = { x: round(issueLabel.right + issueLabel.size * 0.3), y: issueLabel.y, size: issueLabel.size, body: true };
  }
  report(f.issued ?? f.issueDate, "Issued Date");

  // Certificate No. and Registration No., on two lines or sharing one.
  const numbers = sorted.flatMap((l) => {
    const reg = l.text.search(/\breg(?:istration)?\.?\s*(?:no|number|#)\b/i);
    if (reg <= 0 || !CERT.test(l.text)) return [l];
    const at = round(l.x + (l.right - l.x) * (reg / l.text.length));
    return [{ ...l, text: l.text.slice(0, reg).trim(), right: at - 1 }, { ...l, text: l.text.slice(reg), x: at }];
  });
  const numberAt = (rule: RegExp) => {
    const line = numbers.find((l) => rule.test(l.text));
    if (!line) return undefined;
    const m = line.text.match(rule)!;
    // A bare label stays on the page and the value goes after it; with a sample value, the portal redraws both.
    // So does a label too near the right edge for a long number (CCMD, owner 5 Nov 2026), so the overlay can move it left.
    const roomy = line.right + line.size * (0.3 + NUMBER_WIDTH) <= pageW - 36;
    if (!m[2].replace(/[\s:.]/g, "") && roomy) return { x: round(line.right + line.size * 0.3), y: line.y, size: line.size, body: true, bold: line.bold };
    lifted.push(line);
    return { x: line.x, y: line.y, size: line.size, label: m[1].trim(), body: true, bold: line.bold };
  };
  f.certNo = numberAt(CERT);
  f.regNo = numberAt(REG);
  report(f.certNo, "Certificate No.");
  report(f.regNo, "Registration No.");
  const small = Math.max(8, Math.round(pageW / 70));
  f.certNo ??= { x: round(pageW * 0.07), y: round(pageH * 0.07 + small * 1.6), size: small, label: "Certificate No:", body: true, bold: true };
  f.regNo ??= { x: round(pageW * 0.07), y: round(pageH * 0.07), size: small, label: "Registration No:", body: true, bold: true };

  // Owner, 3 Nov 2026: the title under April Cantoneros reads Operations Manager on every certificate.
  const title = sorted.filter((l) => /^operational manager$/i.test(l.text));
  if (title.length) { f.fixed = title.map((l) => ({ text: "Operations Manager", cx: round(centre(l)), y: l.y, size: l.size, bold: l.bold })); lifted.push(...title); }

  const bodyLine = paragraph[0] ?? issued ?? issueLabel ?? sorted[0];
  if (bodyLine?.sans) f.sans = true;
  f.lift = lifted.map(zone);
  return { fields: f.name ? f : null, found, missing, lifted };
}

/** Page 1 as lines of text with their positions. Pieces join with a space only where there is a real gap, and columns stay apart. */
export async function readTemplateLines(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // @ts-expect-error pdf.js ships no types for its worker. Importing it keeps pdf.js from looking for the file at run time.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1), [vx, vy, vw, vh] = page.view, pageW = vw - vx, pageH = vh - vy;
    // shortcut: a rotated or shifted page reads as no text (the upload then says Not Found); handle it if such a PDF appears.
    if (vx || vy || page.rotate) return { lines: [] as TemplateLine[], pageW, pageH };
    const content = await page.getTextContent();
    await page.getOperatorList(); // Loads the fonts, for bold and sans.
    const fontName = (id: string) => { try { return String((page.commonObjs.get(id) as { name?: string } | null)?.name ?? ""); } catch { return ""; } };
    type Item = { str: string; x: number; right: number; y: number; size: number; font: string };
    const items: Item[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim() || Math.abs(it.transform[1]) > 0.01) continue;
      items.push({ str: it.str, x: it.transform[4], right: it.transform[4] + it.width, y: it.transform[5], size: Math.hypot(it.transform[2], it.transform[3]), font: it.fontName });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Item[][] = [];
    for (const it of items) {
      const row = rows[rows.length - 1];
      // Within half a font size counts as the same line, so a raised "th" stays with its date.
      if (row && Math.abs(row[0].y - it.y) <= 0.45 * Math.max(row[0].size, it.size)) row.push(it); else rows.push([it]);
    }
    const lines: TemplateLine[] = [];
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      let part: Item[] = [];
      const flush = () => {
        if (!part.length) return;
        let text = "";
        part.forEach((it, i) => { if (i && it.x - part[i - 1].right > 0.12 * it.size && !text.endsWith(" ")) text += " "; text += it.str; });
        const main = part.reduce((a, b) => (b.size > a.size ? b : a)), name = fontName(part.reduce((a, b) => (b.str.length > a.str.length ? b : a)).font);
        lines.push({ text: text.replace(/\s+/g, " ").trim(), x: round(part[0].x), right: round(Math.max(...part.map((p) => p.right))), y: round(main.y), size: round(main.size), bold: /bold|demi|black|heavy/i.test(name), sans: /arial|helvetica|calibri|verdana|tahoma|segoe|sans|roboto|geist|montserrat|poppins|lato/i.test(name) });
        part = [];
      };
      for (const it of row) {
        const last = part[part.length - 1];
        if (last && it.x - last.right > 3 * Math.max(it.size, last.size)) flush();
        part.push(it);
      }
      flush();
    }
    return { lines, pageW, pageH };
  } finally {
    await doc.destroy();
  }
}

/**
 * Reads an uploaded PDF. Returns null for a file already converted from the Word templates, whose measured
 * positions carry fixes. Sample text the page will not give up is covered, so nothing ever prints over it.
 */
export async function autoLayout(bytes: Uint8Array, { hasMeasuredLayout }: { hasMeasuredLayout: boolean }): Promise<ReadLayout | null> {
  const { lines, pageW, pageH } = await readTemplateLines(bytes);
  if (hasMeasuredLayout && lines.some((l) => /\[TRAINEE FULL NAME\]/i.test(l.text))) return null;
  const read = layoutFromLines(lines, pageW, pageH);
  // A template converted from Word hides its description and dates until print, so no dates paragraph can be read here (6 Nov 2026): its measured positions must stay.
  if (hasMeasuredLayout && read.missing.includes("Training Dates")) return null;
  if (!read.fields?.lift?.length) return read;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  liftTemplateText(doc, doc.getPage(0), read.fields.lift);
  const after = await readTemplateLines(await doc.save());
  const stuck = read.lifted.filter((l) => after.lines.some((a) => Math.abs(a.y - l.y) < l.size * 0.5 && a.x < l.right && a.right > l.x));
  if (stuck.length) { read.fields.cover = stuck.map((l) => ({ x: round(l.x - 1), y: round(l.y - l.size * 0.3), w: round(l.right - l.x + 2), h: round(l.size * 1.3) })); read.covered = true; }
  return read;
}
