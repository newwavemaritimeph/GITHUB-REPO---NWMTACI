import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { balanceAt, finalList, paidLate, unsettledAt11, type MismoBatch, type MismoTrainee } from "@/lib/mismo";
import type { DocumentControl } from "@/lib/document-controls";
import { FOOT, LEGAL_LANDSCAPE, SIDE, drawLetterhead, finishPages, loadBrand, newPage } from "@/lib/print/letterhead";

/**
 * MARINA MISMO lists (owner, 8–9 Oct 2026), one section per batch, on the shared Corporate Two-Tone letterhead,
 * legal landscape (10 Nov 2026):
 *  - final: the List of Trainees settled by the 4:00 PM cut-off, for the MARINA MISMO Portal,
 *    with trainees who paid after the cut-off shown apart; a trainee not yet paid is not on it (5 Nov 2026);
 *  - unsettled: trainees not settled as of 11:00 AM, for the instructor to send to the Cashier.
 * Letterhead, a batch information box, a ruled table, a summary, signatures and page numbers.
 */
export type MismoPdfOptions = { logo?: Uint8Array; preparedBy?: string | null; printedAt?: Date; control?: DocumentControl | null };

const longDate = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const shortDate = (d: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const mdy = (d: string | null) => { if (!d) return "-"; const [y, m, dd] = d.slice(0, 10).split("-"); return `${m}/${dd}/${y}`; };
const peso = (c: number) => `PHP ${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Helvetica speaks WinAnsi: keep Latin-1 (Ñ, é), swap typographic dashes and quotes. */
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const dates = (b: MismoBatch) => (b.startsOn === b.endsOn ? shortDate(b.startsOn) : `${shortDate(b.startsOn)} - ${shortDate(b.endsOn)}`);
const stamp = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(d);

export async function createMismoListPdf(date: string, batches: MismoBatch[], list: "final" | "unsettled", options: MismoPdfOptions = {}) {
  const pdf = await PDFDocument.create();
  const unsettled = list === "unsettled";
  pdf.setTitle(unsettled ? "Trainees Not Settled as of 11:00 AM" : "MARINA MISMO List of Trainees");
  pdf.setAuthor("New Wave Maritime Training and Assessment Center, Inc.");
  const brand = await loadBrand(pdf, options.logo), { reg, bold } = brand;
  const navy = rgb(0.07, 0.25, 0.39), ink = rgb(0.06, 0.15, 0.22), muted = rgb(0.37, 0.44, 0.5), line = rgb(0.55, 0.62, 0.68), zebra = rgb(0.95, 0.97, 0.98), soft = rgb(0.93, 0.96, 0.98), red = rgb(0.7, 0.14, 0.09);
  const [W] = LEGAL_LANDSCAPE, M = SIDE, CW = W - 2 * M;
  const title = unsettled ? "TRAINEES NOT SETTLED AS OF 11:00 AM" : "MARINA MISMO LIST OF TRAINEES";
  const printed = options.printedAt ?? new Date();
  const fit = (text: string, font: PDFFont, size: number, width: number) => { let t = safe(text); while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1); return t; };
  const text = (page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(safe(s), { x, y, size, font, color });
  const right = (page: PDFPage, s: string, xr: number, y: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(safe(s), { x: xr - font.widthOfTextAtSize(safe(s), size), y, size, font, color });

  type Col = { label: string; w: number; align?: "left" | "right" | "center"; value: (t: MismoTrainee, i: number) => string; strong?: boolean };
  const cols: Col[] = unsettled
    ? [
      { label: "No.", w: 42, align: "center", value: (_t, i) => String(i + 1) },
      { label: "Last Name", w: 172, value: (t) => t.lastName.toUpperCase(), strong: true },
      { label: "First Name", w: 172, value: (t) => t.firstName },
      { label: "Middle Name", w: 135, value: (t) => t.middleName ?? "-" },
      { label: "Rank", w: 123, value: (t) => t.rank ?? "-" },
      { label: "Balance at 11:00 AM", w: 162, align: "right", value: (t) => peso(balanceAt(t, "11")), strong: true },
      { label: "Instructor's Remarks", w: CW - 806, value: () => "" },
    ]
    : [
      { label: "No.", w: 42, align: "center", value: (_t, i) => String(i + 1) },
      { label: "Last Name", w: 185, value: (t) => t.lastName.toUpperCase(), strong: true },
      { label: "First Name", w: 185, value: (t) => t.firstName },
      { label: "Middle Name", w: 154, value: (t) => t.middleName ?? "-" },
      { label: "Date of Birth", w: 110, align: "center", value: (t) => mdy(t.birthdate) },
      { label: "SRN", w: 148, value: (t) => t.srn ?? "-" },
      { label: "Rank", w: CW - 824, value: (t) => t.rank ?? "-" },
    ];

  for (const b of batches) {
    const rows = unsettled ? unsettledAt11(b) : finalList(b);
    const off = unsettled ? [] : b.trainees.filter(paidLate);
    let page: PDFPage = newPage(pdf, brand, LEGAL_LANDSCAPE);
    let y = 0;

    const letterhead = (cont: boolean) => {
      y = drawLetterhead(page, brand, options.control, { title, right: cont ? undefined : `${unsettled ? "FOR THE INSTRUCTOR" : "MARINA MISMO PORTAL"}  |  ${longDate(date)}`, cont });
      if (!cont) {
        y += 8;
        // Batch information box: two rows of four fields.
        const fields: [string, string][] = [["Course", `${b.courseName} (${b.courseCode})`], ["Batch No.", b.batchNumber], ["Training Dates", dates(b)], ["List Date", shortDate(date)],
          ["Room", b.room ?? "-"], ["Instructor", b.instructor ?? "-"], ["Cut-off", unsettled ? "Settled by 11:00 AM" : "Settled by 4:00 PM"], [unsettled ? "Not Settled" : "On This List", unsettled ? `${rows.length} of ${b.trainees.length} trainee${b.trainees.length === 1 ? "" : "s"}` : `${rows.length} trainee${rows.length === 1 ? "" : "s"}`]];
        const bh = 62, widths = [CW * 0.4, CW * 0.2, CW * 0.22, CW * 0.18];
        page.drawRectangle({ x: M, y: y - bh, width: CW, height: bh, color: soft, borderColor: line, borderWidth: 0.6 });
        page.drawLine({ start: { x: M, y: y - bh / 2 }, end: { x: M + CW, y: y - bh / 2 }, thickness: 0.4, color: line });
        fields.forEach(([label, value], i) => {
          const r = Math.floor(i / 4), c = i % 4, x = M + widths.slice(0, c).reduce((s, v) => s + v, 0);
          if (c) page.drawLine({ start: { x, y: y - r * (bh / 2) }, end: { x, y: y - (r + 1) * (bh / 2) }, thickness: 0.4, color: line });
          text(page, label.toUpperCase(), x + 8, y - r * (bh / 2) - 11, 7.6, bold, muted);
          text(page, fit(value, bold, 11, widths[c] - 16), x + 8, y - r * (bh / 2) - 24.5, 11, bold, ink);
        });
        y -= bh + 14;
      }
    };
    const tableHead = () => {
      page.drawRectangle({ x: M, y: y - 21, width: CW, height: 21, color: navy });
      let x = M;
      for (const c of cols) {
        const lab = c.label.toUpperCase(), tw = bold.widthOfTextAtSize(lab, 9);
        const tx = c.align === "right" ? x + c.w - 8 - tw : c.align === "center" ? x + (c.w - tw) / 2 : x + 8;
        page.drawText(lab, { x: tx, y: y - 14, size: 9, font: bold, color: rgb(1, 1, 1) });
        x += c.w;
      }
      y -= 21;
    };
    letterhead(false);
    tableHead();
    const rh = 20;
    rows.forEach((t, i) => {
      if (y - rh < FOOT + 20) { page = newPage(pdf, brand, LEGAL_LANDSCAPE); letterhead(true); tableHead(); }
      if (i % 2) page.drawRectangle({ x: M, y: y - rh, width: CW, height: rh, color: zebra });
      let x = M;
      for (const c of cols) {
        const font = c.strong ? bold : reg, v = fit(c.value(t, i), font, 11, c.w - 14);
        const tw = font.widthOfTextAtSize(v, 11);
        page.drawText(v, { x: c.align === "right" ? x + c.w - 8 - tw : c.align === "center" ? x + (c.w - tw) / 2 : x + 8, y: y - 14, size: 11, font, color: ink });
        x += c.w;
        page.drawLine({ start: { x, y }, end: { x, y: y - rh }, thickness: 0.3, color: line });
      }
      page.drawLine({ start: { x: M, y: y - rh }, end: { x: M + CW, y: y - rh }, thickness: 0.4, color: line });
      y -= rh;
    });
    if (!rows.length) { text(page, unsettled ? "Everyone in this class had settled by 11:00 AM." : "No trainee was settled by the 4:00 PM cut-off.", M + 8, y - 14, 11, reg, muted); y -= rh; }
    page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.8, color: navy });

    // Summary line.
    y -= 18;
    const total = rows.reduce((s, t) => s + balanceAt(t, "11"), 0);
    text(page, unsettled
      ? `${rows.length} trainee${rows.length === 1 ? "" : "s"} not settled · total balance ${peso(total)} · please send them to the Cashier before the 4:00 PM cut-off.`
      : `${rows.length} trainee${rows.length === 1 ? "" : "s"} settled by 4:00 PM and included${off.length ? ` · ${off.length} paid after 4:00 PM` : ""}.`, M, y, 10.5, bold, ink);
    right(page, `Printed ${stamp(printed)}`, W - M, y, 8.5, reg, muted);
    y -= 8;

    // Paid after the cut-off (final list only): shown apart, not on this list.
    if (off.length) {
      const need = 28 + off.length * 15;
      if (y - need < FOOT + 80) { page = newPage(pdf, brand, LEGAL_LANDSCAPE); letterhead(true); }
      y -= 10;
      page.drawRectangle({ x: M, y: y - need, width: CW, height: need, color: rgb(0.99, 0.93, 0.91), borderColor: red, borderWidth: 0.6 });
      text(page, "NOT ON THIS LIST - PAID AFTER THE 4:00 PM CUT-OFF", M + 8, y - 15, 9, bold, red);
      off.forEach((t, i) => text(page, fit(`${i + 1}.  ${t.lastName.toUpperCase()}, ${t.firstName}${t.middleName ? ` ${t.middleName}` : ""}  ·  ${t.rank ?? "-"}`, reg, 10.5, CW - 16), M + 8, y - 30 - i * 15, 10.5, reg, ink));
      y -= need;
    }

    // Signatures.
    if (y - 56 < FOOT + 30) { page = newPage(pdf, brand, LEGAL_LANDSCAPE); letterhead(true); }
    const sy = Math.min(y - 56, FOOT + 90);
    const sign = (x: number, w: number, name: string, role: string) => {
      if (name) { const s = fit(name.toUpperCase(), bold, 10.5, w); page.drawText(s, { x: x + (w - bold.widthOfTextAtSize(s, 10.5)) / 2, y: sy + 5, size: 10.5, font: bold, color: ink }); }
      page.drawLine({ start: { x, y: sy }, end: { x: x + w, y: sy }, thickness: 0.7, color: ink });
      const r = safe(role); page.drawText(r, { x: x + (w - reg.widthOfTextAtSize(r, 9)) / 2, y: sy - 13, size: 9, font: reg, color: muted });
    };
    text(page, "Prepared by:", M, sy + 30, 9, bold, muted);
    sign(M, 270, options.preparedBy ?? "", "MISMO Compliance Officer · Signature over Printed Name");
    text(page, unsettled ? "Received by:" : "Noted by:", M + 330, sy + 30, 9, bold, muted);
    sign(M + 330, 270, "", unsettled ? "Instructor · Signature over Printed Name" : "Admin · Signature over Printed Name");
    text(page, "Date:", M + 660, sy + 30, 9, bold, muted);
    sign(M + 660, 140, "", "Date");
  }

  finishPages(pdf, brand, options.control);
  return pdf.save();
}
