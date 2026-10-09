import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PlanRow } from "@/lib/admin-assistant";

const short = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const longDay = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const ascii = (s: string) => s.replace(/[–—]/g, "-").replace(/·/g, "-").normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

/** Resource plan (owner, 9 Oct 2026, design 3): batches grouped by start day with classroom, students, instructor and notes. A4 landscape. */
export async function createResourcePlanPdf(from: string, to: string, today: string, rows: PlanRow[]) {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.07, 0.25, 0.39), muted = rgb(0.37, 0.44, 0.5), ink = rgb(0.06, 0.15, 0.22), rule = rgb(0.86, 0.9, 0.93), red = rgb(0.71, 0.14, 0.09), band = rgb(0.93, 0.96, 0.97);
  const W = 841.89, H = 595.28, M = 30;
  const cols = [["Batch", 98], ["Course", 190], ["Dates", 82], ["Classroom", 92], ["Students", 52], ["Instructor", 120], ["Notes", 148]] as const;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const fit = (t: string, w: number, font = reg, size = 8.5) => { let s = ascii(t); while (s.length > 1 && font.widthOfTextAtSize(s, size) > w - 8) s = s.slice(0, -1); return s; };
  const header = () => {
    page.drawText("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", { x: M, y, size: 8.5, font: bold, color: navy });
    y -= 18;
    page.drawText(ascii(`Resource Plan - ${short(from)} to ${short(to)}, ${to.slice(0, 4)}`), { x: M, y, size: 15, font: bold, color: ink });
    page.drawText(ascii(`${rows.length} batches - ${rows.filter((r) => r.issues.length).length} need attention - printed ${short(today)}`), { x: W - M - 260, y: y + 2, size: 9, font: reg, color: muted });
    y -= 20;
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 17, color: navy });
    let x = M;
    for (const [label, w] of cols) { page.drawText(label.toUpperCase(), { x: x + 4, y, size: 7, font: bold, color: rgb(1, 1, 1) }); x += w; }
    y -= 19;
  };
  header();
  let lastDay = "";
  for (const r of rows) {
    const day = r.startsOn < from ? from : r.startsOn;
    if (y < M + 70) { page = pdf.addPage([W, H]); y = H - M; header(); lastDay = ""; }
    if (day !== lastDay) {
      page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 15, color: band });
      page.drawText(ascii(longDay(day)), { x: M + 4, y, size: 8.5, font: bold, color: navy });
      y -= 17;
      lastDay = day;
    }
    const cells = [r.batchNumber, `${r.courseCode} ${r.courseName}`, r.startsOn === r.endsOn ? short(r.startsOn) : `${short(r.startsOn)}-${short(r.endsOn)}`, r.room?.name ?? "-", `${r.students}/${r.room?.capacity ?? r.capacity}`, r.instructor?.complete_name ?? "-", r.issues.join("; ")];
    let x = M;
    cells.forEach((c, i) => { const w = cols[i][1]; const font = i === 0 ? bold : reg; page.drawText(fit(c, w, font), { x: x + 4, y, size: 8.5, font, color: i === 6 ? red : ink }); x += w; });
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.5, color: rule });
    y -= 16;
  }
  if (!rows.length) { page.drawText("No batches in this range.", { x: M, y, size: 10, font: reg, color: muted }); y -= 16; }
  y = Math.max(y - 36, M + 20);
  const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 220, y }, thickness: 0.7, color: ink }); page.drawText(label, { x, y: y - 12, size: 8.5, font: reg, color: muted }); };
  sig("Prepared by (Admin Assistant)", M);
  sig("Noted by (Admin)", W - M - 220);
  return pdf.save();
}
