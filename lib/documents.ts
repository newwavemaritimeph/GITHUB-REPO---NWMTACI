import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

const INSTRUCTION_TERMS: [string, string[]][] = [
  ["Payment Terms", ["50% down payment required upon enrollment; full payment before completion.", "Full payment is required for 1-day courses."]],
  ["Cancellation", ["Communicate cancellations before the scheduled date.", "Charges per the Refund Policy."]],
  ["Rescheduling", ["1-2 day courses may be rescheduled, subject to slots and approval.", "Reschedule charges per the Refund Policy."]],
  ["Refund", ["5+ days before: Php 350.00 processing fee.", "Under 5 days before: 50% of course fee + Php 250.00 fee."]],
  ["Make-up Class", ["Available for 3-day+ courses, subject to approval.", "Php 350.00 per training day."]],
  ["Certificate", ["Issued only after completing all requirements and settling all balances."]],
];

// Option 1 design: centered logo, minimal editorial letter, single page, Terms & Conditions
// combined at the bottom (two compact columns).
export async function createTrainingInstructionsPdf(snapshot: TrainingInstructionsSnapshot) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const c = { orange: rgb(.949,.337,.082), blue: rgb(.02,.443,.816), cyan: rgb(.208,.8,.98), lightcyan: rgb(.62,.89,.945), darkblue: rgb(.071,.247,.388), muted: rgb(.42,.5,.56), line: rgb(.85,.92,.96), soft: rgb(.93,.985,1) };
  const H = 841.89, mid = 595.28 / 2, left = 48, right = 547, width = right - left;
  const text = (t: string, x: number, yy: number, size: number, font = reg, color = c.darkblue) => page.drawText(ascii(t), { x, y: yy, size, font, color });
  const wrap = (t: string, x: number, yy: number, size: number, maxW: number, font = reg, color = c.darkblue, lead = 12) => {
    let line = "";
    for (const w of ascii(t).split(" ")) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW) { page.drawText(line, { x, y: yy, size, font, color }); yy -= lead; line = w; }
      else line = test;
    }
    if (line) { page.drawText(line, { x, y: yy, size, font, color }); yy -= lead; }
    return yy;
  };
  let y = H - 26;
  // Centered logo + orange rule + title.
  if (snapshot.logoBytes) {
    try { const logo = await pdf.embedPng(snapshot.logoBytes); const d = logo.scale(58 / logo.width); page.drawImage(logo, { x: mid - d.width / 2, y: y - d.height, width: d.width, height: d.height }); y -= d.height + 8; } catch { y -= 20; }
  }
  page.drawRectangle({ x: mid - 34, y, width: 68, height: 2.5, color: c.orange });
  y -= 22;
  const title = "TRAINING INSTRUCTIONS";
  text(title, mid - bold.widthOfTextAtSize(title, 15) / 2, y, 15, bold);
  y -= 15;
  const sub = `${snapshot.reference ?? ""}${snapshot.reference ? "  -  " : ""}Issued ${snapshot.issuedAt}`;
  text(sub, mid - reg.widthOfTextAtSize(ascii(sub), 8) / 2, y, 8, reg, c.muted);
  y -= 22;
  text(`Dear ${snapshot.traineeName || "Trainee"},`, left, y, 10.5, bold);
  y -= 15;
  // Body (per-course template or default).
  for (const rawLine of ((snapshot.body && snapshot.body.trim()) ? snapshot.body : DEFAULT_INSTRUCTIONS_BODY).split("\n")) {
    if (rawLine === "") { y -= 6; continue; }
    const isReminders = /^IMPORTANT REMINDERS/i.test(rawLine);
    y = wrap(rawLine, left, y, 9, width, isReminders ? bold : reg, isReminders ? c.orange : c.darkblue, 12);
  }
  y -= 6;
  // Training details box.
  const rows: [string, string][] = [["Course", snapshot.courseName], ["Date of Training", snapshot.dateOfTraining], ["Time", snapshot.time], ["Classroom", snapshot.classroom]];
  const boxH = 20 + rows.length * 17;
  page.drawRectangle({ x: left, y: y - boxH + 12, width, height: boxH, color: c.soft, borderColor: c.lightcyan, borderWidth: 1 });
  text("TRAINING DETAILS", left + 12, y - 1, 8.5, bold, c.blue);
  let ry = y - 20;
  for (const [k, v] of rows) { text(k, left + 12, ry, 8.5, reg, c.muted); text(v || "-", left + 140, ry, 9, bold); ry -= 17; }
  y = y - boxH - 4;
  if (snapshot.googleClassroomLink) {
    text("Google Classroom (in-house):", left, y, 8.5, bold);
    text(snapshot.googleClassroomLink, left + 150, y, 8.5, reg, c.blue);
    y -= 16;
  } else { y -= 4; }
  // Terms & Conditions (two columns).
  page.drawRectangle({ x: left, y: y - 15, width, height: 19, color: c.blue });
  text("TERMS AND CONDITIONS", left + 10, y - 10, 10, bold, rgb(1, 1, 1));
  text("Please read carefully.", right - reg.widthOfTextAtSize("Please read carefully.", 7.5) - 8, y - 9, 7.5, reg, rgb(1, 1, 1));
  y -= 26;
  const colW = (width - 20) / 2, colX = [left, left + colW + 20], colY = [y, y];
  INSTRUCTION_TERMS.forEach(([h, items], i) => {
    const ci = i < 3 ? 0 : 1, x = colX[ci]; let cy = colY[ci];
    text(`${i + 1}. ${h}`, x, cy, 8.5, bold); cy -= 11;
    for (const it of items) { text("-", x + 4, cy, 7.5, bold, c.cyan); cy = wrap(it, x + 12, cy, 7.5, colW - 12, reg, c.darkblue, 9.5); cy -= 1; }
    cy -= 4; colY[ci] = cy;
  });
  const footY = Math.min(colY[0], colY[1]) - 4;
  wrap("New Wave Maritime Training and Assessment Center reserves the right to amend, revise, or update the details stated above without prior notice.", left, footY, 7.5, width, bold, c.orange, 10);
  page.drawLine({ start: { x: left, y: 50 }, end: { x: right, y: 50 }, thickness: 0.5, color: c.line });
  text("Unit 103, Bel-Air Apartments, Roxas Boulevard, Ermita Manila   -   newwavemaritime@gmail.com   -   0948-847-6530", left, 38, 7, reg, c.muted);
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
};

/** Expense Voucher ("Expense Invoice") on the shared half-sheet layout. */
export async function createExpenseVoucherPdf(snapshot: ExpenseVoucherSnapshot) {
  return createHalfSheetDocument({
    title: "EXPENSE VOUCHER",
    logoBytes: snapshot.logoBytes,
    meta: [
      { label: "Voucher", value: snapshot.number },
      { label: "Issued", value: snapshot.issuedAt },
      { label: "Status", value: snapshot.status },
    ],
    columns: [
      { label: "Payee", value: snapshot.payee },
      { label: "Category", value: snapshot.category },
      { label: "Purpose", value: snapshot.purpose },
      { label: "Mode of payment", value: snapshot.modeOfPayment || "-" },
      { label: "Quantity / unit", value: `${snapshot.quantity ?? "-"} ${snapshot.unit ?? ""}`.trim() },
      { label: "Requested by", value: snapshot.requestedBy || "-" },
    ],
    totals: [{ label: "Amount", value: php(snapshot.amountCentavos) }, { label: "Status", value: snapshot.status }],
    signatures: [
      { label: "Prepared by — Signature over Printed Name", name: snapshot.preparedBy },
      { label: "Approved by — Signature over Printed Name", name: snapshot.approvedBy },
    ],
    footer: "Disbursement voucher — retain for accounting and audit. Amounts are in Philippine peso.",
  });
}

export type DailyExpensesSnapshot = {
  dateLabel: string;
  rows: { number: string; payee: string; category: string; channel: string; reference: string; status: string; amountCentavos: number }[];
  totalCentavos: number;
  paidCentavos: number;
  preparedBy: string;
  logoBytes?: Uint8Array;
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
    page.drawText("Daily Expenses Summary", { x: margin + 54, y: y - 24, size: 15, font: bold, color: orange });
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
  if (!snapshot.rows.length) { page.drawText("No expenses recorded for this day.", { x: margin, y, size: 9, font, color: gray }); y -= 15; }
  y -= 8;
  page.drawText(`Total expenses: ${php(snapshot.totalCentavos)}`, { x: margin, y, size: 10, font: bold, color: dark });
  page.drawText(`Paid: ${php(snapshot.paidCentavos)}`, { x: margin + 220, y, size: 10, font: bold, color: dark });
  page.drawText(`${snapshot.rows.length} voucher(s)`, { x: W - margin - font.widthOfTextAtSize(`${snapshot.rows.length} voucher(s)`, 9), y, size: 9, font, color: gray });
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
