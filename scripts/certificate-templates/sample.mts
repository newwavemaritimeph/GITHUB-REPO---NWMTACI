// Renders a filled sample from a converted template, to check positions before importing.
//   npx tsx scripts/certificate-templates/sample.mts <out folder> <CODE> <sample.pdf> "<Name>" <start> <end> <Cert No.> <Reg No.>
import fs from "node:fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { drawTemplateFields } from "@/lib/certificate-overlay";
import { detectPhotoBox } from "@/lib/certificate-template";
const [dir, code, out, name, start, end, cert, regNo] = process.argv.slice(2);
const bytes = new Uint8Array(fs.readFileSync(`${dir}/${code}.pdf`));
const fields = JSON.parse(fs.readFileSync(`${dir}/${code}.json`, "utf8"));
// As lib/certificates.ts does: the template is placed as an embedded page, so its graphics state cannot leak into the overlay.
const src = await PDFDocument.load(bytes), pdf = await PDFDocument.create();
const [copied] = await pdf.copyPages(src, [0]);
const page = pdf.addPage([copied.getWidth(), copied.getHeight()]);
page.drawPage(await pdf.embedPage(copied), { x: 0, y: 0, width: copied.getWidth(), height: copied.getHeight() });
await drawTemplateFields(pdf, page, fields, { name, startsOn: start, endsOn: end, issuedOn: "2026-10-20", certificateNumber: cert, registrationNumber: regNo, verifyUrl: "https://newwavemaritimemtaci.com/verify/8KX4-Q2PM-7TZD" });
const box = await detectPhotoBox(bytes);
if (box) { page.drawRectangle({ x: box.x + 2, y: box.y + 2, width: box.w - 4, height: box.h - 4, color: rgb(0.86, 0.9, 0.93) }); const f = await pdf.embedFont(StandardFonts.Helvetica); page.drawText("2x2 PHOTO", { x: box.x + box.w / 2 - 22, y: box.y + box.h / 2, size: 8, font: f, color: rgb(0.4, 0.45, 0.5) }); }
fs.writeFileSync(out, await pdf.save());
console.log("photo box", box ? `${box.w.toFixed(0)}x${box.h.toFixed(0)} ${box.source}` : "none");
