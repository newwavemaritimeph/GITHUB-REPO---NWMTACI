import { PDFDocument, StandardFonts, TextRenderingMode, popGraphicsState, pushGraphicsState, rgb, setLineWidth, setStrokingColor, setTextRenderingMode, type PDFFont, type PDFPage } from "pdf-lib";
import { controlRows, type DocumentControl } from "@/lib/document-controls";
import { courseForm, groupTick, SHEET_LINES, taskGroups, type AssessmentTask, type TraineeResult } from "@/lib/completion-record";
import { SHEET_TITLES, type SheetKind } from "@/lib/training-sheets";
import { drawWatermark } from "@/lib/print/watermark";

/**
 * The Training Reports sheets as PDF, drawn like New Wave's own Word files (owner, 9 Nov 2026).
 * - Attendance Sheet (NW-TRNG-06-25): A4 portrait, one sheet per training day with Signature over AM and PM Session;
 *   CCMD puts every day on one sheet of 30 lines.
 * - Exercise Performance Sheet (NW-TRNG-08-26): A4 landscape, the course's EP columns, left blank to tick by hand.
 *   Both have the framed header (logo, blue divider, outlined title, Form No. at the top right), peach and light blue
 *   heading cells, the blue and peach page bands and the tagline at the bottom right.
 * - Assessment Performance Sheet (NW-TRNG-09-26): A4 landscape, ticks from the TCROA, its own heading.
 * Every sheet carries New Wave's emblem as a faint watermark.
 */
export type SheetTrainee = { enrollmentId: string; name: string; rank: string | null };
export type TrainingSheetInput = {
  kind: SheetKind; control?: DocumentControl | null;
  /** New Wave's logo with its name (the framed header) and its emblem (the watermark, and the Assessment sheet's heading). */
  logo?: Uint8Array; emblem?: Uint8Array;
  courseCode: string; courseName: string; classNo: string; startsOn: string; endsOn: string; dailyStart?: string | null; dailyEnd?: string | null; instructor: string | null;
  /** Attendance: the days to print, one sheet each (CCMD: all on one sheet); `allDays` numbers them (Signature Day 2). */
  days: string[]; allDays: string[];
  trainees: SheetTrainee[]; tasks: AssessmentTask[]; results: Record<string, TraineeResult>; assessor: string;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** "26 MAY 2026", as on the form. */
export const formDay = (d: string) => { const [y, m, dd] = d.slice(0, 10).split("-"); return `${dd} ${MONTHS[Number(m) - 1]} ${y}`; };
/** "26 MAY 2026 – 26 MAY 2026": the form shows both ends even for a one-day class. */
export const scheduleText = (a: string, b: string) => `${formDay(a)} – ${formDay(b || a)}`;
/** CCMD's schedule as on its Attendance Sheet: "NOV 19-21, 2026 (08:00-17:00)". */
export function ccmdSchedule(a: string, b: string, from?: string | null, to?: string | null) {
  const [y1, m1, d1] = a.slice(0, 10).split("-"), [y2, m2, d2] = (b || a).slice(0, 10).split("-"), mon = (m: string) => MONTHS[Number(m) - 1];
  const dates = `${y1}${m1}${d1}` === `${y2}${m2}${d2}` ? `${mon(m1)} ${d1}, ${y1}`
    : y1 === y2 && m1 === m2 ? `${mon(m1)} ${d1}-${d2}, ${y1}`
      : `${mon(m1)} ${d1}${y1 === y2 ? "" : `, ${y1}`} - ${mon(m2)} ${d2}, ${y2}`;
  return from && to ? `${dates} (${from.slice(0, 5)}-${to.slice(0, 5)})` : dates;
}

/** Helvetica speaks WinAnsi: keep Latin-1 (Ñ) and the en dash, swap other typographic marks. */
const safe = (s: string) => s.replace(/—/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/[^\x20-\x7E\xA0-\xFF–]/g, "");
const fit = (text: string, font: PDFFont, size: number, width: number) => { let t = safe(text); while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1); return t; };
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = safe(text).split(/\s+/).filter(Boolean), lines: string[] = [];
  let line = "";
  for (const w of words) { const next = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(next, size) <= width || !line) line = next; else { lines.push(line); line = w; } }
  if (line) lines.push(line);
  return lines;
}
/** A heading on one line at 8pt, or a short one that just misses (AP 10) at 6.5pt, or wrapped at the largest size whose lines fit ("EP" over "A4.10"). */
function headingLines(label: string, font: PDFFont, width: number): { lines: string[]; size: number } {
  if (font.widthOfTextAtSize(label, 8) <= width) return { lines: [label], size: 8 };
  if (font.widthOfTextAtSize(label, 6.5) <= width) return { lines: [label], size: 6.5 };
  for (const size of [8, 7, 6.5, 6]) { const lines = wrap(label, font, size, width); if (lines.every((l) => font.widthOfTextAtSize(l, size) <= width)) return { lines: lines.slice(0, 3), size }; }
  return { lines: wrap(label, font, 6, width).slice(0, 3), size: 6 };
}

const PEACH = rgb(0.984, 0.894, 0.835), LIGHT_BLUE = rgb(0.851, 0.886, 0.953), DIVIDER = rgb(0, 0.69, 0.941);
const FRAME = rgb(0.616, 0.863, 0.953), ORANGE = rgb(0.957, 0.694, 0.514), BAND_TOP = rgb(0.525, 0.839, 0.961), BAND_BOTTOM = rgb(0.965, 0.769, 0.627);

type Col = { label: string; weight: number; sub?: string };

export async function createTrainingSheetPdf(input: TrainingSheetInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(SHEET_TITLES[input.kind]);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), script = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const image = async (bytes?: Uint8Array) => { if (!bytes) return null; try { return await pdf.embedPng(bytes); } catch { return null; } };
  const logo = await image(input.logo), emblem = await image(input.emblem);
  const form = courseForm(input.courseCode), groups = taskGroups(input.tasks);
  const framed = input.kind !== "assessment", portrait = input.kind === "attendance", oneSheet = portrait && form.attendanceAllDays;
  const [W, H] = portrait ? [595.28, 841.89] : [841.89, 595.28];
  const L = framed ? 32 : 40, R = W - (framed ? 28 : 40), black = rgb(0, 0, 0);
  const lines = oneSheet ? 30 : SHEET_LINES;
  const apCount = groups.length || form.apCount;
  const eps = form.eps.widths, days = input.allDays.length ? input.allDays : [input.startsOn];

  // Column widths follow each Word file's grid (twips), scaled to the page. Columns with `sub` share one heading above them.
  const cols: Col[] = input.kind === "assessment"
    ? [{ label: "", weight: 562 }, { label: "TRAINEE'S NAME", weight: 4820 }, ...(form.writtenOnSheet ? [{ label: "Written Assessment Grade in %", weight: 1277 }] : []), ...Array.from({ length: apCount }, (_, i) => ({ label: form.apLabel(i), weight: apCount <= 4 ? 1130 : 4900 / apCount })), { label: "Signature", weight: 2127 }, { label: "Remarks", weight: 2977 }]
    : input.kind === "exercise"
      ? [{ label: "", weight: eps[0] }, { label: "TRAINEE'S NAME", weight: eps[1] }, ...eps.slice(2, -2).map((weight, i) => ({ label: `${form.eps.prefix}${i + 1}`, weight })), { label: "Signature", weight: eps[eps.length - 2] }, { label: "Remarks", weight: eps[eps.length - 1] }]
      : oneSheet
        ? [{ label: "", weight: 567 }, { label: "NAME OF TRAINEES", weight: 3181 }, { label: "RANK/ POSITION", weight: 1964 }, ...days.map((_, i) => ({ label: "", sub: `DAY ${i + 1}`, weight: days.length === 3 ? [2069, 1558, 1558][i] : 5185 / days.length }))]
        : [{ label: "", weight: 567 }, { label: "NAME OF TRAINEES", weight: 4140 }, { label: "RANK/ POSITION", weight: 2410 }, { label: "", sub: "AM SESSION", weight: 1843 }, { label: "", sub: "PM SESSION", weight: 1842 }];
  const total = cols.reduce((s, c) => s + c.weight, 0), xs: number[] = [L];
  for (const c of cols) xs.push(xs[xs.length - 1] + (c.weight / total) * (R - L));
  const firstAp = form.writtenOnSheet ? 3 : 2, firstSub = cols.findIndex((c) => c.sub);

  const sheet = (day: string | null, part: (SheetTrainee | null)[], offset: number, nothingFollows: boolean) => {
    const page: PDFPage = pdf.addPage([W, H]);
    if (emblem) drawWatermark(page, emblem);
    const text = (s: string, x: number, y: number, size: number, font = reg) => page.drawText(safe(s), { x, y, size, font, color: black });
    const centered = (s: string, x0: number, x1: number, y: number, size: number, font = reg) => { const t = fit(s, font, size, x1 - x0 - 4); page.drawText(t, { x: x0 + (x1 - x0 - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color: black }); };
    const check = (cx: number, cy: number) => page.drawSvgPath("M 0 3 L 2.6 6 L 7.5 0", { x: cx - 3.7, y: cy + 3, borderColor: black, borderWidth: 1 });
    const cross = (cx: number, cy: number) => { page.drawLine({ start: { x: cx - 3, y: cy - 3 }, end: { x: cx + 3, y: cy + 3 }, thickness: 1, color: black }); page.drawLine({ start: { x: cx - 3, y: cy + 3 }, end: { x: cx + 3, y: cy - 3 }, thickness: 1, color: black }); };
    const ctl = controlRows(input.control);
    let top: number;

    if (framed) {
      // Page bands, then the framed header: logo, blue divider, outlined title, Form No. at the top right.
      page.drawRectangle({ x: W - 15, y: H * 0.7, width: 15, height: H * 0.3, color: BAND_TOP });
      page.drawRectangle({ x: 0, y: 0, width: 15, height: H * 0.3, color: BAND_BOTTOM });
      const fH = portrait ? 76 : 64, fTop = H - 22, fBot = fTop - fH, ls = portrait ? 84 : 72;
      // The logo's white margin is covered by the frame, drawn after it.
      if (logo) page.drawImage(logo, { x: L - 4, y: fBot - (portrait ? 12 : 10), width: ls, height: ls });
      page.drawRectangle({ x: L, y: fBot, width: R - L, height: fH, borderColor: FRAME, borderWidth: 3 });
      page.drawRectangle({ x: L + 3.5, y: fBot + 3.5, width: R - L - 7, height: fH - 7, borderColor: ORANGE, borderWidth: 0.8 });
      const dx = L + ls - 8;
      page.drawLine({ start: { x: dx, y: fBot + 11 }, end: { x: dx, y: fTop - 11 }, thickness: 1.5, color: DIVIDER });
      const title = SHEET_TITLES[input.kind].toUpperCase(), ts = portrait ? 24 : 26, tw = bold.widthOfTextAtSize(title, ts);
      const tx = portrait ? (W - tw) / 2 : (dx + R - 120 - tw) / 2 + 30, ty = fBot + fH / 2 - ts * 0.35;
      page.drawText(title, { x: tx + 1.2, y: ty - 1.2, size: ts, font: bold, color: rgb(0.77, 0.77, 0.77) });
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.FillAndOutline), setStrokingColor(rgb(0.5, 0.5, 0.5)), setLineWidth(0.7));
      page.drawText(title, { x: tx, y: ty, size: ts, font: bold, color: rgb(0.89, 0.89, 0.89) });
      page.pushOperators(popGraphicsState());
      ctl.forEach(([k, v], i) => { const s = safe(`${k}: ${v}`); page.drawText(s, { x: R - 9 - reg.widthOfTextAtSize(s, 5.8), y: fTop - 12 - i * 7, size: 5.8, font: reg, color: black }); });

      // Training Course, Class No. and Class Schedule: bold labels, underlined values.
      const line = (label: string, value: string, x: number, y: number, maxW: number, right = false) => {
        const lw = bold.widthOfTextAtSize(label, 10.5) + 5, v = fit(value, reg, 10.5, maxW - lw), vw = reg.widthOfTextAtSize(v, 10.5), x0 = right ? R - lw - vw : x;
        page.drawText(label, { x: x0, y, size: 10.5, font: bold, color: black });
        page.drawText(v, { x: x0 + lw, y, size: 10.5, font: reg, color: black });
        page.drawLine({ start: { x: x0 + lw, y: y - 1.6 }, end: { x: x0 + lw + vw, y: y - 1.6 }, thickness: 0.6, color: black });
      };
      const y0 = fBot - 20;
      if (oneSheet) {
        line("Course:", input.courseName, L, y0, R - L); line("Course Batch:", input.classNo, L, y0 - 15, R - L);
        line("Schedule:", ccmdSchedule(input.startsOn, input.endsOn, input.dailyStart, input.dailyEnd), L, y0 - 30, R - L);
      } else if (portrait) {
        line("Training Course:", input.courseName, L, y0, R - L); line("Class No.:", input.classNo, L, y0 - 15, R - L);
        line("Class Schedule:", scheduleText(input.startsOn, input.endsOn), L, y0 - 30, R - L);
      } else {
        line("Training Course:", input.courseName, L, y0, R - L - 190); line("Class No.:", input.classNo, L, y0, 180, true);
        line("Class Schedule:", scheduleText(input.startsOn, input.endsOn), L, y0 - 15, R - L);
      }
      top = portrait ? y0 - 42 : y0 - 26;
    } else {
      // The Assessment Performance Sheet keeps its own heading: emblem, title and form box.
      if (emblem) page.drawImage(emblem, { x: L, y: H - 84, width: 54, height: 54 });
      centered(SHEET_TITLES[input.kind].toUpperCase(), L, R, H - 62, 16, bold);
      if (ctl.length) {
        const bw = 160, bh = ctl.length * 10 + 6, bx = R - bw, by = H - 30;
        page.drawRectangle({ x: bx, y: by - bh, width: bw, height: bh, borderColor: black, borderWidth: 0.7 });
        ctl.forEach(([k, v], i) => text(`${k}: ${v}`, bx + 5, by - 11 - i * 10, 7.5));
      }
      page.drawLine({ start: { x: L, y: H - 92 }, end: { x: R, y: H - 92 }, thickness: 1, color: black });
      const pair = (label: string, value: string, x: number, y: number, width: number, align: "left" | "right" = "left") => {
        const lw = reg.widthOfTextAtSize(label, 10), v = fit(value, bold, 10, width - lw), vw = bold.widthOfTextAtSize(v, 10), x0 = align === "right" ? R - lw - vw : x;
        text(label, x0, y, 10); page.drawText(v, { x: x0 + lw, y, size: 10, font: bold, color: black });
      };
      pair("Training Course: ", input.courseName, L, H - 112, R - L - 170);
      pair("Class No.: ", input.classNo, L, H - 112, 160, "right");
      pair("Class Schedule: ", scheduleText(input.startsOn, input.endsOn), L, H - 128, 320);
      top = H - 140;
    }

    // Table.
    const headH = 26, foot = portrait ? 150 : framed ? 100 : 74;
    const rowH = Math.min(portrait ? 21 : 16, (top - headH - foot) / lines);
    const cell = (k: number, y: number, h: number, fill?: typeof PEACH, to = k) => page.drawRectangle({ x: xs[k], y: y - h, width: xs[to + 1] - xs[k], height: h, borderColor: black, borderWidth: 0.6, ...(fill ? { color: fill } : {}) });
    const heading = (label: string, x0: number, x1: number, yTop: number, h: number) => {
      const { lines: ls, size } = headingLines(label, bold, x1 - x0 - 3);
      let y = yTop - (h - ls.length * (size + 1)) / 2 - size + 0.5;
      for (const l of ls) { centered(l, x0, x1, y, size, bold); y -= size + 1; }
    };
    cols.forEach((c, k) => {
      if (c.sub) return;
      cell(k, top, headH, framed ? PEACH : undefined);
      heading(c.label, xs[k], xs[k + 1], top, headH);
    });
    if (firstSub >= 0) {
      const last = cols.length - 1, groupLabel = oneSheet || days.length < 2 || !day ? "SIGNATURE" : `SIGNATURE DAY ${days.indexOf(day) + 1}`;
      cell(firstSub, top, 14, PEACH, last);
      heading(groupLabel, xs[firstSub], xs[last + 1], top, 14);
      for (let k = firstSub; k <= last; k++) { cell(k, top - 14, headH - 14, LIGHT_BLUE); heading(cols[k].sub ?? "", xs[k], xs[k + 1], top - 14, headH - 14); }
    }
    const firstBlank = part.indexOf(null);
    part.forEach((t, n) => {
      const rowTop = top - headH - n * rowH, size = portrait ? 9 : 8.5, base = rowTop - rowH + (rowH - size) / 2 + 1.5, mid = rowTop - rowH / 2;
      cols.forEach((_, k) => cell(k, rowTop, rowH));
      if (framed) text(`${offset + n + 1}.`, xs[0] + 3, base, size - 0.5); else centered(String(offset + n + 1), xs[0], xs[1], base, 8.5);
      if (!t) { if (nothingFollows && n === firstBlank) centered("-Nothing Follows-", xs[1], xs[2], base, size); return; }
      text(fit(t.name, reg, size, xs[2] - xs[1] - 6), xs[1] + 4, base, size);
      if (portrait) text(fit(t.rank ?? "", reg, size, xs[3] - xs[2] - 6), xs[2] + 4, base, size);
      const r = input.kind === "assessment" ? input.results[t.enrollmentId] : undefined;
      if (!r) return;
      if (form.writtenOnSheet && r.pct !== null) centered(String(r.pct), xs[2], xs[3], base, 8.5);
      groups.slice(0, apCount).forEach((g, i) => { const k = firstAp + i, v = groupTick(r, g), cx = (xs[k] + xs[k + 1]) / 2; if (v === true) check(cx, mid); else if (v === false) cross(cx, mid); });
    });
    const bottom = top - headH - lines * rowH;

    if (portrait) {
      // Checked and Verified by: the instructor signs over the line.
      text("Checked and Verified by:", L + 36, bottom - 24, 10.5);
      const sx = L + 36, sw = 190, sy = bottom - 64;
      if (input.instructor) centered(input.instructor, sx, sx + sw, sy + 4, 9.5, bold);
      page.drawLine({ start: { x: sx, y: sy }, end: { x: sx + sw, y: sy }, thickness: 0.7, color: black });
      centered("Instructor", sx, sx + sw, sy - 12, 10.5);
    } else {
      const who = input.kind === "assessment" ? input.assessor : input.instructor ?? "", fy = bottom - 16;
      text("Certified correct by:", L, fy, 9);
      const sx = L + 100, sw = 230;
      if (who) centered(who, sx, sx + sw, fy - 12, 9.5, bold);
      page.drawLine({ start: { x: sx, y: fy - 16 }, end: { x: sx + sw, y: fy - 16 }, thickness: 0.7, color: black });
      centered(input.kind === "assessment" ? "Assessor's printed name over signature" : "Instructor's printed name over signature", sx, sx + sw, fy - 26, 7.5);
      const lx = R - 170;
      text("Legend:", lx, fy, 9); check(lx + 45, fy + 3); text("= Performed", lx + 52, fy, 9);
      text("X", lx + 41, fy - 14, 9); text("= Not Performed", lx + 52, fy - 14, 9);
    }
    if (framed) {
      // "Ride the New Wave of Maritime Excellence", bottom right with an orange rule, as in the Word footer.
      ["“Ride the", "New Wave of", "Maritime Excellence”"].forEach((s, i) => page.drawText(s, { x: R - 8 - script.widthOfTextAtSize(s, 7.5), y: 44 - i * 9, size: 7.5, font: script, color: black }));
      page.drawLine({ start: { x: R - 3, y: 23 }, end: { x: R - 3, y: 54 }, thickness: 1.2, color: ORANGE });
    }
  };

  const chunks: (SheetTrainee | null)[][] = [];
  for (let k = 0; k < Math.max(1, Math.ceil(input.trainees.length / lines)); k++) {
    const part: (SheetTrainee | null)[] = input.trainees.slice(k * lines, (k + 1) * lines);
    while (part.length < lines) part.push(null);
    chunks.push(part);
  }
  const sheetDays: (string | null)[] = portrait && !oneSheet ? (input.days.length ? input.days : days) : [null];
  for (const day of sheetDays) chunks.forEach((part, k) => sheet(day, part, k * lines, input.trainees.length > 0 && k === chunks.length - 1));
  const pages = pdf.getPages();
  if (pages.length > 1) pages.forEach((p, k) => { const s = `Page ${k + 1} of ${pages.length}`; p.drawText(s, { x: (W - reg.widthOfTextAtSize(s, 7)) / 2, y: 12, size: 7, font: reg, color: black }); });
  return pdf.save();
}
