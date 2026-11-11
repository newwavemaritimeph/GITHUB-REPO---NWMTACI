import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { drawControlBlock, drawControlLine } from "@/lib/print/control-block";
import { FOOT, LEGAL, SIDE, drawLetterhead, enlarged, finishPages, loadBrand, newPage } from "@/lib/print/letterhead";
import type { DocumentControl } from "@/lib/document-controls";
import { pesosInWords } from "@/lib/amount-words";

export type DocumentSnapshot = {
  title: string;
  reference: string;
  issuedAt: string;
  recipient?: string;
  sections: { heading: string; rows: { label: string; value: string }[] }[];
  footer?: string;
  logoBytes?: Uint8Array;
};

/** A plain record page (the Payment Invoice) on the shared Corporate Two-Tone letterhead, legal paper, drawn 1.15 times larger (10 Nov 2026). */
export async function createBrandedPdf(snapshot: DocumentSnapshot) {
  const pdf = await PDFDocument.create();
  const brand = await loadBrand(pdf, snapshot.logoBytes), { reg: regular, bold } = brand;
  const colors = { ink: rgb(.07,.25,.39), blue: rgb(.02,.44,.82), muted: rgb(.38,.47,.54), line: rgb(.84,.9,.93) };
  const title = ascii(snapshot.title).toUpperCase(), frame = enlarged(pdf, brand, null, 1.15), { W, M } = frame;
  let { page, y } = frame.open({ title, right: snapshot.reference });
  const addPage = () => { ({ page, y } = frame.open({ title, cont: true })); };
  page.drawText(ascii(`Reference: ${snapshot.reference}`), { x: M, y, size: 9, font: regular, color: colors.muted });
  page.drawText(ascii(`Issued: ${snapshot.issuedAt}`), { x: W - M - 190, y, size: 9, font: regular, color: colors.muted });
  y -= 30;
  for (const section of snapshot.sections) {
    if (y < frame.bottom + 60) addPage();
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 25, color: rgb(.94,.98,.99) });
    page.drawText(ascii(section.heading), { x: M + 10, y: y + 3, size: 10, font: bold, color: colors.blue });
    y -= 25;
    for (const row of section.rows) {
      if (y < frame.bottom + 20) addPage();
      page.drawText(ascii(row.label), { x: M + 10, y, size: 9, font: regular, color: colors.muted });
      page.drawText(ascii(row.value).slice(0, 70), { x: M + 166, y, size: 9, font: bold, color: colors.ink });
      page.drawLine({ start: { x: M + 10, y: y - 7 }, end: { x: W - M - 10, y: y - 7 }, thickness: .5, color: colors.line });
      y -= 23;
    }
    y -= 12;
  }
  if (y < frame.bottom + 10) addPage();
  page.drawText(ascii(snapshot.footer ?? "Generated from a versioned New Wave record snapshot."), { x: M, y, size: 7, font: regular, color: colors.muted });
  frame.close();
  return pdf.save();
}

export type TrainingInstructionsSnapshot = {
  control?: DocumentControl | null;
  traineeName: string;
  formalName: string;
  nwmtaciNumber: string;
  srn: string;
  courseName: string;
  batchNumber: string;
  dateOfTraining: string;
  time: string;
  classroom: string;
  mode: string;
  online: boolean;
  googleClassroomLink?: string | null;
  classCode?: string | null;
  reference: string;
  issuedAt: string;
  categoryLabel: string;
  arriveNote: string;
  bringTitle: string;
  bring: string[];
  reminders: string[];
  policies: [string, string][];
  steps: [string, string][];
  logoBytes?: Uint8Array;
};

// Strip characters Helvetica's WinAnsi encoding can't render (en/em dash, smart quotes,
// bullets, ellipsis) so live DB text can never crash PDF generation.
const ascii = (s: string) => (s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[•]/g, "-").replace(/…/g, "...").replace(/[^\x00-\xFF]/g, "");

/**
 * Training instructions, Design 11 "Cards + Steps" (owner's choice, 3 Nov 2026): half of Legal in
 * landscape (8.5 x 7 in) with the Acknowledgement Receipt header, four cards (When, Where, Bring,
 * Reminders), five steps, the policies and two signatures. The text starts large and shrinks
 * until it fits, so an Admin's longer template still prints on one page.
 */
export async function createTrainingInstructionsPdf(s: TrainingInstructionsSnapshot) {
  const pdf = await PDFDocument.create();
  const W = 612, H = 504, M = 22;
  const page = pdf.addPage([W, H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), mono = await pdf.embedFont(StandardFonts.CourierBold);
  type Font = typeof reg;
  const c = { orange: rgb(.949, .337, .082), blue: rgb(.02, .443, .816), navy: rgb(.071, .247, .388), green: rgb(.039, .478, .243), lightcyan: rgb(.62, .89, .945), ink: rgb(.06, .15, .22), muted: rgb(.31, .40, .47), rule: rgb(.78, .83, .86), white: rgb(1, 1, 1) };
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (s.logoBytes) { try { logo = await pdf.embedPng(s.logoBytes); } catch { logo = null; } }
  const wrap = (text: string, size: number, maxW: number, font: Font = reg) => {
    const out: string[] = []; let line = "";
    // A word wider than the space (a link) is broken by characters.
    const words = ascii(text).split(/\s+/).filter(Boolean).flatMap((w) => {
      if (font.widthOfTextAtSize(w, size) <= maxW) return [w];
      const parts: string[] = []; let cur = "";
      for (const ch of w) { if (font.widthOfTextAtSize(cur + ch, size) > maxW && cur) { parts.push(cur); cur = ch; } else cur += ch; }
      return cur ? [...parts, cur] : parts;
    });
    for (const w of words) { const test = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = w; } else line = test; }
    return line ? [...out, line] : out;
  };
  const write = (text: string, x: number, y: number, size: number, font: Font = reg, color = c.ink) => page.drawText(ascii(text), { x, y, size, font, color });
  const rightAt = (text: string, right: number, y: number, size: number, font: Font = reg, color = c.ink) => write(text, right - font.widthOfTextAtSize(ascii(text), size), y, size, font, color);

  // The Acknowledgement Receipt header.
  if (logo) { const d = logo.scale(34 / Math.max(logo.width, logo.height)); page.drawImage(logo, { x: M, y: H - M - 34, width: d.width, height: d.height }); }
  write("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", M + 42, H - M - 11, 10.5, bold, c.navy);
  const ctlH = drawControlBlock(page, { reg, bold }, s.control, { right: W - M, top: H - M, width: 125, rowHeight: 9 });
  wrap("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000 | +63 948 847 6530 | (02) 8553 0310 | newwavemaritime@gmail.com | facebook.com/newwavemtc", 6.8, W - 2 * M - 42 - (ctlH ? 133 : 0)).forEach((l, i) => write(l, M + 42, H - M - 22 - i * 8.4, 6.8, reg, c.muted));
  const barY = H - M - 58;
  page.drawRectangle({ x: M, y: barY, width: W - 2 * M, height: 17, color: c.navy });
  page.drawRectangle({ x: M, y: barY - 2.2, width: W - 2 * M, height: 2.2, color: c.orange });
  write("TRAINING INSTRUCTIONS", M + 8, barY + 5.2, 9.5, bold, c.white);
  write(`${s.categoryLabel} | issued ${s.issuedAt}`, M + 8 + bold.widthOfTextAtSize("TRAINING INSTRUCTIONS", 9.5) + 8, barY + 5.2, 7.4, reg, c.lightcyan);
  rightAt(s.reference ?? "", W - M - 8, barY + 5.2, 8.5, mono, c.white);
  rightAt("REF NO.", W - M - 8 - mono.widthOfTextAtSize(ascii(s.reference ?? ""), 8.5) - 5, barY + 5.2, 7.4, reg, c.lightcyan);

  const hasClass = !!(s.googleClassroomLink || s.classCode), gap = 8, colW = (W - 2 * M - gap) / 2, bottom = M + 30;
  const whereLine = hasClass ? `${s.googleClassroomLink ?? ""}${s.classCode ? ` | code ${s.classCode}` : ""}` : s.online ? "" : "Bel-Air Apartment, 1020 Roxas Boulevard, Ermita";
  const whenLine = `${s.time} | ${s.arriveNote}`;

  // Measured first (draw = false), then drawn at the first size that fits.
  const lay = (k: number, draw: boolean) => {
    const size = 8.8 * k, lh = size * 1.28, head = 7.6 * k;
    let y = barY - 8;
    // Identity.
    const who = [s.formalName, s.nwmtaciNumber, s.srn ? `SRN ${s.srn}` : ""].filter(Boolean).join(" | "), what = [s.courseName, s.batchNumber ? `Batch ${s.batchNumber}` : ""].filter(Boolean).join(" | ");
    for (const [text, font] of [[who, bold], [what, reg]] as [string, Font][]) for (const l of wrap(text, size, W - 2 * M, font)) { y -= lh; if (draw) write(l, M, y, size, font); }
    y -= 6;
    // Cards.
    type Line = { text: string; font?: Font; bullet?: boolean };
    const bodyH = (lines: Line[], w: number) => lines.reduce((n, l) => n + wrap(l.text, size, w - 16 - (l.bullet ? 8 : 0), l.font ?? reg).length * lh, 0);
    const card = (x: number, top: number, h: number, title: string, color: typeof c.ink, lines: Line[]) => {
      page.drawRectangle({ x, y: top - h, width: colW, height: h, borderColor: c.rule, borderWidth: .7 });
      page.drawRectangle({ x, y: top - 2.6, width: colW, height: 2.6, color });
      write(title.toUpperCase(), x + 8, top - 6.5 - head, head, bold, color);
      let at = top - 8 - head - 2;
      for (const l of lines) wrap(l.text, size, colW - 16 - (l.bullet ? 8 : 0), l.font ?? reg).forEach((t, i) => { at -= lh; if (l.bullet && i === 0) write("-", x + 8, at, size, bold, color); write(t, x + 8 + (l.bullet ? 8 : 0), at, size, l.font ?? reg); });
    };
    const when: Line[] = [{ text: s.dateOfTraining, font: bold }, { text: whenLine }];
    const where: Line[] = [{ text: `${s.classroom} | ${s.mode}`, font: bold }, ...(whereLine ? [{ text: whereLine }] : [])];
    const bring = s.bring.map((text): Line => ({ text, bullet: true })), reminders = s.reminders.map((text): Line => ({ text, bullet: true }));
    for (const [[a, ac, al], [b, bc, bl]] of [[["When", c.blue, when], ["Where", c.navy, where]], [[s.bringTitle, c.orange, bring], ["Reminders", c.green, reminders]]] as [[string, typeof c.ink, Line[]], [string, typeof c.ink, Line[]]][]) {
      const h = 8 + head + 2 + Math.max(bodyH(al, colW), bodyH(bl, colW)) + 6;
      if (draw) { card(M, y, h, a, ac, al); card(M + colW + gap, y, h, b, bc, bl); }
      y -= h + 6;
    }
    // Steps.
    if (draw) write("YOUR STEPS", M, y - head, head, bold, c.navy);
    y -= head + 4;
    const stepW = (W - 2 * M - 4 * 6) / 5, small = 7.6 * k, smallLh = small * 1.25;
    const stepH = 6 + 14 + Math.max(...s.steps.map(([, t]) => wrap(t, small, stepW - 10).length)) * smallLh + 4;
    if (draw) s.steps.forEach(([title, text], i) => {
      const x = M + i * (stepW + 6);
      page.drawRectangle({ x, y: y - stepH, width: stepW, height: stepH, borderColor: c.rule, borderWidth: .7 });
      page.drawCircle({ x: x + 11, y: y - 11, size: 6.5, color: c.orange });
      const n = String(i + 1); write(n, x + 11 - bold.widthOfTextAtSize(n, 7.5) / 2, y - 13.6, 7.5, bold, c.white);
      write(title, x + 21, y - 13.6, small + .4, bold);
      wrap(text, small, stepW - 10).forEach((l, j) => write(l, x + 5, y - 20 - smallLh * (j + 1) + 2, small));
    });
    y -= stepH + 6;
    // Policies, two columns.
    if (draw) write("POLICIES", M, y - head, head, bold, c.navy);
    y -= head + 2;
    const rows = Array.from({ length: Math.ceil(s.policies.length / 2) }, (_, i) => s.policies.slice(i * 2, i * 2 + 2));
    for (const row of rows) {
      const texts = row.map(([label, text]) => wrap(`${label ? `${label}: ` : ""}${text}`, small, colW));
      const h = Math.max(...texts.map((t) => t.length)) * smallLh + 2;
      if (draw) texts.forEach((t, col) => t.forEach((l, i) => write(l, M + col * (colW + gap), y - smallLh * (i + 1), small, reg, c.muted)));
      y -= h;
    }
    return y;
  };
  const scale = [1.2, 1.15, 1.1, 1.05, 1, .95, .9, .85, .8].find((k) => lay(k, false) >= bottom) ?? .75;
  lay(scale, true);

  // Signatures sit at the foot of the sheet.
  for (const [i, label] of ["Registration Officer", "Trainee"].entries()) {
    const x = M + i * (colW + gap);
    page.drawLine({ start: { x, y: bottom - 12 }, end: { x: x + colW, y: bottom - 12 }, thickness: .7, color: c.ink });
    write(label, x + colW / 2 - reg.widthOfTextAtSize(label, 7.2) / 2, bottom - 21, 7.2, reg, c.muted);
  }
  return pdf.save();
}

type AdmissionSnapshot={reference:string;traineeNumber:string;firstName:string;middleName:string;lastName:string;suffix:string;address:string;birthDate:string;placeOfBirth:string;email:string;mobile:string;srn:string;rank:string;company:string;emergencyName:string;emergencyMobile:string;course:string;schedule:string;venue:string;termsVersion:string};
type PaymentSnapshot={invoiceNumber:string;receiptNumber:string;paymentNumber:string;enrollmentNumber:string;traineeName:string;traineeNumber:string;address:string;course:string;amountCentavos:number;totalDueCentavos:number;totalPaidCentavos:number;balanceCentavos:number;method:string;referenceNumber:string;receivedAt:string;cashierName:string};
const php=(value:number)=>`PHP ${(value/100).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export async function createAdmissionPdf(snapshot:AdmissionSnapshot,templateBytes:Uint8Array,termsBytes:Uint8Array){
  const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),template=await pdf.embedPng(templateBytes),terms=await pdf.embedPng(termsBytes);
  const width=842,height=650,page=pdf.addPage([width,height]);page.drawImage(template,{x:0,y:0,width,height});
  const value=(text:string,x:number,top:number,size=8)=>page.drawText((text||"-").slice(0,74),{x,y:height-top,size,font:regular,color:rgb(.02,.18,.35)});
  value(snapshot.firstName,166,174);value(snapshot.middleName,166,202);value(snapshot.lastName,166,230);value(snapshot.suffix,166,257);value(snapshot.address,166,285,7);value(snapshot.birthDate,166,313);value(snapshot.placeOfBirth,166,341);value(snapshot.email,166,369,7);value(snapshot.mobile,166,397);value(snapshot.srn,166,424);value(snapshot.rank,166,451);value(snapshot.emergencyMobile,211,503);
  page.drawText(`${snapshot.course}`.slice(0,75),{x:445,y:height-313,size:9,font:bold,color:rgb(.02,.18,.35)});page.drawText(`${snapshot.schedule}`.slice(0,80),{x:445,y:height-334,size:8,font:regular,color:rgb(.02,.18,.35)});page.drawText(`${snapshot.venue}`.slice(0,80),{x:445,y:height-352,size:8,font:regular,color:rgb(.02,.18,.35)});
  page.drawText(`Trainee: ${snapshot.traineeNumber}   Registration: ${snapshot.reference}`,{x:445,y:height-462,size:8,font:bold,color:rgb(.02,.18,.35)});page.drawText(`Company: ${snapshot.company||"-"}   Emergency: ${snapshot.emergencyName}`,{x:445,y:height-480,size:7,font:regular,color:rgb(.02,.18,.35)});
  const termsPage=pdf.addPage([842,595]);termsPage.drawImage(terms,{x:0,y:0,width:842,height:595});termsPage.drawRectangle({x:20,y:12,width:802,height:23,color:rgb(1,1,1),opacity:.92});termsPage.drawText(`Accepted electronically - ${snapshot.firstName} ${snapshot.lastName} - Version ${snapshot.termsVersion}`,{x:30,y:20,size:8,font:bold,color:rgb(.07,.25,.39)});
  return pdf.save();
}

export async function createAcknowledgmentReceiptPdf(snapshot:PaymentSnapshot,templateBytes:Uint8Array){
  const pdf=await PDFDocument.create(),page=pdf.addPage([842,398]),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),template=await pdf.embedPng(templateBytes);page.drawImage(template,{x:0,y:0,width:842,height:398});const ink=rgb(.03,.03,.03);
  const draw=(text:string,x:number,top:number,size=8,font=regular)=>page.drawText((text||"-").slice(0,80),{x,y:398-top,size,font,color:ink});
  draw(snapshot.receiptNumber,716,86,13,bold);draw(new Date(snapshot.receivedAt).toLocaleDateString("en-PH"),668,121);draw(snapshot.traineeName,405,161);draw(snapshot.address,410,188,7);draw(php(snapshot.amountCentavos),391,245,9,bold);draw(`${snapshot.course} - ${snapshot.enrollmentNumber}`,304,300,7);draw(snapshot.cashierName,660,355,7,bold);
  draw(snapshot.course,18,73,7);draw(php(snapshot.amountCentavos),183,73,7);draw(php(snapshot.totalDueCentavos),183,226,7,bold);draw(php(snapshot.balanceCentavos),183,244,7,bold);draw(php(snapshot.amountCentavos),183,262,7,bold);draw(snapshot.referenceNumber,174,322,7);draw(snapshot.method.toUpperCase(),61,303,7,bold);
  return pdf.save();
}

export type InvoiceLine = { description: string; detail: string; amountCentavos: number };
export type EnrollmentInvoiceSnapshot = {
  reference: string;
  traineeName: string;
  traineeNumber: string;
  course: string;
  schedule: string;
  issuedAt: string;
  lines: { charges: InvoiceLine[]; payments: InvoiceLine[] };
  dueCentavos: number;
  paidCentavos: number;
  balanceCentavos: number;
  cashierName: string;
  /** Payment status stamped prominently for instructor verification. */
  paymentStatus?: string;
  /** Optional New Wave logo PNG bytes; drawn top-left when supplied. */
  logoBytes?: Uint8Array;
};

export type HalfSheetField = { label: string; value: string };
export type HalfSheetLine = { description: string; detail?: string; amount?: string; negative?: boolean };
export type HalfSheetDocument = {
  /** Document name shown in the header, e.g. "PAYMENT INVOICE". */
  title: string;
  meta: HalfSheetField[];
  columns?: HalfSheetField[];
  lineHeading?: string;
  lines?: HalfSheetLine[];
  totals?: HalfSheetField[];
  signatures?: { label: string; name: string }[];
  footer?: string;
  logoBytes?: Uint8Array;
  /** Page size in points. Defaults to half-short-bond landscape (612 × 396). */
  page?: { width: number; height: number };
  /** Prominent status stamp drawn in the header (e.g. payment status). */
  statusBadge?: { label: string; tone: "green" | "amber" | "red" };
  /** The form's Form No. and revision details (Form Numbers), at the top right. */
  control?: DocumentControl | null;
};

/**
 * Shared New Wave document layout on a half-short-bond sheet, crosswise
 * (8.5in × 5.5in landscape = 612 × 396pt). Every issued document — Payment
 * Invoice, Admission Slip, Expense Voucher — is built from this so they share
 * one letterhead, one grid, and one footer style.
 */
export async function createHalfSheetDocument(doc: HalfSheetDocument) {
  const pdf = await PDFDocument.create();
  const width = doc.page?.width ?? 612;
  const height = doc.page?.height ?? 396;
  let page = pdf.addPage([width, height]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.25, 0.39);
  const blue = rgb(0.02, 0.44, 0.82);
  const orange = rgb(0.95, 0.34, 0.08);
  const muted = rgb(0.38, 0.47, 0.54);
  const line = rgb(0.84, 0.9, 0.93);
  const panel = rgb(0.95, 0.98, 0.99);
  const green = rgb(0.05, 0.5, 0.25);
  const left = 28;
  const right = width - 28;
  const mid = left + Math.round((right - left) / 2);
  let y = height - 24;

  const newPage = () => {
    page = pdf.addPage([width, height]);
    y = height - 24;
  };
  const ensure = (min: number) => {
    if (y < min) newPage();
  };

  // Letterhead band
  page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: blue });
  let headerX = left;
  if (doc.logoBytes) {
    try {
      const logo = await pdf.embedPng(doc.logoBytes);
      const dims = logo.scale(40 / logo.width);
      page.drawImage(logo, { x: left, y: y - dims.height + 8, width: dims.width, height: dims.height });
      headerX = left + dims.width + 12;
    } catch {
      /* text-only header */
    }
  }
  page.drawText("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", { x: headerX, y, size: 9.5, font: bold, color: ink });
  page.drawText("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000", { x: headerX, y: y - 12, size: 6.5, font: regular, color: muted });
  page.drawText(doc.title, { x: headerX, y: y - 28, size: 13, font: bold, color: orange });
  drawControlBlock(page, { reg: regular, bold }, doc.control, { right, top: y + 10, width: 120, rowHeight: 8.5 });

  // Prominent status stamp (top-right) — used by instructors to verify enrollment.
  if (doc.statusBadge) {
    const badge = doc.statusBadge;
    const fill = badge.tone === "green" ? green : badge.tone === "amber" ? rgb(0.85, 0.55, 0.05) : rgb(0.78, 0.12, 0.12);
    const label = badge.label.toUpperCase();
    const size = 12;
    const textW = bold.widthOfTextAtSize(label, size);
    const boxW = textW + 24;
    const boxH = 26;
    const boxX = right - boxW;
    const boxY = y - 30;
    page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: fill });
    page.drawText(label, { x: boxX + 12, y: boxY + 8, size, font: bold, color: rgb(1, 1, 1) });
  }

  y -= 42;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1.2, color: blue });
  y -= 16;

  // Meta row (evenly spaced)
  if (doc.meta.length) {
    const step = (right - left) / doc.meta.length;
    doc.meta.forEach((field, index) => {
      const x = left + step * index;
      page.drawText(field.label, { x, y, size: 6.5, font: regular, color: muted });
      page.drawText(field.value.slice(0, 34), { x, y: y - 10, size: 8.5, font: bold, color: ink });
    });
    y -= 26;
  }

  // Two-column details grid
  if (doc.columns?.length) {
    for (let i = 0; i < doc.columns.length; i += 2) {
      ensure(90);
      const a = doc.columns[i];
      const b = doc.columns[i + 1];
      page.drawText(a.label, { x: left, y, size: 6.5, font: regular, color: muted });
      if (b) page.drawText(b.label, { x: mid, y, size: 6.5, font: regular, color: muted });
      y -= 10;
      page.drawText(a.value.slice(0, 46), { x: left, y, size: 8.5, font: bold, color: ink });
      if (b) page.drawText(b.value.slice(0, 46), { x: mid, y, size: 8.5, font: bold, color: ink });
      y -= 16;
    }
    y -= 4;
  }

  // Itemized lines
  if (doc.lineHeading) {
    ensure(80);
    page.drawText(doc.lineHeading.toUpperCase(), { x: left, y, size: 8, font: bold, color: blue });
    y -= 6;
  }
  (doc.lines ?? []).forEach((item) => {
    ensure(70);
    const rowH = item.detail ? 26 : 18;
    y -= rowH;
    page.drawRectangle({ x: left, y, width: right - left, height: rowH, color: panel });
    page.drawRectangle({ x: left, y, width: 3, height: rowH, color: item.negative ? green : blue });
    page.drawText(item.description.slice(0, 64), { x: left + 12, y: y + rowH - 12, size: 8, font: bold, color: ink });
    if (item.detail) page.drawText(item.detail.slice(0, 86), { x: left + 12, y: y + 6, size: 6.5, font: regular, color: muted });
    if (item.amount) {
      const amount = `${item.negative ? "-" : ""}${item.amount}`;
      page.drawText(amount, { x: right - 10 - bold.widthOfTextAtSize(amount, 9), y: y + rowH / 2 - 4, size: 9, font: bold, color: item.negative ? green : ink });
    }
    y -= 4;
  });

  // Totals grid
  if (doc.totals?.length) {
    ensure(80);
    y -= 4;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.6, color: line });
    y -= 12;
    for (let i = 0; i < doc.totals.length; i += 2) {
      const a = doc.totals[i];
      const b = doc.totals[i + 1];
      page.drawText(a.label, { x: left, y, size: 6.5, font: regular, color: muted });
      if (b) page.drawText(b.label, { x: mid, y, size: 6.5, font: regular, color: muted });
      y -= 11;
      page.drawText(a.value, { x: left, y, size: 9.5, font: bold, color: ink });
      if (b) page.drawText(b.value, { x: mid, y, size: 9.5, font: bold, color: ink });
      y -= 16;
    }
  }

  // Signatures
  if (doc.signatures?.length) {
    ensure(60);
    y -= 18;
    const step = (right - left) / doc.signatures.length;
    doc.signatures.forEach((sig, index) => {
      const x = left + step * index;
      page.drawText((sig.name || " ").slice(0, 30), { x, y: y + 4, size: 8, font: bold, color: ink });
      page.drawLine({ start: { x, y }, end: { x: x + step - 24, y }, thickness: 0.6, color: line });
      page.drawText(sig.label, { x, y: y - 10, size: 6.5, font: regular, color: muted });
    });
    y -= 22;
  }

  if (doc.footer) page.drawText(doc.footer.slice(0, 130), { x: left, y: 20, size: 6, font: regular, color: muted });
  return pdf.save();
}

/** Cashier per-enrollment Payment Invoice on the shared half-sheet layout. */
export async function createEnrollmentInvoicePdf(snapshot: EnrollmentInvoiceSnapshot) {
  const lines: HalfSheetLine[] = [
    ...snapshot.lines.charges.map((item) => ({ description: item.description, detail: item.detail, amount: php(item.amountCentavos) })),
    ...snapshot.lines.payments.map((item) => ({ description: item.description, detail: item.detail, amount: php(item.amountCentavos), negative: true })),
  ];
  const status = (snapshot.paymentStatus ?? "").toLowerCase();
  const statusBadge = status
    ? {
        label: status.includes("partial") ? "Partially Paid" : status.includes("paid") ? "Fully Paid" : snapshot.paymentStatus!,
        tone: (status.includes("partial") ? "amber" : status === "paid" ? "green" : "red") as "green" | "amber" | "red",
      }
    : undefined;
  return createHalfSheetDocument({
    title: "PAYMENT INVOICE",
    logoBytes: snapshot.logoBytes,
    page: { width: 504, height: 612 }, // half of legal bond, portrait (7in × 8.5in)
    statusBadge,
    meta: [
      { label: "Invoice", value: `INV-${snapshot.reference}` },
      { label: "Trainee No.", value: snapshot.traineeNumber },
      { label: "Issued", value: snapshot.issuedAt },
    ],
    columns: [
      { label: "Name", value: snapshot.traineeName },
      { label: "Enrollment", value: snapshot.reference },
      { label: "Course", value: snapshot.course },
      { label: "Schedule", value: snapshot.schedule },
    ],
    lineHeading: "Charges & payments",
    lines: lines.length ? lines : [{ description: "No ledger entries yet." }],
    totals: [
      { label: "Total due", value: php(snapshot.dueCentavos) },
      { label: "Total paid", value: php(snapshot.paidCentavos) },
      { label: "Balance", value: php(snapshot.balanceCentavos) },
      { label: "Prepared by", value: snapshot.cashierName },
    ],
    footer: "This Payment Invoice is generated from the enrollment ledger. Amounts reflect posted charges, discounts, and verified payments.",
  });
}

export type AdmissionSlipSnapshot = {
  reference: string;
  traineeName: string;
  traineeNumber: string;
  srn: string;
  course: string;
  schedule: string;
  time: string;
  venue: string;
  instructor: string;
  issuedAt: string;
  officer: string;
  cashier: string;
  logoBytes?: Uint8Array;
};

/** Admission Slip on the shared half-sheet layout. */
export async function createAdmissionSlipPdf(snapshot: AdmissionSlipSnapshot) {
  return createHalfSheetDocument({
    title: "ADMISSION SLIP",
    logoBytes: snapshot.logoBytes,
    meta: [
      { label: "Reference", value: snapshot.reference },
      { label: "Trainee No.", value: snapshot.traineeNumber },
      { label: "Issued", value: snapshot.issuedAt },
    ],
    columns: [
      { label: "Name", value: snapshot.traineeName },
      { label: "SRN", value: snapshot.srn || "-" },
      { label: "Course", value: snapshot.course },
      { label: "Schedule", value: snapshot.schedule },
      { label: "Time", value: snapshot.time },
      { label: "Classroom", value: snapshot.venue || "-" },
      { label: "Instructor", value: snapshot.instructor || "-" },
      { label: "Status", value: "Admitted" },
    ],
    signatures: [
      { label: "Registration Officer — Signature over Printed Name", name: snapshot.officer },
      { label: "Cashier — Signature over Printed Name", name: snapshot.cashier },
    ],
    footer: "Present this admission slip on the first training day together with a valid ID.",
  });
}

export type AdmissionInvoiceLine = { description: string; detail?: string; amountCentavos: number; negative?: boolean };
/** One course the trainee enrolled in on the admission day. */
export type AdmissionCourseLine = {
  course: string;
  schedule: string;
  time: string;
  venue: string;
  instructor: string;
};

export type AdmissionInvoiceSnapshot = {
  control?: DocumentControl | null;
  reference: string;
  traineeName: string;
  traineeNumber: string;
  srn: string;
  mobile: string;
  email: string;
  /** Every course the trainee enrolled in on the admission day (same-day enrollments). */
  courses: AdmissionCourseLine[];
  registrationStatus: string;
  issuedAt: string;
  officer: string;
  cashier: string;
  lines: AdmissionInvoiceLine[];
  dueCentavos: number;
  paidCentavos: number;
  balanceCentavos: number;
  /** Payment status stamped prominently (FULLY PAID / PARTIALLY PAID / UNPAID). */
  paymentStatus?: string;
  logoBytes?: Uint8Array;
};

/**
 * Combined Payment Invoice + Admission Slip on ONE A4 portrait sheet
 * (595.28 × 841.89pt) with narrow margins. The block is printed twice — the
 * upper half tagged ORIGINAL COPY (trainee), the lower half DUPLICATE COPY
 * (file copy) — so the sheet is cut across the middle. Payment status is
 * stamped prominently for instructor verification.
 */
export async function createAdmissionInvoicePdf(snapshot: AdmissionInvoiceSnapshot) {
  const pdf = await PDFDocument.create();
  const width = 595.28; // A4 portrait
  const height = 841.89;
  const bandH = height / 2; // two copies stacked on one A4 (upper + lower)
  const page = pdf.addPage([width, height]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.25, 0.39);
  const blue = rgb(0.02, 0.44, 0.82);
  const orange = rgb(0.95, 0.34, 0.08);
  const muted = rgb(0.38, 0.47, 0.54);
  const line = rgb(0.84, 0.9, 0.93);
  const green = rgb(0.05, 0.5, 0.25);
  const left = 20; // narrow margins to fit two copies
  const right = width - 20;

  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
  if (snapshot.logoBytes) {
    try {
      logo = await pdf.embedPng(snapshot.logoBytes);
    } catch {
      logo = undefined;
    }
  }

  const statusInfo = (() => {
    const status = (snapshot.paymentStatus ?? "").toLowerCase();
    if (!status) return undefined;
    if (status.includes("partial")) return { label: "PARTIALLY PAID", fill: rgb(0.85, 0.55, 0.05) };
    if (status === "paid" || status.includes("fully")) return { label: "FULLY PAID", fill: green };
    return { label: "UNPAID", fill: rgb(0.78, 0.12, 0.12) };
  })();

  // Truncate a string to a max pixel width, appending an ellipsis if trimmed.
  const fit = (text: string, font: typeof regular, size: number, maxWidth: number) => {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
    return `${t}…`;
  };

  // Word-wrap a string to a max pixel width for a given font/size.
  const wrap = (text: string, font: typeof regular, size: number, maxWidth: number) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(attempt, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = attempt;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  // Draws one combined copy anchored at the band whose bottom edge is `baseY`.
  const drawCopy = (baseY: number, copyLabel: string) => {
    let y = baseY + bandH - 14;
    let headerX = left;
    if (logo) {
      const dims = logo.scale(30 / logo.width);
      page.drawImage(logo, { x: left, y: y - dims.height + 8, width: dims.width, height: dims.height });
      headerX = left + dims.width + 10;
    }
    page.drawText("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", { x: headerX, y, size: 9, font: bold, color: ink });
    page.drawText("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000", { x: headerX, y: y - 11, size: 6.5, font: regular, color: muted });
    page.drawText("TRAINEE ADMISSION RECORD", { x: headerX, y: y - 25, size: 12, font: bold, color: orange });

    // Copy tag (top-right)
    page.drawText(copyLabel, { x: right - bold.widthOfTextAtSize(copyLabel, 8), y: baseY + bandH - 16, size: 8, font: bold, color: muted });

    // Status badge under the copy tag
    if (statusInfo) {
      const size = 11;
      const textW = bold.widthOfTextAtSize(statusInfo.label, size);
      const boxW = textW + 20;
      const boxH = 22;
      const boxX = right - boxW;
      const boxY = y - 30;
      page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: statusInfo.fill });
      page.drawText(statusInfo.label, { x: boxX + 10, y: boxY + 7, size, font: bold, color: rgb(1, 1, 1) });
    }

    y -= 33;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1.2, color: blue });
    drawControlLine(page, regular, snapshot.control, { right, y: y - 8, size: 5.6 });
    y -= 12;

    const contentW = right - left;
    const headFill = rgb(0.90, 0.95, 0.99);
    // Draw one thead cell label; returns nothing.
    const th = (text: string, x: number, ty: number, alignRight = false, cellW = 0) =>
      page.drawText(text, { x: alignRight ? x + cellW - 5 - bold.widthOfTextAtSize(text, 6) : x + 5, y: ty, size: 6, font: bold, color: blue });

    // ---- Trainee information card (one bordered block) ----
    const infoRowH = 17;
    const infoBoxH = 8 + infoRowH * 3;
    const infoTop = y;
    page.drawRectangle({ x: left, y: infoTop - infoBoxH, width: contentW, height: infoBoxH, borderColor: line, borderWidth: 0.8, color: rgb(1, 1, 1) });
    const iColW = (contentW - 20) / 3;
    const iX = (i: number) => left + 10 + iColW * i;
    const field = (x: number, ly: number, label: string, value: string, maxW: number) => {
      page.drawText(label, { x, y: ly, size: 5.5, font: regular, color: muted });
      page.drawText(fit(value || "-", bold, 8, maxW), { x, y: ly - 9, size: 8, font: bold, color: ink });
    };
    let iy = infoTop - 13;
    field(iX(0), iy, "REFERENCE", snapshot.reference, iColW - 6);
    field(iX(1), iy, "TRAINEE NO.", snapshot.traineeNumber, iColW - 6);
    field(iX(2), iy, "ISSUED", snapshot.issuedAt, iColW - 6);
    iy -= infoRowH;
    field(iX(0), iy, "TRAINEE NAME", snapshot.traineeName, contentW - 20);
    iy -= infoRowH;
    field(iX(0), iy, "SRN", snapshot.srn || "-", iColW - 6);
    field(iX(1), iy, "MOBILE", snapshot.mobile || "-", iColW - 6);
    field(iX(2), iy, "EMAIL", snapshot.email || "-", iColW - 6);
    y = infoTop - infoBoxH - 14;

    // ---- Courses enrolled table ----
    page.drawText("COURSES ENROLLED", { x: left, y, size: 8, font: bold, color: ink });
    y -= 11;
    const courses = snapshot.courses.length ? snapshot.courses : [{ course: "-", schedule: "-", time: "-", venue: "", instructor: "" }];
    // column widths: Course | Schedule | Time | Classroom
    const cw = [contentW - 150 - 92 - 118, 150, 92, 118];
    const cx = [left, left + cw[0], left + cw[0] + cw[1], left + cw[0] + cw[1] + cw[2]];
    const cHeadH = 13;
    const cTop = y;
    page.drawRectangle({ x: left, y: y - cHeadH, width: contentW, height: cHeadH, color: headFill });
    th("COURSE", cx[0], y - 9);
    th("SCHEDULE", cx[1], y - 9);
    th("TIME", cx[2], y - 9);
    th("CLASSROOM", cx[3], y - 9);
    let cy = y - cHeadH;
    courses.forEach((c) => {
      const rowH = c.instructor ? 21 : 15;
      cy -= rowH;
      page.drawText(fit(c.course, bold, 7.5, cw[0] - 10), { x: cx[0] + 5, y: cy + rowH - 10, size: 7.5, font: bold, color: ink });
      if (c.instructor) page.drawText(fit(`Instructor: ${c.instructor}`, regular, 5.5, cw[0] - 10), { x: cx[0] + 5, y: cy + 4, size: 5.5, font: regular, color: muted });
      page.drawText(fit(c.schedule, regular, 7, cw[1] - 8), { x: cx[1] + 5, y: cy + rowH - 10, size: 7, font: regular, color: ink });
      page.drawText(fit(c.time, regular, 7, cw[2] - 8), { x: cx[2] + 5, y: cy + rowH - 10, size: 7, font: regular, color: ink });
      page.drawText(fit(c.venue || "-", regular, 7, cw[3] - 8), { x: cx[3] + 5, y: cy + rowH - 10, size: 7, font: regular, color: ink });
      page.drawLine({ start: { x: left, y: cy }, end: { x: right, y: cy }, thickness: 0.4, color: line });
    });
    page.drawRectangle({ x: left, y: cy, width: contentW, height: cTop - cy, borderColor: line, borderWidth: 0.8 });
    [cx[1], cx[2], cx[3]].forEach((x) => page.drawLine({ start: { x, y: cy }, end: { x, y: cTop }, thickness: 0.4, color: line }));
    y = cy - 14;

    // ---- Charges & payments table (with totals footer) ----
    page.drawText("CHARGES & PAYMENTS", { x: left, y, size: 8, font: bold, color: ink });
    y -= 11;
    const rows = snapshot.lines.length ? snapshot.lines : [{ description: "No ledger entries yet.", detail: "", amountCentavos: 0 }];
    const pw = [contentW - 150 - 100, 150, 100]; // Description | Reference | Amount
    const px = [left, left + pw[0], left + pw[0] + pw[1]];
    const amtRight = right - 6;
    const pHeadH = 13;
    const pTop = y;
    page.drawRectangle({ x: left, y: y - pHeadH, width: contentW, height: pHeadH, color: headFill });
    th("DESCRIPTION", px[0], y - 9);
    th("REFERENCE", px[1], y - 9);
    th("AMOUNT", px[2], y - 9, true, pw[2]);
    let py = y - pHeadH;
    rows.forEach((item) => {
      const rowH = 13;
      py -= rowH;
      page.drawText(fit(item.description, regular, 7, pw[0] - 10), { x: px[0] + 5, y: py + 4, size: 7, font: regular, color: ink });
      if (item.detail) page.drawText(fit(item.detail, regular, 6.5, pw[1] - 8), { x: px[1] + 5, y: py + 4, size: 6.5, font: regular, color: muted });
      if (item.amountCentavos) {
        const amount = `${item.negative ? "-" : ""}${php(item.amountCentavos)}`;
        page.drawText(amount, { x: amtRight - bold.widthOfTextAtSize(amount, 7.5), y: py + 4, size: 7.5, font: bold, color: item.negative ? green : ink });
      }
      page.drawLine({ start: { x: left, y: py }, end: { x: right, y: py }, thickness: 0.4, color: line });
    });
    // Totals footer rows (right-aligned label + amount within the same table)
    const totals = [
      { label: "TOTAL DUE", value: snapshot.dueCentavos, strong: false },
      { label: "TOTAL PAID", value: snapshot.paidCentavos, strong: false },
      { label: "BALANCE", value: snapshot.balanceCentavos, strong: true },
    ];
    totals.forEach((t) => {
      const rowH = 14;
      py -= rowH;
      if (t.strong) page.drawRectangle({ x: px[1], y: py, width: right - px[1], height: rowH, color: t.value > 0 ? rgb(0.99, 0.93, 0.92) : rgb(0.92, 0.97, 0.93) });
      page.drawText(t.label, { x: px[2] - 8 - bold.widthOfTextAtSize(t.label, 7), y: py + 4, size: 7, font: bold, color: muted });
      const amount = php(t.value);
      const color = t.strong ? (t.value > 0 ? rgb(0.78, 0.12, 0.12) : green) : ink;
      page.drawText(amount, { x: amtRight - bold.widthOfTextAtSize(amount, t.strong ? 9 : 8), y: py + 4, size: t.strong ? 9 : 8, font: bold, color });
    });
    page.drawRectangle({ x: left, y: py, width: contentW, height: pTop - py, borderColor: line, borderWidth: 0.8 });
    [px[1], px[2]].forEach((x) => page.drawLine({ start: { x, y: py }, end: { x, y: pTop }, thickness: 0.4, color: line }));
    y = py - 16;

    // Acknowledgment + terms
    const terms = `I, ${snapshot.traineeName}, hereby acknowledge and accept the Terms and Conditions of New Wave Maritime Training and Assessment Center, Inc.`;
    wrap(terms, regular, 6.5, right - left).forEach((ln) => {
      page.drawText(ln, { x: left, y, size: 6.5, font: regular, color: ink });
      y -= 9;
    });
    y -= 16; // room for the signature stroke

    // Three signature columns — trainee (printed name shown), officer, cashier
    const sigs = [
      { label: "Trainee — Signature over Printed Name", name: snapshot.traineeName },
      { label: "Registration Officer — Signature over Printed Name", name: snapshot.officer },
      { label: "Cashier — Signature over Printed Name", name: snapshot.cashier },
    ];
    const sStep = (right - left) / sigs.length;
    sigs.forEach((sig, index) => {
      const x = left + sStep * index;
      page.drawText((sig.name || " ").slice(0, 26), { x, y: y + 4, size: 7, font: bold, color: ink });
      page.drawLine({ start: { x, y }, end: { x: x + sStep - 16, y }, thickness: 0.6, color: line });
      page.drawText(sig.label, { x, y: y - 8, size: 5.5, font: regular, color: muted });
    });

    page.drawText("Present the ORIGINAL copy on the first training day with a valid ID. Amounts reflect the enrollment ledger.", { x: left, y: baseY + 10, size: 5.5, font: regular, color: muted });
  };

  // Dashed cut line between the two copies.
  page.drawLine({ start: { x: 0, y: bandH }, end: { x: width, y: bandH }, thickness: 0.6, color: line, dashArray: [4, 4] });
  drawCopy(bandH, "ORIGINAL COPY"); // upper half — trainee copy
  drawCopy(0, "DUPLICATE COPY"); // lower half — file copy

  return pdf.save();
}

export type ExpenseVoucherLine = { description: string; quantity: number; unitCentavos: number };

export type ExpenseVoucherSnapshot = {
  control?: DocumentControl | null;
  number: string;
  issuedAt: string;
  payee: string;
  category: string;
  purpose: string;
  amountCentavos: number;
  quantity?: number;
  unit?: string;
  requestedBy: string;
  modeOfPayment: string;
  status: string;
  preparedBy: string;
  approvedBy: string;
  logoBytes?: Uint8Array;
  // Request number, lines, channel and signatures (8 Oct 2026).
  requestNumber?: string;
  lines?: ExpenseVoucherLine[];
  paymentChannel?: string;
  referenceNumber?: string;
  supportingDocument?: string;
  preparedAt?: string;
  approvedAt?: string;
  releasedBy?: string;
  releasedAt?: string;
  // Print limit (8 Oct 2026): "Reprint 1" etc. on copies after the first.
  printLabel?: string;
};

const VOUCHER_ROW_PAD = 3.8, VOUCHER_LEADING = 1.18;

/**
 * The largest type, 8 pt down to 6 pt, that holds every voucher line (owner, 4 Nov 2026), so a line is
 * never left off while the total still counts it. `linesAt` says how many lines a description wraps to.
 * The server allows 10 expense lines (expenseCreateInput); ten two-line rows always fit at 6 pt.
 */
export function fitVoucherLines(descriptions: string[], space: number, linesAt: (text: string, size: number) => number) {
  const height = (size: number) => descriptions.reduce((sum, d) => sum + VOUCHER_ROW_PAD + Math.min(2, linesAt(d, size)) * size * VOUCHER_LEADING, 0);
  for (let size = 8; size > 6; size = Math.round((size - 0.2) * 10) / 10) if (height(size) <= space) return size;
  return 6;
}

/**
 * Expense voucher, Design 4 "Receipt Family" (owner's choice, 4 Nov 2026): half of A4 in landscape.
 * Letterhead with a blank Control No. and Revision No. block on the upper right, the navy title bar with
 * the orange rule used on the Training Instructions, a details grid, the expense lines, the amount in
 * words and total, and four signatures: prepared, approved, released and received by.
 */
export async function createExpenseVoucherPdf(snapshot: ExpenseVoucherSnapshot) {
  const pdf = await PDFDocument.create();
  const W = 595.28, H = 419.53;
  const page = pdf.addPage([W, H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const monoBold = await pdf.embedFont(StandardFonts.CourierBold);
  type Font = typeof reg;
  const c = { navy: rgb(.071, .247, .388), lightcyan: rgb(.62, .89, .945), orange: rgb(.949, .337, .082), ink: rgb(.08, .16, .23), muted: rgb(.34, .41, .47), rule: rgb(.73, .78, .83), hair: rgb(.86, .9, .93), tint: rgb(.933, .965, .984), white: rgb(1, 1, 1) };
  const M = 20, X0 = M, X1 = W - M, CW = X1 - X0, PAD = 4, TOP = H - 16;
  const money = (v: number) => (v / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = (s: string, x: number, y: number, size: number, font: Font = reg, color = c.ink) => page.drawText(ascii(s), { x, y, size, font, color });
  const right = (s: string, xr: number, y: number, size: number, font: Font = reg, color = c.ink) => text(s, xr - font.widthOfTextAtSize(ascii(s), size), y, size, font, color);
  const center = (s: string, cx: number, y: number, size: number, font: Font = reg, color = c.ink) => text(s, cx - font.widthOfTextAtSize(ascii(s), size) / 2, y, size, font, color);
  const fit = (s: string, size: number, maxW: number, font: Font = reg) => {
    let t = ascii(s ?? "");
    if (font.widthOfTextAtSize(t, size) <= maxW) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxW) t = t.slice(0, -1);
    return `${t}...`;
  };
  const wrap = (s: string, size: number, maxW: number, font: Font = reg, max = 2) => {
    const out: string[] = []; let line = "";
    for (const w of ascii(s ?? "").split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = w; } else line = test;
    }
    if (line) out.push(line);
    if (out.length > max) { out.length = max; out[max - 1] = fit(`${out[max - 1]} ...`, size, maxW, font); }
    return out.length ? out : [""];
  };
  const box = (x: number, y: number, w: number, h: number, fill?: typeof c.ink) => page.drawRectangle({ x, y, width: w, height: h, borderColor: c.rule, borderWidth: 0.5, ...(fill ? { color: fill } : {}) });
  const cap = (s: string, x: number, y: number) => text(s, x, y, 6, bold, c.muted);

  const lines: ExpenseVoucherLine[] = snapshot.lines?.length
    ? snapshot.lines
    : [{ description: snapshot.purpose, quantity: snapshot.quantity ?? 1, unitCentavos: Math.round(snapshot.amountCentavos / Math.max(1, snapshot.quantity ?? 1)) }];
  let y = TOP;

  // 1. Letterhead, a blank Control No. for writing in (owner, 4 Nov 2026), and the details from Form Numbers (owner, 5 Nov 2026).
  const logoS = 34, textX = X0 + logoS + 8, ctrlW = 140, ctrlLabel = 50;
  if (snapshot.logoBytes) { try { const img = await pdf.embedPng(snapshot.logoBytes); const d = img.scaleToFit(logoS, logoS); page.drawImage(img, { x: X0 + (logoS - d.width) / 2, y: y - logoS + (logoS - d.height) / 2, width: d.width, height: d.height }); } catch { /* logo optional */ } }
  const org = "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", orgRoom = X1 - ctrlW - 8 - textX;
  text(org, textX, y - 12, Math.min(10.6, 10.6 * orgRoom / bold.widthOfTextAtSize(org, 10.6)), bold, c.navy);
  text("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000", textX, y - 22, 6.2, reg, c.muted);
  text("0948-847-6530  |  (02) 8553 0310  |  newwavemaritime@gmail.com", textX, y - 30, 6.2, reg, c.muted);
  const ctrlH = drawControlBlock(page, { reg, bold }, snapshot.control, { right: X1, top: y, width: ctrlW, labelWidth: ctrlLabel, rowHeight: 8, always: true, firstRows: [["Control No.", ""]] });
  y -= Math.max(logoS, ctrlH) + 3;

  // 2. Title bar with the orange rule, as on the Training Instructions.
  const barH = 16, isVoid = snapshot.status === "VOID";
  page.drawRectangle({ x: X0, y: y - barH, width: CW, height: barH, color: c.navy });
  page.drawRectangle({ x: X0, y: y - barH - 2.2, width: CW, height: 2.2, color: c.orange });
  const barText = y - barH + 5;
  text("LIQUIDATION FORM", X0 + 8, barText, 9.5, bold, c.white); // Liquidation Form, Design 1 (owner, 10 Nov 2026)
  const state = `${isVoid && snapshot.printLabel ? `VOID - ${snapshot.printLabel}` : snapshot.status}  |  issued ${snapshot.issuedAt || "-"}`;
  text(state, X0 + 8 + bold.widthOfTextAtSize("LIQUIDATION FORM", 9.5) + 8, barText, 7, reg, c.lightcyan);
  const numberW = monoBold.widthOfTextAtSize(ascii(snapshot.number), 9);
  text(snapshot.number, X1 - 8 - numberW, barText, 9, monoBold, c.white);
  const labelEnd = X1 - 8 - numberW - 4;
  right("CV NO.", labelEnd, barText, 7, reg, c.lightcyan);
  // Reprint and file-copy marks (print limit, 8 Oct 2026).
  if (snapshot.printLabel && !isVoid) {
    const chip = ascii(snapshot.printLabel).toUpperCase(), chipW = bold.widthOfTextAtSize(chip, 6.4) + 8, chipX = labelEnd - reg.widthOfTextAtSize("CV NO.", 7) - 8 - chipW;
    page.drawRectangle({ x: chipX, y: barText - 2.5, width: chipW, height: 10, borderColor: c.white, borderWidth: 0.8 });
    text(chip, chipX + 4, barText, 6.4, bold, c.white);
  }
  y -= barH + 2.2 + 3;

  // 3. Details grid.
  const rowH = 12.5, thW = CW * 0.13, tdW = (CW - 3 * thW) / 3;
  const cell = (label: string, value: string, x: number, top: number, w: number, font: Font = bold) => {
    box(x, top - rowH, thW, rowH, c.tint);
    cap(label, x + PAD, top - 8.4);
    box(x + thW, top - rowH, w, rowH);
    text(fit(value || "-", 7.6, w - 2 * PAD, font), x + thW + PAD, top - 8.8, 7.6, font);
  };
  const col = (i: number) => X0 + i * (thW + tdW);
  cell("Payee", snapshot.payee, col(0), y, tdW * 2 + thW);
  cell("Request No.", snapshot.requestNumber || "-", col(2), y, tdW, monoBold);
  y -= rowH;
  cell("Category", snapshot.category, col(0), y, tdW);
  cell("Mode of Payment", snapshot.paymentChannel || "-", col(1), y, tdW);
  cell("Reference No.", snapshot.referenceNumber || "-", col(2), y, tdW, monoBold);
  y -= rowH;
  cell("Supporting Document", snapshot.supportingDocument || "-", col(0), y, CW - thW);
  y -= rowH + 3;

  // 6 and 5 sizes first, so the lines table takes what is left.
  const footH = 14, sigH = 36, totalH = 25;
  const tableTop = y, tableBottom = footH + sigH + 3 + totalH;
  const cols = [
    { label: "No.", w: CW * 0.06, align: "left" as const },
    { label: "Particulars", w: CW * 0.54, align: "left" as const },
    { label: "Qty", w: CW * 0.08, align: "right" as const },
    { label: "Unit Cost", w: CW * 0.15, align: "right" as const },
    { label: "Amount (PHP)", w: CW * 0.17, align: "right" as const },
  ];
  const colX = cols.map((_, i) => X0 + cols.slice(0, i).reduce((s, k) => s + k.w, 0));
  const headRow = 12, descW = cols[1].w - 2 * PAD;
  page.drawRectangle({ x: X0, y: tableTop - headRow, width: CW, height: headRow, color: c.navy });
  cols.forEach((k, i) => {
    if (k.align === "right") right(k.label, colX[i] + k.w - PAD, tableTop - 8.4, 6, bold, c.white);
    else text(k.label, colX[i] + PAD, tableTop - 8.4, 6, bold, c.white);
  });
  // 4. Every line, in the largest type that holds them all.
  const size = fitVoucherLines(lines.map((l) => l.description), tableTop - headRow - tableBottom, (t, s) => wrap(t, s, descW, reg, 3).length);
  const lead = size * VOUCHER_LEADING;
  let ry = tableTop - headRow;
  lines.forEach((ln, i) => {
    const desc = wrap(ln.description, size, descW, reg, 2);
    const h = VOUCHER_ROW_PAD + desc.length * lead, base = ry - VOUCHER_ROW_PAD / 2 - size * 0.86;
    text(String(i + 1), colX[0] + PAD, base, size, mono);
    desc.forEach((d, k) => text(d, colX[1] + PAD, base - k * lead, size));
    right(String(ln.quantity), colX[2] + cols[2].w - PAD, base, size, mono);
    right(money(ln.unitCentavos), colX[3] + cols[3].w - PAD, base, size, mono);
    right(money(ln.unitCentavos * ln.quantity), colX[4] + cols[4].w - PAD, base, size, monoBold);
    ry -= h;
    page.drawLine({ start: { x: X0, y: ry }, end: { x: X1, y: ry }, thickness: 0.4, color: c.hair });
  });
  colX.slice(1).forEach((x) => page.drawLine({ start: { x, y: tableTop - headRow }, end: { x, y: tableBottom }, thickness: 0.5, color: c.rule }));
  page.drawRectangle({ x: X0, y: tableBottom, width: CW, height: tableTop - tableBottom, borderColor: c.rule, borderWidth: 0.5 });
  y = tableBottom;

  // 5. Amount in words and total.
  const totW = 150;
  box(X0, y - totalH, CW - totW, totalH);
  cap("Amount in Words", X0 + PAD + 1, y - 8.5);
  wrap(pesosInWords(snapshot.amountCentavos), 8, CW - totW - 2 * PAD - 2, bold, 1).forEach((l) => text(l, X0 + PAD + 1, y - 19, 8, bold));
  box(X1 - totW, y - totalH, totW, totalH, c.tint);
  right("Total Amount", X1 - PAD - 1, y - 8.5, 6, bold, c.muted);
  right(`PHP ${money(snapshot.amountCentavos)}`, X1 - PAD - 1, y - 20.5, 11.5, bold, c.navy);
  y -= totalH + 3;

  // 6. Signatures.
  const sigs = [
    { label: "Requested by", name: snapshot.preparedBy, note: snapshot.preparedAt || "Cashier" },
    { label: "Approved by", name: snapshot.approvedBy, note: snapshot.approvedAt || "Accounting" },
    { label: "Liquidated by", name: snapshot.releasedBy ?? "", note: snapshot.releasedAt || "Cashier" },
    { label: "Received by", name: "", note: "Payee Signature Over Printed Name, Date" },
  ];
  const sigGap = 14, sigW = (CW - sigGap * (sigs.length - 1)) / sigs.length;
  sigs.forEach((s, i) => {
    const x = X0 + i * (sigW + sigGap), cx = x + sigW / 2, lineY = y - sigH + 8;
    center(s.label, cx, y - 6, 6, bold, c.muted);
    if (s.name) center(fit(s.name, 8, sigW, bold), cx, lineY + 2.5, 8, bold);
    page.drawLine({ start: { x, y: lineY }, end: { x: x + sigW, y: lineY }, thickness: 0.6, color: c.ink });
    center(fit(s.note, 5.6, sigW), cx, lineY - 6.5, 5.6, reg, c.muted);
  });

  // Footer.
  text("Keep with the official receipt for accounting and audit. Amounts are in Philippine peso.", X0, 6, 5.8, reg, c.muted);
  right(`${snapshot.control?.formNo ? `Form ${snapshot.control.formNo}  |  ` : ""}Ride the New Wave of Maritime Excellence`, X1, 6, 5.8, reg, c.muted);

  if (isVoid) {
    const markW = bold.widthOfTextAtSize("VOID", 72), a = 16 * Math.PI / 180;
    page.drawText("VOID", { x: W / 2 - (markW / 2) * Math.cos(a), y: H / 2 - (markW / 2) * Math.sin(a) - 20, size: 72, font: bold, color: c.orange, opacity: 0.18, rotate: degrees(16) });
  }
  return pdf.save();
}

export type DailyExpensesSnapshot = {
  control?: DocumentControl | null;
  dateLabel: string;
  rows: { number: string; payee: string; category: string; channel: string; reference: string; status: string; amountCentavos: number }[];
  totalCentavos: number;
  paidCentavos: number;
  preparedBy: string;
  logoBytes?: Uint8Array;
  // Date-range summary (7 Oct 2026): a custom title and totals per payment channel.
  title?: string;
  channelTotals?: { channel: string; count: number; totalCentavos: number }[];
};

/** Daily expenses summary: the day's (or period's) expense vouchers with payment channel, reference, status and totals,
 * on the shared Corporate Two-Tone letterhead, legal paper, drawn 1.12 times larger (10 Nov 2026). */
export async function createDailyExpensesPdf(snapshot: DailyExpensesSnapshot) {
  const doc = await PDFDocument.create();
  const brand = await loadBrand(doc, snapshot.logoBytes), { reg: font, bold } = brand;
  const dark = rgb(0.071, 0.247, 0.388), gray = rgb(0.42, 0.45, 0.5), line = rgb(0.85, 0.88, 0.9);
  const title = (snapshot.title ?? "Daily Expenses Summary").toUpperCase(), frame = enlarged(doc, brand, snapshot.control, 1.12), W = frame.W, margin = frame.M;
  const cols = [
    { label: "Voucher", x: margin, w: 74 },
    { label: "Payee", x: margin + 74, w: 104 },
    { label: "Category", x: margin + 178, w: 80 },
    { label: "Channel", x: margin + 258, w: 58 },
    { label: "Reference", x: margin + 316, w: 74 },
    { label: "Status", x: margin + 390, w: 46 },
    { label: "Amount", x: margin + 436, w: W - margin - (margin + 436), align: "right" as const },
  ];
  const fit = (text: string, f: typeof font, size: number, w: number) => {
    let t = text ?? "";
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > w - 4) t = t.slice(0, -1);
    return t.length < (text ?? "").length ? `${t.slice(0, -1)}…` : t;
  };
  let { page, y } = frame.open({ title, right: snapshot.dateLabel });
  const drawHead = () => {
    page.drawRectangle({ x: margin, y: y - 4, width: W - margin * 2, height: 18, color: rgb(0.96, 0.98, 0.99) });
    for (const c of cols) page.drawText(c.label, { x: c.align === "right" ? c.x + c.w - (bold.widthOfTextAtSize(c.label, 8) + 2) : c.x + 2, y, size: 8, font: bold, color: dark });
    y -= 18;
  };
  drawHead();
  for (const r of snapshot.rows) {
    if (y < frame.bottom + 20) { ({ page, y } = frame.open({ title, cont: true })); drawHead(); }
    const cells = [r.number, r.payee, r.category, r.channel || "—", r.reference || "—", r.status, php(r.amountCentavos)];
    cells.forEach((val, i) => {
      const c = cols[i];
      const t = fit(String(val), font, 8.5, c.w);
      page.drawText(t, { x: c.align === "right" ? c.x + c.w - (font.widthOfTextAtSize(t, 8.5) + 2) : c.x + 2, y, size: 8.5, font, color: rgb(0.15, 0.18, 0.22) });
    });
    y -= 15;
    page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: W - margin, y: y + 3 }, thickness: 0.4, color: line });
  }
  if (!snapshot.rows.length) { page.drawText(snapshot.title ? "No expenses in this period." : "No expenses recorded for this day.", { x: margin, y, size: 9, font, color: gray }); y -= 15; }
  y -= 8;
  page.drawText(`Total expenses: ${php(snapshot.totalCentavos)}`, { x: margin, y, size: 10, font: bold, color: dark });
  page.drawText(`Paid: ${php(snapshot.paidCentavos)}`, { x: margin + 220, y, size: 10, font: bold, color: dark });
  page.drawText(`${snapshot.rows.length} voucher(s)`, { x: W - margin - font.widthOfTextAtSize(`${snapshot.rows.length} voucher(s)`, 9), y, size: 9, font, color: gray });
  if (snapshot.channelTotals?.length) {
    y -= 26;
    if (y < frame.bottom + 20 + snapshot.channelTotals.length * 15) ({ page, y } = frame.open({ title, cont: true }));
    page.drawRectangle({ x: margin, y: y - 4, width: W - margin * 2, height: 18, color: rgb(0.96, 0.98, 0.99) });
    page.drawText("Per payment channel", { x: margin + 2, y, size: 8, font: bold, color: dark });
    page.drawText("Vouchers", { x: margin + 300, y, size: 8, font: bold, color: dark });
    page.drawText("Total", { x: W - margin - bold.widthOfTextAtSize("Total", 8) - 2, y, size: 8, font: bold, color: dark });
    y -= 18;
    for (const c of snapshot.channelTotals) {
      page.drawText(fit(c.channel || "Not set", font, 9, 280), { x: margin + 2, y, size: 9, font, color: rgb(0.15, 0.18, 0.22) });
      page.drawText(String(c.count), { x: margin + 300, y, size: 9, font, color: rgb(0.15, 0.18, 0.22) });
      const t = php(c.totalCentavos);
      page.drawText(t, { x: W - margin - font.widthOfTextAtSize(t, 9) - 2, y, size: 9, font: bold, color: dark });
      y -= 15;
      page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: W - margin, y: y + 3 }, thickness: 0.4, color: line });
    }
  }
  if (y - 56 < frame.bottom) ({ page, y } = frame.open({ title, cont: true }));
  y -= 40;
  page.drawText(`Prepared by: ${snapshot.preparedBy || "—"}`, { x: margin, y, size: 9, font, color: rgb(0.15, 0.18, 0.22) });
  page.drawText("Amounts are in Philippine peso. Retain for accounting and audit.", { x: margin, y: y - 14, size: 7.5, font, color: gray });
  frame.close();
  return doc.save();
}

export type PayslipSnapshot = {
  control?: DocumentControl | null;
  employeeNumber: string;
  employeeName: string;
  position: string;
  payFrequency: string;
  dateHired: string;
  period: string;
  payDate: string;
  earnings: { label: string; amountCentavos: number }[];
  deductions: { label: string; amountCentavos: number }[];
  grossCentavos: number;
  totalDeductionsCentavos: number;
  netCentavos: number;
  preparedBy: string;
  logoBytes?: Uint8Array;
};

/** Employee payslip on the shared half-sheet layout. */
export async function createPayslipPdf(snapshot: PayslipSnapshot) {
  return createHalfSheetDocument({
    title: "PAYSLIP",
    logoBytes: snapshot.logoBytes,
    control: snapshot.control,
    meta: [
      { label: "Employee", value: snapshot.employeeNumber },
      { label: "Period", value: snapshot.period },
      { label: "Pay date", value: snapshot.payDate },
    ],
    columns: [
      { label: "Name", value: snapshot.employeeName },
      { label: "Position", value: snapshot.position },
      { label: "Pay frequency", value: snapshot.payFrequency || "-" },
      { label: "Date hired", value: snapshot.dateHired || "-" },
    ],
    lineHeading: "Earnings & deductions",
    lines: [
      ...snapshot.earnings.map((item) => ({ description: item.label, amount: php(item.amountCentavos) })),
      ...snapshot.deductions.map((item) => ({ description: item.label, amount: php(item.amountCentavos), negative: true })),
    ],
    totals: [
      { label: "Gross pay", value: php(snapshot.grossCentavos) },
      { label: "Total deductions", value: php(snapshot.totalDeductionsCentavos) },
      { label: "Net pay", value: php(snapshot.netCentavos) },
      { label: "Prepared by", value: snapshot.preparedBy },
    ],
    footer: "Payslip generated from HR/payroll records. Amounts are in Philippine peso.",
  });
}

export async function createPaymentInvoicePdf(snapshot:PaymentSnapshot,logoBytes?:Uint8Array){
  return createBrandedPdf({logoBytes,title:"Payment Invoice",reference:snapshot.invoiceNumber,issuedAt:new Date(snapshot.receivedAt).toLocaleString("en-PH"),recipient:snapshot.traineeName,sections:[
    {heading:"Billed to",rows:[{label:"Trainee",value:snapshot.traineeName},{label:"Trainee number",value:snapshot.traineeNumber},{label:"Address",value:snapshot.address||"-"},{label:"Enrollment",value:snapshot.enrollmentNumber}]},
    {heading:"Training and payment",rows:[{label:"Course",value:snapshot.course},{label:"Payment",value:snapshot.paymentNumber},{label:"Payment method",value:snapshot.method},{label:"Transaction reference",value:snapshot.referenceNumber||"Manual / none"},{label:"This payment",value:php(snapshot.amountCentavos)},{label:"Total course fee",value:php(snapshot.totalDueCentavos)},{label:"Total paid",value:php(snapshot.totalPaidCentavos)},{label:"Remaining balance",value:php(snapshot.balanceCentavos)}]},
  ],footer:"This invoice was generated automatically from an immutable payment snapshot. An acknowledgment receipt is issued separately."});
}

export type CashierReportRow = { paymentId?: string; rebateCentavos?: number; rebateStatus?: string; receipt: string; time: string; trainee: string; course: string; channel: string; reference: string; amountCentavos: number; proof?: boolean; receivedAt?: string; codes?: string; kind?: string; agency?: string; valid?: boolean; voidReason?: string | null; verificationState?: string | null };

export type CashierReportSnapshot = {
  control?: DocumentControl | null;
  dateLabel: string;
  preparedBy: string;
  checkedBy?: string;
  logoBytes?: Uint8Array;
  position: { previousLabel: string; previousNote?: string; previousCentavos: number; cashCollectedCentavos: number; cashExpensesCentavos: number; bankDepositsCentavos?: number; onHandCentavos: number; countedCentavos: number | null; overShortCentavos: number | null };
  channels: string[];
  matrix: { source: string; cells: { channel: string; count: number; totalCentavos: number }[]; count: number; totalCentavos: number }[];
  groups: { kind: string; name: string; rows: CashierReportRow[]; subtotalCentavos: number }[];
  /** Voided that day, for Accounting's list. In no total, and not on the PDF. */
  voided?: CashierReportRow[];
  expenses: { voucher: string; payee: string; category: string; channel: string; reference: string; status: string; amountCentavos: number }[];
  expenseTotals: { channel: string; totalCentavos: number }[];
  /** Other income received that day (202610190045): endorsement rebates, rental, etc. */
  otherIncome?: { number: string; source: string; payer: string; channel: string; reference: string; amountCentavos: number }[];
};

/**
 * Cashier summary report (owner, 8 Oct 2026): one consolidated A4 page per day
 * (more pages only when the lists are long). Cash position (previous cash +
 * today's cash − cash expenses), collections by source (direct walk-ins,
 * agencies, consultancies) and payment channel, the receipts behind them,
 * the expenses with voucher numbers, and signatures.
 */
export async function createCashierReportPdf(s: CashierReportSnapshot) {
  const pdf = await PDFDocument.create();
  // The shared Corporate Two-Tone letterhead on legal paper, bigger text (owner, 10 Nov 2026).
  const [W] = LEGAL, M = SIDE, CW = W - 2 * M;
  const brand = await loadBrand(pdf, s.logoBytes), { reg, bold } = brand;
  const mono = await pdf.embedFont(StandardFonts.Courier);
  type Font = typeof reg;
  const c = { navy: rgb(.071, .247, .388), orange: rgb(.949, .337, .082), blue: rgb(.02, .443, .816), cyan: rgb(.208, .8, .98), ink: rgb(.08, .16, .23), muted: rgb(.37, .44, .5), rule: rgb(.78, .83, .87), hair: rgb(.88, .91, .94), tint: rgb(.933, .965, .984), green: rgb(.04, .48, .24), red: rgb(.7, .14, .1), white: rgb(1, 1, 1) };
  const money = (v: number) => `${v < 0 ? "-" : ""}${(Math.abs(v) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  let page = newPage(pdf, brand);
  let y = 0;
  const text = (t: string, x: number, yy: number, size: number, font: Font = reg, color = c.ink) => page.drawText(ascii(t), { x, y: yy, size, font, color });
  const right = (t: string, xr: number, yy: number, size: number, font: Font = reg, color = c.ink) => text(t, xr - font.widthOfTextAtSize(ascii(t), size), yy, size, font, color);
  const fit = (t: string, size: number, maxW: number, font: Font = reg) => {
    let v = ascii(t ?? "");
    if (font.widthOfTextAtSize(v, size) <= maxW) return v;
    while (v.length > 1 && font.widthOfTextAtSize(`${v}...`, size) > maxW) v = v.slice(0, -1);
    return `${v}...`;
  };
  const ensure = (need: number, again?: () => void) => {
    if (y - need >= FOOT + 20) return;
    page = newPage(pdf, brand);
    y = drawLetterhead(page, brand, s.control, { title: `CASHIER SUMMARY REPORT - ${s.dateLabel}`, cont: true });
    again?.();
  };
  const section = (title: string, aside?: string) => {
    ensure(40);
    y -= 10;
    text(title.toUpperCase(), M, y - 11, 10.5, bold, c.navy);
    if (aside) right(aside, W - M, y - 11, 9.5, reg, c.muted);
    y -= 17;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: c.navy });
    y -= 2;
  };
  type Col = { label: string; w: number; align?: "right"; font?: Font };
  const tableHead = (cols: Col[]) => {
    page.drawRectangle({ x: M, y: y - 17, width: CW, height: 17, color: c.tint });
    let x = M;
    for (const col of cols) {
      const w = CW * col.w;
      if (col.align === "right") right(col.label.toUpperCase(), x + w - 5, y - 11.5, 7.6, bold, c.navy); else text(col.label.toUpperCase(), x + 5, y - 11.5, 7.6, bold, c.navy);
      x += w;
    }
    y -= 17;
  };
  const tableRow = (cols: Col[], cells: string[], opts: { bold?: boolean; fill?: boolean } = {}) => {
    const h = 16.5;
    if (opts.fill) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: c.tint });
    let x = M;
    cols.forEach((col, i) => {
      const w = CW * col.w, font = opts.bold ? bold : col.font ?? reg, v = fit(cells[i] ?? "", 9.4, w - 10, font);
      if (col.align === "right") right(v, x + w - 5, y - 11.6, 9.4, font); else text(v, x + 5, y - 11.6, 9.4, font);
      x += w;
    });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: c.hair });
  };

  y = drawLetterhead(page, brand, s.control, { title: "CASHIER SUMMARY REPORT", right: s.dateLabel }) + 6;

  // 1. Cash position.
  section("1. Cash position", "Cash only");
  const p = s.position;
  const boxes: [string, string, typeof c.ink, string?][] = [
    [p.previousLabel, money(p.previousCentavos), c.ink, p.previousNote],
    ["+ Cash collected", money(p.cashCollectedCentavos), c.green],
    ["- Cash expenses", money(p.cashExpensesCentavos), c.red],
    ...(p.bankDepositsCentavos ? [["- Bank deposits", money(p.bankDepositsCentavos), c.navy] as [string, string, typeof c.ink]] : []),
    ["= Cash on hand", money(p.onHandCentavos), c.navy],
    ["Counted at closing", p.countedCentavos == null ? "Not yet" : money(p.countedCentavos), c.ink],
    ["Over / short", p.overShortCentavos == null ? "-" : `${p.overShortCentavos > 0 ? "+" : ""}${money(p.overShortCentavos)}`, p.overShortCentavos ? (p.overShortCentavos < 0 ? c.red : c.green) : c.ink],
  ];
  const bw = CW / boxes.length, bh = 52;
  boxes.forEach(([label, value, color, note], i) => {
    const x = M + i * bw;
    page.drawRectangle({ x, y: y - bh, width: bw, height: bh, borderColor: c.rule, borderWidth: 0.5, ...(i === 3 ? { color: c.tint } : {}) });
    text(fit(label.toUpperCase(), 7, bw - 10, bold), x + 6, y - 13, 7, bold, c.muted);
    text(fit(value, i === 3 ? 13 : 12, bw - 12, bold), x + 6, y - 32, i === 3 ? 13 : 12, bold, color);
    if (note) text(fit(note, 7.5, bw - 12), x + 6, y - 45, 7.5, reg, c.muted);
  });
  y -= bh + 4;

  // 2. Collections summary matrix.
  const grand = s.matrix.reduce((t, r) => t + r.totalCentavos, 0), grandCount = s.matrix.reduce((t, r) => t + r.count, 0);
  section("2. Collections summary", `${grandCount} receipt${grandCount === 1 ? "" : "s"}  |  PHP ${money(grand)}`);
  const srcW = 0.22, chW = (1 - srcW - 0.16) / Math.max(1, s.channels.length);
  const mCols: Col[] = [{ label: "Source", w: srcW }, ...s.channels.map((ch): Col => ({ label: ch, w: chW, align: "right" })), { label: "Total", w: 0.16, align: "right" }];
  tableHead(mCols);
  const cell = (n: number, t: number) => (n ? `${money(t)} (${n})` : "-");
  for (const r of s.matrix) tableRow(mCols, [r.source, ...s.channels.map((ch) => { const k = r.cells.find((x) => x.channel === ch); return cell(k?.count ?? 0, k?.totalCentavos ?? 0); }), cell(r.count, r.totalCentavos)]);
  tableRow(mCols, ["Total", ...s.channels.map((ch) => { const n = s.matrix.reduce((t, r) => t + (r.cells.find((x) => x.channel === ch)?.count ?? 0), 0), v = s.matrix.reduce((t, r) => t + (r.cells.find((x) => x.channel === ch)?.totalCentavos ?? 0), 0); return cell(n, v); }), cell(grandCount, grand)], { bold: true, fill: true });
  text("Amounts in pesos; receipts in brackets.", M, y - 11, 8, reg, c.muted);
  y -= 15;

  // 3. Collections detail.
  section("3. Collections detail");
  const dCols: Col[] = [{ label: "Receipt", w: 0.165, font: mono }, { label: "Time", w: 0.08 }, { label: "Trainee", w: 0.195 }, { label: "Course", w: 0.2 }, { label: "Channel", w: 0.1 }, { label: "Reference", w: 0.12, font: mono }, { label: "Amount", w: 0.14, align: "right" }];
  if (!s.groups.length) { text("No collections on this day.", M, y - 12, 10, reg, c.muted); y -= 19; }
  for (const g of s.groups) {
    ensure(56);
    page.drawRectangle({ x: M, y: y - 18, width: CW, height: 18, color: rgb(.96, .97, .98) });
    text(`${g.kind}${g.name && g.name !== g.kind ? `  |  ${g.name}` : ""}`, M + 5, y - 12.5, 10, bold, c.navy);
    right(`${g.rows.length} receipt${g.rows.length === 1 ? "" : "s"}  |  PHP ${money(g.subtotalCentavos)}`, W - M - 5, y - 12.5, 9.5, bold, c.navy);
    y -= 18;
    tableHead(dCols);
    for (const r of g.rows) { ensure(17, () => tableHead(dCols)); tableRow(dCols, [r.receipt, r.time, r.trainee, r.course, r.channel, r.reference || "-", money(r.amountCentavos)]); }
    y -= 6;
  }

  // Other income (19 Oct 2026), apart from trainee fees.
  const inc = s.otherIncome ?? [];
  if (inc.length) {
    const incTotal = inc.reduce((t, i) => t + i.amountCentavos, 0);
    section("Other Income", `${inc.length} receipt${inc.length === 1 ? "" : "s"}  |  PHP ${money(incTotal)}`);
    const iCols: Col[] = [{ label: "Income no.", w: 0.15, font: mono }, { label: "Source", w: 0.17 }, { label: "Received from", w: 0.3 }, { label: "Channel", w: 0.1 }, { label: "Reference", w: 0.13, font: mono }, { label: "Amount", w: 0.15, align: "right", font: mono }];
    tableHead(iCols);
    for (const i of inc) { ensure(17, () => tableHead(iCols)); tableRow(iCols, [i.number, i.source, i.payer, i.channel, i.reference || "-", money(i.amountCentavos)]); }
    tableRow(iCols, ["Total", "", "", "", "", money(incTotal)], { bold: true, fill: true });
    y -= 6;
  }

  // 4. Expenses.
  const expTotal = s.expenses.reduce((t, e) => t + e.amountCentavos, 0);
  section("4. Expenses", `${s.expenses.length} voucher${s.expenses.length === 1 ? "" : "s"}  |  PHP ${money(expTotal)}`);
  const eCols: Col[] = [{ label: "Voucher no.", w: 0.15, font: mono }, { label: "Payee", w: 0.22 }, { label: "Category", w: 0.15 }, { label: "Channel", w: 0.1 }, { label: "Reference", w: 0.13, font: mono }, { label: "Status", w: 0.1 }, { label: "Amount", w: 0.15, align: "right" }];
  if (!s.expenses.length) { text("No expenses on this day.", M, y - 12, 10, reg, c.muted); y -= 19; }
  else {
    tableHead(eCols);
    for (const e of s.expenses) { ensure(17, () => tableHead(eCols)); tableRow(eCols, [e.voucher, e.payee, e.category, e.channel || "-", e.reference || "-", e.status, money(e.amountCentavos)]); }
    for (const t of s.expenseTotals) tableRow(eCols, ["", "", "", t.channel, "", "Subtotal", money(t.totalCentavos)]);
    tableRow(eCols, ["Total", "", "", "", "", "", money(expTotal)], { bold: true, fill: true });
  }

  // 5. Signatures.
  ensure(90);
  y -= 46;
  const sw = (CW - 40) / 2;
  [["Prepared by", s.preparedBy, "Cashier"], ["Checked by", s.checkedBy ?? "", "Accounting"]].forEach(([label, name, role], i) => {
    const x = M + i * (sw + 40);
    if (name) text(name, x, y + 5, 11, bold);
    page.drawLine({ start: { x, y }, end: { x: x + sw, y }, thickness: 0.6, color: c.ink });
    text(`${label}  |  ${role}  |  signature over printed name, date`, x, y - 13, 8.5, reg, c.muted);
  });
  finishPages(pdf, brand, s.control);
  return pdf.save();
}
