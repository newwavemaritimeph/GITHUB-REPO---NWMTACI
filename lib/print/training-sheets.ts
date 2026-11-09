import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { controlRows, type DocumentControl } from "@/lib/document-controls";
import { courseForm, groupTick, SHEET_LINES, taskGroups, type AssessmentTask, type TraineeResult } from "@/lib/completion-record";
import { SHEET_TITLES, type SheetKind } from "@/lib/training-sheets";

/**
 * The Training Reports sheets as PDF, A4 landscape, drawn like New Wave's Assessment Performance Sheet
 * (Form No. NW-TRNG-09-26, owner's files of 9 Nov 2026): emblem, title and form box; Training Course, Class No.
 * and Class Schedule; 24 numbered lines; "Certified correct by" and the legend. The Attendance Sheet and the
 * Exercise Performance Sheet use the same frame until New Wave's own versions are supplied.
 */
export type SheetTrainee = { enrollmentId: string; name: string; srn: string | null };
export type TrainingSheetInput = {
  kind: SheetKind; control?: DocumentControl | null; logo?: Uint8Array;
  courseCode: string; courseName: string; classNo: string; startsOn: string; endsOn: string; room: string | null; instructor: string | null;
  /** Attendance: the days to print, one sheet each; `allDays` numbers them (Day 2 of 3). */
  days: string[]; allDays: string[];
  trainees: SheetTrainee[]; tasks: AssessmentTask[]; results: Record<string, TraineeResult>; exercises: string[]; assessor: string;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** "26 MAY 2026", as on the form. */
export const formDay = (d: string) => { const [y, m, dd] = d.slice(0, 10).split("-"); return `${dd} ${MONTHS[Number(m) - 1]} ${y}`; };
/** "26 MAY 2026 – 26 MAY 2026": the form shows both ends even for a one-day class. */
export const scheduleText = (a: string, b: string) => `${formDay(a)} – ${formDay(b || a)}`;

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

type Col = { label: string; weight: number; note?: string };

export async function createTrainingSheetPdf(input: TrainingSheetInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(SHEET_TITLES[input.kind]);
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let emblem: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  if (input.logo) { try { emblem = await pdf.embedPng(input.logo); } catch { /* prints without the emblem */ } }
  const W = 841.89, H = 595.28, L = 40, R = W - 40, black = rgb(0, 0, 0);
  const form = courseForm(input.courseCode), groups = taskGroups(input.tasks);
  const apCount = groups.length || form.apCount, exCount = input.exercises.length || 5;

  // Column widths follow the Word file's grid (twips), scaled to the page.
  const cols: Col[] = input.kind === "assessment"
    ? [{ label: "", weight: 562 }, { label: "TRAINEE'S NAME", weight: 4820 }, ...(form.writtenOnSheet ? [{ label: "Written Assessment Grade in %", weight: 1277 }] : []), ...Array.from({ length: apCount }, (_, i) => ({ label: form.apLabel(i), weight: apCount <= 4 ? 1130 : 4900 / apCount })), { label: "Signature", weight: 2127 }, { label: "Remarks", weight: 2977 }]
    : input.kind === "exercise"
      ? [{ label: "", weight: 562 }, { label: "TRAINEE'S NAME", weight: 4820 }, ...Array.from({ length: exCount }, (_, i) => ({ label: `Ex. ${i + 1}`, note: input.exercises[i], weight: exCount <= 5 ? 1130 : 5600 / exCount })), { label: "Signature", weight: 2127 }, { label: "Remarks", weight: 2977 }]
      : [{ label: "", weight: 562 }, { label: "TRAINEE'S NAME", weight: 4600 }, { label: "SRN", weight: 1700 }, { label: "Time In (AM)", weight: 1300 }, { label: "Signature", weight: 2200 }, { label: "Time Out (PM)", weight: 1300 }, { label: "Signature", weight: 2200 }, { label: "Remarks", weight: 2200 }];
  const total = cols.reduce((s, c) => s + c.weight, 0), xs: number[] = [L];
  for (const c of cols) xs.push(xs[xs.length - 1] + (c.weight / total) * (R - L));
  const firstAp = form.writtenOnSheet ? 3 : 2;

  const sheet = (day: string | null, part: (SheetTrainee | null)[], offset: number, nothingFollows: boolean) => {
    const page: PDFPage = pdf.addPage([W, H]);
    const text = (s: string, x: number, y: number, size: number, font = reg) => page.drawText(safe(s), { x, y, size, font, color: black });
    const centered = (s: string, x0: number, x1: number, y: number, size: number, font = reg) => { const t = fit(s, font, size, x1 - x0 - 4); page.drawText(t, { x: x0 + (x1 - x0 - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color: black }); };
    const check = (cx: number, cy: number) => page.drawSvgPath("M 0 3 L 2.6 6 L 7.5 0", { x: cx - 3.7, y: cy + 3, borderColor: black, borderWidth: 1 });
    const cross = (cx: number, cy: number) => { page.drawLine({ start: { x: cx - 3, y: cy - 3 }, end: { x: cx + 3, y: cy + 3 }, thickness: 1, color: black }); page.drawLine({ start: { x: cx - 3, y: cy + 3 }, end: { x: cx + 3, y: cy - 3 }, thickness: 1, color: black }); };

    // Heading: emblem, title, form box.
    if (emblem) page.drawImage(emblem, { x: L, y: H - 84, width: 54, height: 54 });
    centered(SHEET_TITLES[input.kind].toUpperCase(), L, R, H - 62, 16, bold);
    const ctl = controlRows(input.control);
    if (ctl.length) {
      const bw = 160, bh = ctl.length * 10 + 6, bx = R - bw, by = H - 30;
      page.drawRectangle({ x: bx, y: by - bh, width: bw, height: bh, borderColor: black, borderWidth: 0.7 });
      ctl.forEach(([k, v], i) => text(`${k}: ${v}`, bx + 5, by - 11 - i * 10, 7.5));
    }
    page.drawLine({ start: { x: L, y: H - 92 }, end: { x: R, y: H - 92 }, thickness: 1, color: black });

    // Course, class and schedule.
    const pair = (label: string, value: string, x: number, y: number, width: number, align: "left" | "right" = "left") => {
      const lw = reg.widthOfTextAtSize(label, 10), v = fit(value, bold, 10, width - lw), vw = bold.widthOfTextAtSize(v, 10), x0 = align === "right" ? R - lw - vw : x;
      text(label, x0, y, 10); page.drawText(v, { x: x0 + lw, y, size: 10, font: bold, color: black });
    };
    pair("Training Course: ", input.courseName, L, H - 112, R - L - 170);
    pair("Class No.: ", input.classNo, L, H - 112, 160, "right");
    pair("Class Schedule: ", scheduleText(input.startsOn, input.endsOn), L, H - 128, 320);
    if (day) pair("Training Day: ", `Day ${input.allDays.indexOf(day) + 1} of ${input.allDays.length} – ${formDay(day)}`, L, H - 128, 300, "right");
    if (input.kind !== "assessment") { pair("Room: ", input.room ?? "", L, H - 144, 300); pair("Instructor: ", input.instructor ?? "", L, H - 144, 360, "right"); }

    // Table.
    const top = input.kind === "assessment" ? H - 140 : H - 156, headH = input.kind === "exercise" && input.exercises.length ? 40 : 26;
    const rowH = Math.min(16, (top - headH - 74) / SHEET_LINES);
    const cell = (k: number, y: number, h: number) => page.drawRectangle({ x: xs[k], y: y - h, width: xs[k + 1] - xs[k], height: h, borderColor: black, borderWidth: 0.6 });
    cols.forEach((c, k) => {
      cell(k, top, headH);
      // A short label that just misses one line (AP 10) prints smaller instead of wrapping.
      const one = bold.widthOfTextAtSize(c.label, 8) > xs[k + 1] - xs[k] - 4 && bold.widthOfTextAtSize(c.label, 6.5) <= xs[k + 1] - xs[k] - 4;
      const lines = one ? [c.label] : wrap(c.label, bold, 8, xs[k + 1] - xs[k] - 4).slice(0, 3);
      const notes = c.note ? wrap(c.note, reg, 5.5, xs[k + 1] - xs[k] - 4).slice(0, 3) : [];
      const blockH = lines.length * 9 + notes.length * 6.5;
      let y = top - (headH - blockH) / 2 - 7;
      for (const l of lines) { centered(l, xs[k], xs[k + 1], y, one ? 6.5 : 8, bold); y -= 9; }
      for (const l of notes) { centered(l, xs[k], xs[k + 1], y + 1.5, 5.5); y -= 6.5; }
    });
    const firstBlank = part.indexOf(null);
    part.forEach((t, n) => {
      const rowTop = top - headH - n * rowH, base = rowTop - rowH + (rowH - 8.5) / 2 + 1.5, mid = rowTop - rowH / 2;
      cols.forEach((_, k) => cell(k, rowTop, rowH));
      centered(String(offset + n + 1), xs[0], xs[1], base, 8.5);
      if (!t) { if (nothingFollows && n === firstBlank) centered("-Nothing Follows-", xs[1], xs[2], base, 8.5); return; }
      text(fit(t.name, reg, 8.5, xs[2] - xs[1] - 6), xs[1] + 4, base, 8.5);
      if (input.kind === "attendance") centered(t.srn ?? "", xs[2], xs[3], base, 8.5);
      const r = input.kind === "assessment" ? input.results[t.enrollmentId] : undefined;
      if (!r) return;
      if (form.writtenOnSheet && r.pct !== null) centered(String(r.pct), xs[2], xs[3], base, 8.5);
      groups.slice(0, apCount).forEach((g, i) => { const k = firstAp + i, v = groupTick(r, g), cx = (xs[k] + xs[k + 1]) / 2; if (v === true) check(cx, mid); else if (v === false) cross(cx, mid); });
    });

    // Certified correct by, and the legend.
    const who = input.kind === "assessment" ? input.assessor : input.instructor ?? "";
    text("Certified correct by:", L, 62, 9);
    const sx = L + 100, sw = 230;
    if (who) centered(who, sx, sx + sw, 50, 9.5, bold);
    page.drawLine({ start: { x: sx, y: 46 }, end: { x: sx + sw, y: 46 }, thickness: 0.7, color: black });
    centered(input.kind === "assessment" ? "Assessor's printed name over signature" : "Instructor's printed name over signature", sx, sx + sw, 36, 7.5);
    if (input.kind !== "attendance") {
      const lx = R - 170;
      text("Legend:", lx, 62, 9); check(lx + 45, 65); text("= Performed", lx + 52, 62, 9);
      text("X", lx + 41, 48, 9); text("= Not Performed", lx + 52, 48, 9);
    }
  };

  const chunks: (SheetTrainee | null)[][] = [];
  for (let k = 0; k < Math.max(1, Math.ceil(input.trainees.length / SHEET_LINES)); k++) {
    const part: (SheetTrainee | null)[] = input.trainees.slice(k * SHEET_LINES, (k + 1) * SHEET_LINES);
    while (part.length < SHEET_LINES) part.push(null);
    chunks.push(part);
  }
  for (const day of input.kind === "attendance" ? input.days : [null]) chunks.forEach((part, k) => sheet(day, part, k * SHEET_LINES, input.trainees.length > 0 && k === chunks.length - 1));
  const pages = pdf.getPages();
  if (pages.length > 1) pages.forEach((p, k) => { const s = `Page ${k + 1} of ${pages.length}`; p.drawText(s, { x: R - reg.widthOfTextAtSize(s, 7), y: 18, size: 7, font: reg, color: black }); });
  return pdf.save();
}
