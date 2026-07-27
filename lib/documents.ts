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
export type AdmissionInvoiceSnapshot = {
  reference: string;
  traineeName: string;
  traineeNumber: string;
  srn: string;
  mobile: string;
  email: string;
  course: string;
  schedule: string;
  time: string;
  venue: string;
  instructor: string;
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
  const panel = rgb(0.95, 0.98, 0.99);
  const green = rgb(0.05, 0.5, 0.25);
  const left = 20; // narrow margins to fit two copies
  const right = width - 20;
  const mid = left + Math.round((right - left) / 2);

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

  // Draws one combined copy anchored at the band whose bottom edge is `baseY`.
  const drawCopy = (baseY: number, copyLabel: string) => {
    let y = baseY + bandH - 14;
    let headerX = left;
    if (logo) {
      const dims = logo.scale(34 / logo.width);
      page.drawImage(logo, { x: left, y: y - dims.height + 8, width: dims.width, height: dims.height });
      headerX = left + dims.width + 10;
    }
    page.drawText("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", { x: headerX, y, size: 9, font: bold, color: ink });
    page.drawText("Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000", { x: headerX, y: y - 11, size: 6.5, font: regular, color: muted });
    page.drawText("TRAINEE ADMISSION RECORD", { x: headerX, y: y - 26, size: 12, font: bold, color: orange });

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

    y -= 34;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1.2, color: blue });
    y -= 14;

    // Meta row
    const meta = [
      { label: "Reference", value: snapshot.reference },
      { label: "Trainee No.", value: snapshot.traineeNumber },
      { label: "Issued", value: snapshot.issuedAt },
    ];
    const step = (right - left) / meta.length;
    meta.forEach((field, index) => {
      const x = left + step * index;
      page.drawText(field.label, { x, y, size: 6, font: regular, color: muted });
      page.drawText(field.value.slice(0, 30), { x, y: y - 9, size: 8, font: bold, color: ink });
    });
    y -= 18;

    // Two-column detail grid (trainee + training details)
    const cols: { label: string; value: string }[] = [
      { label: "Name", value: snapshot.traineeName },
      { label: "SRN", value: snapshot.srn || "-" },
      { label: "Mobile", value: snapshot.mobile || "-" },
      { label: "Email", value: snapshot.email || "-" },
      { label: "Course", value: snapshot.course },
      { label: "Schedule", value: snapshot.schedule },
      { label: "Time", value: snapshot.time },
      { label: "Classroom", value: snapshot.venue || "-" },
      { label: "Instructor", value: snapshot.instructor || "-" },
      { label: "Registration status", value: snapshot.registrationStatus || "-" },
    ];
    for (let i = 0; i < cols.length; i += 2) {
      const a = cols[i];
      const b = cols[i + 1];
      page.drawText(a.label, { x: left, y, size: 6, font: regular, color: muted });
      if (b) page.drawText(b.label, { x: mid, y, size: 6, font: regular, color: muted });
      y -= 8;
      page.drawText(a.value.slice(0, 44), { x: left, y, size: 8, font: bold, color: ink });
      if (b) page.drawText(b.value.slice(0, 44), { x: mid, y, size: 8, font: bold, color: ink });
      y -= 11;
    }
    y -= 2;

    // Charges & payments
    page.drawText("CHARGES & PAYMENTS", { x: left, y, size: 7.5, font: bold, color: blue });
    y -= 4;
    const rows = snapshot.lines.length ? snapshot.lines : [{ description: "No ledger entries yet.", amountCentavos: 0 }];
    rows.forEach((item) => {
      const rowH = item.detail ? 22 : 15;
      y -= rowH;
      page.drawRectangle({ x: left, y, width: right - left, height: rowH, color: panel });
      page.drawRectangle({ x: left, y, width: 3, height: rowH, color: item.negative ? green : blue });
      page.drawText(item.description.slice(0, 60), { x: left + 10, y: y + rowH - 11, size: 7.5, font: bold, color: ink });
      if (item.detail) page.drawText(item.detail.slice(0, 92), { x: left + 10, y: y + 5, size: 6, font: regular, color: muted });
      if (item.amountCentavos) {
        const amount = `${item.negative ? "-" : ""}${php(item.amountCentavos)}`;
        page.drawText(amount, { x: right - 8 - bold.widthOfTextAtSize(amount, 8), y: y + rowH / 2 - 3, size: 8, font: bold, color: item.negative ? green : ink });
      }
      y -= 3;
    });

    // Totals
    y -= 2;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.6, color: line });
    y -= 11;
    const totals = [
      { label: "Total due", value: php(snapshot.dueCentavos) },
      { label: "Total paid", value: php(snapshot.paidCentavos) },
      { label: "Balance", value: php(snapshot.balanceCentavos) },
    ];
    const tStep = (right - left) / totals.length;
    totals.forEach((t, index) => {
      const x = left + tStep * index;
      page.drawText(t.label, { x, y, size: 6, font: regular, color: muted });
      page.drawText(t.value, { x, y: y - 10, size: 9, font: bold, color: t.label === "Balance" && snapshot.balanceCentavos > 0 ? rgb(0.78, 0.12, 0.12) : ink });
    });
    y -= 26;

    // Signatures
    const sigs = [
      { label: "Registration Officer — Signature over Printed Name", name: snapshot.officer },
      { label: "Cashier — Signature over Printed Name", name: snapshot.cashier },
    ];
    const sStep = (right - left) / sigs.length;
    sigs.forEach((sig, index) => {
      const x = left + sStep * index;
      page.drawText((sig.name || " ").slice(0, 28), { x, y: y + 4, size: 7.5, font: bold, color: ink });
      page.drawLine({ start: { x, y }, end: { x: x + sStep - 24, y }, thickness: 0.6, color: line });
      page.drawText(sig.label, { x, y: y - 9, size: 6, font: regular, color: muted });
    });

    page.drawText("Present the ORIGINAL copy on the first training day with a valid ID. Amounts reflect the enrollment ledger.", { x: left, y: baseY + 12, size: 5.5, font: regular, color: muted });
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
