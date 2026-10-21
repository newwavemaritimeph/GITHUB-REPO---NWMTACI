import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { channelTotal, channelsUsed, sideTotal, type Line, type summarize } from "@/lib/finance-summary";

type Summary = ReturnType<typeof summarize> & { title: string; from: string; to: string };
const ascii = (s: string) => s.replace(/[–—]/g, "-").replace(/·/g, "-").replace(/₱/g, "PHP ").normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
const money = (c: number) => `${c < 0 ? "-" : ""}${(Math.abs(c) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Cash and Sales Summary, A4 portrait (owner, 21 Oct 2026). Amounts in PHP. */
export async function createFinanceSummaryPdf(s: Summary, printed: string) {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.07, 0.25, 0.39), muted = rgb(0.37, 0.44, 0.5), ink = rgb(0.06, 0.15, 0.22), rule = rgb(0.86, 0.9, 0.93), band = rgb(0.9, 0.96, 0.99), soft = rgb(0.93, 0.96, 0.97), orange = rgb(0.95, 0.34, 0.08), red = rgb(0.71, 0.14, 0.09);
  const W = 595.28, H = 841.89, M = 36, IW = W - 2 * M;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (t: string, x: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(ascii(t), { x, y, size, font, color });
  const right = (t: string, xr: number, size: number, font: PDFFont = reg, color = ink) => { const v = ascii(t); page.drawText(v, { x: xr - font.widthOfTextAtSize(v, size), y, size, font, color }); };
  const need = (h: number) => { if (y - h < M + 40) { page = pdf.addPage([W, H]); y = H - M; } };

  text("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", M, 8.5, bold, navy); y -= 20;
  text("Cash and Sales Summary", M, 17, bold); right(`Printed ${day(printed)}`, W - M, 9, reg, muted); y -= 15;
  text(`${s.title} - ${day(s.from)} to ${day(s.to)} - Training Endorsement vs Direct New Wave - amounts in PHP`, M, 9, reg, muted); y -= 8;
  page.drawRectangle({ x: M, y, width: IW, height: 2, color: orange }); y -= 18;

  // Tiles
  const rE = sideTotal(s.received, "E"), rD = sideTotal(s.received, "D"), dE = sideTotal(s.disbursed, "E"), dD = sideTotal(s.disbursed, "D");
  const tiles: [string, number, string][] = [["Cash Received", rE + rD, `Endorsement ${money(rE)} - Direct ${money(rD)}`], ["Disbursements", dE + dD, `Endorsement ${money(dE)} - Direct ${money(dD)}`], ["Net Cash", rE + rD - dE - dD, "received less disbursed"], ["Direct Sales", s.direct.sales, `${s.direct.trainees} trainees by training date`], ["Endorsement Keeps", s.endorsement.keeps, `${s.endorsement.trainees} trainees - rebates less shares`]];
  const tw = (IW - 4 * 6) / 5;
  tiles.forEach(([label, v, sub], i) => {
    const x = M + i * (tw + 6);
    page.drawRectangle({ x, y: y - 48, width: tw, height: 54, color: soft });
    page.drawRectangle({ x, y: y - 48, width: 3, height: 54, color: i === 1 ? red : i === 4 ? orange : navy });
    page.drawText(ascii(label), { x: x + 8, y: y - 6, size: 7.5, font: reg, color: muted });
    page.drawText(ascii(money(v)), { x: x + 8, y: y - 20, size: 11, font: bold, color: ink });
    ascii(sub).split(" - ").slice(0, 2).forEach((part, k) => page.drawText(part.slice(0, 34), { x: x + 8, y: y - 31 - k * 8, size: 6, font: reg, color: muted }));
  });
  y -= 68;

  const cols = [M + IW * 0.58, M + IW * 0.72, M + IW * 0.86, M + IW];
  const header = (title: string, heads: string[]) => {
    need(40);
    text(title, M, 11.5, bold, navy); y -= 8;
    page.drawRectangle({ x: M, y: y - 12, width: IW, height: 15, color: band });
    y -= 8; text(heads[0], M + 4, 7.5, bold, navy);
    heads.slice(1).forEach((h, i) => right(h, cols[i + 1] - 4, 7.5, bold, navy));
    y -= 14;
  };
  const row = (cells: string[], opts: { bold?: boolean; indent?: boolean; band?: boolean; red?: boolean[] } = {}) => {
    need(14);
    if (opts.band) page.drawRectangle({ x: M, y: y - 4, width: IW, height: 14, color: soft });
    const f = opts.bold ? bold : reg;
    text(cells[0], M + (opts.indent ? 14 : 4), 8.5, f, opts.band ? navy : ink);
    cells.slice(1).forEach((c, i) => right(c, cols[i + 1] - 4, 8.5, f, opts.red?.[i] ? red : ink));
    if (!opts.band) page.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + IW, y: y - 4 }, thickness: 0.4, color: rule });
    y -= 14;
  };
  const cashBlock = (title: string, ls: Line[]) => {
    header(title, ["Line", "Endorsement", "Direct", "Total"]);
    for (const [label, side] of [["Training Endorsement", "E"], ["Direct New Wave", "D"]] as const) {
      const mine = ls.filter((l) => l.side === side);
      row([label, "", "", ""], { band: true, bold: true });
      for (const l of mine) row([l.label, side === "E" ? money(l.total) : "-", side === "D" ? money(l.total) : "-", money(l.total)], { indent: true });
      if (!mine.length) row(["None in this period", "", "", ""], { indent: true });
    }
    const e = sideTotal(ls, "E"), d = sideTotal(ls, "D");
    row([`Total ${title}`, money(e), money(d), money(e + d)], { bold: true });
    row(["By Channel", "", "", ""], { band: true, bold: true });
    for (const ch of channelsUsed(ls)) { const ce = channelTotal(ls, "E", ch), cd = channelTotal(ls, "D", ch); row([ch, money(ce), money(cd), money(ce + cd)], { indent: true }); }
    y -= 10;
  };
  cashBlock("Cash Received", s.received);
  cashBlock("Disbursements", s.disbursed);
  header("Net Cash", ["", "Endorsement", "Direct", "Total"]);
  row(["Cash Received", money(rE), money(rD), money(rE + rD)]);
  row(["Less Disbursements", money(-dE), money(-dD), money(-dE - dD)], { red: [true, true, true] });
  row(["Net Cash", money(rE - dE), money(rD - dD), money(rE + rD - dE - dD)], { bold: true });
  y -= 10;

  need(14 * (s.direct.courses.length + 12));
  header("Direct Sales", ["Course", "Trainees", "", "Sales"]);
  for (const c of s.direct.courses) row([`${c.code}  ${c.name}`.slice(0, 70), String(c.trainees), "", money(c.sales)]);
  if (!s.direct.courses.length) row(["No New Wave training in this period", "", "", ""]);
  row(["Course Fees", String(s.direct.trainees), "", money(s.direct.fees)], { bold: true });
  row(["Add Miscellaneous Charges", "", "", money(s.direct.charges)], { indent: true });
  row(["Less Discounts", "", "", money(-s.direct.discounts)], { indent: true, red: [false, false, true] });
  row(["Direct Sales", "", "", money(s.direct.sales)], { bold: true });
  row(["Collected", "", "", money(s.direct.collected)], { indent: true });
  row(["Balance Still Due", "", "", money(s.direct.balance)], { indent: true, red: [false, false, true] });
  row(["Less Direct Expenses (period)", "", "", money(-s.direct.expenses)], { indent: true, red: [false, false, true] });
  row(["Direct Gross Margin", "", "", money(s.direct.margin)], { bold: true });
  y -= 10;

  const ecols = [0.44, 0.55, 0.68, 0.79, 0.9, 1].map((f) => M + IW * f); // right edges of the number columns
  need(60);
  text("Training Endorsement", M, 11.5, bold, navy); y -= 8;
  page.drawRectangle({ x: M, y: y - 12, width: IW, height: 15, color: band }); y -= 8;
  const eh = ["Center", "Trainees", "Fees Billed", "Paid to Center", "Rebate", "Agency Share", "NW Keeps"];
  text(eh[0], M + 4, 7.5, bold, navy); eh.slice(1).forEach((h, i) => right(h, ecols[i] - 4, 7.5, bold, navy)); y -= 14;
  const erow = (cells: string[], b = false) => { need(14); const f = b ? bold : reg; text(cells[0], M + 4, 8.5, f); cells.slice(1).forEach((c, i) => right(c, ecols[i] - 4, 8.5, f, i === 4 ? red : ink)); page.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + IW, y: y - 4 }, thickness: 0.4, color: rule }); y -= 14; };
  for (const c of s.endorsement.centers) erow([c.name, String(c.trainees), money(c.fees), money(c.payable), money(c.rebate), money(-c.share), money(c.keeps)]);
  if (!s.endorsement.centers.length) erow(["No endorsed training in this period", "", "", "", "", "", ""]);
  const e = s.endorsement;
  erow(["Total", String(e.trainees), money(e.fees), money(e.payable), money(e.rebate), money(-e.share), money(e.keeps)], true);
  erow([`Rebates received ${money(e.received)} - still due from centers ${money(e.rebateDue)}`, "", "", "", "", "", ""]);

  y = Math.max(y - 46, M + 20);
  if (y < M + 40) { page = pdf.addPage([W, H]); y = H - M - 40; }
  const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 200, y }, thickness: 0.7, color: ink }); page.drawText(label, { x, y: y - 12, size: 8.5, font: reg, color: muted }); };
  sig("Prepared by (Accounting)", M);
  sig("Noted by (Admin)", W - M - 200);
  return pdf.save();
}
