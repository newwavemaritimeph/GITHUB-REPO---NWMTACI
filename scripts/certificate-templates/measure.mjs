// Reads the PDFs made by convert.ps1 and records where the portal writes each
// field (owner, 20 Oct 2026). The placeholders are still in the PDF as invisible
// text in {CODE}.measure.pdf (same layout), so their exact positions are known. Writes {CODE}.json next to each PDF:
// the template's `fields` (version 2) used by lib/certificates.ts.
//
// pdfjs-dist is not a project dependency; install it anywhere and point to it:
//   npm i --prefix <dir> pdfjs-dist@4.10.38
//   PDFJS_DIR=<dir>/node_modules/pdfjs-dist node scripts/certificate-templates/measure.mjs <out folder>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
if (!dir || !process.env.PDFJS_DIR) throw new Error("Usage: PDFJS_DIR=<pdfjs-dist folder> node measure.mjs <out folder>");
const pdfjs = await import(pathToFileURL(path.join(process.env.PDFJS_DIR, "legacy/build/pdf.mjs")).href);
const r1 = (n) => Math.round(n * 10) / 10;
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

const problems = [];
let count = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".word.json"))) {
  const code = file.replace(/\.word\.json$/, "");
  const word = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8").replace(/^﻿/, ""));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, `${code}.measure.pdf`))), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const { width: W, height: H } = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.filter((i) => i.str?.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.hypot(i.transform[0], i.transform[1]) }));
  const find = (t) => items.find((i) => i.s.includes(t));
  const sameLine = (y) => items.filter((i) => Math.abs(i.y - y) < 0.6);
  const span = (line) => ({ left: Math.min(...line.map((i) => i.x)), right: Math.max(...line.map((i) => i.x + i.w)) });
  const fields = { version: 2, pageW: r1(W), pageH: r1(H) };

  const name = find("[TRAINEE FULL NAME]");
  if (name) fields.name = { cx: r1(name.x + name.w / 2), y: r1(name.y), size: r1(name.size), bold: word.name?.bold ?? true, maxW: r1(W - 2 * 56.7) };

  const dated = find("[START DATE]") ?? find("[DATE]");
  const issued = find("Issued this");
  if (dated && word.conducted?.text) {
    // The paragraph's lines: same size, from the first line down to just above "Issued this".
    const ys = [...new Set(items.filter((i) => Math.abs(i.size - dated.size) < 0.2 && i.y <= dated.y + 0.5 && (!issued || i.y > issued.y + 1)).map((i) => r1(i.y)))].sort((a, b) => b - a);
    const lines = [];
    for (const y of ys) { if (lines.length && lines[lines.length - 1] - y > dated.size * 2) break; lines.push(y); }
    const spans = lines.map((y) => span(sameLine(y)));
    const left = Math.min(...spans.map((s) => s.left)), right = Math.max(...spans.map((s) => s.right));
    fields.conducted = { x: r1(left), y: r1(dated.y), w: r1(right - left), size: r1(dated.size), leading: r1(lines.length > 1 ? lines[0] - lines[1] : dated.size * 1.18), lines: lines.length, align: word.conducted.align, text: word.conducted.text };
  }
  if (issued && word.issued?.text) {
    const s = span(sameLine(issued.y));
    fields.issued = { cx: r1((s.left + s.right) / 2), y: r1(issued.y), size: r1(issued.size), text: word.issued.text };
  }
  const cert = find("[CERTIFICATE NO.]"), reg = find("[REGISTRATION NO.]");
  if (cert) fields.certNo = { x: r1(cert.x), y: r1(cert.y), size: r1(cert.size) };
  if (reg) fields.regNo = { x: r1(reg.x), y: r1(reg.y), size: r1(reg.size) };

  // The QR Verify picture: the image drawn at the size Word reported.
  if (word.qr) {
    const ops = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === pdfjs.OPS.save) stack.push(ctm);
      else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === pdfjs.OPS.transform) ctm = mul(ops.argsArray[i], ctm);
      else if ((fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) && Math.abs(ctm[0] - word.qr.w) < 1.5 && Math.abs(ctm[3] - word.qr.h) < 1.5) {
        fields.qr = { x: r1(ctm[4]), y: r1(ctm[5]), w: r1(ctm[0]), h: r1(ctm[3]) };
        break;
      }
    }
  }
  const missing = ["name", "conducted", "issued", "certNo", "regNo", "qr"].filter((k) => !fields[k]);
  if (doc.numPages !== 1) missing.push(`${doc.numPages} pages`);
  if (missing.length) problems.push(`${code}: missing ${missing.join(", ")}`);
  fs.writeFileSync(path.join(dir, `${code}.json`), JSON.stringify(fields, null, 1));
  count++;
}
console.log(`Measured ${count}`);
if (problems.length) console.log(problems.join("\n"));
