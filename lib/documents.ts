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

export async function createPaymentInvoicePdf(snapshot:PaymentSnapshot){
  return createBrandedPdf({title:"Payment Invoice",reference:snapshot.invoiceNumber,issuedAt:new Date(snapshot.receivedAt).toLocaleString("en-PH"),recipient:snapshot.traineeName,sections:[
    {heading:"Billed to",rows:[{label:"Trainee",value:snapshot.traineeName},{label:"Trainee number",value:snapshot.traineeNumber},{label:"Address",value:snapshot.address||"-"},{label:"Enrollment",value:snapshot.enrollmentNumber}]},
    {heading:"Training and payment",rows:[{label:"Course",value:snapshot.course},{label:"Payment",value:snapshot.paymentNumber},{label:"Payment method",value:snapshot.method},{label:"Transaction reference",value:snapshot.referenceNumber||"Manual / none"},{label:"This payment",value:php(snapshot.amountCentavos)},{label:"Total course fee",value:php(snapshot.totalDueCentavos)},{label:"Total paid",value:php(snapshot.totalPaidCentavos)},{label:"Remaining balance",value:php(snapshot.balanceCentavos)}]},
  ],footer:"This invoice was generated automatically from an immutable payment snapshot. An acknowledgment receipt is issued separately."});
}
