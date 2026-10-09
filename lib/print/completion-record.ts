import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { durationText, formDate, practicalOk, remarkOf, resultOf, SHEET_LINES, type AssessmentTask, type CompletionFields, type CompletionTrainee, type TraineeResult } from "@/lib/completion-record";

/**
 * Training Completion and Record of Assessment Report as a PDF (owner, 9 Oct 2026):
 * drawn cell for cell like New Wave's form (AD NO. 05-00), A4 landscape, for the
 * TCROA folder in Google Drive and for printing.
 */
export type CompletionPdfInput = { courseName: string; startsOn: string; endsOn: string; tasks: AssessmentTask[]; trainees: CompletionTrainee[]; results: Record<string, TraineeResult>; fields: CompletionFields; logo?: Uint8Array };

/** Helvetica speaks WinAnsi: keep Latin-1 (Ñ, é) and swap typographic dashes and quotes. */
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = safe(text).split(/\s+/).filter(Boolean), lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}
/** Wrapped lines at the largest size (down to 3.4 pt) that fits the box. */
function shrink(text: string, font: PDFFont, max: number, width: number, height: number, lead = 1.2) {
  for (let size = max; size >= 3.4; size -= 0.2) { const lines = wrap(text, font, size, width); if (lines.length * size * lead <= height) return { lines, size }; }
  return { lines: wrap(text, font, 3.4, width), size: 3.4 };
}
const fit = (text: string, font: PDFFont, size: number, width: number) => { let t = safe(text); while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1); return t; };

export async function createCompletionRecordPdf(input: CompletionPdfInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Training Completion and Record of Assessment Report");
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique), boldItal = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const W = 841.89, H = 595.28, L = 17, R = W - 17, black = rgb(0, 0, 0);
  const page: PDFPage = pdf.addPage([W, H]);
  const n = input.tasks.length;

  // Columns: no, name, birth, place, rank, %, remarks, tasks…, practical, C, NYC, certificate.
  const fixed = [16.5, 133.5, 46.5, 69, 72, 19.5, 16.5];
  const tail = [18, 16.5, 19.5, 112.5];
  const taskW = n ? (R - L - [...fixed, ...tail].reduce((s, v) => s + v, 0)) / n : 0;
  const widths = [...fixed, ...Array.from({ length: n }, () => taskW), ...tail];
  const xs: number[] = [L]; for (const w of widths) xs.push(xs[xs.length - 1] + w);
  const col = (i: number) => ({ x: xs[i], w: widths[i] });
  const span = (a: number, b: number) => ({ x: xs[a], w: xs[b + 1] - xs[a] });
  const iPct = 5, iRem = 6, iTask = 7, iPrac = 7 + n, iC = 8 + n, iNyc = 9 + n, iCert = 10 + n;

  const box = (x: number, y: number, w: number, h: number) => page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: black, borderWidth: 0.6 });
  /** Lines of text inside a cell, top-left or centred. y is the cell's top. */
  const write = (lines: string[], x: number, y: number, w: number, h: number, size: number, font: PDFFont, align: "left" | "center" = "left", valign: "top" | "middle" = "middle") => {
    const lh = size * 1.2, total = lines.length * lh;
    let ty = valign === "top" ? y - size - 2 : y - (h - total) / 2 - size + 1;
    for (const line of lines) { const tw = font.widthOfTextAtSize(line, size); page.drawText(line, { x: align === "center" ? x + (w - tw) / 2 : x + 2.5, y: ty, size, font, color: black }); ty -= lh; }
  };
  /** Text turned to read bottom-to-top, centred in the cell, wrapped into side-by-side lines. */
  const vertical = (text: string, x: number, y: number, w: number, h: number, size: number, font: PDFFont) => {
    const fitted = shrink(text, font, size, h - 6, w - 2, 1.15); size = fitted.size;
    const lines = fitted.lines, lh = size * 1.15, total = lines.length * lh;
    let lx = x + (w - total) / 2 + size * 0.85;
    for (const line of lines) { const tw = font.widthOfTextAtSize(line, size); page.drawText(line, { x: lx, y: y - h + (h - tw) / 2, size, font, color: black, rotate: degrees(90) }); lx += lh; }
  };
  const check = (x: number, y: number, w: number, h: number) => page.drawSvgPath("M 0 2 L 1.7 3.9 L 5 0", { x: x + w / 2 - 2.5, y: y - h / 2 + 2, borderColor: black, borderWidth: 0.6 });

  // Heading: document code, emblem, title.
  let y = H - 18;
  write(["AD NO.: 05-00", "Initial Issue Date: 09-14-2023", "Revision Date: 00"], L - 2.5, y, 120, 30, 4.8, reg, "left", "top");
  if (input.logo) { try { const img = await pdf.embedPng(input.logo); page.drawImage(img, { x: L + 170, y: y - 48, width: 46, height: 46 }); } catch { /* the form prints without the emblem */ } }
  page.drawText("TRAINING COMPLETION AND RECORD OF ASSESSMENT REPORT", { x: L + 290, y: y - 30, size: 11, font: bold, color: black });
  y -= 56;

  // Organisation row.
  const all = span(0, iCert);
  box(all.x, y, all.w, 11); write(["New Wave Maritime Training and Assessment Center, Inc."], all.x, y, all.w, 11, 6.8, bold);
  y -= 11;
  const h1 = 44, h2 = 50, h3 = 35, top = y;

  // Row 1.
  const nm = span(0, 1);
  box(nm.x, top, nm.w, h1); write(wrap(`Training Course: ${input.courseName}`, bold, 7.5, nm.w - 5), nm.x, top, nm.w, h1, 7.5, bold, "left", "top");
  const pd = span(2, 4); box(pd.x, top, pd.w, h1); write(["Personal Data"], pd.x, top, pd.w, h1, 6.5, bold, "center");
  const wr = span(iPct, iRem); box(wr.x, top, wr.w, h1 + h2); vertical("Written Assessment Result (refer to *Grading Scheme)", wr.x, top, wr.w, h1 + h2, 5.2, boldItal);
  input.tasks.forEach((t, i) => { const c = col(iTask + i); box(c.x, top, c.w, h1); const k = shrink(t.title, reg, 5.4, c.w - 6, h1 - 3); write(k.lines, c.x, top, c.w, h1, k.size, reg, "center"); });
  const pr = col(iPrac); box(pr.x, top, pr.w, h1 + h2 + h3); vertical("Practical Assessment Result (Refer **Grading Scheme)", pr.x, top, pr.w, h1 + h2 + h3, 5.2, boldItal);
  const rs = span(iC, iNyc); box(rs.x, top, rs.w, h1 + h2); vertical("Result of the Assessment", rs.x, top, rs.w, h1 + h2, 5.2, boldItal);
  const ct = col(iCert); box(ct.x, top, ct.w, h1 + h2 + h3); write(["Training Certificate Number"], ct.x, top, ct.w, h1 + h2 + h3, 6.5, bold, "center");

  // Row 2.
  const y2 = top - h1;
  const f = input.fields;
  box(nm.x, y2, nm.w, h2);
  write([...wrap(`Class No.: ${f.classNo}`, reg, 6, nm.w - 5), ...wrap(`Training Duration: ${durationText(input.startsOn, input.endsOn)}`, reg, 6, nm.w - 5), ...wrap(`Class No.: (For re-sit) ${f.resitClassNo}   Training Duration: ${f.resitDuration}`, reg, 6, nm.w - 5)], nm.x, y2, nm.w, h2, 6, reg, "left", "top");
  ([["Date of Birth (mm/dd/yyyy)", 2], ["Place of Birth", 3], ["Rank", 4]] as const).forEach(([label, i]) => { const c = col(i); box(c.x, y2, c.w, h2 + h3); vertical(label, c.x, y2, c.w, h2 + h3, 5, reg); });
  input.tasks.forEach((t, i) => { const c = col(iTask + i); box(c.x, y2, c.w, h2 + h3); vertical(t.criteria, c.x, y2, c.w, h2 + h3, 4.1, reg); });

  // Row 3.
  const y3 = y2 - h2;
  box(nm.x, y3, nm.w, h3);
  write(["Date and Place", "of Assessment"], nm.x, y3, 60, h3, 6, reg, "left", "top");
  write([fit(`Written: ${f.writtenPlace}`, reg, 6, 70), fit(`Practical: ${f.practicalPlace}`, reg, 6, 70)], nm.x + nm.w - 74, y3, 74, h3, 6, reg, "left", "top");
  page.drawText("Name of Trainee", { x: nm.x + 2.5, y: y3 - h3 + 4, size: 6, font: reg, color: black });
  page.drawText("(Last Name, First Name, Middle Name):", { x: nm.x + 2.5 + reg.widthOfTextAtSize("Name of Trainee ", 6), y: y3 - h3 + 4, size: 4.3, font: reg, color: black });
  ([["Percentage", iPct, reg], ["Remarks", iRem, reg], ["Competent [C]", iC, boldItal], ["Not yet competent [NYC]", iNyc, boldItal]] as const).forEach(([label, i, font]) => { const c = col(i); box(c.x, y3, c.w, h3); vertical(label, c.x, y3, c.w, h3, 5, font); });

  // Trainee lines.
  const lh = 10, lines = Math.max(SHEET_LINES, input.trainees.length + 1);
  let ly = y3 - h3;
  for (let i = 0; i < lines; i++) {
    for (let c = 0; c < widths.length; c++) {
      if (c === 0) { page.drawLine({ start: { x: xs[0], y: ly }, end: { x: xs[0], y: ly - lh }, thickness: 0.6, color: black }); continue; }
      box(c === 1 ? xs[0] : xs[c], ly, c === 1 ? widths[0] + widths[1] : widths[c], lh);
    }
    page.drawText(`${i + 1} .`, { x: xs[0] + 2, y: ly - 7.4, size: 6, font: reg, color: black });
    const t = input.trainees[i];
    if (t) {
      const r = input.results[t.enrollmentId] ?? { pct: null, ticks: [], cert: "" };
      const res = resultOf(r, n);
      const at = (ci: number, text: string, size = 6, font = reg) => { const c = col(ci); const s = fit(text, font, size, c.w - 3); page.drawText(s, { x: c.x + (c.w - font.widthOfTextAtSize(s, size)) / 2, y: ly - 7.4, size, font, color: black }); };
      page.drawText(fit(t.name, reg, 6, widths[1] - 3), { x: xs[1] + 1, y: ly - 7.4, size: 6, font: reg, color: black });
      at(2, formDate(t.birthdate)); at(3, t.placeOfBirth ?? "", 5.2); at(4, t.rank || "N/A", 5.2);
      at(iPct, r.pct === null ? "" : String(r.pct)); at(iRem, remarkOf(r.pct));
      r.ticks.slice(0, n).forEach((tick, j) => { const c = col(iTask + j); if (tick === true) check(c.x, ly, c.w, lh); else if (tick === false) at(iTask + j, "X"); });
      if (res) { const c = col(iPrac); if (practicalOk(r, n)) check(c.x, ly, c.w, lh); else at(iPrac, "X"); }
      if (res === "C") { at(iC, "C"); at(iCert, r.cert); }
      if (res === "NYC") at(iNyc, "NYC", 5.2);
    } else if (i === input.trainees.length && input.trainees.length) page.drawText("***Nothing follows***", { x: xs[1] + 20, y: ly - 7.4, size: 6, font: reg, color: black });
    ly -= lh;
  }

  // Signatures and grading legend.
  const fy = ly - 14;
  page.drawText("Certified Correct:", { x: L, y: fy, size: 6, font: bold, color: black });
  const sign = (x: number, w: number, name: string, role: string | null, extra: string[] = []) => {
    const lineY = fy - 30;
    if (name) { const s = fit(name, bold, 6.5, w); page.drawText(s, { x: x + (w - bold.widthOfTextAtSize(s, 6.5)) / 2, y: lineY + 3, size: 6.5, font: bold, color: black }); }
    page.drawLine({ start: { x, y: lineY }, end: { x: x + w, y: lineY }, thickness: 0.7, color: black });
    let ty = lineY - 8;
    for (const [i, s] of [role, ...extra].filter((v): v is string => v !== null).entries()) { const font = i === 0 && role ? bold : reg; const sz = font === bold ? 6 : 5.6; page.drawText(s, { x: x + (w - font.widthOfTextAtSize(s, sz)) / 2, y: ty, size: sz, font, color: black }); ty -= 7.5; }
  };
  sign(L, 170, f.assessor, "ASSESSOR", ["Signature over Printed Name", safe(`COA Validity: ${f.coaValidity}`)]);
  sign(L + 190, 95, formDate(f.assessedOn), null, ["Date"]);
  sign(L + 310, 170, f.director, "TRAINING DIRECTOR", ["Signature over Printed Name"]);
  sign(L + 500, 95, formDate(f.directorOn), null, ["Date"]);
  // Legend box.
  const lx = R - 176, lw = 176, rows: [string, string, PDFFont, boolean][] = [
    ["*Grading Scheme for Written Assessment: Obtained at least 75% of correct answers out of the total test items (as reflected in the ASSESSMENT PLAN)", "", ital, true],
    ["PASS", "75% and Above", boldItal, false], ["FAILED", "Below 75%", boldItal, false],
    ["**Grading Scheme for Practical Assessment: Successfully meeting all the Assessment Criteria in all Assessment Tasks", "", ital, true],
    ["Legend", "Performed", bold, false], ["X", "Not Performed", bold, false],
  ];
  let gy = fy + 4;
  rows.forEach(([a, b, font, full], i) => {
    const lines2 = full ? wrap(a, font, 4.6, lw - 6) : [a];
    const rh = full ? lines2.length * 5.6 + 3 : 8;
    if (full) { box(lx, gy, lw, rh); write(lines2, lx, gy, lw, rh, 4.6, font, "center"); }
    else {
      box(lx, gy, lw / 2, rh); box(lx + lw / 2, gy, lw / 2, rh);
      write([a], lx, gy, lw / 2, rh, 5, font, i >= 4 ? "center" : "left"); write([b], lx + lw / 2, gy, lw / 2, rh, 5, font, "center");
      if (i === 4) check(lx + lw / 4 + 8, gy, 12, rh);
    }
    gy -= rh;
  });
  return pdf.save();
}
