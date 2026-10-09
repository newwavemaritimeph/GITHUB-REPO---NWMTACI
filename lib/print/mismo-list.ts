import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { balanceAt, finalList, leftOff, unsettledAt11, type MismoBatch, type MismoTrainee } from "@/lib/mismo";

/**
 * MARINA MISMO lists (owner, 8–9 Oct 2026), one section per batch, A4 landscape:
 *  - final: the List of Trainees settled by the 4:00 PM cut-off, for the MARINA MISMO Portal,
 *    with the trainees left off shown apart;
 *  - unsettled: trainees not settled as of 11:00 AM, for the instructor to send to the Cashier.
 * Letterhead, a batch information box, a ruled table, a summary, signatures and page numbers.
 */
export type MismoPdfOptions = { logo?: Uint8Array; preparedBy?: string | null; printedAt?: Date };

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
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (options.logo) { try { logo = await pdf.embedPng(options.logo); } catch { logo = null; } }
  const navy = rgb(0.07, 0.25, 0.39), blue = rgb(0.02, 0.44, 0.82), orange = rgb(0.95, 0.34, 0.08), ink = rgb(0.06, 0.15, 0.22), muted = rgb(0.37, 0.44, 0.5), line = rgb(0.55, 0.62, 0.68), zebra = rgb(0.95, 0.97, 0.98), soft = rgb(0.93, 0.96, 0.98), red = rgb(0.7, 0.14, 0.09);
  const W = 841.89, H = 595.28, M = 30, CW = W - 2 * M;
  const printed = options.printedAt ?? new Date();
  const fit = (text: string, font: PDFFont, size: number, width: number) => { let t = safe(text); while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1); return t; };
  const text = (page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(safe(s), { x, y, size, font, color });
  const right = (page: PDFPage, s: string, xr: number, y: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(safe(s), { x: xr - font.widthOfTextAtSize(safe(s), size), y, size, font, color });

  type Col = { label: string; w: number; align?: "left" | "right" | "center"; value: (t: MismoTrainee, i: number) => string; strong?: boolean };
  const cols: Col[] = unsettled
    ? [
      { label: "No.", w: 34, align: "center", value: (_t, i) => String(i + 1) },
      { label: "Last Name", w: 140, value: (t) => t.lastName.toUpperCase(), strong: true },
      { label: "First Name", w: 140, value: (t) => t.firstName },
      { label: "Middle Name", w: 110, value: (t) => t.middleName ?? "-" },
      { label: "Rank", w: 100, value: (t) => t.rank ?? "-" },
      { label: "Balance at 11:00 AM", w: 132, align: "right", value: (t) => peso(balanceAt(t, "11")), strong: true },
      { label: "Instructor's Remarks", w: CW - 656, value: () => "" },
    ]
    : [
      { label: "No.", w: 34, align: "center", value: (_t, i) => String(i + 1) },
      { label: "Last Name", w: 150, value: (t) => t.lastName.toUpperCase(), strong: true },
      { label: "First Name", w: 150, value: (t) => t.firstName },
      { label: "Middle Name", w: 125, value: (t) => t.middleName ?? "-" },
      { label: "Date of Birth", w: 90, align: "center", value: (t) => mdy(t.birthdate) },
      { label: "SRN", w: 120, value: (t) => t.srn ?? "-" },
      { label: "Rank", w: CW - 669, value: (t) => t.rank ?? "-" },
    ];

  const pages: PDFPage[] = [];
  for (const b of batches) {
    const rows = unsettled ? unsettledAt11(b) : finalList(b);
    const off = unsettled ? [] : leftOff(b);
    let page = pdf.addPage([W, H]); pages.push(page);
    let y = H - M;

    const letterhead = (cont: boolean) => {
      if (logo) page.drawImage(logo, { x: M, y: y - 40, width: 40, height: 40 });
      const lx = M + (logo ? 50 : 0);
      text(page, "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", lx, y - 13, 11.5, bold, navy);
      text(page, "Ride the New Wave of Maritime Excellence", lx, y - 26, 8.5, reg, blue);
      right(page, unsettled ? "FOR THE INSTRUCTOR" : "MARINA MISMO PORTAL", W - M, y - 13, 8, bold, unsettled ? orange : blue);
      right(page, `${longDate(date)}`, W - M, y - 26, 8.5, reg, muted);
      y -= 48;
      page.drawRectangle({ x: M, y, width: CW, height: 2.2, color: navy });
      page.drawRectangle({ x: M, y: y - 1.4, width: CW * 0.28, height: 1.4, color: orange });
      y -= 26;
      text(page, unsettled ? "Trainees Not Settled as of 11:00 AM" : "MARINA MISMO List of Trainees", M, y, 17, bold, ink);
      if (cont) right(page, "continued", W - M, y, 9, reg, muted);
      y -= 14;
      if (!cont) {
        // Batch information box: two rows of four fields.
        const fields: [string, string][] = [["Course", `${b.courseName} (${b.courseCode})`], ["Batch No.", b.batchNumber], ["Training Dates", dates(b)], ["List Date", shortDate(date)],
          ["Room", b.room ?? "-"], ["Instructor", b.instructor ?? "-"], ["Cut-off", unsettled ? "Settled by 11:00 AM" : "Settled by 4:00 PM"], [unsettled ? "Not Settled" : "On This List", `${rows.length} of ${b.trainees.length} trainee${b.trainees.length === 1 ? "" : "s"}`]];
        const bh = 52, widths = [CW * 0.4, CW * 0.2, CW * 0.22, CW * 0.18];
        page.drawRectangle({ x: M, y: y - bh, width: CW, height: bh, color: soft, borderColor: line, borderWidth: 0.6 });
        page.drawLine({ start: { x: M, y: y - bh / 2 }, end: { x: M + CW, y: y - bh / 2 }, thickness: 0.4, color: line });
        fields.forEach(([label, value], i) => {
          const r = Math.floor(i / 4), c = i % 4, x = M + widths.slice(0, c).reduce((s, v) => s + v, 0);
          if (c) page.drawLine({ start: { x, y: y - r * (bh / 2) }, end: { x, y: y - (r + 1) * (bh / 2) }, thickness: 0.4, color: line });
          text(page, label.toUpperCase(), x + 7, y - r * (bh / 2) - 9, 6.3, bold, muted);
          text(page, fit(value, bold, 9.2, widths[c] - 14), x + 7, y - r * (bh / 2) - 20.5, 9.2, bold, ink);
        });
        y -= bh + 14;
      }
    };
    const tableHead = () => {
      page.drawRectangle({ x: M, y: y - 18, width: CW, height: 18, color: navy });
      let x = M;
      for (const c of cols) {
        const tw = bold.widthOfTextAtSize(c.label, 7.6);
        const tx = c.align === "right" ? x + c.w - 7 - tw : c.align === "center" ? x + (c.w - tw) / 2 : x + 7;
        page.drawText(c.label.toUpperCase(), { x: tx, y: y - 12, size: 7.3, font: bold, color: rgb(1, 1, 1) });
        x += c.w;
      }
      y -= 18;
    };
    letterhead(false);
    tableHead();
    const rh = 17;
    rows.forEach((t, i) => {
      if (y - rh < M + 40) { page = pdf.addPage([W, H]); pages.push(page); y = H - M; letterhead(true); tableHead(); }
      if (i % 2) page.drawRectangle({ x: M, y: y - rh, width: CW, height: rh, color: zebra });
      let x = M;
      for (const c of cols) {
        const font = c.strong ? bold : reg, v = fit(c.value(t, i), font, 9, c.w - 12);
        const tw = font.widthOfTextAtSize(v, 9);
        page.drawText(v, { x: c.align === "right" ? x + c.w - 7 - tw : c.align === "center" ? x + (c.w - tw) / 2 : x + 7, y: y - 12, size: 9, font, color: ink });
        x += c.w;
        page.drawLine({ start: { x, y }, end: { x, y: y - rh }, thickness: 0.3, color: line });
      }
      page.drawLine({ start: { x: M, y: y - rh }, end: { x: M + CW, y: y - rh }, thickness: 0.4, color: line });
      y -= rh;
    });
    if (!rows.length) { text(page, unsettled ? "Everyone in this class had settled by 11:00 AM." : "No trainee was settled by the 4:00 PM cut-off.", M + 7, y - 13, 9.5, reg, muted); y -= rh; }
    page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.8, color: navy });

    // Summary line.
    y -= 16;
    const total = rows.reduce((s, t) => s + balanceAt(t, "11"), 0);
    text(page, unsettled
      ? `${rows.length} trainee${rows.length === 1 ? "" : "s"} not settled · total balance ${peso(total)} · please send them to the Cashier before the 4:00 PM cut-off.`
      : `${rows.length} trainee${rows.length === 1 ? "" : "s"} settled by 4:00 PM and included · ${off.length} left off.`, M, y, 9, bold, ink);
    y -= 8;

    // Left off (final list only): shown apart so they are not entered in the MARINA MISMO Portal.
    if (off.length) {
      const need = 24 + off.length * 13;
      if (y - need < M + 70) { page = pdf.addPage([W, H]); pages.push(page); y = H - M; letterhead(true); }
      y -= 10;
      page.drawRectangle({ x: M, y: y - need, width: CW, height: need, color: rgb(0.99, 0.93, 0.91), borderColor: red, borderWidth: 0.6 });
      text(page, "NOT INCLUDED - BALANCE UNPAID AT 4:00 PM (do not enter in the MARINA MISMO Portal)", M + 8, y - 13, 7.6, bold, red);
      off.forEach((t, i) => text(page, fit(`${i + 1}.  ${t.lastName.toUpperCase()}, ${t.firstName}${t.middleName ? ` ${t.middleName}` : ""}  ·  ${t.rank ?? "-"}  ·  balance ${peso(balanceAt(t, "16"))}`, reg, 8.6, CW - 16), M + 8, y - 26 - i * 13, 8.6, reg, ink));
      y -= need;
    }

    // Signatures.
    const sy = Math.max(M + 26, Math.min(y - 46, M + 70));
    const sign = (x: number, w: number, name: string, role: string) => {
      if (name) { const s = fit(name.toUpperCase(), bold, 9, w); page.drawText(s, { x: x + (w - bold.widthOfTextAtSize(s, 9)) / 2, y: sy + 4, size: 9, font: bold, color: ink }); }
      page.drawLine({ start: { x, y: sy }, end: { x: x + w, y: sy }, thickness: 0.7, color: ink });
      const r = safe(role); page.drawText(r, { x: x + (w - reg.widthOfTextAtSize(r, 8)) / 2, y: sy - 11, size: 8, font: reg, color: muted });
    };
    text(page, "Prepared by:", M, sy + 26, 7.6, bold, muted);
    sign(M, 210, options.preparedBy ?? "", "MISMO Compliance Officer · Signature over Printed Name");
    text(page, unsettled ? "Received by:" : "Noted by:", M + 260, sy + 26, 7.6, bold, muted);
    sign(M + 260, 210, "", unsettled ? "Instructor · Signature over Printed Name" : "Admin · Signature over Printed Name");
    text(page, "Date:", M + 520, sy + 26, 7.6, bold, muted);
    sign(M + 520, 110, "", "Date");
  }

  // Footer on every page: document name, printed time, page x of y.
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 8 }, end: { x: W - M, y: M - 8 }, thickness: 0.4, color: line });
    p.drawText(safe(`${unsettled ? "Trainees Not Settled as of 11:00 AM" : "MARINA MISMO List of Trainees"} · ${shortDate(date)} · printed ${stamp(printed)}`), { x: M, y: M - 18, size: 7, font: reg, color: muted });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: W - M - reg.widthOfTextAtSize(label, 7), y: M - 18, size: 7, font: reg, color: muted });
  });
  return pdf.save();
}
