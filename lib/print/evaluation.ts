import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { ATTENDANCE_STATEMENT, COMMENTS_QUESTION, EVALUATION_SECTIONS, RATING_SCALE, type EvaluationAnswers } from "@/lib/evaluation-form";

/** One trainee's training evaluation, A4 portrait, filed in Google Drive (owner, 20 Oct 2026). */
export type EvaluationPdfInput = { traineeName: string; nwmtaciNo: string; courseName: string; courseCode: string; startsOn: string | null; endsOn: string | null; submittedAt: string; answers: EvaluationAnswers; logo?: Uint8Array };

/** Helvetica speaks WinAnsi: keep Latin-1 (Ñ, é), swap typographic dashes and quotes, drop the rest. */
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/\r?\n|\t/g, " ").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const day = (d: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d.slice(0, 10)}T12:00:00+08:00`));
const stamp = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of safe(para).split(" ").filter(Boolean)) {
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) { // a single overlong word is cut
        let n = w.length - 1; while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n -= 1;
        if (line) { lines.push(line); line = ""; }
        lines.push(w.slice(0, n)); w = w.slice(n);
      }
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width) { lines.push(line); line = w; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export async function createEvaluationPdf(input: EvaluationPdfInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(`Training Evaluation - ${input.traineeName} - ${input.courseCode}`));
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (input.logo) { try { logo = await pdf.embedPng(input.logo); } catch { logo = null; } }
  const navy = rgb(0.07, 0.25, 0.39), blue = rgb(0.02, 0.44, 0.82), orange = rgb(0.95, 0.34, 0.08), ink = rgb(0.06, 0.15, 0.22), muted = rgb(0.37, 0.44, 0.5), line = rgb(0.75, 0.8, 0.85), soft = rgb(0.93, 0.96, 0.98);
  const W = 595.28, H = 841.89, M = 40, CW = W - 2 * M;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, yy: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(safe(s), { x, y: yy, size, font, color });
  const ensure = (need: number) => { if (y - need < M) { page = pdf.addPage([W, H]); y = H - M; } };

  if (logo) page.drawImage(logo, { x: M, y: y - 42, width: 42, height: 42 });
  const lx = M + (logo ? 52 : 0);
  text("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", lx, y - 15, 11, bold, navy);
  text("Ride the New Wave of Maritime Excellence", lx, y - 29, 8.5, reg, blue);
  y -= 50;
  page.drawRectangle({ x: M, y, width: CW, height: 2.2, color: navy });
  page.drawRectangle({ x: M, y: y - 1.4, width: CW * 0.28, height: 1.4, color: orange });
  y -= 30;
  text("TRAINING EVALUATION", M, y, 17, bold, ink);
  y -= 22;

  const dates = input.startsOn ? (input.endsOn && input.endsOn !== input.startsOn ? `${day(input.startsOn)} - ${day(input.endsOn)}` : day(input.startsOn)) : "-";
  const info: [string, string][] = [["Trainee", input.traineeName], ["NWMTACI No.", input.nwmtaciNo || "-"], ["Course", `${input.courseName}${input.courseCode ? ` (${input.courseCode})` : ""}`], ["Training Dates", dates], ["Submitted", stamp(input.submittedAt)]];
  const boxH = info.length * 16 + 12;
  page.drawRectangle({ x: M, y: y - boxH, width: CW, height: boxH, color: soft });
  let iy = y - 18;
  for (const [k, v] of info) { text(k, M + 10, iy, 9, bold, muted); text(wrap(v, reg, 10, CW - 120)[0] ?? "", M + 110, iy, 10); iy -= 16; }
  y -= boxH + 24;

  // Attendance confirmation, as on the Google Form.
  text("ATTENDANCE", M, y, 10, bold, navy); y -= 15;
  for (const l of wrap(`${input.answers.attendance ? "[X] Confirmed" : "[ ] Not confirmed"}: ${ATTENDANCE_STATEMENT}`, reg, 10, CW)) { text(l, M, y, 10); y -= 14; }
  y -= 12;

  // The three rating grids: item | rating (Poor, Fair, Good, Excellent).
  const rateX = M + CW - 90;
  let n = 0;
  for (const section of EVALUATION_SECTIONS) {
    ensure(40);
    text(section.title.toUpperCase(), M, y, 10, bold, navy); text("Rating", rateX, y, 9, bold, muted);
    y -= 6; page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 1, color: navy });
    for (const q of section.items) {
      const lines = wrap(`${n + 1}. ${q}`, reg, 10, rateX - M - 16);
      const rowH = lines.length * 13 + 9;
      ensure(rowH);
      let ly = y - 14;
      for (const l of lines) { text(l, M + 6, ly, 10); ly -= 13; }
      const score = input.answers.ratings[n];
      text(score ? RATING_SCALE[score - 1] ?? "-" : "-", rateX, y - 14, 10, bold);
      y -= rowH; n += 1;
      page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.6, color: line });
    }
    y -= 18;
  }

  ensure(40);
  text(COMMENTS_QUESTION, M, y, 10, bold, navy); y -= 15;
  for (const l of wrap(input.answers.comments.trim() || "-", reg, 10, CW)) { ensure(14); text(l, M, y, 10); y -= 14; }

  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 22, size: 8, font: reg, color: muted }));
  return pdf.save();
}
