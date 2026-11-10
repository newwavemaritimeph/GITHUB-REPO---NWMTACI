import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { type DocumentControl } from "@/lib/document-controls";
import { courseForm, groupTick, SHEET_LINES, taskGroups, type AssessmentTask, type TraineeResult } from "@/lib/completion-record";
import { SHEET_TITLES, type SheetKind } from "@/lib/training-sheets";
import { LEGAL, LEGAL_LANDSCAPE, SIDE, NAVY, INK, MUTED, RULE, drawLetterhead, finishPages, fitText, loadBrand, newPage, safe, wrapWords } from "@/lib/print/letterhead";

/**
 * The Training Reports sheets as PDF, Design 2 · Clean Lines (owner, 10 Nov 2026): the Corporate Two-Tone letterhead and
 * footer on Legal paper, the course details in light blue boxes, a light blue heading row and thin lines.
 * - Attendance Sheet (NW-TRNG-06-25): portrait, one sheet per training day with Signature over AM and PM Session;
 *   CCMD puts every day on one sheet of 30 lines.
 * - Exercise Performance Sheet (NW-TRNG-08-26): landscape, the course's EP columns, left blank to tick by hand.
 * - Assessment Performance Sheet (NW-TRNG-09-26): landscape, ticks from the TCROA.
 */
export type SheetTrainee = { enrollmentId: string; name: string; rank: string | null };
export type TrainingSheetInput = {
  kind: SheetKind; control?: DocumentControl | null;
  /** `emblem` is New Wave's emblem: the letterhead logo and the faint corner watermark. `logo` is no longer drawn. */
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

/** A heading on one line at 8.5pt, or a short one that just misses at 7pt, or wrapped at the largest size whose lines fit ("EP" over "A4.10"). */
function headingLines(label: string, font: PDFFont, width: number): { lines: string[]; size: number } {
  for (const size of [8.5, 7]) if (font.widthOfTextAtSize(label, size) <= width) return { lines: [label], size };
  for (const size of [8.5, 7.5, 7, 6.5]) { const lines = wrapWords(label, font, size, width); if (lines.every((l) => font.widthOfTextAtSize(l, size) <= width)) return { lines: lines.slice(0, 3), size }; }
  return { lines: wrapWords(label, font, 6.5, width).slice(0, 3), size: 6.5 };
}

const SOFT = rgb(0.918, 0.953, 0.984), BLUE = rgb(0.02, 0.443, 0.816), GREEN = rgb(0.12, 0.48, 0.3), RED = rgb(0.7, 0.14, 0.1);
type Col = { label: string; weight: number; sub?: string };

export async function createTrainingSheetPdf(input: TrainingSheetInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(SHEET_TITLES[input.kind]);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const b = await loadBrand(pdf, input.emblem);
  const form = courseForm(input.courseCode), groups = taskGroups(input.tasks);
  const portrait = input.kind === "attendance", oneSheet = portrait && form.attendanceAllDays;
  const size = portrait ? LEGAL : LEGAL_LANDSCAPE, [W] = size, L = SIDE, R = W - SIDE;
  const lines = oneSheet ? 30 : portrait ? SHEET_LINES : 18;
  const apCount = groups.length || form.apCount;
  const eps = form.eps.widths, days = input.allDays.length ? input.allDays : [input.startsOn];

  // Column widths follow each Word file's grid (twips), scaled to the page. Columns with `sub` share one heading above them.
  const cols: Col[] = input.kind === "assessment"
    ? [{ label: "No.", weight: 562 }, { label: "TRAINEE'S NAME", weight: 4820 }, ...(form.writtenOnSheet ? [{ label: "Written Assessment Grade in %", weight: 1277 }] : []), ...Array.from({ length: apCount }, (_, i) => ({ label: "", sub: form.apLabel(i), weight: apCount <= 4 ? 1130 : 4900 / apCount })), { label: "Signature", weight: 2127 }, { label: "Remarks", weight: 2977 }]
    : input.kind === "exercise"
      ? [{ label: "No.", weight: eps[0] }, { label: "TRAINEE'S NAME", weight: eps[1] }, ...eps.slice(2, -2).map((weight, i) => ({ label: "", sub: `${form.eps.prefix}${i + 1}`, weight })), { label: "Signature", weight: eps[eps.length - 2] }, { label: "Remarks", weight: eps[eps.length - 1] }]
      : oneSheet
        ? [{ label: "No.", weight: 567 }, { label: "NAME OF TRAINEES", weight: 3181 }, { label: "RANK/ POSITION", weight: 1964 }, ...days.map((_, i) => ({ label: "", sub: `DAY ${i + 1}`, weight: days.length === 3 ? [2069, 1558, 1558][i] : 5185 / days.length }))]
        : [{ label: "No.", weight: 567 }, { label: "NAME OF TRAINEES", weight: 4140 }, { label: "RANK/ POSITION", weight: 2410 }, { label: "", sub: "AM SESSION", weight: 1843 }, { label: "", sub: "PM SESSION", weight: 1842 }];
  const total = cols.reduce((s, c) => s + c.weight, 0), xs: number[] = [L];
  for (const c of cols) xs.push(xs[xs.length - 1] + (c.weight / total) * (R - L));
  const firstSub = cols.findIndex((c) => c.sub), lastSub = cols.map((c) => !!c.sub).lastIndexOf(true);
  const firstAp = form.writtenOnSheet ? 3 : 2;
  const who: [string, string] = input.kind === "assessment" ? ["Assessor", input.assessor] : ["Instructor", input.instructor ?? ""];
  const details: [string, string][] = oneSheet
    ? [["Course", input.courseName], ["Course Batch", input.classNo], ["Schedule", ccmdSchedule(input.startsOn, input.endsOn, input.dailyStart, input.dailyEnd)], [who[0], who[1]]]
    : [["Training Course", input.courseName], ["Class No.", input.classNo], ["Class Schedule", scheduleText(input.startsOn, input.endsOn)], ...(input.dailyStart && input.dailyEnd ? [["Daily Time", `${input.dailyStart.slice(0, 5)} - ${input.dailyEnd.slice(0, 5)}`] as [string, string]] : []), [who[0], who[1]]];

  const sheet = (day: string | null, part: (SheetTrainee | null)[], offset: number, nothingFollows: boolean) => {
    const page: PDFPage = newPage(pdf, b, size);
    const text = (s: string, x: number, y: number, sz: number, f = b.reg, color: RGB = INK) => page.drawText(safe(s), { x, y, size: sz, font: f, color });
    const centered = (s: string, x0: number, x1: number, y: number, sz: number, f = b.reg, color: RGB = INK) => { const t = fitText(s, f, sz, x1 - x0 - 4); page.drawText(t, { x: x0 + (x1 - x0 - f.widthOfTextAtSize(t, sz)) / 2, y, size: sz, font: f, color }); };
    const check = (cx: number, cy: number) => page.drawSvgPath("M 0 3.5 L 3 7 L 8.5 0", { x: cx - 4.2, y: cy + 3.5, borderColor: GREEN, borderWidth: 1.3 });
    const cross = (cx: number, cy: number) => { page.drawLine({ start: { x: cx - 3.5, y: cy - 3.5 }, end: { x: cx + 3.5, y: cy + 3.5 }, thickness: 1.2, color: RED }); page.drawLine({ start: { x: cx - 3.5, y: cy + 3.5 }, end: { x: cx + 3.5, y: cy - 3.5 }, thickness: 1.2, color: RED }); };
    const dayNo = day ? days.indexOf(day) + 1 : 0;
    const right = portrait && day && days.length > 1 ? `Day ${dayNo} of ${days.length} - ${formDay(day)}` : portrait && day ? formDay(day) : `Class No. ${input.classNo}`;
    let y = drawLetterhead(page, b, input.control, { title: SHEET_TITLES[input.kind], right });

    // The course details in light blue boxes.
    const per = portrait ? 3 : Math.min(details.length, 5), bw = (R - L - (per - 1) * 8) / per, bh = 34;
    details.forEach(([k, v], i) => {
      const x = L + (i % per) * (bw + 8), top = y + 8 - Math.floor(i / per) * (bh + 8);
      page.drawRectangle({ x, y: top - bh, width: bw, height: bh, color: SOFT });
      text(`${k.toUpperCase()}:`, x + 8, top - 12, 7.5, b.reg, MUTED);
      text(fitText(v || "-", b.bold, 10, bw - 14), x + 8, top - 26, 10, b.bold, NAVY);
    });
    y -= Math.ceil(details.length / per) * (bh + 8) + 6;

    // Table: a light blue heading row, a blue rule under it, thin lines.
    const headH = 32, footRoom = portrait ? 140 : 116, rowH = Math.min(portrait ? 26 : 20, (y - headH - footRoom) / lines);
    const fill = (x0: number, x1: number, yTop: number, h: number) => page.drawRectangle({ x: x0, y: yTop - h, width: x1 - x0, height: h, color: SOFT });
    const heading = (label: string, x0: number, x1: number, yTop: number, h: number, color: RGB = NAVY) => {
      const { lines: ls, size: sz } = headingLines(label.toUpperCase(), b.bold, x1 - x0 - 4);
      let ty = yTop - (h - ls.length * (sz + 1)) / 2 - sz + 0.5;
      for (const l of ls) { centered(l, x0, x1, ty, sz, b.bold, color); ty -= sz + 1; }
    };
    fill(L, R, y, headH);
    cols.forEach((c, k) => { if (!c.sub) heading(c.label, xs[k], xs[k + 1], y, headH); });
    if (firstSub >= 0) {
      const group = input.kind === "attendance" ? (oneSheet || days.length < 2 || !day ? "SIGNATURE" : `SIGNATURE DAY ${dayNo}`) : input.kind === "exercise" ? "Exercise Performance" : "Assessment Performance";
      heading(group, xs[firstSub], xs[lastSub + 1], y, 15);
      page.drawLine({ start: { x: xs[firstSub] + 4, y: y - 15 }, end: { x: xs[lastSub + 1] - 4, y: y - 15 }, thickness: 0.5, color: RULE });
      for (let k = firstSub; k <= lastSub; k++) heading(cols[k].sub ?? "", xs[k], xs[k + 1], y - 15, headH - 15, BLUE);
    }
    page.drawLine({ start: { x: L, y: y - headH }, end: { x: R, y: y - headH }, thickness: 1.4, color: BLUE });
    const firstBlank = part.indexOf(null);
    part.forEach((t, n) => {
      const rowTop = y - headH - n * rowH, sz = rowH < 15 ? 9 : 10, base = rowTop - rowH / 2 - sz * 0.35, mid = rowTop - rowH / 2;
      page.drawLine({ start: { x: L, y: rowTop - rowH }, end: { x: R, y: rowTop - rowH }, thickness: 0.5, color: RULE });
      centered(`${offset + n + 1}.`, xs[0], xs[1], base, sz - 0.5, b.reg, MUTED);
      if (!t) { if (nothingFollows && n === firstBlank) centered("-Nothing Follows-", xs[1], xs[2], base, sz, b.reg, MUTED); return; }
      text(fitText(t.name, b.reg, sz, xs[2] - xs[1] - 8), xs[1] + 5, base, sz);
      if (portrait) text(fitText(t.rank ?? "", b.reg, sz - 0.5, xs[3] - xs[2] - 8), xs[2] + 5, base, sz - 0.5, b.reg, MUTED);
      const r = input.kind === "assessment" ? input.results[t.enrollmentId] : undefined;
      if (!r) return;
      if (form.writtenOnSheet && r.pct !== null) centered(String(r.pct), xs[2], xs[3], base, sz, b.bold);
      groups.slice(0, apCount).forEach((g, i) => { const k = firstAp + i, v = groupTick(r, g), cx = (xs[k] + xs[k + 1]) / 2; if (v === true) check(cx, mid); else if (v === false) cross(cx, mid); });
    });
    const bottom = y - headH - lines * rowH;
    // Lines between the columns under one group heading start below that heading.
    for (let k = 1; k < cols.length; k++) page.drawLine({ start: { x: xs[k], y: k > firstSub && k <= lastSub && firstSub >= 0 ? y - 15 : y }, end: { x: xs[k], y: bottom }, thickness: 0.5, color: RULE });

    // Sign-off: the instructor (or assessor) signs over the line; the performance sheets add the legend.
    const sy = bottom - (portrait ? 54 : 48), sw = 230;
    const sign = (label: string, name: string, role: string) => {
      text(label, L, bottom - 20, 10, b.reg, MUTED);
      if (name) centered(name, L, L + sw, sy + 5, 10.5, b.bold, NAVY);
      page.drawLine({ start: { x: L, y: sy }, end: { x: L + sw, y: sy }, thickness: 0.7, color: INK });
      centered(role, L, L + sw, sy - 12, 9, b.reg, MUTED);
    };
    if (portrait) sign("Checked and Verified by:", input.instructor ?? "", "Instructor");
    else {
      sign("Certified correct by:", who[1], input.kind === "assessment" ? "Assessor's printed name over signature" : "Instructor's printed name over signature");
      const lx = R - 200;
      text("Legend:", lx, bottom - 20, 10, b.bold, NAVY);
      check(lx + 8, bottom - 38); text("= Performed", lx + 20, bottom - 38, 9.5);
      cross(lx + 108, bottom - 34); text("= Not Performed", lx + 118, bottom - 38, 9.5);
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
  finishPages(pdf, b, input.control);
  return pdf.save();
}
