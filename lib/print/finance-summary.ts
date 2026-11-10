import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { channelTotal, channelsUsed, sideTotal, type Line, type SalesLine, type summarize } from "@/lib/finance-summary";
import type { DocumentControl } from "@/lib/document-controls";
import { enlarged, loadBrand } from "@/lib/print/letterhead";

type Summary = ReturnType<typeof summarize> & { title: string; from: string; to: string };
export const ascii = (s: string) => s.replace(/[–—]/g, "-").replace(/·/g, "-").replace(/₱/g, "PHP ").normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
export const money = (c: number) => `${c < 0 ? "-" : ""}${(Math.abs(c) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const day = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/**
 * Cash and Sales Summary (owner, 21 Oct 2026; segregated sales, 5 Nov 2026), on the shared Corporate Two-Tone letterhead,
 * legal paper, drawn 1.17 times larger (10 Nov 2026):
 * Total Sales, then Sales from New Wave Courses by category, then Sales from Endorsed Courses by center, then cash. Amounts in PHP.
 */
export async function createFinanceSummaryPdf(s: Summary, printed: string, control?: DocumentControl | null, logoBytes?: Uint8Array) {
  const pdf = await PDFDocument.create();
  const brand = await loadBrand(pdf, logoBytes), { reg, bold } = brand;
  const navy = rgb(0.07, 0.25, 0.39), blue = rgb(0.02, 0.44, 0.82), muted = rgb(0.37, 0.44, 0.5), ink = rgb(0.06, 0.15, 0.22), rule = rgb(0.86, 0.9, 0.93), band = rgb(0.9, 0.96, 0.99), soft = rgb(0.93, 0.96, 0.97), orange = rgb(0.95, 0.34, 0.08), red = rgb(0.71, 0.14, 0.09), green = rgb(0.04, 0.48, 0.24);
  const TITLE = "CASH AND SALES SUMMARY", frame = enlarged(pdf, brand, control, 1.17), { W, M } = frame, IW = W - 2 * M;
  let { page, y } = frame.open({ title: TITLE });
  const text = (t: string, x: number, size: number, font: PDFFont = reg, color = ink) => page.drawText(ascii(t), { x, y, size, font, color });
  const right = (t: string, xr: number, size: number, font: PDFFont = reg, color = ink) => { const v = ascii(t); page.drawText(v, { x: xr - font.widthOfTextAtSize(v, size), y, size, font, color }); };
  const fit = (t: string, width: number, size: number, font: PDFFont = reg) => { let v = ascii(t); if (font.widthOfTextAtSize(v, size) <= width) return v; while (v.length > 1 && font.widthOfTextAtSize(`${v}...`, size) > width) v = v.slice(0, -1); return `${v}...`; };
  const need = (h: number) => { if (y - h < frame.bottom) ({ page, y } = frame.open({ title: TITLE, cont: true })); };

  y += 4;
  text(`${s.title} - ${day(s.from)} to ${day(s.to)} - amounts in PHP - printed ${day(printed)}`, M, 8.5, reg, muted); y -= 8;
  page.drawRectangle({ x: M, y, width: IW, height: 2, color: orange }); y -= 18;

  const section = (title: string, aside?: string) => {
    need(70);
    text(title, M, 12, bold, navy);
    if (aside) right(aside, W - M, 8, reg, muted);
    y -= 5;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: navy });
    y -= 14;
  };
  const tiles = (items: [string, number, string, ReturnType<typeof rgb>][]) => {
    const tw = (IW - 2 * 6) / 3;
    items.forEach(([label, v, sub, color], i) => {
      const x = M + i * (tw + 6);
      page.drawRectangle({ x, y: y - 36, width: tw, height: 44, color: soft });
      page.drawRectangle({ x, y: y - 36, width: 3, height: 44, color });
      page.drawText(ascii(label), { x: x + 8, y: y - 2, size: 7.5, font: reg, color: muted });
      page.drawText(ascii(money(v)), { x: x + 8, y: y - 15, size: 11, font: bold, color: ink });
      page.drawText(fit(sub, tw - 14, 6.4), { x: x + 8, y: y - 27, size: 6.4, font: reg, color: muted });
    });
    y -= 52;
  };

  // A table with two-line heads: `edges` are the right edges of the number columns.
  const heads = (labels: string[], edges: number[]) => {
    need(44);
    page.drawRectangle({ x: M, y: y - 16, width: IW, height: 22, color: band });
    y -= 8; text(labels[0], M + 4, 7, bold, navy); y += 8;
    labels.slice(1).forEach((h, i) => h.split("\n").forEach((part, k, parts) => { const yy = y; y = yy + (parts.length > 1 ? 0 : -8) - k * 8; right(part, edges[i] - 3, 6.6, bold, navy); y = yy; }));
    y -= 27;
  };
  // The column edges of the A4 layout (523.28 pt wide), kept in proportion.
  const SALE_EDGES = [189, 253, 311, 361, 415, 469, 523.28].map((v) => M + (v / 523.28) * IW);
  const SALE_HEADS = ["Trainees", "Course\nFees", "Miscellaneous\nCharges", "Less\nDiscounts", "Total\nSales", "Amount\nCollected", "Outstanding\nBalance"];
  const saleCells = (r: SalesLine) => [String(r.trainees), money(r.fees), money(r.charges), money(0 - r.discounts), money(r.sales), money(r.collected), money(r.balance)];
  type RowStyle = { strong?: boolean; fill?: ReturnType<typeof rgb>; bar?: ReturnType<typeof rgb>; indent?: boolean; sub?: string };
  const cellsRow = (label: string, cells: string[], edges: number[], o: RowStyle = {}) => {
    const h = o.sub ? 21 : 14;
    need(h);
    if (o.fill) page.drawRectangle({ x: M, y: y - h + 10, width: IW, height: h, color: o.fill });
    if (o.bar) page.drawRectangle({ x: M, y: y - h + 10, width: 2.5, height: h, color: o.bar });
    const f = o.strong ? bold : reg, x = M + (o.indent ? 14 : 5), room = edges[0] - (o.indent ? 52 : 40) - x;
    text(fit(label, room, 7.8, o.sub ? bold : f), x, 7.8, o.sub ? bold : f);
    cells.forEach((c, i) => right(c, edges[i] - 3, 7.6, f, !o.strong && c.startsWith("-") && c !== "-" ? red : ink));
    if (o.sub) { y -= 8; text(fit(o.sub, edges[0] - 40 - x, 6.2), x, 6.2, reg, muted); y += 8; }
    page.drawLine({ start: { x: M, y: y - h + 10 }, end: { x: M + IW, y: y - h + 10 }, thickness: 0.4, color: rule });
    y -= h;
  };
  const band2 = (label: string) => { need(14); page.drawRectangle({ x: M, y: y - 4, width: IW, height: 14, color: soft }); text(label.toUpperCase(), M + 5, 6.8, bold, muted); y -= 14; };

  // 1. Sales Summary.
  section("Sales Summary", "By Training Date - Company Charge by Date Paid");
  const share = (v: number) => (s.totalSales.sales ? `${Math.round((v / s.totalSales.sales) * 100)}% of Total Sales` : "No Sales in This Period");
  const trainees = (n: number) => `${n} Trainee${n === 1 ? "" : "s"}`;
  tiles([
    ["Total Sales", s.totalSales.sales, trainees(s.totalSales.trainees), navy],
    ["Sales from New Wave Courses", s.direct.sales, `${trainees(s.direct.trainees)} - ${share(s.direct.sales)}`, blue],
    ["Sales from Endorsed Courses", s.endorsement.sales, `${trainees(s.endorsement.trainees)} - ${share(s.endorsement.sales)}`, orange],
  ]);
  heads(["Category", ...SALE_HEADS], SALE_EDGES);
  cellsRow("Total Sales", saleCells(s.totalSales), SALE_EDGES, { strong: true, fill: band, bar: navy });
  cellsRow("Sales from New Wave Courses", saleCells(s.direct), SALE_EDGES, { strong: true, fill: soft, bar: blue });
  for (const c of s.direct.categories) cellsRow(c.name, saleCells(c), SALE_EDGES, { indent: true });
  cellsRow("Sales from Endorsed Courses", saleCells(s.endorsement), SALE_EDGES, { strong: true, fill: soft, bar: orange });
  for (const c of s.endorsement.centers) cellsRow(c.name, saleCells(c), SALE_EDGES, { indent: true });
  if (!s.endorsement.centers.length) { text("No Endorsed Training in This Period", M + 14, 7.8, reg, muted); y -= 14; }
  cellsRow("Of Which Company Charge, by Date Paid", saleCells(s.companyCharge), SALE_EDGES, { indent: true });
  y -= 2;
  text("Sales from Endorsed Courses are shown in full; most of the amount is remitted to the partnered centers. New Wave's own income from them is the Net Rebate Income.", M, 6.4, reg, muted);
  y -= 18;

  // 2. New Wave courses, by category.
  section("Sales from New Wave Courses");
  heads(["Course", ...SALE_HEADS], SALE_EDGES);
  for (const c of s.direct.categories) {
    band2(c.name);
    for (const r of c.courses) cellsRow(r.code, saleCells(r), SALE_EDGES, { sub: r.name });
    if (!c.courses.length) { text("No Training in This Period", M + 5, 7.8, reg, muted); y -= 14; }
    cellsRow(`Total ${c.name}`, saleCells(c), SALE_EDGES, { strong: true });
  }
  cellsRow("Total Sales from New Wave Courses", saleCells(s.direct), SALE_EDGES, { strong: true, fill: band });
  const lastOnly = (label: string, v: number, o: RowStyle = {}) => cellsRow(label, ["", "", "", "", "", "", money(v)], [W - M - 184, ...SALE_EDGES.slice(1)], o);
  lastOnly("Less Operating Expenses for the Period", 0 - s.direct.expenses);
  lastOnly("Gross Margin on New Wave Courses", s.direct.margin, { strong: true, fill: band });
  y -= 12;

  // 3. Endorsed courses, by center.
  section("Sales from Endorsed Courses");
  heads(["Partnered Center", ...SALE_HEADS], SALE_EDGES);
  for (const c of s.endorsement.centers) cellsRow(c.name, saleCells(c), SALE_EDGES);
  if (!s.endorsement.centers.length) { text("No Endorsed Training in This Period", M + 5, 7.8, reg, muted); y -= 14; }
  cellsRow("Total Sales from Endorsed Courses", saleCells(s.endorsement), SALE_EDGES, { strong: true, fill: band });
  y -= 12;
  need(60);
  text("Rebates from Endorsed Courses", M, 10, bold, navy); y -= 13;
  const REBATE_EDGES = [0.37, 0.48, 0.59, 0.71, 0.85, 1].map((f) => M + IW * f);
  heads(["Partnered Center", "Payable to\nPartnered Center", "Rebate", "Rebate\nReceived", "Rebates\nReceivable", "Agency\nCommission", "Net Rebate\nIncome"], REBATE_EDGES);
  const rebateCells = (c: { payable: number; rebate: number; received: number; due: number; share: number; keeps: number }) => [money(c.payable), money(c.rebate), money(c.received), money(c.due), money(0 - c.share), money(c.keeps)];
  for (const c of s.endorsement.centers) cellsRow(c.name, rebateCells(c), REBATE_EDGES);
  if (!s.endorsement.centers.length) { text("No Endorsed Training in This Period", M + 5, 7.8, reg, muted); y -= 14; }
  cellsRow("Total", rebateCells({ ...s.endorsement, due: s.endorsement.rebateDue }), REBATE_EDGES, { strong: true, fill: band });
  y -= 14;

  // 4. Cash.
  const rE = sideTotal(s.received, "E"), rD = sideTotal(s.received, "D"), dE = sideTotal(s.disbursed, "E"), dD = sideTotal(s.disbursed, "D");
  section("Cash Summary", "By Date Received and Released");
  tiles([
    ["Cash Received", rE + rD, `Endorsed ${money(rE)} - New Wave ${money(rD)}`, green],
    ["Disbursements", dE + dD, `Endorsed ${money(dE)} - New Wave ${money(dD)}`, red],
    ["Net Cash", rE + rD - dE - dD, "Received Less Disbursed", blue],
  ]);
  const cols = [M + IW * 0.58, M + IW * 0.72, M + IW * 0.86, M + IW];
  const header = (title: string, labels: string[]) => {
    need(40);
    text(title, M, 10, bold, navy); y -= 8;
    page.drawRectangle({ x: M, y: y - 12, width: IW, height: 15, color: band });
    y -= 8; text(labels[0], M + 4, 7, bold, navy);
    labels.slice(1).forEach((h, i) => right(h, cols[i + 1] - 4, 7, bold, navy));
    y -= 14;
  };
  const row = (cells: string[], opts: { bold?: boolean; indent?: boolean; band?: boolean; red?: boolean[] } = {}) => {
    need(14);
    if (opts.band) page.drawRectangle({ x: M, y: y - 4, width: IW, height: 14, color: soft });
    const f = opts.bold ? bold : reg;
    text(cells[0], M + (opts.indent ? 14 : 4), 8.2, f, opts.band ? navy : ink);
    cells.slice(1).forEach((c, i) => right(c, cols[i + 1] - 4, 8.2, f, opts.red?.[i] ? red : ink));
    if (!opts.band) page.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + IW, y: y - 4 }, thickness: 0.4, color: rule });
    y -= 14;
  };
  const cashBlock = (title: string, ls: Line[]) => {
    header(title, ["Line", "Endorsed Courses", "New Wave Courses", "Total"]);
    for (const [label, side] of [["Endorsed Courses", "E"], ["New Wave Courses", "D"]] as const) {
      const mine = ls.filter((l) => l.side === side);
      row([label, "", "", ""], { band: true, bold: true });
      for (const l of mine) row([l.label, side === "E" ? money(l.total) : "-", side === "D" ? money(l.total) : "-", money(l.total)], { indent: true });
      if (!mine.length) row(["None in This Period", "", "", ""], { indent: true });
    }
    const e = sideTotal(ls, "E"), d = sideTotal(ls, "D");
    row([`Total ${title}`, money(e), money(d), money(e + d)], { bold: true });
    row(["By Channel", "", "", ""], { band: true, bold: true });
    for (const ch of channelsUsed(ls)) { const ce = channelTotal(ls, "E", ch), cd = channelTotal(ls, "D", ch); row([ch, money(ce), money(cd), money(ce + cd)], { indent: true }); }
    y -= 10;
  };
  cashBlock("Cash Received", s.received);
  cashBlock("Disbursements", s.disbursed);
  header("Net Cash", ["", "Endorsed Courses", "New Wave Courses", "Total"]);
  row(["Cash Received", money(rE), money(rD), money(rE + rD)]);
  row(["Less Disbursements", money(0 - dE), money(0 - dD), money(0 - dE - dD)], { red: [dE > 0, dD > 0, dE + dD > 0] });
  row(["Net Cash", money(rE - dE), money(rD - dD), money(rE + rD - dE - dD)], { bold: true });

  need(70);
  y -= 46;
  const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 200, y }, thickness: 0.7, color: ink }); page.drawText(label, { x, y: y - 12, size: 8.5, font: reg, color: muted }); };
  sig("Prepared by (Accounting)", M);
  sig("Noted by (Admin)", W - M - 200);
  frame.close();
  return pdf.save();
}
