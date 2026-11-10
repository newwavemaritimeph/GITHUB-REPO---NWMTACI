import { PDFDocument, rgb } from "pdf-lib";
import type { PlanRow } from "@/lib/admin-assistant";
import type { DocumentControl } from "@/lib/document-controls";
import { FOOT, INK, LEGAL_LANDSCAPE, MUTED, NAVY, SIDE, drawLetterhead, finishPages, loadBrand, newPage } from "@/lib/print/letterhead";

const short = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const longDay = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const ascii = (s: string) => s.replace(/[–—]/g, "-").replace(/·/g, "-").normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

/**
 * Resource plan (owner, 9 Oct 2026, design 3): batches grouped by start day with classroom, students, instructor, assessor
 * and notes. On the shared Corporate Two-Tone letterhead, legal landscape (10 Nov 2026).
 */
export async function createResourcePlanPdf(from: string, to: string, today: string, rows: PlanRow[], control?: DocumentControl | null, logoBytes?: Uint8Array) {
  const pdf = await PDFDocument.create();
  const brand = await loadBrand(pdf, logoBytes), { reg, bold } = brand;
  const rule = rgb(0.86, 0.9, 0.93), red = rgb(0.71, 0.14, 0.09), band = rgb(0.93, 0.96, 0.97);
  const [W] = LEGAL_LANDSCAPE, M = SIDE;
  const cols = [["Batch", 110], ["Course", 190], ["Dates", 92], ["Classroom", 98], ["Students", 60], ["Instructor", 134], ["Assessor", 134], ["Notes", 142]] as const;
  const title = `RESOURCE PLAN - ${short(from)} to ${short(to)}, ${to.slice(0, 4)}`.toUpperCase();
  let page = newPage(pdf, brand, LEGAL_LANDSCAPE);
  let y = 0;
  const fit = (t: string, w: number, font = reg, size = 10) => { let s = ascii(t); while (s.length > 1 && font.widthOfTextAtSize(s, size) > w - 10) s = s.slice(0, -1); return s; };
  const header = (cont: boolean) => {
    y = drawLetterhead(page, brand, control, { title, right: cont ? undefined : ascii(`${rows.length} batches - ${rows.filter((r) => r.issues.length).length} need attention - printed ${short(today)}`), cont });
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: NAVY });
    let x = M;
    for (const [label, w] of cols) { page.drawText(label.toUpperCase(), { x: x + 5, y, size: 8.5, font: bold, color: rgb(1, 1, 1) }); x += w; }
    y -= 22;
  };
  header(false);
  let lastDay = "";
  for (const r of rows) {
    const day = r.startsOn < from ? from : r.startsOn;
    if (y < FOOT + 40) { page = newPage(pdf, brand, LEGAL_LANDSCAPE); header(true); lastDay = ""; }
    if (day !== lastDay) {
      page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: band });
      page.drawText(ascii(longDay(day)), { x: M + 5, y, size: 10, font: bold, color: NAVY });
      y -= 20;
      lastDay = day;
    }
    const cells = [r.batchNumber, `${r.courseCode} ${r.courseName}`, r.startsOn === r.endsOn ? short(r.startsOn) : `${short(r.startsOn)}-${short(r.endsOn)}`, r.room?.name ?? "-", `${r.students}/${r.room?.capacity ?? r.capacity}`, (r.instructor?.complete_name ?? "-") + (r.alternate ? ` / Alt. ${r.alternate.complete_name}` : ""), r.assessor?.complete_name ?? "-", r.issues.join("; ")];
    let x = M;
    cells.forEach((c, i) => { const w = cols[i][1]; const font = i === 0 ? bold : reg; page.drawText(fit(c, w, font), { x: x + 5, y, size: 10, font, color: i === 7 ? red : INK }); x += w; });
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.5, color: rule });
    y -= 19;
  }
  if (!rows.length) { page.drawText("No batches in this range.", { x: M, y, size: 11, font: reg, color: MUTED }); y -= 19; }
  if (y - 60 < FOOT) { page = newPage(pdf, brand, LEGAL_LANDSCAPE); y = drawLetterhead(page, brand, control, { title, cont: true }); }
  y -= 44;
  const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 250, y }, thickness: 0.7, color: INK }); page.drawText(label, { x, y: y - 14, size: 10, font: reg, color: MUTED }); };
  sig("Prepared by (Admin Assistant)", M);
  sig("Noted by (Admin)", W - M - 250);
  finishPages(pdf, brand, control);
  return pdf.save();
}
