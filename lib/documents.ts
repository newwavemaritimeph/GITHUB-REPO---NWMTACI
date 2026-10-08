import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pesosInWords } from "@/lib/amount-words";

export type DocumentSnapshot = {
  title: string;
  reference: string;
  issuedAt: string;
  recipient?: string;
  sections: { heading: string; rows: { label: string; value: string }[] }[];
  footer?: string;
};

export async function createBrandedPdf(snapshot: DocumentSnapshot) {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colors = { ink: rgb(.07,.25,.39), blue: rgb(.02,.44,.82), orange: rgb(.95,.34,.08), muted: rgb(.38,.47,.54), line: rgb(.84,.9,.93) };
  let y = 785;
  const addPage = () => { page = pdf.addPage([595.28,841.89]); y = 790; };
  page.drawRectangle({ x: 0, y: 813, width: 595.28, height: 29, color: colors.blue });
  page.drawRectangle({ x: 0, y: 806, width: 595.28, height: 7, color: colors.orange });
  page.drawText("NEW WAVE MARITIME", { x: 44, y, size: 15, font: bold, color: colors.blue });
  page.drawText("Training and Assessment Center, Inc.", { x: 44, y: y - 16, size: 8, font: regular, color: colors.muted });
  y -= 62;
  page.drawText(snapshot.title, { x: 44, y, size: 24, font: bold, color: colors.ink });
  y -= 27;
  page.drawText(`Reference: ${snapshot.reference}`, { x: 44, y, size: 9, font: regular, color: colors.muted });
  page.drawText(`Issued: ${snapshot.issuedAt}`, { x: 360, y, size: 9, font: regular, color: colors.muted });
  y -= 30;
  for (const section of snapshot.sections) {
    if (y < 120) addPage();
    page.drawRectangle({ x: 44, y: y - 5, width: 507, height: 25, color: rgb(.94,.98,.99) });
    page.drawText(section.heading, { x: 54, y: y + 3, size: 10, font: bold, color: colors.blue });
    y -= 25;
    for (const row of section.rows) {
      if (y < 75) addPage();
      page.drawText(row.label, { x: 54, y, size: 9, font: regular, color: colors.muted });
      page.drawText(row.value.slice(0, 70), { x: 210, y, size: 9, font: bold, color: colors.ink });
      page.drawLine({ start: { x: 54, y: y - 7 }, end: { x: 541, y: y - 7 }, thickness: .5, color: colors.line });
      y -= 23;
    }
    y -= 12;
  }
  page.drawText(snapshot.footer ?? "Generated from a versioned New Wave record snapshot.", { x: 44, y: 36, size: 7, font: regular, color: colors.muted });
  return pdf.save();
}

export type TrainingInstructionsSnapshot = {
  traineeName: string;
  courseName: string;
  dateOfTraining: string;
  time: string;
  classroom: string;
  googleClassroomLink?: string | null;
  subject?: string;
  body?: string;
  reference?: string;
  issuedAt: string;
  logoBytes?: Uint8Array;
  // Grid form (Design 3) fields.
  classCode?: string | null;
  formalName?: string;
  nwmtaciNumber?: string;
  srn?: string;
  batchNumber?: string;
  mode?: string;
  duration?: string;
};

// Strip characters Helvetica's WinAnsi encoding can't render (en/em dash, smart quotes,
// bullets, ellipsis) so live DB text can never crash PDF generation.
const ascii = (s: string) => (s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[•]/g, "-").replace(/…/g, "...").replace(/[^\x00-\xFF]/g, "");

// The owner's default reporting letter. Registration can override the body per course;
// dynamic details (name/date/time/classroom + Google Classroom) are merged separately.
export const DEFAULT_INSTRUCTIONS_BODY = [
  "Welcome aboard! Your enrollment has been confirmed. Please review your reporting details below and observe the reminders.",
  "",
  "IMPORTANT REMINDERS:",
  "- Check the printed name in your admission record and report any corrections immediately.",
  "- Arrive on time, observe proper conduct, and complete all requirements before training starts.",
  "- Bring your own tumbler - drinking water is available in the Training Room.",
  "- Wear the official training uniform during the training period (Php 150.00 uniform fee applies).",
  "",
  "New Wave MTACI sincerely appreciates your trust in choosing us as your training provider.",
  "",
  "Thank you!",
].join("\n");

// Reminders shown when the course template has no "- " lines of its own.
const DEFAULT_REMINDERS = [
  "Bring one valid ID and your Seaman's Book / SRN for verification.",
  "Check your printed name; report corrections before 8:00 AM.",
  "Wear the official training uniform (Php 150.00 if not yet issued).",
  "Bring your own tumbler. Phones on silent during sessions.",
  "Arrivals more than 30 minutes late are rescheduled.",
];
const INSTRUCTION_POLICIES: [string, string, string][] = [
  ["P", "Payment", "Full payment for 1-day courses; 50% down payment otherwise."],
  ["R", "Reschedule", "3+ days before: Php 300.00. 1-2 days before: 50% of the fee + Php 250.00."],
  ["F", "Cancellation", "5+ days before: Php 300.00. Under 5 days: 50% of the fee + Php 250.00."],
  ["M", "Make-up", "3-day and longer courses; Php 350.00 per training day."],
  ["C", "Certificate", "Released after all requirements and balances are complete."],
];

/**
 * Training instructions, Design 3 "grid form" (owner's choice, 7 Oct 2026):
 * half of A4 in landscape (210 x 148 mm). Navy letterhead band, brand stripe,
 * then one bordered grid in two halves — A. Trainee, B. Training,
 * C. Google Classroom and the trainee's signature on the left; D. Reminders,
 * E. Policies and the registration officer's signature on the right. Rows
 * stretch to fill the sheet so there is no blank space.
 */
export async function createTrainingInstructionsPdf(snapshot: TrainingInstructionsSnapshot) {
  const pdf = await PDFDocument.create();
  const W = 595.28, H = 419.53;
  const page = pdf.addPage([W, H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.CourierBold);
  const c = { orange: rgb(.949, .337, .082), blue: rgb(.02, .443, .816), cyan: rgb(.208, .8, .98), lightcyan: rgb(.62, .89, .945), navy: rgb(.071, .247, .388), ink: rgb(.06, .15, .22), muted: rgb(.31, .40, .47), rule: rgb(.79, .84, .88), soft: rgb(.93, .96, .97), tint: rgb(.957, .976, .992), white: rgb(1, 1, 1) };
  type Font = typeof reg;
  const M = 14, FOOT = 22;
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (snapshot.logoBytes) { try { logo = await pdf.embedPng(snapshot.logoBytes); } catch { logo = null; } }
  const text = (s: string, x: number, y: number, size: number, font: Font = reg, color = c.ink) => page.drawText(ascii(s), { x, y, size, font, color });
  const lines = (s: string, size: number, maxW: number, font: Font = reg) => {
    const out: string[] = []; let line = "";
    // A single word wider than the cell (a link) is broken by characters.
    const words = ascii(s).split(/\s+/).filter(Boolean).flatMap((w) => {
      if (font.widthOfTextAtSize(w, size) <= maxW) return [w];
      const parts: string[] = []; let cur = "";
      for (const ch of w) { if (font.widthOfTextAtSize(cur + ch, size) > maxW && cur) { parts.push(cur); cur = ch; } else cur += ch; }
      if (cur) parts.push(cur);
      return parts;
    });
    for (const w of words) { const test = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = w; } else line = test; }
    if (line) out.push(line);
    return out.length ? out : [""];
  };

  // Letterhead band.
  const bandH = 40, bandY = H - M - bandH;
  page.drawRectangle({ x: M, y: bandY, width: W - 2 * M, height: bandH, color: c.navy });
  if (logo) { page.drawCircle({ x: M + 8 + 15, y: bandY + bandH / 2, size: 15.5, color: c.white }); const d = logo.scale(26 / Math.max(logo.width, logo.height)); page.drawImage(logo, { x: M + 23 - d.width / 2, y: bandY + bandH / 2 - d.height / 2, width: d.width, height: d.height }); }
  text("New Wave Maritime Training and Assessment Center, Inc.", M + 46, bandY + 23, 10, bold, c.white);
  text("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000  |  0948-847-6530  |  (02) 8553 0310", M + 46, bandY + 12, 6.2, reg, c.lightcyan);
  const docTitle = "TRAINING INSTRUCTIONS", ref = `${snapshot.reference ?? ""}${snapshot.reference ? "  |  " : ""}${snapshot.issuedAt}`;
  text(docTitle, W - M - 10 - bold.widthOfTextAtSize(docTitle, 12), bandY + 22, 12, bold, c.white);
  text(ref, W - M - 10 - reg.widthOfTextAtSize(ascii(ref), 6.6), bandY + 11, 6.6, reg, c.lightcyan);
  // Brand stripe.
  const stripeY = bandY - 4, third = (W - 2 * M) / 3;
  page.drawRectangle({ x: M, y: stripeY, width: third, height: 4, color: c.orange });
  page.drawRectangle({ x: M + third, y: stripeY, width: third, height: 4, color: c.cyan });
  page.drawRectangle({ x: M + 2 * third, y: stripeY, width: W - 2 * M - 2 * third, height: 4, color: c.blue });

  // Grid rows.
  type Cell = { label?: string; value: string; w: number; font?: Font; size?: number; color?: typeof c.ink; code?: boolean; tint?: boolean };
  type Row = { kind: "head"; title: string; aside?: string } | { kind: "cells"; cells: Cell[] } | { kind: "item"; mark: string; label?: string; value: string } | { kind: "sign"; cells: { value: string; w: number }[] };
  const reminders = (snapshot.body ?? "").split("\n").map((l) => l.trim()).filter((l) => /^[-•]\s/.test(l)).map((l) => l.replace(/^[-•]\s*/, ""));
  const leftRows: Row[] = [
    { kind: "head", title: "A. Trainee" },
    { kind: "cells", cells: [{ label: "Name", value: snapshot.formalName ?? snapshot.traineeName.toUpperCase(), w: 1, font: bold, size: 9 }] },
    { kind: "cells", cells: [{ label: "NWMTACI no.", value: snapshot.nwmtaciNumber || "-", w: 1 / 3, font: mono }, { label: "SRN", value: snapshot.srn || "-", w: 1 / 3, font: mono }, { label: "Enrollment", value: snapshot.reference || "-", w: 1 / 3, font: mono }] },
    { kind: "head", title: "B. Training", aside: "Report by 7:00 AM" },
    { kind: "cells", cells: [{ label: "Course", value: snapshot.courseName, w: 1, font: bold, size: 8.8 }] },
    { kind: "cells", cells: [{ label: "Date", value: snapshot.dateOfTraining, w: 1 / 3, font: bold }, { label: "Time", value: snapshot.time, w: 1 / 3, font: bold }, { label: "Duration", value: snapshot.duration || "-", w: 1 / 3, font: bold }] },
    { kind: "cells", cells: [{ label: "Classroom", value: snapshot.classroom, w: 1 / 3, font: bold }, { label: "Batch", value: snapshot.batchNumber || "-", w: 1 / 3, font: mono }, { label: "Mode", value: snapshot.mode || "Face-to-face", w: 1 / 3, font: bold }] },
    { kind: "head", title: "C. Google Classroom" },
    { kind: "cells", cells: [{ label: "Join link", value: snapshot.googleClassroomLink || "Ask the registration office for the link", w: 2 / 3, font: reg, size: 7.4, color: c.blue, tint: true }, { label: "Class code", value: snapshot.classCode || "-", w: 1 / 3, font: mono, size: 11, color: c.navy, code: true, tint: true }] },
    { kind: "sign", cells: [{ value: "Trainee signature over printed name", w: 2 / 3 }, { value: "Date", w: 1 / 3 }] },
  ];
  const rightRows: Row[] = [
    { kind: "head", title: "D. Reminders" },
    ...(reminders.length ? reminders : DEFAULT_REMINDERS).slice(0, 7).map((r, i): Row => ({ kind: "item", mark: String(i + 1), value: r })),
    { kind: "head", title: "E. Policies" },
    ...INSTRUCTION_POLICIES.map(([mark, label, value]): Row => ({ kind: "item", mark, label, value })),
    { kind: "sign", cells: [{ value: "Registration officer", w: 1 }] },
  ];

  const top = stripeY, bottom = FOOT + 4, avail = top - bottom, gap = 0;
  const colW = (W - 2 * M - gap) / 2, PAD = 4.5;
  const HEAD = 13;
  const markW = 18, labelW = 54;
  const natural = (r: Row): number => {
    if (r.kind === "head") return HEAD;
    if (r.kind === "sign") return 30;
    if (r.kind === "item") { const w = colW - markW - (r.label ? labelW : 0) - 2 * PAD; return 7 + lines(r.value, 8, w).length * 10.4; }
    return 9 + Math.max(...r.cells.map((cl) => lines(cl.value, cl.size ?? 8.4, colW * cl.w - 2 * PAD, cl.font ?? reg).length * ((cl.size ?? 8.4) * 1.25))) + 6;
  };
  const drawColumn = (rows: Row[], x0: number) => {
    const heights = rows.map(natural);
    const stretchable = rows.map((r) => r.kind !== "head");
    const extra = Math.max(0, avail - heights.reduce((s, v) => s + v, 0));
    const share = extra / Math.max(1, stretchable.filter(Boolean).length);
    let y = top;
    rows.forEach((r, i) => {
      const h = heights[i] + (stretchable[i] ? share : 0);
      const yb = y - h;
      if (r.kind === "head") {
        page.drawRectangle({ x: x0, y: yb, width: colW, height: h, color: c.soft });
        page.drawLine({ start: { x: x0, y }, end: { x: x0 + colW, y }, thickness: 0.9, color: c.navy });
        text(r.title.toUpperCase(), x0 + PAD, yb + 4, 6.8, bold, c.navy);
        if (r.aside) text(r.aside, x0 + colW - PAD - bold.widthOfTextAtSize(r.aside, 6.6), yb + 4, 6.6, bold, c.orange);
      } else if (r.kind === "cells") {
        let cx = x0;
        for (const cl of r.cells) {
          const cw = colW * cl.w;
          if (cl.tint) page.drawRectangle({ x: cx, y: yb, width: cw, height: h, color: c.tint });
          page.drawRectangle({ x: cx, y: yb, width: cw, height: h, borderColor: c.rule, borderWidth: 0.5 });
          if (cl.label) text(cl.label.toUpperCase(), cx + PAD, y - 8, 5.6, bold, c.muted);
          const size = cl.size ?? 8.4;
          lines(cl.value, size, cw - 2 * PAD, cl.font ?? reg).forEach((ln, k) => text(ln, cx + PAD, y - 10 - size - k * size * 1.25, size, cl.font ?? reg, cl.color ?? c.ink));
          cx += cw;
        }
      } else if (r.kind === "item") {
        page.drawRectangle({ x: x0, y: yb, width: colW, height: h, borderColor: c.rule, borderWidth: 0.5 });
        page.drawLine({ start: { x: x0 + markW, y }, end: { x: x0 + markW, y: yb }, thickness: 0.5, color: c.rule });
        const mid = yb + h / 2;
        text(r.mark, x0 + markW / 2 - mono.widthOfTextAtSize(r.mark, 8.4) / 2, mid - 3, 8.4, mono, c.orange);
        let tx = x0 + markW + PAD;
        if (r.label) { page.drawLine({ start: { x: x0 + markW + labelW, y }, end: { x: x0 + markW + labelW, y: yb }, thickness: 0.5, color: c.rule }); text(r.label, tx, mid - 3, 8, bold, c.navy); tx = x0 + markW + labelW + PAD; }
        const ls = lines(r.value, 8, x0 + colW - PAD - tx);
        const startY = mid + ((ls.length - 1) * 10.4) / 2 - 3;
        ls.forEach((ln, k) => text(ln, tx, startY - k * 10.4, 8));
      } else {
        let cx = x0;
        for (const cl of r.cells) {
          const cw = colW * cl.w;
          page.drawRectangle({ x: cx, y: yb, width: cw, height: h, borderColor: c.rule, borderWidth: 0.5 });
          page.drawLine({ start: { x: cx + 10, y: yb + 13 }, end: { x: cx + cw - 10, y: yb + 13 }, thickness: 0.6, color: c.ink });
          text(cl.value, cx + cw / 2 - reg.widthOfTextAtSize(ascii(cl.value), 6.2) / 2, yb + 5, 6.2, reg, c.muted);
          cx += cw;
        }
      }
      y = yb;
    });
  };
  drawColumn(leftRows, M);
  drawColumn(rightRows, M + colW + gap);
  // Outer frame and the centre divider.
  page.drawRectangle({ x: M, y: bottom, width: W - 2 * M, height: avail, borderColor: c.navy, borderWidth: 0.9 });
  page.drawLine({ start: { x: M + colW, y: top }, end: { x: M + colW, y: bottom }, thickness: 0.9, color: c.navy });
  // Footer.
  text("Ride the New Wave of Maritime Excellence", M, FOOT - 8, 6.2, reg, c.muted);
  const foot = "Form TI-03  |  newwavemaritime@gmail.com";
  text(foot, W - M - reg.widthOfTextAtSize(foot, 6.2), FOOT - 8, 6.2, reg, c.muted);
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
  // Design 2 "grid form" (owner's choice, 8 Oct 2026).
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

/**
 * Expense voucher, Design 2 "grid form" (owner's choice, 8 Oct 2026): half of
 * A4 in landscape, one bordered grid like the training instruction form.
 * Letterhead with the voucher number, a row of voucher details, payee and
 * supporting document, a numbered table of expense lines (blank rows fill the
 * sheet), the total with the amount in words, and four signatures:
 * prepared, approved, released and received by.
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
  const c = { navy: rgb(.071, .247, .388), cyan: rgb(.208, .8, .98), ink: rgb(.08, .16, .23), muted: rgb(.37, .44, .5), rule: rgb(.73, .78, .83), hair: rgb(.86, .9, .93), tint: rgb(.933, .965, .984), white: rgb(1, 1, 1) };
  const M = 20, FOOT = 18, X0 = M, X1 = W - M, CW = X1 - X0, PAD = 5;
  const money = (v: number) => (v / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = (s: string, x: number, y: number, size: number, font: Font = reg, color = c.ink) => page.drawText(ascii(s), { x, y, size, font, color });
  const right = (s: string, xr: number, y: number, size: number, font: Font = reg, color = c.ink) => text(s, xr - font.widthOfTextAtSize(ascii(s), size), y, size, font, color);
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
  const cap = (s: string, x: number, y: number, color = c.muted) => text(s.toUpperCase(), x, y, 5.6, bold, color);

  const lines: ExpenseVoucherLine[] = snapshot.lines?.length
    ? snapshot.lines
    : [{ description: snapshot.purpose, quantity: snapshot.quantity ?? 1, unitCentavos: Math.round(snapshot.amountCentavos / Math.max(1, snapshot.quantity ?? 1)) }];
  const top = H - M, bottom = FOOT + 8;
  let y = top;

  // 1. Letterhead: logo · organisation · voucher number on navy.
  const headH = 46, logoW = 50, titleW = 160;
  box(X0, y - headH, logoW, headH);
  if (snapshot.logoBytes) { try { const img = await pdf.embedPng(snapshot.logoBytes); const d = img.scaleToFit(36, 36); page.drawImage(img, { x: X0 + (logoW - d.width) / 2, y: y - headH + (headH - d.height) / 2, width: d.width, height: d.height }); } catch { /* logo optional */ } }
  box(X0 + logoW, y - headH, CW - logoW - titleW, headH);
  text("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", X0 + logoW + PAD + 2, y - 19, 9.6, bold, c.navy);
  text("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000", X0 + logoW + PAD + 2, y - 30, 6.4, reg, c.muted);
  text("0948-847-6530  |  (02) 8553 0310  |  newwavemaritime@gmail.com", X0 + logoW + PAD + 2, y - 39, 6.4, reg, c.muted);
  page.drawRectangle({ x: X1 - titleW, y: y - headH, width: titleW, height: headH, color: c.navy });
  text("EXPENSE VOUCHER", X1 - titleW + PAD + 3, y - 14, 6.6, bold, c.cyan);
  text(snapshot.number, X1 - titleW + PAD + 3, y - 30, 12.5, monoBold, c.white);
  text(snapshot.printLabel ? `${snapshot.status}  |  ${snapshot.printLabel}` : snapshot.status, X1 - titleW + PAD + 3, y - 41, 6.6, bold, c.white);
  y -= headH;
  page.drawLine({ start: { x: X0, y }, end: { x: X1, y }, thickness: 1.2, color: c.navy });

  // 2. Voucher details.
  const infoH = 27;
  const info: [string, string, Font][] = [
    ["Date issued", snapshot.issuedAt || "-", bold],
    ["Request no.", snapshot.requestNumber || "-", monoBold],
    ["Category", snapshot.category || "-", bold],
    ["Mode of payment", snapshot.paymentChannel || "-", bold],
    ["Reference no.", snapshot.referenceNumber || "-", monoBold],
  ];
  info.forEach(([label, value, font], i) => {
    const w = CW / info.length, x = X0 + i * w;
    box(x, y - infoH, w, infoH);
    cap(label, x + PAD, y - 9);
    text(fit(value, 8.6, w - 2 * PAD, font), x + PAD, y - 21, 8.6, font);
  });
  y -= infoH;

  // 3. Payee and supporting document.
  const payH = 27, payW = CW * 0.58;
  box(X0, y - payH, payW, payH); cap("Payee", X0 + PAD, y - 9); text(fit(snapshot.payee, 9, payW - 2 * PAD, bold), X0 + PAD, y - 21, 9, bold);
  box(X0 + payW, y - payH, CW - payW, payH); cap("Supporting document", X0 + payW + PAD, y - 9); text(fit(snapshot.supportingDocument || "-", 8.6, CW - payW - 2 * PAD, bold), X0 + payW + PAD, y - 21, 8.6, bold);
  y -= payH;

  // 5 and 6 sizes first, so the lines table takes what is left.
  const totalH = 34, sigH = 52;
  const tableTop = y, tableBottom = bottom + sigH + totalH;
  const cols = [
    { label: "No.", w: CW * 0.07, align: "left" as const },
    { label: "Particulars", w: CW * 0.45, align: "left" as const },
    { label: "Qty", w: CW * 0.10, align: "right" as const },
    { label: "Unit cost", w: CW * 0.17, align: "right" as const },
    { label: "Amount (PHP)", w: CW * 0.21, align: "right" as const },
  ];
  const colX = cols.map((_, i) => X0 + cols.slice(0, i).reduce((s, k) => s + k.w, 0));
  const headRow = 14, rowH = 14.5;
  page.drawRectangle({ x: X0, y: tableTop - headRow, width: CW, height: headRow, color: c.tint });
  cols.forEach((k, i) => {
    if (k.align === "right") right(k.label.toUpperCase(), colX[i] + k.w - PAD, tableTop - 9.5, 5.8, bold, c.navy);
    else text(k.label.toUpperCase(), colX[i] + PAD, tableTop - 9.5, 5.8, bold, c.navy);
  });
  let ry = tableTop - headRow;
  page.drawLine({ start: { x: X0, y: ry }, end: { x: X1, y: ry }, thickness: 0.5, color: c.rule });
  lines.forEach((ln, i) => {
    const desc = wrap(ln.description, 8, cols[1].w - 2 * PAD, reg, 2);
    const h = Math.max(rowH, 5 + desc.length * 9.6);
    if (ry - h < tableBottom + 2) return; // never draw past the total row
    const base = ry - 10;
    text(String(i + 1), colX[0] + PAD, base, 8, mono);
    desc.forEach((d, k) => text(d, colX[1] + PAD, base - k * 9.6, 8));
    right(String(ln.quantity), colX[2] + cols[2].w - PAD, base, 8, mono);
    right(money(ln.unitCentavos), colX[3] + cols[3].w - PAD, base, 8, mono);
    right(money(ln.unitCentavos * ln.quantity), colX[4] + cols[4].w - PAD, base, 8, monoBold);
    ry -= h;
    page.drawLine({ start: { x: X0, y: ry }, end: { x: X1, y: ry }, thickness: 0.4, color: c.hair });
  });
  // Blank rows fill the rest of the table.
  while (ry - rowH >= tableBottom + 0.5) { ry -= rowH; page.drawLine({ start: { x: X0, y: ry }, end: { x: X1, y: ry }, thickness: 0.4, color: c.hair }); }
  colX.slice(1).forEach((x) => page.drawLine({ start: { x, y: tableTop }, end: { x, y: tableBottom }, thickness: 0.5, color: c.rule }));
  page.drawRectangle({ x: X0, y: tableBottom, width: CW, height: tableTop - tableBottom, borderColor: c.rule, borderWidth: 0.5 });
  y = tableBottom;

  // 5. Total and amount in words.
  const totW = 150;
  page.drawRectangle({ x: X0, y: y - totalH, width: CW, height: totalH, color: c.tint });
  box(X0, y - totalH, CW - totW, totalH);
  cap("Amount in words", X0 + PAD, y - 9);
  wrap(pesosInWords(snapshot.amountCentavos), 8.4, CW - totW - 2 * PAD, bold, 2).forEach((l, k) => text(l, X0 + PAD, y - 20 - k * 9.6, 8.4, bold));
  box(X1 - totW, y - totalH, totW, totalH);
  cap("Total amount", X1 - totW + PAD, y - 9);
  right(`PHP ${money(snapshot.amountCentavos)}`, X1 - PAD, y - 26, 12.5, bold, c.navy);
  y -= totalH;

  // 6. Signatures.
  const sigs = [
    { label: "Prepared by", name: snapshot.preparedBy, note: [snapshot.preparedAt].filter(Boolean).join("") || "Cashier" },
    { label: "Approved by", name: snapshot.approvedBy, note: snapshot.approvedAt || "Accounting Manager" },
    { label: "Released by", name: snapshot.releasedBy ?? "", note: snapshot.releasedAt || "Cashier" },
    { label: "Received by", name: "", note: "Payee signature over printed name, date" },
  ];
  sigs.forEach((s, i) => {
    const w = CW / sigs.length, x = X0 + i * w;
    box(x, y - sigH, w, sigH);
    cap(s.label, x + PAD, y - 9);
    const lineY = y - sigH + 17;
    if (s.name) text(fit(s.name, 8.4, w - 2 * PAD, bold), x + PAD, lineY + 3, 8.4, bold);
    page.drawLine({ start: { x: x + PAD, y: lineY }, end: { x: x + w - PAD, y: lineY }, thickness: 0.6, color: c.ink });
    text(fit(s.note, 6, w - 2 * PAD), x + PAD, lineY - 9, 6, reg, c.muted);
  });

  // Outer frame and footer.
  page.drawRectangle({ x: X0, y: bottom, width: CW, height: top - bottom, borderColor: c.navy, borderWidth: 1.2 });
  text("Keep with the official receipt for accounting and audit. Amounts are in Philippine peso.", X0, FOOT - 4, 6, reg, c.muted);
  right("Form EV-02  |  Ride the New Wave of Maritime Excellence", X1, FOOT - 4, 6, reg, c.muted);
  return pdf.save();
}

export type DailyExpensesSnapshot = {
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

/** Daily expenses summary — one A4 portrait page (paginated) listing the day's
 * expense vouchers with payment channel, reference, status, and totals. */
export async function createDailyExpensesPdf(snapshot: DailyExpensesSnapshot) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const orange = rgb(0.949, 0.337, 0.086), dark = rgb(0.071, 0.247, 0.388), gray = rgb(0.42, 0.45, 0.5), line = rgb(0.85, 0.88, 0.9);
  const W = 595.28, H = 841.89, margin = 40;
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
  let page = doc.addPage([W, H]);
  let y = H - margin;
  const header = async () => {
    if (snapshot.logoBytes) { try { const img = await doc.embedPng(snapshot.logoBytes); const d = img.scaleToFit(46, 46); page.drawImage(img, { x: margin, y: y - d.height + 6, width: d.width, height: d.height }); } catch { /* skip logo */ } }
    page.drawText("New Wave Maritime Training and Assessment Center, Inc.", { x: margin + 54, y: y - 8, size: 11, font: bold, color: dark });
    page.drawText(snapshot.title ?? "Daily Expenses Summary", { x: margin + 54, y: y - 24, size: 15, font: bold, color: orange });
    page.drawText(snapshot.dateLabel, { x: margin + 54, y: y - 40, size: 10, font, color: gray });
    y -= 66;
    drawHead();
  };
  const drawHead = () => {
    page.drawRectangle({ x: margin, y: y - 4, width: W - margin * 2, height: 18, color: rgb(0.96, 0.98, 0.99) });
    for (const c of cols) page.drawText(c.label, { x: c.align === "right" ? c.x + c.w - (bold.widthOfTextAtSize(c.label, 8) + 2) : c.x + 2, y, size: 8, font: bold, color: dark });
    y -= 18;
  };
  await header();
  for (const r of snapshot.rows) {
    if (y < margin + 60) { page = doc.addPage([W, H]); y = H - margin; drawHead(); }
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
    if (y < margin + 40 + snapshot.channelTotals.length * 15) { page = doc.addPage([W, H]); y = H - margin; }
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
  y -= 40;
  page.drawText(`Prepared by: ${snapshot.preparedBy || "—"}`, { x: margin, y, size: 9, font, color: rgb(0.15, 0.18, 0.22) });
  page.drawText("Amounts are in Philippine peso. Retain for accounting and audit.", { x: margin, y: margin - 12, size: 7.5, font, color: gray });
  return doc.save();
}

export type PayslipSnapshot = {
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

export async function createPaymentInvoicePdf(snapshot:PaymentSnapshot){
  return createBrandedPdf({title:"Payment Invoice",reference:snapshot.invoiceNumber,issuedAt:new Date(snapshot.receivedAt).toLocaleString("en-PH"),recipient:snapshot.traineeName,sections:[
    {heading:"Billed to",rows:[{label:"Trainee",value:snapshot.traineeName},{label:"Trainee number",value:snapshot.traineeNumber},{label:"Address",value:snapshot.address||"-"},{label:"Enrollment",value:snapshot.enrollmentNumber}]},
    {heading:"Training and payment",rows:[{label:"Course",value:snapshot.course},{label:"Payment",value:snapshot.paymentNumber},{label:"Payment method",value:snapshot.method},{label:"Transaction reference",value:snapshot.referenceNumber||"Manual / none"},{label:"This payment",value:php(snapshot.amountCentavos)},{label:"Total course fee",value:php(snapshot.totalDueCentavos)},{label:"Total paid",value:php(snapshot.totalPaidCentavos)},{label:"Remaining balance",value:php(snapshot.balanceCentavos)}]},
  ],footer:"This invoice was generated automatically from an immutable payment snapshot. An acknowledgment receipt is issued separately."});
}

export type CashierReportSnapshot = {
  dateLabel: string;
  preparedBy: string;
  checkedBy?: string;
  logoBytes?: Uint8Array;
  position: { previousLabel: string; previousNote?: string; previousCentavos: number; cashCollectedCentavos: number; cashExpensesCentavos: number; onHandCentavos: number; countedCentavos: number | null; overShortCentavos: number | null };
  channels: string[];
  matrix: { source: string; cells: { channel: string; count: number; totalCentavos: number }[]; count: number; totalCentavos: number }[];
  groups: { kind: string; name: string; rows: { receipt: string; time: string; trainee: string; course: string; channel: string; reference: string; amountCentavos: number; proof?: boolean }[]; subtotalCentavos: number }[];
  expenses: { voucher: string; payee: string; category: string; channel: string; reference: string; status: string; amountCentavos: number }[];
  expenseTotals: { channel: string; totalCentavos: number }[];
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
  const W = 595.28, H = 841.89, M = 32, CW = W - 2 * M;
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  type Font = typeof reg;
  const c = { navy: rgb(.071, .247, .388), orange: rgb(.949, .337, .082), blue: rgb(.02, .443, .816), cyan: rgb(.208, .8, .98), ink: rgb(.08, .16, .23), muted: rgb(.37, .44, .5), rule: rgb(.78, .83, .87), hair: rgb(.88, .91, .94), tint: rgb(.933, .965, .984), green: rgb(.04, .48, .24), red: rgb(.7, .14, .1), white: rgb(1, 1, 1) };
  const money = (v: number) => `${v < 0 ? "-" : ""}${(Math.abs(v) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (s.logoBytes) { try { logo = await pdf.embedPng(s.logoBytes); } catch { logo = null; } }
  let page = pdf.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;
  const text = (t: string, x: number, yy: number, size: number, font: Font = reg, color = c.ink) => page.drawText(ascii(t), { x, y: yy, size, font, color });
  const right = (t: string, xr: number, yy: number, size: number, font: Font = reg, color = c.ink) => text(t, xr - font.widthOfTextAtSize(ascii(t), size), yy, size, font, color);
  const fit = (t: string, size: number, maxW: number, font: Font = reg) => {
    let v = ascii(t ?? "");
    if (font.widthOfTextAtSize(v, size) <= maxW) return v;
    while (v.length > 1 && font.widthOfTextAtSize(`${v}...`, size) > maxW) v = v.slice(0, -1);
    return `${v}...`;
  };
  const footer = () => {
    text("Ride the New Wave of Maritime Excellence  |  Amounts in Philippine peso", M, 18, 6.5, reg, c.muted);
    right(`Page ${pageNo}`, W - M, 18, 6.5, reg, c.muted);
  };
  const ensure = (need: number, again?: () => void) => {
    if (y - need >= 70) return;
    footer();
    page = pdf.addPage([W, H]); pageNo += 1; y = H - M;
    text(`Cashier summary report  |  ${s.dateLabel} (continued)`, M, y - 10, 8, bold, c.navy);
    y -= 22;
    again?.();
  };
  const section = (title: string, aside?: string) => {
    ensure(40);
    y -= 8;
    text(title.toUpperCase(), M, y - 9, 8, bold, c.navy);
    if (aside) right(aside, W - M, y - 9, 7.5, reg, c.muted);
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: c.navy });
    y -= 2;
  };
  type Col = { label: string; w: number; align?: "right"; font?: Font };
  const tableHead = (cols: Col[]) => {
    page.drawRectangle({ x: M, y: y - 14, width: CW, height: 14, color: c.tint });
    let x = M;
    for (const col of cols) {
      const w = CW * col.w;
      if (col.align === "right") right(col.label.toUpperCase(), x + w - 4, y - 9.5, 6, bold, c.navy); else text(col.label.toUpperCase(), x + 4, y - 9.5, 6, bold, c.navy);
      x += w;
    }
    y -= 14;
  };
  const tableRow = (cols: Col[], cells: string[], opts: { bold?: boolean; fill?: boolean } = {}) => {
    const h = 13.5;
    if (opts.fill) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: c.tint });
    let x = M;
    cols.forEach((col, i) => {
      const w = CW * col.w, font = opts.bold ? bold : col.font ?? reg, v = fit(cells[i] ?? "", 7.6, w - 8, font);
      if (col.align === "right") right(v, x + w - 4, y - 9.5, 7.6, font); else text(v, x + 4, y - 9.5, 7.6, font);
      x += w;
    });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: c.hair });
  };

  // Letterhead.
  page.drawRectangle({ x: M, y: y - 50, width: CW, height: 50, color: c.navy });
  if (logo) { page.drawCircle({ x: M + 25, y: y - 25, size: 18, color: c.white }); const d = logo.scale(30 / Math.max(logo.width, logo.height)); page.drawImage(logo, { x: M + 25 - d.width / 2, y: y - 25 - d.height / 2, width: d.width, height: d.height }); }
  text("New Wave Maritime Training and Assessment Center, Inc.", M + 52, y - 21, 10.5, bold, c.white);
  text("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000", M + 52, y - 33, 6.6, reg, rgb(.62, .89, .945));
  right("CASHIER SUMMARY REPORT", W - M - 12, y - 21, 11, bold, c.white);
  right(s.dateLabel, W - M - 12, y - 34, 8, reg, rgb(.62, .89, .945));
  y -= 50;
  const third = CW / 3;
  page.drawRectangle({ x: M, y: y - 3, width: third, height: 3, color: c.orange });
  page.drawRectangle({ x: M + third, y: y - 3, width: third, height: 3, color: c.cyan });
  page.drawRectangle({ x: M + 2 * third, y: y - 3, width: CW - 2 * third, height: 3, color: c.blue });
  y -= 10;

  // 1. Cash position.
  section("1. Cash position", "Cash only");
  const p = s.position;
  const boxes: [string, string, typeof c.ink, string?][] = [
    [p.previousLabel, money(p.previousCentavos), c.ink, p.previousNote],
    ["+ Cash collected", money(p.cashCollectedCentavos), c.green],
    ["- Cash expenses", money(p.cashExpensesCentavos), c.red],
    ["= Cash on hand", money(p.onHandCentavos), c.navy],
    ["Counted at closing", p.countedCentavos == null ? "Not yet" : money(p.countedCentavos), c.ink],
    ["Over / short", p.overShortCentavos == null ? "-" : `${p.overShortCentavos > 0 ? "+" : ""}${money(p.overShortCentavos)}`, p.overShortCentavos ? (p.overShortCentavos < 0 ? c.red : c.green) : c.ink],
  ];
  const bw = CW / boxes.length, bh = 42;
  boxes.forEach(([label, value, color, note], i) => {
    const x = M + i * bw;
    page.drawRectangle({ x, y: y - bh, width: bw, height: bh, borderColor: c.rule, borderWidth: 0.5, ...(i === 3 ? { color: c.tint } : {}) });
    text(fit(label.toUpperCase(), 5.8, bw - 8, bold), x + 5, y - 11, 5.8, bold, c.muted);
    text(fit(value, i === 3 ? 11 : 10, bw - 10, bold), x + 5, y - 27, i === 3 ? 11 : 10, bold, color);
    if (note) text(fit(note, 6, bw - 10), x + 5, y - 37, 6, reg, c.muted);
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
  text("Amounts in pesos; receipts in brackets.", M, y - 9, 6.2, reg, c.muted);
  y -= 12;

  // 3. Collections detail.
  section("3. Collections detail");
  const dCols: Col[] = [{ label: "Receipt", w: 0.165, font: mono }, { label: "Time", w: 0.08 }, { label: "Trainee", w: 0.195 }, { label: "Course", w: 0.2 }, { label: "Channel", w: 0.1 }, { label: "Reference", w: 0.12, font: mono }, { label: "Amount", w: 0.14, align: "right" }];
  if (!s.groups.length) { text("No collections on this day.", M, y - 10, 8, reg, c.muted); y -= 16; }
  for (const g of s.groups) {
    ensure(48);
    page.drawRectangle({ x: M, y: y - 15, width: CW, height: 15, color: rgb(.96, .97, .98) });
    text(`${g.kind}${g.name && g.name !== g.kind ? `  |  ${g.name}` : ""}`, M + 4, y - 10.5, 8, bold, c.navy);
    right(`${g.rows.length} receipt${g.rows.length === 1 ? "" : "s"}  |  PHP ${money(g.subtotalCentavos)}`, W - M - 4, y - 10.5, 7.6, bold, c.navy);
    y -= 15;
    tableHead(dCols);
    for (const r of g.rows) { ensure(14, () => tableHead(dCols)); tableRow(dCols, [r.receipt, r.time, r.trainee, r.course, r.channel, r.reference || "-", money(r.amountCentavos)]); }
    y -= 6;
  }

  // 4. Expenses.
  const expTotal = s.expenses.reduce((t, e) => t + e.amountCentavos, 0);
  section("4. Expenses", `${s.expenses.length} voucher${s.expenses.length === 1 ? "" : "s"}  |  PHP ${money(expTotal)}`);
  const eCols: Col[] = [{ label: "Voucher no.", w: 0.15, font: mono }, { label: "Payee", w: 0.22 }, { label: "Category", w: 0.15 }, { label: "Channel", w: 0.1 }, { label: "Reference", w: 0.13, font: mono }, { label: "Status", w: 0.1 }, { label: "Amount", w: 0.15, align: "right" }];
  if (!s.expenses.length) { text("No expenses on this day.", M, y - 10, 8, reg, c.muted); y -= 16; }
  else {
    tableHead(eCols);
    for (const e of s.expenses) { ensure(14, () => tableHead(eCols)); tableRow(eCols, [e.voucher, e.payee, e.category, e.channel || "-", e.reference || "-", e.status, money(e.amountCentavos)]); }
    for (const t of s.expenseTotals) tableRow(eCols, ["", "", "", t.channel, "", "Subtotal", money(t.totalCentavos)]);
    tableRow(eCols, ["Total", "", "", "", "", "", money(expTotal)], { bold: true, fill: true });
  }

  // 5. Signatures.
  ensure(70);
  y -= 34;
  const sw = (CW - 40) / 2;
  [["Prepared by", s.preparedBy, "Cashier"], ["Checked by", s.checkedBy ?? "", "Accounting Manager"]].forEach(([label, name, role], i) => {
    const x = M + i * (sw + 40);
    if (name) text(name, x, y + 4, 9, bold);
    page.drawLine({ start: { x, y }, end: { x: x + sw, y }, thickness: 0.6, color: c.ink });
    text(`${label}  |  ${role}  |  signature over printed name, date`, x, y - 10, 6.6, reg, c.muted);
  });
  footer();
  return pdf.save();
}
