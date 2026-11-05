// UBT-PSSR training certificate (owner, 5 Nov 2026): page 1 of the owner's PDF with the sample text lifted out
// (name, the two date paragraphs' sentence, the issued line, "Operational Manager"), then "Operations Manager" and the
// Certificate No. / Registration No. labels added. The portal fills the rest from the UBT-PSSR---Training-Certificate.pdf
// entry in lib/certificate-template-layouts.json.
//   npx tsx scripts/certificate-templates/ubt-pssr.mts "<UBT-PSSR (TEMPLATE).pdf>" "<UBT-PSSR - Training Certificate.pdf>"
import fs from "node:fs";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, rgb } from "pdf-lib";

const [source, out] = process.argv.slice(2);
if (!source || !out) throw new Error("Give the owner's PDF and the output file.");
const doc = await PDFDocument.load(fs.readFileSync(source));
while (doc.getPageCount() > 1) doc.removePage(1);
const page = doc.getPages()[0];
const contents = page.node.Contents();
const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
let text = "";
for (const s of streams) text += Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : (s as unknown as { getContents(): Uint8Array }).getContents()).toString("latin1") + "\n";

// The lines that change per trainee, found by where they sit on the page.
const lifted = (x: number, y: number) => Math.abs(y - 540) < 3 || (y > 305 && y < 355) || Math.abs(y - 267) < 3 || (Math.abs(y - 184) < 3 && x < 250);
let removed = 0;
const kept = text.replace(/BT\s[\s\S]*?\sET/g, (block) => {
  const m = block.match(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/);
  if (m && lifted(Number(m[1]), Number(m[2]))) { removed += 1; return ""; }
  return block;
});
if (removed < 20) throw new Error(`Only ${removed} text blocks were lifted; the source PDF changed.`);
page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(Buffer.from(kept, "latin1"))));

// Embedded as a page, so its graphics state cannot leak into what is drawn on top.
const clean = await PDFDocument.load(await doc.save()), pdf = await PDFDocument.create();
const [copied] = await pdf.copyPages(clean, [0]);
const W = copied.getWidth(), H = copied.getHeight();
const p = pdf.addPage([W, H]);
p.drawPage(await pdf.embedPage(copied), { x: 0, y: 0, width: W, height: H });
const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), ink = rgb(0, 0, 0);
const title = "Operations Manager";
p.drawText(title, { x: 120 - reg.widthOfTextAtSize(title, 12) / 2, y: 184, size: 12, font: reg, color: ink });
p.drawText("Certificate No.:", { x: 56.55, y: 112, size: 10, font: bold, color: ink });
p.drawText("Registration No.:", { x: 56.55, y: 97, size: 10, font: bold, color: ink });
fs.writeFileSync(out, await pdf.save());
console.log({ removed, pages: pdf.getPageCount(), size: [W, H] });
